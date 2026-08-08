import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt)

/**
 * scrypt parameters. N=32768 costs ~50 ms and 32 MiB per hash on this class of
 * hardware — plenty against offline guessing for a single-user LAN appliance,
 * and unlike bcrypt/argon2 it needs no native module, which is what keeps
 * `npm ci` on the box reliable across Node upgrades.
 */
const N = 32768
const r = 8
const p = 1
const KEYLEN = 64
const SALT_BYTES = 16

/** scrypt's default maxmem (32 MiB) is exactly at our requirement — raise it. */
const MAXMEM = 128 * 1024 * 1024

export async function hashPassword(password) {
  const salt = randomBytes(SALT_BYTES)
  const derived = await scryptAsync(password, salt, KEYLEN, { N, r, p, maxmem: MAXMEM })
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${derived.toString('base64')}`
}

export async function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored.startsWith('scrypt$')) return false
  const [, nStr, rStr, pStr, saltB64, hashB64] = stored.split('$')
  const params = { N: Number(nStr), r: Number(rStr), p: Number(pStr), maxmem: MAXMEM }
  if (!Number.isFinite(params.N) || !Number.isFinite(params.r) || !Number.isFinite(params.p)) {
    return false
  }

  let expected
  try {
    expected = Buffer.from(hashB64, 'base64')
  } catch {
    return false
  }
  const salt = Buffer.from(saltB64, 'base64')

  let actual
  try {
    actual = await scryptAsync(password, salt, expected.length, params)
  } catch {
    return false
  }
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}

/**
 * A password the installer prints once. Ambiguous characters are left out so
 * it can be read off a terminal and typed without a second attempt.
 */
export function generatePassword(length = 20) {
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length]
  return out
}
