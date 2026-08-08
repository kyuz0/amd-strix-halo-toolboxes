import rateLimit from 'express-rate-limit'

import { AUTH_COOKIE, CSRF_HEADER, CSRF_VALUE } from '../../../shared/constants.js'
import { forbidden, unauthorized } from '../lib/errors.js'
import { REFRESH_AFTER_SECONDS, TOKEN_TTL_SECONDS, signToken, verifyToken } from './tokens.js'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Build the cookie options. `Secure` is only set when the request actually
 * arrived over TLS: on a plain-HTTP LAN deployment a Secure cookie would be
 * silently dropped by the browser and every login would appear to succeed and
 * then fail.
 */
export function cookieOptions(req) {
  const secure =
    req.secure || String(req.get('x-forwarded-proto') || '').split(',')[0].trim() === 'https'
  return {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    maxAge: TOKEN_TTL_SECONDS * 1000,
    secure,
  }
}

/**
 * CSRF defence for a cookie-authenticated app, layer 2 and 3 (layer 1 is
 * SameSite=Strict on the cookie itself).
 *
 * A cross-origin page cannot set `X-Requested-With` without a CORS preflight,
 * and CORS is never enabled here, so the preflight fails. The Origin check
 * catches the rest. There are deliberately no state-changing GET endpoints, so
 * exempting safe methods costs nothing.
 */
export function originGuard(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next()

  if (req.get(CSRF_HEADER) !== CSRF_VALUE) {
    return next(forbidden('Fehlender oder falscher X-Requested-With-Header.'))
  }

  const origin = req.get('origin') || req.get('referer')
  if (!origin) {
    return next(forbidden('Anfrage ohne Origin-Header wird abgelehnt.'))
  }
  let originHost
  try {
    originHost = new URL(origin).host
  } catch {
    return next(forbidden('Origin-Header ist unlesbar.'))
  }
  if (originHost !== req.get('host')) {
    return next(forbidden('Origin stimmt nicht mit dem Host überein.'))
  }
  return next()
}

/**
 * Cookie-based auth. Because the browser attaches the cookie itself, this same
 * middleware protects the SSE endpoints — EventSource cannot set headers, and
 * this is what avoids needing a token in the query string.
 */
export function requireAuth(getConfig) {
  return async (req, res, next) => {
    const config = getConfig()
    const token = req.cookies?.[AUTH_COOKIE] || ticketFromQuery(req)
    const payload = await verifyToken(config.jwtSecret, token)
    if (!payload) return next(unauthorized())

    req.user = { username: payload.sub, expiresAt: payload.exp }

    // Sliding session: refresh a token that is more than an hour old so an
    // actively used tab never expires mid-session.
    const age = Math.floor(Date.now() / 1000) - (payload.iat ?? 0)
    if (age > REFRESH_AFTER_SECONDS) {
      const fresh = await signToken(config.jwtSecret, { sub: payload.sub })
      res.cookie(AUTH_COOKIE, fresh, cookieOptions(req))
    }
    return next()
  }
}

/**
 * Reserve path for a deployment behind a cookie-stripping proxy: an SSE ticket
 * passed as `?ticket=`. Off unless SHX_SSE_TICKETS=1, because a token in a URL
 * ends up in access logs.
 */
function ticketFromQuery(req) {
  if (process.env.SHX_SSE_TICKETS !== '1') return null
  const t = req.query?.ticket
  return typeof t === 'string' ? t : null
}

/**
 * Login throttling. Per-IP is the primary limit; the global counter adds a
 * delay once the whole instance has seen many failures, which is what a
 * distributed guess from several LAN hosts would look like.
 */
export function makeLoginLimiter() {
  let globalFailures = 0
  let resetAt = Date.now() + 15 * 60_000

  const limiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 5,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'rate_limited', message: 'Zu viele Anmeldeversuche. Bitte später erneut versuchen.' } },
  })

  return {
    limiter,
    noteFailure() {
      if (Date.now() > resetAt) {
        globalFailures = 0
        resetAt = Date.now() + 15 * 60_000
      }
      globalFailures += 1
    },
    noteSuccess() {
      globalFailures = 0
    },
    async penalty() {
      if (globalFailures > 10) {
        await new Promise((r) => setTimeout(r, 2000))
      }
    },
  }
}
