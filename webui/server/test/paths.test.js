import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { safeResolve, toRelative } from '../src/models/paths.js'

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shx-paths-'))
  fs.mkdirSync(path.join(root, 'models', 'repo', 'Q8_0'), { recursive: true })
  fs.writeFileSync(path.join(root, 'models', 'repo', 'Q8_0', 'm.gguf'), 'x')
  fs.writeFileSync(path.join(root, 'secret.txt'), 'do not read me')
  return { root, models: path.join(root, 'models') }
}

test('resolves an ordinary relative path inside the root', () => {
  const { models } = makeRoot()
  const resolved = safeResolve(models, 'repo/Q8_0/m.gguf')
  assert.equal(resolved, path.join(models, 'repo/Q8_0/m.gguf'))
})

test('rejects .. traversal in every position', () => {
  const { models } = makeRoot()
  for (const bad of ['../secret.txt', 'repo/../../secret.txt', '..', 'a/../../b']) {
    assert.throws(() => safeResolve(models, bad), /\.\./, `should reject ${bad}`)
  }
})

test('rejects absolute paths', () => {
  const { models } = makeRoot()
  assert.throws(() => safeResolve(models, '/etc/passwd'), /relativ/)
})

test('rejects null bytes and backslashes', () => {
  const { models } = makeRoot()
  assert.throws(() => safeResolve(models, 'a\0b.gguf'), /Nullbyte/)
  assert.throws(() => safeResolve(models, 'a\\b.gguf'), /Backslash/)
})

test('rejects an empty or non-string path', () => {
  const { models } = makeRoot()
  assert.throws(() => safeResolve(models, ''), /kein Pfad/)
  assert.throws(() => safeResolve(models, undefined), /kein Pfad/)
  assert.throws(() => safeResolve(models, 42), /kein Pfad/)
})

test('rejects a symlink that escapes the root', () => {
  const { root, models } = makeRoot()
  // The syntactic checks cannot see this: the path has no "..", stays inside
  // the root textually, and only realpath reveals the escape.
  fs.symlinkSync(path.join(root, 'secret.txt'), path.join(models, 'escape.gguf'))
  assert.throws(() => safeResolve(models, 'escape.gguf'), /Symlink/)
})

test('rejects a file inside a symlinked directory that escapes the root', () => {
  const { root, models } = makeRoot()
  fs.mkdirSync(path.join(root, 'outside'))
  fs.writeFileSync(path.join(root, 'outside', 'x.gguf'), 'x')
  fs.symlinkSync(path.join(root, 'outside'), path.join(models, 'linked'))
  assert.throws(() => safeResolve(models, 'linked/x.gguf'), /Symlink/)
})

test('allows a symlink that stays inside the root', () => {
  const { models } = makeRoot()
  fs.symlinkSync(path.join(models, 'repo'), path.join(models, 'alias'))
  assert.doesNotThrow(() => safeResolve(models, 'alias/Q8_0/m.gguf'))
})

test('allows a path that does not exist yet (download targets)', () => {
  const { models } = makeRoot()
  assert.doesNotThrow(() => safeResolve(models, 'brandnew/repo/file.gguf'))
})

test('mustExist rejects a missing file', () => {
  const { models } = makeRoot()
  assert.throws(() => safeResolve(models, 'nope.gguf', { mustExist: true }), /nicht gefunden/)
})

test('toRelative round-trips with forward slashes', () => {
  const { models } = makeRoot()
  const abs = safeResolve(models, 'repo/Q8_0/m.gguf')
  assert.equal(toRelative(models, abs), 'repo/Q8_0/m.gguf')
})
