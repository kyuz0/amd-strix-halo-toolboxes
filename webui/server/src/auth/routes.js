import express from 'express'
import { z } from 'zod'

import { AUTH_COOKIE } from '../../../shared/constants.js'
import { badRequest, unauthorized } from '../lib/errors.js'
import { registerSecret, unregisterSecret } from '../lib/redact.js'
import { validate } from '../lib/validate.js'
import { cookieOptions, makeLoginLimiter, requireAuth } from './middleware.js'
import { generatePassword, hashPassword, verifyPassword } from './password.js'
import { TOKEN_TTL_SECONDS, generateSecret, signToken } from './tokens.js'

const loginBody = z.object({
  username: z.string().min(1).max(128).optional(),
  password: z.string().min(1).max(1024),
})

const changePasswordBody = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: z.string().min(8).max(1024),
})

export function authRoutes(ctx) {
  const router = express.Router()
  const login = makeLoginLimiter()
  const auth = requireAuth(ctx.getConfig)

  router.post('/login', login.limiter, validate({ body: loginBody }), async (req, res, next) => {
    try {
      const config = ctx.config.data
      if (!config.passwordHash) {
        throw badRequest(
          'Es ist noch kein Passwort gesetzt. Führe webui/install.sh aus oder setze eines mit webui/scripts/shx-passwd.',
        )
      }

      await login.penalty()
      const { username, password } = req.body
      const userOk = !username || username === config.username
      const passOk = await verifyPassword(password, config.passwordHash)

      if (!userOk || !passOk) {
        login.noteFailure()
        ctx.log.warn(`Fehlgeschlagener Anmeldeversuch von ${req.ip}`)
        throw unauthorized('Benutzername oder Passwort ist falsch.')
      }

      login.noteSuccess()
      const token = await signToken(config.jwtSecret, { sub: config.username })
      res.cookie(AUTH_COOKIE, token, cookieOptions(req))
      res.json({
        username: config.username,
        expiresAt: new Date(Date.now() + TOKEN_TTL_SECONDS * 1000).toISOString(),
      })
    } catch (err) {
      next(err)
    }
  })

  router.post('/logout', (req, res) => {
    res.clearCookie(AUTH_COOKIE, { ...cookieOptions(req), maxAge: undefined })
    res.json({ ok: true })
  })

  router.get('/me', auth, (req, res) => {
    res.json({
      username: req.user.username,
      expiresAt: new Date(req.user.expiresAt * 1000).toISOString(),
    })
  })

  router.post(
    '/password',
    auth,
    validate({ body: changePasswordBody }),
    async (req, res, next) => {
      try {
        const config = ctx.config.data
        const ok = await verifyPassword(req.body.currentPassword, config.passwordHash)
        if (!ok) throw unauthorized('Das aktuelle Passwort ist falsch.')

        const hash = await hashPassword(req.body.newPassword)
        await ctx.config.update((c) => {
          c.passwordHash = hash
          return c
        })
        ctx.log.info('Passwort wurde geändert.')
        res.json({ ok: true })
      } catch (err) {
        next(err)
      }
    },
  )

  // Rotating the secret invalidates every issued token, including our own.
  router.post('/rotate-secret', auth, async (req, res, next) => {
    try {
      const old = ctx.config.data.jwtSecret
      const secret = generateSecret()
      await ctx.config.update((c) => {
        c.jwtSecret = secret
        return c
      })
      unregisterSecret(old)
      registerSecret(secret)
      res.clearCookie(AUTH_COOKIE, { ...cookieOptions(req), maxAge: undefined })
      ctx.log.info('JWT-Secret rotiert, alle Sitzungen wurden abgemeldet.')
      res.json({ ok: true })
    } catch (err) {
      next(err)
    }
  })

  return router
}

export { generatePassword }
