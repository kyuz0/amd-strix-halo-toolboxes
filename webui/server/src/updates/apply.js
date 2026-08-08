import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

import { stateDir, webuiRoot } from '../config/paths.js'
import { AppError, failedDependency } from '../lib/errors.js'
import { run, which } from '../lib/exec.js'
import { log } from '../lib/log.js'
import { updateStatus } from './git.js'

const SERVICE = process.env.SHX_SERVICE_NAME || 'strix-halo-webui.service'
const TAIL_INTERVAL_MS = 500

/**
 * Run the updater as a transient systemd unit.
 *
 * A child spawned normally lives in our service's cgroup, so the
 * `systemctl restart` at the end of the update would kill it mid-`npm ci`.
 * `systemd-run --user` puts it in its own unit instead — and the service file
 * additionally sets `KillMode=mixed`, so even a fallback would survive.
 */
export async function startUpdate(ctx) {
  const status = await updateStatus({ fetch: true })

  if (status.dirty) {
    throw failedDependency(
      `Das Repository hat lokale Änderungen (${status.dirtyFiles.length} Datei(en)). Committe oder verwirf sie, bevor du aktualisierst.`,
      { dirtyFiles: status.dirtyFiles },
    )
  }
  if (status.behind === 0) {
    throw failedDependency('Es liegt kein Update vor — der Stand ist bereits aktuell.')
  }

  const systemdRun = await which('systemd-run', ['--version'])
  if (!systemdRun.available) {
    throw failedDependency(
      'systemd-run steht nicht zur Verfügung. Aktualisiere von Hand: cd webui && git pull && npm ci && npm run build && systemctl --user restart strix-halo-webui',
    )
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const logFile = path.join(stateDir, `update-${stamp}.log`)
  await fsp.mkdir(stateDir, { recursive: true, mode: 0o700 })
  await fsp.writeFile(logFile, '', { mode: 0o600 })

  const job = ctx.jobs.start(
    {
      type: 'app-update',
      lane: 'app-update',
      title: `Update auf ${status.commits[0]?.shortSha ?? 'neuen Stand'}`,
      meta: {
        logFile,
        from: null,
        behind: status.behind,
        commits: status.commits.slice(0, 20),
      },
    },
    (jobCtx) => runUpdate(jobCtx, { logFile, status }),
  )

  // Persist before the restart so the new process can re-adopt this job and
  // finish reporting rather than losing it.
  ctx.jobs.emit('job', job.toJSON())
  return job
}

async function runUpdate({ appendLog, setMessage, setProgress }, { logFile, status }) {
  setMessage('Updater wird gestartet …')
  setProgress({ pct: null, done: null, total: null, rate: null, eta: null })

  const argv = [
    '--user',
    '--collect',
    `--unit=shx-self-update-${Date.now()}`,
    `--setenv=SHX_UPDATE_LOG=${logFile}`,
    `--setenv=SHX_SERVICE_NAME=${SERVICE}`,
    `--setenv=SHX_SKIP_INSTALL=${status.needsInstall ? '0' : '1'}`,
    `--setenv=SHX_SKIP_BUILD=${status.needsBuild ? '0' : '1'}`,
    `--working-directory=${webuiRoot}`,
    '/bin/bash',
    path.join(webuiRoot, 'scripts', 'self-update.sh'),
  ]

  const result = await run('systemd-run', argv, { timeoutMs: 30_000, allowFailure: true })
  if (result.code !== 0) {
    throw new AppError(
      500,
      'update_failed',
      `systemd-run schlug fehl: ${(result.stderr || result.stdout).trim().split('\n').slice(-1)[0]}`,
    )
  }

  appendLog('Updater läuft in einer eigenen systemd-Unit.')
  setMessage('Update läuft. Der Dienst startet danach neu.')

  // Tail the log file until the updater finishes or restarts us out from under
  // this loop — whichever comes first.
  await tailUntilDone(logFile, appendLog)
  return { logFile }
}

/**
 * Follow the updater's log. This process is expected to be killed by the
 * restart partway through; whatever the new process finds in the file is
 * replayed by `readUpdateLog`.
 */
async function tailUntilDone(logFile, appendLog, maxMs = 15 * 60_000) {
  let offset = 0
  const deadline = Date.now() + maxMs

  while (Date.now() < deadline) {
    await sleep(TAIL_INTERVAL_MS)
    let text = ''
    try {
      const handle = await fsp.open(logFile, 'r')
      try {
        const stat = await handle.stat()
        if (stat.size > offset) {
          const buffer = Buffer.alloc(stat.size - offset)
          await handle.read(buffer, 0, buffer.length, offset)
          offset = stat.size
          text = buffer.toString('utf8')
        }
      } finally {
        await handle.close()
      }
    } catch {
      continue
    }

    for (const line of text.split('\n')) {
      if (line.trim()) appendLog(line)
    }
    if (/^(Fertig:|FEHLGESCHLAGEN:|Nichts zu tun)/m.test(text)) return
  }
  log.warn('Update-Log wurde nicht innerhalb des Zeitfensters abgeschlossen.')
}

/** The most recent update log, so the UI can show what happened after a restart. */
export async function readUpdateLog() {
  let entries
  try {
    entries = await fsp.readdir(stateDir)
  } catch {
    return null
  }
  const logs = entries.filter((f) => f.startsWith('update-') && f.endsWith('.log')).sort()
  if (logs.length === 0) return null

  const file = path.join(stateDir, logs[logs.length - 1])
  try {
    const text = await fsp.readFile(file, 'utf8')
    return {
      file,
      at: fs.statSync(file).mtime.toISOString(),
      lines: text.split('\n').filter(Boolean),
      succeeded: /^Fertig:/m.test(text),
      failed: /^FEHLGESCHLAGEN:/m.test(text),
    }
  } catch {
    return null
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
