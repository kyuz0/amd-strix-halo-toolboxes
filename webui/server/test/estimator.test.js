import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseEstimate } from '../src/models/estimator.js'

/**
 * Verbatim shape of gguf-vram-estimator.py's output (see its lines 125-144):
 * a header block, then a fixed-width table formatted with `{:>15,}` and
 * `format_mem()`, which pads to 8 characters and appends the unit.
 */
const SAMPLE = `
--- Model 'Qwen3.6-35B-A3B-Instruct' ---
Max Context: 262,144 tokens
Model Size: 19.42 GiB (from file size)
Incl. Overhead: 2.00 GiB (for compute buffer, etc. adjustable via --overhead)

--- Memory Footprint Estimation ---
   Context Size |  Context Memory | Est. Total VRAM
---------------------------------------------------
          4,096 |      562.50 MiB |        21.97 GiB
         32,768 |        4.39 GiB |        25.81 GiB
        131,072 |       17.58 GiB |        39.00 GiB
`

test('parses the header fields', () => {
  const parsed = parseEstimate(SAMPLE)
  assert.equal(parsed.modelName, 'Qwen3.6-35B-A3B-Instruct')
  assert.equal(parsed.maxContext, 262144)
  assert.equal(parsed.overheadGib, 2)
  assert.equal(parsed.modelSizeBytes, Math.round(19.42 * 1024 ** 3))
})

test('parses every data row with its units', () => {
  const { rows } = parseEstimate(SAMPLE)
  assert.equal(rows.length, 3)
  assert.deepEqual(rows[0], {
    ctxSize: 4096,
    kvBytes: Math.round(562.5 * 1024 ** 2),
    totalBytes: Math.round(21.97 * 1024 ** 3),
  })
  assert.equal(rows[1].ctxSize, 32768)
  assert.equal(rows[2].ctxSize, 131072)
})

test('the separator line is not mistaken for a data row', () => {
  const { rows } = parseEstimate(SAMPLE)
  assert.ok(rows.every((r) => Number.isInteger(r.ctxSize) && r.ctxSize > 0))
})

test('unparseable output yields empty rows instead of throwing', () => {
  const parsed = parseEstimate('Error: Invalid GGUF magic number')
  assert.deepEqual(parsed.rows, [])
  assert.equal(parsed.modelName, null)
})

test('handles an empty string', () => {
  const parsed = parseEstimate('')
  assert.deepEqual(parsed.rows, [])
})

test('mixed MiB and GiB units are both converted to bytes', () => {
  const { rows } = parseEstimate(`
   Context Size |  Context Memory | Est. Total VRAM
---------------------------------------------------
          1,024 |      128.00 MiB |         3.50 GiB
`)
  assert.equal(rows[0].kvBytes, 128 * 1024 ** 2)
  assert.equal(rows[0].totalBytes, Math.round(3.5 * 1024 ** 3))
})
