import express from 'express'
import fs from 'node:fs'
import path from 'node:path'

import { settingsPatchSchema } from '../config/schema.js'
import { badRequest } from '../lib/errors.js'
import { mask, registerSecret, unregisterSecret } from '../lib/redact.js'
import { validate } from '../lib/validate.js'

export function settingsRoutes(ctx) {
  const router = express.Router()

  router.get('/', (req, res) => {
    const config = ctx.config.data
    res.json({
      settings: config.settings,
      // Write-only: the token itself is never handed back out.
      hfToken: { configured: Boolean(config.hfToken), hint: mask(config.hfToken) },
      username: config.username,
    })
  })

  router.put('/', validate({ body: settingsPatchSchema }), async (req, res, next) => {
    try {
      const { hfToken, ...patch } = req.body

      if (patch.modelsDir !== undefined) {
        if (!path.isAbsolute(patch.modelsDir)) {
          throw badRequest('Das Modellverzeichnis muss ein absoluter Pfad sein.')
        }
        try {
          fs.mkdirSync(patch.modelsDir, { recursive: true })
        } catch (err) {
          throw badRequest(`Modellverzeichnis nicht nutzbar: ${err.message}`)
        }
      }

      const previousToken = ctx.config.data.hfToken
      await ctx.config.update((c) => {
        c.settings = { ...c.settings, ...patch }
        if (hfToken !== undefined) c.hfToken = hfToken
        return c
      })

      if (hfToken !== undefined && hfToken !== previousToken) {
        unregisterSecret(previousToken)
        registerSecret(hfToken)
      }
      if (patch.maxConcurrentDownloads !== undefined) {
        ctx.jobs.configureLane('model-download', patch.maxConcurrentDownloads)
      }

      res.json({ settings: ctx.config.data.settings })
    } catch (err) {
      next(err)
    }
  })

  return router
}
