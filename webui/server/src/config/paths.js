import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

/** `webui/` — the workspace root, three levels up from `server/src/config/`. */
export const webuiRoot = path.resolve(here, '../../..')

/**
 * The git checkout that contains us. Needed for the Dockerfile-derived image
 * catalog, the VRAM estimator script and self-update. `git rev-parse` is the
 * honest answer; the relative fallback covers a tarball deployment.
 */
export const repoRoot = (() => {
  try {
    const out = execFileSync('git', ['-C', webuiRoot, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const top = out.trim()
    if (top) return top
  } catch {
    // not a git checkout, or git missing — fall through
  }
  return path.resolve(webuiRoot, '..')
})()

const home = os.homedir()

function xdg(envVar, fallback) {
  const v = process.env[envVar]
  return v && path.isAbsolute(v) ? v : fallback
}

/**
 * Config and state live outside the repo on purpose: `git pull` during a
 * self-update must never be able to touch them.
 */
export const configDir =
  process.env.SHX_CONFIG_DIR ||
  path.join(xdg('XDG_CONFIG_HOME', path.join(home, '.config')), 'strix-halo-webui')

export const stateDir =
  process.env.SHX_STATE_DIR ||
  path.join(xdg('XDG_STATE_HOME', path.join(home, '.local', 'state')), 'strix-halo-webui')

export const configFile = path.join(configDir, 'config.json')
export const profilesFile = path.join(configDir, 'profiles.json')
export const stateFile = path.join(stateDir, 'state.json')
export const logFile = path.join(stateDir, 'app.log')

/** Default models directory. Absolute, and deliberately not repo-relative. */
export const defaultModelsDir = path.join(home, 'models')

/** Where the built frontend ends up. */
export const webDist = path.join(webuiRoot, 'web', 'dist')

/** Host copy of the VRAM estimator, so we never need a container to run it. */
export const vramEstimator = path.join(
  repoRoot,
  'toolboxes_llama_server',
  'gguf-vram-estimator.py',
)

/** Directory whose `Dockerfile.<tag>` entries define the known image tags. */
export const dockerfileDir = path.join(repoRoot, 'toolboxes_llama_server')

/**
 * Root of the sysfs tree to read GPU metrics from (swappable for dev fixtures).
 * Read on each call rather than captured at import, so a test can point it
 * somewhere else and re-probe.
 */
export function sysfsRoot() {
  return process.env.SHX_SYSFS_ROOT || '/sys'
}

export function ensureDirs() {
  for (const dir of [configDir, stateDir]) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    // mkdir's mode is masked by umask, so set it explicitly afterwards.
    try {
      fs.chmodSync(dir, 0o700)
    } catch {
      // best effort; a pre-existing dir owned by someone else is a config error
    }
  }
}
