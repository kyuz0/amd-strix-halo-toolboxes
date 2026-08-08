import express from 'express'
import { z } from 'zod'

import { lastEventId, openSse } from '../lib/sse.js'
import { q, validate } from '../lib/validate.js'

const listQuery = z.object({
  type: z.string().optional(),
  status: z.string().optional(),
})

export function jobRoutes(ctx) {
  const router = express.Router()

  router.get('/', validate({ query: listQuery }), (req, res) => {
    res.json({ jobs: ctx.jobs.list(q(req)) })
  })

  router.get('/:id', (req, res, next) => {
    try {
      const job = ctx.jobs.get(req.params.id)
      res.json({ job: job.toJSON(), logs: job.logs.all() })
    } catch (err) {
      next(err)
    }
  })

  router.get('/:id/events', (req, res, next) => {
    try {
      const job = ctx.jobs.get(req.params.id)
      const sse = openSse(req, res)

      // Replay what the client missed before switching to live updates, so a
      // reconnect never loses log lines.
      const since = lastEventId(req)
      for (const entry of job.logs.since(since)) {
        sse.send('log', { line: entry.value }, entry.seq)
      }
      sse.send('status', job.toJSON())
      if (job.progress) sse.send('progress', job.progress)

      if (job.finished) {
        sse.close()
        return
      }

      const onEvent = ({ event, data, id }) => sse.send(event, data, id)
      ctx.jobs.on(`job:${job.id}`, onEvent)
      req.on('close', () => ctx.jobs.off(`job:${job.id}`, onEvent))
    } catch (err) {
      next(err)
    }
  })

  router.delete('/:id', (req, res, next) => {
    try {
      res.json(ctx.jobs.cancel(req.params.id))
    } catch (err) {
      next(err)
    }
  })

  return router
}
