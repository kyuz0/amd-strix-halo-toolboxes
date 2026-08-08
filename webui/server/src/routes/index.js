import express from 'express'

import { authRoutes } from '../auth/routes.js'
import { requireAuth } from '../auth/middleware.js'
import { notFound } from '../lib/errors.js'
import { imageRoutes } from './images.js'
import { jobRoutes } from './jobs.js'
import { metaRoutes } from './meta.js'
import { modelRoutes } from './models.js'
import { profileRoutes } from './profiles.js'
import { serverRoutes } from './servers.js'
import { settingsRoutes } from './settings.js'
import { systemRoutes } from './system.js'
import { updateRoutes } from './updates.js'

/**
 * Mounts everything under `/api`.
 *
 * `/api/auth/*` and the meta routes carry their own (or no) auth; everything
 * after `router.use(auth)` is behind the cookie check.
 */
export function apiRoutes(ctx) {
  const router = express.Router()
  const auth = requireAuth(ctx.getConfig)

  router.use('/auth', authRoutes(ctx))
  router.use('/', metaRoutes())

  router.use(auth)
  router.use('/images', imageRoutes(ctx))
  router.use('/jobs', jobRoutes(ctx))
  router.use('/models', modelRoutes(ctx))
  router.use('/profiles', profileRoutes(ctx))
  router.use('/servers', serverRoutes(ctx))
  router.use('/settings', settingsRoutes(ctx))
  router.use('/system', systemRoutes(ctx))
  router.use('/updates', updateRoutes(ctx))

  router.use((req, res, next) => {
    next(notFound(`Unbekannter API-Endpunkt: ${req.method} ${req.originalUrl}`))
  })

  return router
}
