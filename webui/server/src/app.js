import fs from 'node:fs'
import path from 'node:path'

import cookieParser from 'cookie-parser'
import express from 'express'
import helmet from 'helmet'

import { webDist } from './config/paths.js'
import { originGuard } from './auth/middleware.js'
import { errorHandler } from './lib/errors.js'
import { log } from './lib/log.js'
import { redact } from './lib/redact.js'
import { apiRoutes } from './routes/index.js'

export function createApp(ctx) {
  const app = express()

  // We sit on a LAN, possibly behind a reverse proxy the user set up. Trusting
  // one hop gives correct client IPs for rate limiting without letting a
  // direct client spoof X-Forwarded-For at will.
  app.set('trust proxy', 1)
  app.disable('x-powered-by')

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          // Vite emits hashed external scripts, so scripts need no inline
          // allowance; styles still do because of React's inline style props.
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      // The app is served over plain HTTP on a LAN; HSTS would poison the
      // browser for that host.
      strictTransportSecurity: false,
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'no-referrer' },
    }),
  )

  app.use(cookieParser())
  app.use(express.json({ limit: '256kb' }))

  // No CORS middleware anywhere, by design: without it a cross-origin
  // preflight can never succeed, which is half of the CSRF story.
  app.use('/api', originGuard, apiRoutes(ctx))

  if (fs.existsSync(webDist)) {
    app.use(
      express.static(webDist, {
        index: false,
        setHeaders(res, filePath) {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
          } else {
            res.setHeader('Cache-Control', 'no-cache')
          }
        },
      }),
    )

    // SPA fallback. Express 5 removed the `app.get('*')` wildcard form, so this
    // has to be plain middleware.
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next()
      if (req.path.startsWith('/api/')) return next()
      res.sendFile(path.join(webDist, 'index.html'))
    })
  } else {
    app.use((req, res, next) => {
      if (req.path.startsWith('/api/')) return next()
      res
        .status(503)
        .type('text/plain; charset=utf-8')
        .send('Das Frontend ist noch nicht gebaut. Führe "npm run build" in webui/ aus.')
    })
  }

  app.use(errorHandler(log, redact))

  return app
}
