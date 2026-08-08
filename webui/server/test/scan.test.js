import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { groupShards, scanModels } from '../src/models/scan.js'

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'shx-scan-'))
}

function write(root, rel, bytes = 16) {
  const abs = path.join(root, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, Buffer.alloc(bytes))
  return abs
}

/* ------------------------------ groupShards ------------------------------ */

const entry = (rel, size = 100) => ({
  rel,
  dir: path.dirname(rel) === '.' ? '' : path.dirname(rel),
  file: path.basename(rel),
  size,
  mtime: '2026-08-01T00:00:00.000Z',
})

test('a single-file model becomes one group', () => {
  const groups = groupShards([entry('repo/Q8_0/m.gguf', 500)])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].primary, 'repo/Q8_0/m.gguf')
  assert.equal(groups[0].expectedShards, 1)
  assert.equal(groups[0].complete, true)
  assert.equal(groups[0].totalBytes, 500)
})

test('shards collapse into one group whose primary is the first part', () => {
  const groups = groupShards([
    entry('r/F16/m-00002-of-00003.gguf', 200),
    entry('r/F16/m-00001-of-00003.gguf', 100),
    entry('r/F16/m-00003-of-00003.gguf', 300),
  ])
  assert.equal(groups.length, 1)
  const [group] = groups
  assert.equal(group.primary, 'r/F16/m-00001-of-00003.gguf')
  assert.equal(group.shardCount, 3)
  assert.equal(group.expectedShards, 3)
  assert.equal(group.complete, true)
  assert.equal(group.totalBytes, 600)
})

test('an incomplete shard set is reported as incomplete', () => {
  const groups = groupShards([
    entry('r/F16/m-00001-of-00003.gguf'),
    entry('r/F16/m-00003-of-00003.gguf'),
  ])
  assert.equal(groups[0].shardCount, 2)
  assert.equal(groups[0].expectedShards, 3)
  assert.equal(groups[0].complete, false)
})

test('a shard set missing its first part is incomplete and cannot be started', () => {
  // llama.cpp is always handed -00001-of-; without it there is nothing to pass.
  const groups = groupShards([
    entry('r/F16/m-00002-of-00002.gguf'),
  ])
  assert.equal(groups[0].complete, false)
})

test('two different models in the same folder stay separate', () => {
  const groups = groupShards([
    entry('r/Q4/a-00001-of-00002.gguf'),
    entry('r/Q4/a-00002-of-00002.gguf'),
    entry('r/Q4/b-00001-of-00002.gguf'),
    entry('r/Q4/b-00002-of-00002.gguf'),
  ])
  assert.equal(groups.length, 2)
  assert.deepEqual(groups.map((g) => g.name).sort(), ['a', 'b'])
})

test('same-named shard sets in different folders stay separate', () => {
  const groups = groupShards([
    entry('r/Q4/m-00001-of-00002.gguf'),
    entry('r/Q8/m-00001-of-00002.gguf'),
  ])
  assert.equal(groups.length, 2)
})

/* ------------------------------- scanModels ------------------------------ */

test('scans recursively and reports sizes', async () => {
  const root = tmpRoot()
  write(root, 'repo/Q8_0/m.gguf', 1234)
  write(root, 'other/deep/nested/x.gguf', 10)

  const { groups } = await scanModels(root, { force: true })
  assert.equal(groups.length, 2)
  const m = groups.find((g) => g.name === 'm')
  assert.equal(m.totalBytes, 1234)
  assert.equal(m.dir, 'repo/Q8_0')
})

test('ignores non-gguf files and known cache directories', async () => {
  const root = tmpRoot()
  write(root, 'repo/m.gguf')
  write(root, 'repo/README.md')
  write(root, 'repo/config.json')
  write(root, '.cache/huggingface/blobs/deadbeef.gguf')
  write(root, '.git/objects/x.gguf')

  const { groups } = await scanModels(root, { force: true })
  assert.deepEqual(groups.map((g) => g.name), ['m'])
})

test('reports .incomplete partials separately instead of as models', async () => {
  const root = tmpRoot()
  write(root, 'repo/done.gguf', 50)
  write(root, 'repo/pending.gguf.incomplete', 900)

  const { groups, partials } = await scanModels(root, { force: true })
  assert.deepEqual(groups.map((g) => g.name), ['done'])
  assert.equal(partials.length, 1)
  assert.equal(partials[0].size, 900)
})

test('does not follow a symlinked directory that escapes the root', async () => {
  const root = tmpRoot()
  const outside = tmpRoot()
  write(outside, 'secret.gguf')
  write(root, 'repo/m.gguf')
  fs.symlinkSync(outside, path.join(root, 'escape'))

  const { groups } = await scanModels(root, { force: true })
  assert.deepEqual(groups.map((g) => g.name), ['m'])
})

test('an unreadable root is reported rather than thrown', async () => {
  const { groups, unreadable } = await scanModels('/definitely/not/here', { force: true })
  assert.deepEqual(groups, [])
  assert.ok(unreadable)
})

test('the cache is bypassed by force and honoured otherwise', async () => {
  const root = tmpRoot()
  write(root, 'a.gguf')
  const first = await scanModels(root, { force: true })
  assert.equal(first.groups.length, 1)

  write(root, 'b.gguf')
  const cached = await scanModels(root)
  assert.equal(cached.groups.length, 1, 'cached result should not see the new file')

  const fresh = await scanModels(root, { force: true })
  assert.equal(fresh.groups.length, 2)
})
