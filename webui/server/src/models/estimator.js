import fsp from 'node:fs/promises'

import { vramEstimator } from '../config/paths.js'
import { failedDependency } from '../lib/errors.js'
import { run } from '../lib/exec.js'
import { log } from '../lib/log.js'

/** Cache per (path, mtime): a GGUF's header does not change under us. */
const cache = new Map()
const CACHE_MAX = 64

const MIB = 1024 * 1024
const GIB = 1024 * MIB

/**
 * Parse the estimator's fixed-width table.
 *
 * Output shape (gguf-vram-estimator.py lines 125-144):
 *
 *   --- Model 'Qwen3.6-35B' ---
 *   Max Context: 262,144 tokens
 *   Model Size: 19.42 GiB (from file size)
 *   Incl. Overhead: 2.00 GiB (for compute buffer, etc. adjustable via --overhead)
 *
 *   --- Memory Footprint Estimation ---
 *      Context Size |  Context Memory | Est. Total VRAM
 *   ---------------------------------------------------
 *             4,096 |         1.12 GiB |        21.54 GiB
 */
export function parseEstimate(stdout) {
  const rows = []
  let modelName = null
  let maxContext = null
  let modelSizeBytes = null
  let overheadGib = null

  for (const raw of String(stdout).split('\n')) {
    const line = raw.trim()
    if (!line) continue

    const name = /^---\s*Model\s+'(.*)'\s*---$/.exec(line)
    if (name) {
      modelName = name[1]
      continue
    }
    const ctx = /^Max Context:\s*([\d,]+)\s*tokens/.exec(line)
    if (ctx) {
      maxContext = Number(ctx[1].replace(/,/g, ''))
      continue
    }
    const size = /^Model Size:\s*([\d.]+)\s*(MiB|GiB)/.exec(line)
    if (size) {
      modelSizeBytes = toBytes(Number(size[1]), size[2])
      continue
    }
    const overhead = /^Incl\. Overhead:\s*([\d.]+)\s*GiB/.exec(line)
    if (overhead) {
      overheadGib = Number(overhead[1])
      continue
    }

    // Data rows: "<ctx> | <kv> MiB|GiB | <total> MiB|GiB"
    const row = /^([\d,]+)\s*\|\s*([\d.]+)\s*(MiB|GiB)\s*\|\s*([\d.]+)\s*(MiB|GiB)$/.exec(line)
    if (row) {
      rows.push({
        ctxSize: Number(row[1].replace(/,/g, '')),
        kvBytes: toBytes(Number(row[2]), row[3]),
        totalBytes: toBytes(Number(row[4]), row[5]),
      })
    }
  }

  return { modelName, maxContext, modelSizeBytes, overheadGib, rows }
}

function toBytes(value, unit) {
  return Math.round(value * (unit === 'GiB' ? GIB : MIB))
}

/**
 * Estimate VRAM for a model at several context sizes.
 *
 * Runs the host copy of the estimator rather than the one baked into the
 * images: it only reads the GGUF header, so a container start would cost
 * seconds for no benefit.
 *
 * @param {string} absPath absolute path to the (first shard of the) model
 * @param {{contexts?: number[], overhead?: number}} [opts]
 */
export async function estimateVram(absPath, { contexts = [], overhead = 2.0 } = {}) {
  let mtime = ''
  try {
    mtime = (await fsp.stat(absPath)).mtimeMs.toString()
  } catch {
    throw failedDependency(`Modelldatei nicht lesbar: ${absPath}`)
  }

  const key = `${absPath}|${mtime}|${contexts.join(',')}|${overhead}`
  if (cache.has(key)) return cache.get(key)

  const argv = [vramEstimator, absPath]
  if (contexts.length) argv.push('-c', ...contexts.map(String))
  argv.push('--overhead', String(overhead))

  const { stdout, stderr, code } = await run('python3', argv, {
    timeoutMs: 60_000,
    allowFailure: true,
  })

  if (code !== 0) {
    const detail = (stderr || stdout).trim().split('\n').slice(-2).join(' ')
    throw failedDependency(
      `Der VRAM-Schätzer konnte das Modell nicht lesen${detail ? `: ${detail}` : '.'}`,
    )
  }

  const parsed = parseEstimate(stdout)
  if (!parsed.rows.length) {
    log.warn(`VRAM-Schätzer lieferte keine auswertbare Tabelle für ${absPath}`)
  }
  // Warnings about missing shards go to stderr and are worth surfacing.
  parsed.warning = stderr.trim() || null

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value)
  cache.set(key, parsed)
  return parsed
}
