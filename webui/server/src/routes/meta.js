import express from 'express'

import { repoRoot } from '../config/paths.js'
import { run, which } from '../lib/exec.js'

/** Cached at boot: it only changes when the process is restarted by an update. */
let versionCache = null

export async function readVersion() {
  if (versionCache) return versionCache

  let sha = ''
  let dirty = false
  let branch = ''
  try {
    const rev = await run('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { allowFailure: true })
    sha = rev.stdout.trim()
    const status = await run('git', ['-C', repoRoot, 'status', '--porcelain'], {
      allowFailure: true,
    })
    dirty = status.stdout.trim().length > 0
    const head = await run('git', ['-C', repoRoot, 'rev-parse', '--abbrev-ref', 'HEAD'], {
      allowFailure: true,
    })
    branch = head.stdout.trim()
  } catch {
    // Not a git checkout — version info degrades rather than failing.
  }

  versionCache = {
    sha,
    shortSha: sha.slice(0, 7),
    branch,
    dirty,
    node: process.version,
    startedAt: new Date().toISOString(),
  }
  return versionCache
}

/** Called after a self-update so the next /version reflects the new commit. */
export function invalidateVersion() {
  versionCache = null
}

export function metaRoutes() {
  const router = express.Router()

  router.get('/health', (req, res) => {
    res.json({ ok: true, uptime: process.uptime() })
  })

  router.get('/version', async (req, res, next) => {
    try {
      const version = await readVersion()
      const podman = await which('podman', ['--version'])
      res.json({ ...version, podman: podman.version || null })
    } catch (err) {
      next(err)
    }
  })

  return router
}
