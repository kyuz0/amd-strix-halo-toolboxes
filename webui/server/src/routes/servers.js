import express from 'express'
import { z } from 'zod'

import { NAME_RE, PORT_MAX, PORT_MIN } from '../../../shared/constants.js'
import { badRequest, notFound } from '../lib/errors.js'
import { lastEventId, openSse } from '../lib/sse.js'
import { q, validate } from '../lib/validate.js'
import { logSnapshot } from '../podman/client.js'
import { attachLogClient } from '../podman/logstream.js'
import {
  createServer,
  deleteServer,
  getServerDetail,
  listServers,
  restartServer,
  serverHealth,
  startServer,
  stopServer,
} from '../podman/servers.js'

const specSchema = z.object({
  name: z.string().regex(NAME_RE),
  image: z.string().min(1),
  modelPath: z.string().min(1),
  port: z.number().int().min(PORT_MIN).max(PORT_MAX),
  ctxSize: z.number().int().min(256).max(4_000_000),
  gpuLayers: z.number().int().min(0).max(9999),
  threads: z.number().int().min(1).max(512),
  apiKey: z.string().max(512).optional(),
  extraArgs: z.string().max(1024).optional(),
  profileId: z.string().optional(),
})

const createBody = z.union([
  z.object({ profileId: z.string().min(1), replace: z.boolean().optional() }),
  specSchema.extend({ replace: z.boolean().optional() }),
])

const nameParams = z.object({ name: z.string().regex(NAME_RE) })

export function serverRoutes(ctx) {
  const router = express.Router()

  router.get('/', async (req, res, next) => {
    try {
      res.json({ servers: await listServers() })
    } catch (err) {
      next(err)
    }
  })

  router.post('/', validate({ body: createBody }), async (req, res, next) => {
    try {
      const { replace = false, ...rest } = req.body
      let spec = rest

      // A profile is just a stored spec; materialise it here so the podman
      // layer only ever sees one shape.
      if (rest.profileId && !rest.name) {
        const profile = ctx.profiles.data.profiles.find((p) => p.id === rest.profileId)
        if (!profile) throw notFound(`Profil ${rest.profileId} ist unbekannt.`)
        spec = {
          name: profile.name,
          image: profile.image,
          modelPath: profile.modelPath,
          port: profile.port,
          ctxSize: profile.ctxSize,
          gpuLayers: profile.gpuLayers,
          threads: profile.threads,
          apiKey: profile.apiKey,
          extraArgs: profile.extraArgs,
          profileId: profile.id,
        }
      }

      const logs = []
      const result = await createServer(ctx, spec, { replace, onLog: (l) => logs.push(l) })
      res.status(201).json({ ...result, logs })
    } catch (err) {
      next(err)
    }
  })

  router.get('/:name', validate({ params: nameParams }), async (req, res, next) => {
    try {
      res.json({ server: await getServerDetail(req.params.name) })
    } catch (err) {
      next(err)
    }
  })

  for (const [action, fn] of [
    ['start', startServer],
    ['stop', stopServer],
    ['restart', restartServer],
  ]) {
    router.post(`/:name/${action}`, validate({ params: nameParams }), async (req, res, next) => {
      try {
        res.json({ server: await fn(req.params.name) })
      } catch (err) {
        next(err)
      }
    })
  }

  router.delete('/:name', validate({ params: nameParams }), async (req, res, next) => {
    try {
      res.json(await deleteServer(req.params.name))
    } catch (err) {
      next(err)
    }
  })

  router.get('/:name/health', validate({ params: nameParams }), async (req, res, next) => {
    try {
      res.json(await serverHealth(req.params.name))
    } catch (err) {
      next(err)
    }
  })

  const logsQuery = z.object({ tail: z.coerce.number().int().min(1).max(5000).default(500) })

  router.get(
    '/:name/logs',
    validate({ params: nameParams, query: logsQuery }),
    async (req, res, next) => {
      try {
        await getServerDetail(req.params.name)
        res.json({ lines: await logSnapshot(req.params.name, q(req).tail) })
      } catch (err) {
        next(err)
      }
    },
  )

  router.get('/:name/logs/events', validate({ params: nameParams }), async (req, res, next) => {
    try {
      await getServerDetail(req.params.name)
      const sse = openSse(req, res)
      const detach = attachLogClient(req.params.name, sse, lastEventId(req))
      req.on('close', detach)
    } catch (err) {
      next(err)
    }
  })

  router.use((req, res, next) => next(badRequest(`Unbekannte Server-Aktion: ${req.path}`)))

  return router
}
