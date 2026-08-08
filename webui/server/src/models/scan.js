import fsp from 'node:fs/promises'
import path from 'node:path'

import { SHARD_RE } from '../../../shared/constants.js'

const MAX_DEPTH = 6
const SKIP_DIRS = new Set(['.cache', '.git', '.locks', 'node_modules'])
const CACHE_MS = 30_000

let cache = { at: 0, dir: null, value: null }

/**
 * Recursively find every GGUF under `modelsDir` and group multi-part models.
 *
 * Shards matter: llama.cpp is handed only `*-00001-of-000NN.gguf` and finds the
 * rest itself, so presenting five files where the user has one model would be
 * both noisy and misleading about what is startable.
 */
export async function scanModels(modelsDir, { force = false } = {}) {
  if (!force && cache.value && cache.dir === modelsDir && Date.now() - cache.at < CACHE_MS) {
    return cache.value
  }

  /** @type {{rel: string, dir: string, file: string, size: number, mtime: string}[]} */
  const files = []
  /** @type {{rel: string, size: number}[]} */
  const partials = []
  let unreadable = null

  async function walk(absDir, relDir, depth) {
    if (depth > MAX_DEPTH) return
    let entries
    try {
      entries = await fsp.readdir(absDir, { withFileTypes: true })
    } catch (err) {
      if (relDir === '') unreadable = err.message
      return
    }

    for (const entry of entries) {
      const name = entry.name
      if (name.startsWith('.') && name !== '.') {
        if (entry.isDirectory() && !SKIP_DIRS.has(name)) {
          // A dotted directory that is not a known cache is still skipped: the
          // HF cache layout hides a second copy of every blob in there.
          continue
        }
        continue
      }
      if (entry.isDirectory() && SKIP_DIRS.has(name)) continue

      const abs = path.join(absDir, name)
      const rel = relDir ? `${relDir}/${name}` : name

      if (entry.isDirectory()) {
        await walk(abs, rel, depth + 1)
        continue
      }

      // Symlinks are followed only if they stay inside the tree; a link that
      // escapes would otherwise let a delete act outside the models dir.
      if (entry.isSymbolicLink()) {
        try {
          const real = await fsp.realpath(abs)
          const root = await fsp.realpath(modelsDir)
          if (!real.startsWith(root + path.sep)) continue
          const stat = await fsp.stat(abs)
          if (stat.isDirectory()) {
            await walk(abs, rel, depth + 1)
            continue
          }
        } catch {
          continue
        }
      }

      if (name.endsWith('.incomplete') || name.endsWith('.gguf.part')) {
        try {
          const stat = await fsp.stat(abs)
          partials.push({ rel, size: stat.size })
        } catch {
          /* vanished mid-scan */
        }
        continue
      }

      if (!name.toLowerCase().endsWith('.gguf')) continue

      try {
        const stat = await fsp.stat(abs)
        files.push({
          rel,
          dir: relDir,
          file: name,
          size: stat.size,
          mtime: stat.mtime.toISOString(),
        })
      } catch {
        /* vanished mid-scan */
      }
    }
  }

  await walk(path.resolve(modelsDir), '', 0)

  const value = { groups: groupShards(files), partials, unreadable }
  cache = { at: Date.now(), dir: modelsDir, value }
  return value
}

export function invalidateModelCache() {
  cache = { at: 0, dir: null, value: null }
}

/**
 * Collapse `name-00001-of-00003.gguf` … into a single logical model.
 *
 * @param {{rel: string, dir: string, file: string, size: number, mtime: string}[]} files
 */
export function groupShards(files) {
  /** @type {Map<string, any>} */
  const groups = new Map()

  for (const entry of files) {
    const match = SHARD_RE.exec(entry.file)
    if (!match) {
      groups.set(entry.rel, {
        key: entry.rel,
        name: entry.file.replace(/\.gguf$/i, ''),
        dir: entry.dir,
        primary: entry.rel,
        files: [entry.rel],
        shardCount: 1,
        expectedShards: 1,
        complete: true,
        totalBytes: entry.size,
        mtime: entry.mtime,
      })
      continue
    }

    const { base, idx, total } = match.groups
    const key = `${entry.dir}/${base}-of-${total}`
    const expected = Number(total)
    const group = groups.get(key) ?? {
      key,
      name: base,
      dir: entry.dir,
      primary: null,
      files: [],
      shardCount: 0,
      expectedShards: expected,
      complete: false,
      totalBytes: 0,
      mtime: entry.mtime,
    }

    group.files.push(entry.rel)
    group.shardCount += 1
    group.totalBytes += entry.size
    if (entry.mtime > group.mtime) group.mtime = entry.mtime
    // Only the first shard is ever passed to `-m`.
    if (Number(idx) === 1) group.primary = entry.rel
    groups.set(key, group)
  }

  for (const group of groups.values()) {
    group.files.sort()
    group.complete = group.shardCount === group.expectedShards && Boolean(group.primary)
    // Without the first shard the model cannot be started at all.
    if (!group.primary) group.primary = group.files[0] ?? null
  }

  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key))
}

/** Free space on the filesystem holding the models directory. */
export async function diskUsage(modelsDir) {
  try {
    const stats = await fsp.statfs(modelsDir)
    return {
      totalBytes: stats.blocks * stats.bsize,
      freeBytes: stats.bavail * stats.bsize,
    }
  } catch {
    return { totalBytes: null, freeBytes: null }
  }
}
