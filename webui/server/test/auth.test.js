import assert from 'node:assert/strict'
import { test } from 'node:test'

import { generatePassword, hashPassword, verifyPassword } from '../src/auth/password.js'
import { generateSecret, signToken, verifyToken } from '../src/auth/tokens.js'
import { originGuard } from '../src/auth/middleware.js'

test('scrypt hash round-trips and rejects the wrong password', async () => {
  const hash = await hashPassword('correct horse battery staple')
  assert.match(hash, /^scrypt\$32768\$8\$1\$/)
  assert.equal(await verifyPassword('correct horse battery staple', hash), true)
  assert.equal(await verifyPassword('Correct horse battery staple', hash), false)
  assert.equal(await verifyPassword('', hash), false)
})

test('verifyPassword survives malformed stored values instead of throwing', async () => {
  for (const stored of ['', 'plaintext', 'scrypt$', 'scrypt$a$b$c$d$e', 'bcrypt$x$y']) {
    assert.equal(await verifyPassword('whatever', stored), false)
  }
})

test('the same password hashes differently each time (unique salt)', async () => {
  const a = await hashPassword('same')
  const b = await hashPassword('same')
  assert.notEqual(a, b)
  assert.equal(await verifyPassword('same', a), true)
  assert.equal(await verifyPassword('same', b), true)
})

test('generated passwords avoid ambiguous characters', () => {
  const pw = generatePassword(200)
  assert.equal(pw.length, 200)
  assert.doesNotMatch(pw, /[0O1lI]/)
})

test('a signed token verifies and carries the subject', async () => {
  const secret = generateSecret()
  const token = await signToken(secret, { sub: 'admin' })
  const payload = await verifyToken(secret, token)
  assert.equal(payload.sub, 'admin')
  assert.equal(payload.aud, 'shx')
})

test('a token signed with another secret is rejected', async () => {
  const token = await signToken(generateSecret(), { sub: 'admin' })
  assert.equal(await verifyToken(generateSecret(), token), null)
})

test('an expired token is rejected', async () => {
  const secret = generateSecret()
  const token = await signToken(secret, { sub: 'admin', ttl: -10 })
  assert.equal(await verifyToken(secret, token), null)
})

test('a token minted for the SSE audience does not unlock the API', async () => {
  const secret = generateSecret()
  const ticket = await signToken(secret, { sub: 'admin', audience: 'sse' })
  assert.equal(await verifyToken(secret, ticket), null)
  assert.ok(await verifyToken(secret, ticket, 'sse'))
})

test('garbage tokens are rejected rather than throwing', async () => {
  const secret = generateSecret()
  for (const token of ['', 'abc', 'a.b.c', null, undefined]) {
    assert.equal(await verifyToken(secret, token), null)
  }
})

/* ------------------------------ originGuard ------------------------------ */

function fakeReq({ method = 'POST', headers = {} } = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return { method, get: (name) => lower[name.toLowerCase()] }
}

function runGuard(req) {
  return new Promise((resolve) => {
    originGuard(req, {}, (err) => resolve(err ?? null))
  })
}

test('originGuard lets safe methods through untouched', async () => {
  assert.equal(await runGuard(fakeReq({ method: 'GET' })), null)
  assert.equal(await runGuard(fakeReq({ method: 'HEAD' })), null)
})

test('originGuard requires the custom header on mutating requests', async () => {
  const err = await runGuard(fakeReq({ headers: { origin: 'http://box:8420', host: 'box:8420' } }))
  assert.equal(err?.status, 403)
  assert.match(err.message, /X-Requested-With/)
})

test('originGuard rejects a mismatched or missing Origin', async () => {
  const mismatch = await runGuard(
    fakeReq({
      headers: { 'x-requested-with': 'shx', origin: 'http://evil.test', host: 'box:8420' },
    }),
  )
  assert.equal(mismatch?.status, 403)

  const missing = await runGuard(
    fakeReq({ headers: { 'x-requested-with': 'shx', host: 'box:8420' } }),
  )
  assert.equal(missing?.status, 403)
})

test('originGuard accepts a same-origin mutating request', async () => {
  const err = await runGuard(
    fakeReq({
      headers: { 'x-requested-with': 'shx', origin: 'http://box:8420', host: 'box:8420' },
    }),
  )
  assert.equal(err, null)
})

test('originGuard falls back to Referer when Origin is absent', async () => {
  const err = await runGuard(
    fakeReq({
      headers: {
        'x-requested-with': 'shx',
        referer: 'http://box:8420/servers',
        host: 'box:8420',
      },
    }),
  )
  assert.equal(err, null)
})
