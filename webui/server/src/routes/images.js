import express from 'express'
import { z } from 'zod'

import { checkUpdates, deleteImage, describeImages, startPull } from '../images/service.js'
import { q, validate } from '../lib/validate.js'
import { resolveExtraArgs } from '../podman/features.js'

const refBody = z.object({ ref: z.string().min(1).max(400) })
const refQuery = z.object({ ref: z.string().min(1).max(400) })

export function imageRoutes(ctx) {
  const router = express.Router()

  router.get('/', async (req, res, next) => {
    try {
      res.json({ images: await describeImages(ctx) })
    } catch (err) {
      next(err)
    }
  })

  router.post('/pull', validate({ body: refBody }), (req, res, next) => {
    try {
      const job = startPull(ctx, req.body.ref)
      res.status(202).json({ jobId: job.id, job: job.toJSON() })
    } catch (err) {
      next(err)
    }
  })

  router.post('/check-updates', async (req, res, next) => {
    try {
      const result = await checkUpdates(ctx, { force: true })
      res.json({ ...result, images: await describeImages(ctx) })
    } catch (err) {
      next(err)
    }
  })

  // Re-probe the fa/mmap spelling for an image, bypassing the cache.
  router.post('/redetect', validate({ query: refQuery }), (req, res, next) => {
    try {
      const { ref } = q(req)
      const job = ctx.jobs.start(
        { type: 'feature-detect', title: `Argumente erkennen: ${ref}`, meta: { ref } },
        async ({ appendLog }) => resolveExtraArgs(ctx, ref, { force: true, onLog: appendLog }),
      )
      res.status(202).json({ jobId: job.id, job: job.toJSON() })
    } catch (err) {
      next(err)
    }
  })

  router.delete('/', validate({ query: refQuery }), async (req, res, next) => {
    try {
      res.json(await deleteImage(ctx, q(req).ref))
    } catch (err) {
      next(err)
    }
  })

  return router
}
