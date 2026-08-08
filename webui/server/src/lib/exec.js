import { execFile, spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { AppError } from './errors.js'
import { log } from './log.js'
import { redact } from './redact.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const webuiRoot = path.resolve(here, '../../..')

/**
 * Every external binary this app runs goes through here.
 *
 * Two reasons. First, security: `execFile`/`spawn` with an argv array means a
 * model path or an API key can never be reinterpreted by a shell — `shell:true`
 * is banned in this file and enforced by ESLint everywhere else. Second,
 * testability: because the binary is looked up through this table, the whole
 * app runs on a Mac without podman by pointing `SHX_PODMAN_BIN` at a fixture
 * script. That indirection is what makes the mock mode a config swap rather
 * than a code branch.
 */
const BINARIES = {
  podman: process.env.SHX_PODMAN_BIN || 'podman',
  hf: process.env.SHX_HF_BIN || 'hf',
  git: process.env.SHX_GIT_BIN || 'git',
  python3: process.env.SHX_PYTHON_BIN || 'python3',
  systemctl: process.env.SHX_SYSTEMCTL_BIN || 'systemctl',
  'systemd-run': process.env.SHX_SYSTEMD_RUN_BIN || 'systemd-run',
}

export function binaryPath(key) {
  const bin = BINARIES[key]
  if (!bin) throw new Error(`Unknown binary key: ${key}`)
  // A relative override is resolved against webui/ so dev/bin/podman works
  // regardless of the process's working directory.
  return bin.includes('/') && !path.isAbsolute(bin) ? path.join(webuiRoot, bin) : bin
}

export const isMock = process.env.SHX_MOCK === '1'

/**
 * Environment handed to subprocesses. An allowlist rather than `process.env`,
 * so nothing we hold (secrets, config paths) leaks into a container runtime or
 * a Python script that did not ask for it.
 */
function baseEnv(extra = {}) {
  const env = {
    PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
    HOME: process.env.HOME || '',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
  }
  for (const key of ['XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'CONTAINER_HOST', 'TMPDIR']) {
    if (process.env[key]) env[key] = process.env[key]
  }
  // Mock shims need to find their own fixtures.
  if (isMock) {
    env.SHX_MOCK = '1'
    for (const key of ['SHX_MOCK_STATE', 'SHX_MOCK_FIXTURES', 'SHX_MOCK_HELP_VARIANT']) {
      if (process.env[key]) env[key] = process.env[key]
    }
  }
  return { ...env, ...extra }
}

export class ProcessError extends AppError {
  constructor(binKey, argv, code, stdout, stderr) {
    const detail = (stderr || stdout || '').trim().split('\n').slice(-4).join('\n')
    super(
      500,
      'process_failed',
      `${binKey} ${argv[0] ?? ''} schlug fehl (exit ${code})${detail ? `: ${redact(detail)}` : ''}`,
    )
    this.name = 'ProcessError'
    this.binKey = binKey
    this.argv = argv
    this.exitCode = code
    this.stdout = stdout
    this.stderr = stderr
  }
}

/**
 * Run a command to completion and capture its output.
 *
 * @param {keyof typeof BINARIES} binKey
 * @param {string[]} argv
 * @param {{timeoutMs?: number, env?: Record<string,string>, maxBuffer?: number,
 *          allowFailure?: boolean, cwd?: string}} [opts]
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
export function run(binKey, argv, opts = {}) {
  const {
    timeoutMs = 30_000,
    env = {},
    maxBuffer = 16 * 1024 * 1024,
    allowFailure = false,
    cwd,
  } = opts
  const bin = binaryPath(binKey)

  return new Promise((resolve, reject) => {
    log.debug(`exec ${binKey} ${redact(argv.join(' '))}`)
    execFile(
      bin,
      argv,
      { timeout: timeoutMs, env: baseEnv(env), maxBuffer, cwd, encoding: 'utf8' },
      (err, stdout, stderr) => {
        const code = err?.code ?? 0
        if (err && err.code === 'ENOENT') {
          reject(
            new AppError(
              424,
              'binary_missing',
              `'${bin}' wurde nicht gefunden. Ist es installiert und im PATH?`,
            ),
          )
          return
        }
        if (err && err.killed) {
          reject(
            new AppError(
              504,
              'process_timeout',
              `${binKey} ${argv[0] ?? ''} hat nach ${timeoutMs} ms nicht geantwortet.`,
            ),
          )
          return
        }
        if (err && !allowFailure) {
          reject(new ProcessError(binKey, argv, code, stdout, stderr))
          return
        }
        resolve({ code: typeof code === 'number' ? code : 0, stdout, stderr })
      },
    )
  })
}

/**
 * Run a command and receive its output line by line as it arrives.
 *
 * Splits on both `\n` and `\r` because podman and tqdm both redraw progress
 * with carriage returns — treating `\r` as a line terminator is what turns
 * that into a readable stream of updates.
 *
 * @param {keyof typeof BINARIES} binKey
 * @param {string[]} argv
 * @param {{env?: Record<string,string>, cwd?: string, detached?: boolean,
 *          onStdout?: (line: string) => void, onStderr?: (line: string) => void,
 *          onExit?: (code: number|null, signal: string|null) => void}} [opts]
 */
export function stream(binKey, argv, opts = {}) {
  const { env = {}, cwd, detached = false, onStdout, onStderr, onExit } = opts
  const bin = binaryPath(binKey)
  log.debug(`stream ${binKey} ${redact(argv.join(' '))}`)

  const child = spawn(bin, argv, {
    env: baseEnv(env),
    cwd,
    detached,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (onStdout) attachLineReader(child.stdout, onStdout)
  if (onStderr) attachLineReader(child.stderr, onStderr)
  if (onExit) child.on('close', (code, signal) => onExit(code, signal))

  return child
}

/** Feed complete lines to `onLine`, buffering partial ones across chunks. */
export function attachLineReader(readable, onLine) {
  let buffer = ''
  readable.setEncoding('utf8')
  readable.on('data', (chunk) => {
    buffer += chunk
    // Both terminators, so carriage-return progress redraws surface promptly.
    const parts = buffer.split(/\r\n|\r|\n/)
    buffer = parts.pop() ?? ''
    for (const line of parts) onLine(line)
  })
  readable.on('end', () => {
    if (buffer) {
      onLine(buffer)
      buffer = ''
    }
  })
}

/** Whether a binary is callable at all. Used for preflight banners in the UI. */
export async function which(binKey, versionArgs = ['--version']) {
  try {
    const { stdout, stderr } = await run(binKey, versionArgs, {
      timeoutMs: 5000,
      allowFailure: true,
    })
    const out = (stdout || stderr).trim().split('\n')[0] || ''
    return { available: true, version: out }
  } catch {
    return { available: false, version: '' }
  }
}
