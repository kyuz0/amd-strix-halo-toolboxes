import { randomUUID } from 'node:crypto'

import express from 'express'
import { z } from 'zod'

import { NAME_RE, PORT_MAX, PORT_MIN } from '../../../shared/constants.js'
import { conflict, notFound } from '../lib/errors.js'
import { registerSecret, unregisterSecret } from '../lib/redact.js'
import { validate } from '../lib/validate.js'
import { reconcile } from '../podman/autostart.js'
import { createServer, generateApiKey } from '../podman/servers.js'

const profileBody = z.object({
  name: z.string().regex(NAME_RE),
  image: z.string().min(1).max(400),
  modelPath: z.string().min(1).max(1000),
  port: z.number().int().min(PORT_MIN).max(PORT_MAX),
  ctxSize: z.number().int().min(256).max(4_000_000),
  gpuLayers: z.number().int().min(0).max(9999),
  threads: z.number().int().min(1).max(512),
  apiKey: z.string().max(512).optional(),
  extraArgs: z.string().max(1024).default(''),
  autostart: z.boolean().default(false),
})

const idParams = z.object({ id: z.string().min(1) })

export function profileRoutes(ctx) {
  const router = express.Router()
  const profiles = () => ctx.profiles.data.profiles

  router.get('/', (req, res) => {
    res.json({ profiles: profiles() })
  })

  router.post('/', validate({ body: profileBody }), async (req, res, next) => {
    try {
      if (profiles().some((p) => p.name === req.body.name)) {
        throw conflict(`Es gibt bereits ein Profil namens '${req.body.name}'.`)
      }
      const now = new Date().toISOString()
      const profile = {
        id: randomUUID(),
        ...req.body,
        apiKey: req.body.apiKey || generateApiKey(),
        createdAt: now,
        updatedAt: now,
      }
      registerSecret(profile.apiKey)
      await ctx.profiles.update((data) => {
        data.profiles.push(profile)
        return data
      })
      res.status(201).json({ profile })
    } catch (err) {
      next(err)
    }
  })

  router.get('/:id', validate({ params: idParams }), (req, res, next) => {
    const profile = profiles().find((p) => p.id === req.params.id)
    if (!profile) return next(notFound(`Profil ${req.params.id} ist unbekannt.`))
    res.json({ profile })
  })

  router.put(
    '/:id',
    validate({ params: idParams, body: profileBody }),
    async (req, res, next) => {
      try {
        const existing = profiles().find((p) => p.id === req.params.id)
        if (!existing) throw notFound(`Profil ${req.params.id} ist unbekannt.`)
        if (profiles().some((p) => p.name === req.body.name && p.id !== req.params.id)) {
          throw conflict(`Es gibt bereits ein Profil namens '${req.body.name}'.`)
        }

        const previousKey = existing.apiKey
        const updated = {
          ...existing,
          ...req.body,
          apiKey: req.body.apiKey || existing.apiKey,
          updatedAt: new Date().toISOString(),
        }
        if (updated.apiKey !== previousKey) {
          unregisterSecret(previousKey)
          registerSecret(updated.apiKey)
        }

        await ctx.profiles.update((data) => {
          data.profiles = data.profiles.map((p) => (p.id === updated.id ? updated : p))
          return data
        })
        res.json({ profile: updated })
      } catch (err) {
        next(err)
      }
    },
  )

  router.delete('/:id', validate({ params: idParams }), async (req, res, next) => {
    try {
      const profile = profiles().find((p) => p.id === req.params.id)
      if (!profile) throw notFound(`Profil ${req.params.id} ist unbekannt.`)
      unregisterSecret(profile.apiKey)
      await ctx.profiles.update((data) => {
        data.profiles = data.profiles.filter((p) => p.id !== req.params.id)
        return data
      })
      // The container, if any, is left alone: deleting a saved configuration
      // should not take a running server down with it.
      res.json({ removed: profile.id })
    } catch (err) {
      next(err)
    }
  })

  router.post('/:id/launch', validate({ params: idParams }), async (req, res, next) => {
    try {
      const profile = profiles().find((p) => p.id === req.params.id)
      if (!profile) throw notFound(`Profil ${req.params.id} ist unbekannt.`)

      const logs = []
      const result = await createServer(
        ctx,
        {
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
        },
        { replace: req.body?.replace === true, onLog: (l) => logs.push(l) },
      )
      res.status(201).json({ ...result, logs })
    } catch (err) {
      next(err)
    }
  })

  router.post('/reconcile', async (req, res, next) => {
    try {
      // No stagger when triggered by hand: the user is watching and can see
      // what happens.
      res.json(await reconcile(ctx, { stagger: 0 }))
    } catch (err) {
      next(err)
    }
  })

  return router
}
