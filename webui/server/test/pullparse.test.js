import assert from 'node:assert/strict'
import { test } from 'node:test'

import { PullProgress, toBytes } from '../src/images/pullparse.js'

test('converts both decimal and binary size units', () => {
  assert.equal(toBytes(1, 'KiB'), 1024)
  assert.equal(toBytes(1, 'MiB'), 1024 ** 2)
  assert.equal(toBytes(1, 'GiB'), 1024 ** 3)
  assert.equal(toBytes(1, 'kB'), 1000)
  assert.equal(toBytes(2.5, 'GiB'), Math.round(2.5 * 1024 ** 3))
})

test('tracks a single blob to a percentage', () => {
  const p = new PullProgress()
  const first = p.push('Copying blob 3f2b1a0c [==>-------] 1.0GiB / 5.0GiB')
  assert.equal(first.pct, 20)
  assert.equal(first.total, 5 * 1024 ** 3)

  const second = p.push('Copying blob 3f2b1a0c [=====>----] 2.5GiB / 5.0GiB')
  assert.equal(second.pct, 50)
})

test('sums several blobs', () => {
  const p = new PullProgress()
  p.push('Copying blob aaa [=>--------] 1.0GiB / 4.0GiB')
  const snapshot = p.push('Copying blob bbb [=>--------] 1.0GiB / 4.0GiB')
  assert.equal(snapshot.done, 2 * 1024 ** 3)
  assert.equal(snapshot.total, 8 * 1024 ** 3)
  assert.equal(snapshot.pct, 25)
})

test('the percentage never moves backwards when a new blob appears', () => {
  // Blobs are announced over time, so the denominator grows; a raw ratio would
  // visibly go backwards, which reads as a broken UI.
  const p = new PullProgress()
  const a = p.push('Copying blob aaa [========>-] 3.6GiB / 4.0GiB')
  assert.equal(a.pct, 90)
  const b = p.push('Copying blob bbb [----------] 0.0GiB / 40.0GiB')
  assert.ok(b.pct >= a.pct, `expected ${b.pct} >= ${a.pct}`)
})

test('a blob reported as done counts as complete', () => {
  const p = new PullProgress()
  p.push('Copying blob aaa [=====>----] 2.0GiB / 4.0GiB')
  const snapshot = p.push('Copying blob aaa done')
  assert.equal(snapshot.done, snapshot.total)
})

test('the manifest line finishes the pull at 100 percent', () => {
  const p = new PullProgress()
  p.push('Copying blob aaa [=====>----] 2.0GiB / 4.0GiB')
  const snapshot = p.push('Writing manifest to image destination')
  assert.equal(snapshot.pct, 100)
})

test('unparseable output leaves the percentage null instead of throwing', () => {
  // podman's format is not a stable contract; the UI falls back to an
  // indeterminate bar plus the raw line.
  const p = new PullProgress()
  const snapshot = p.push('Trying to pull docker.io/foo/bar:baz...')
  assert.equal(snapshot.pct, null)
  assert.equal(snapshot.line, 'Trying to pull docker.io/foo/bar:baz...')
})

test('handles empty and non-string input', () => {
  const p = new PullProgress()
  assert.doesNotThrow(() => p.push(''))
  assert.doesNotThrow(() => p.push(undefined))
  assert.doesNotThrow(() => p.push(null))
  assert.equal(p.snapshot().pct, null)
})

test('never reports 100 percent before the manifest is written', () => {
  const p = new PullProgress()
  const snapshot = p.push('Copying blob aaa [==========] 4.0GiB / 4.0GiB')
  assert.equal(snapshot.pct, 99)
})

test('parses a realistic sequence end to end', () => {
  const p = new PullProgress()
  const lines = [
    'Trying to pull docker.io/st3v0rr/amd-strix-halo-toolboxes:rocm-7.14...',
    'Getting image source signatures',
    'Copying blob 1a2b3c4d [>---------] 100.0MiB / 2.0GiB',
    'Copying blob 5e6f7a8b [>---------] 50.0MiB / 1.0GiB',
    'Copying blob 1a2b3c4d [=====>----] 1.0GiB / 2.0GiB',
    'Copying blob 5e6f7a8b done',
    'Copying blob 1a2b3c4d done',
    'Copying config 9d4e1f done',
    'Writing manifest to image destination',
  ]
  let last = null
  for (const line of lines) last = p.push(line)
  assert.equal(last.pct, 100)
})
