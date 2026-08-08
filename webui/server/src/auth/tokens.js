import { randomBytes, randomUUID } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'

const ISSUER = 'strix-halo-webui'
const AUDIENCE = 'shx'
/** 12 h. A single-user LAN tool; re-logging in once a day is no hardship. */
export const TOKEN_TTL_SECONDS = 12 * 60 * 60
/** Re-issue a token that is older than this, giving a sliding session. */
export const REFRESH_AFTER_SECONDS = 60 * 60

export function generateSecret() {
  return randomBytes(32).toString('base64')
}

function keyFrom(secret) {
  return Buffer.from(secret, 'base64')
}

/**
 * @param {string} secret base64
 * @param {{sub: string, audience?: string, ttl?: number}} opts
 */
export async function signToken(secret, { sub, audience = AUDIENCE, ttl = TOKEN_TTL_SECONDS }) {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuer(ISSUER)
    .setAudience(audience)
    .setJti(randomUUID())
    .setIssuedAt(now)
    .setExpirationTime(now + ttl)
    .sign(keyFrom(secret))
}

/**
 * @returns {Promise<import('jose').JWTPayload | null>} null on any failure —
 * expired, wrong signature, wrong audience. Callers treat all of those alike.
 */
export async function verifyToken(secret, token, audience = AUDIENCE) {
  if (!secret || !token) return null
  try {
    const { payload } = await jwtVerify(token, keyFrom(secret), {
      issuer: ISSUER,
      audience,
      algorithms: ['HS256'],
    })
    return payload
  } catch {
    return null
  }
}
