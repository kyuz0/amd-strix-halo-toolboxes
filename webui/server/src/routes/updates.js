import express from 'express'

import { readUpdateLog, startUpdate } from '../updates/apply.js'
import { updateStatus } from '../updates/git.js'

export function updateRoutes(ctx) {
  const router = express.Router()

  router.get('/app', async (req, res, next) => {
    try {
      const [status, lastLog] = await Promise.all([updateStatus(), readUpdateLog()])
      res.json({ ...status, lastLog })
    } catch (err) {
      next(err)
    }
  })

  router.post('/app/check', async (req, res, next) => {
    try {
      res.json(await updateStatus({ fetch: true }))
    } catch (err) {
      next(err)
    }
  })

  router.post('/app/apply', async (req, res, next) => {
    try {
      const job = await startUpdate(ctx)
      res.status(202).json({ jobId: job.id, job: job.toJSON() })
    } catch (err) {
      next(err)
    }
  })

  return router
}
