import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildIncludes } from '../src/models/download.js'

test('a small selection is passed through as explicit paths', () => {
  const paths = ['Q4_K_M/model.gguf', 'Q8_0/model.gguf']
  assert.deepEqual(buildIncludes(paths), paths)
})

test('exactly 20 files still use explicit paths', () => {
  const paths = Array.from({ length: 20 }, (_, i) => `Q4/part-${i}.gguf`)
  assert.equal(buildIncludes(paths).length, 20)
})

test('a large selection collapses to one glob per directory', () => {
  const paths = Array.from({ length: 30 }, (_, i) => `UD-Q4_K_XL/m-${i}.gguf`)
  assert.deepEqual(buildIncludes(paths), ['UD-Q4_K_XL/*'])
})

test('a large selection spanning directories yields one glob each', () => {
  const paths = [
    ...Array.from({ length: 15 }, (_, i) => `A/m-${i}.gguf`),
    ...Array.from({ length: 15 }, (_, i) => `B/m-${i}.gguf`),
  ]
  assert.deepEqual(buildIncludes(paths).sort(), ['A/*', 'B/*'])
})

test('root-level files in a large selection use a gguf glob, not a bare star', () => {
  // `*` would also pull README.md, config.json and the tokenizer.
  const paths = Array.from({ length: 25 }, (_, i) => `m-${i}.gguf`)
  assert.deepEqual(buildIncludes(paths), ['*.gguf'])
})

test('the returned array is a copy, not the caller’s', () => {
  const paths = ['a.gguf']
  const result = buildIncludes(paths)
  result.push('b.gguf')
  assert.deepEqual(paths, ['a.gguf'])
})
