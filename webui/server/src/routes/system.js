import express from 'express'

import { repoRoot } from '../config/paths.js'
import { which } from '../lib/exec.js'
import { openSse } from '../lib/sse.js'
import { lastReconcile } from '../podman/autostart.js'
import { readBootParams, readKernel } from '../system/host.js'
import { monitor } from '../system/monitor.js'

export function systemRoutes(ctx) {
  const router = express.Router()

  router.get('/', async (req, res, next) => {
    try {
      const snapshot = await monitor.snapshot()
      res.json({ ...snapshot, autostart: lastReconcile() })
    } catch (err) {
      next(err)
    }
  })

  router.get('/events', (req, res) => {
    const sse = openSse(req, res)

    // Send the accumulated history first so sparklines are populated on the
    // very first frame rather than filling in over the next ten minutes.
    monitor
      .snapshot()
      .then((snapshot) => sse.send('snapshot', snapshot))
      .catch(() => {})

    const unsubscribe = monitor.subscribe((sample) => {
      sse.send('tick', { ...sample, containers: monitor.containerStats })
    })
    req.on('close', unsubscribe)
  })

  router.get('/info', async (req, res, next) => {
    try {
      const [podman, python, hf, git] = await Promise.all([
        which('podman', ['--version']),
        which('python3', ['--version']),
        which('hf', ['--version']),
        which('git', ['--version']),
      ])
      res.json({
        kernel: await readKernel(),
        bootParams: await readBootParams(),
        repoRoot,
        modelsDir: ctx.settings.modelsDir,
        tools: { podman, python, hf, git },
        node: process.version,
      })
    } catch (err) {
      next(err)
    }
  })

  return router
}
