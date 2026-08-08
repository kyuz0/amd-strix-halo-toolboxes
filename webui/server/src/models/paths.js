import fs from 'node:fs'
import path from 'node:path'

import { badRequest } from '../lib/errors.js'

/**
 * Resolve a client-supplied relative path inside the models directory, or
 * throw.
 *
 * Every filesystem entry point in the app goes through here — listing,
 * deleting, VRAM estimation, download targets and the `-m` argument — so there
 * is exactly one place where a traversal could slip past.
 *
 * Two layers: a syntactic check that rejects the obvious attacks before
 * touching the disk, then a realpath comparison that also defeats a symlink
 * inside the models directory pointing somewhere else entirely.
 *
 * @param {string} root absolute models directory
 * @param {string} relative path relative to `root`
 * @param {{mustExist?: boolean}} [opts]
 * @returns {string} the resolved absolute path
 */
export function safeResolve(root, relative, { mustExist = false } = {}) {
  if (typeof relative !== 'string' || relative.length === 0) {
    throw badRequest('Es wurde kein Pfad angegeben.')
  }
  if (relative.includes('\0')) {
    throw badRequest('Der Pfad enthält ein Nullbyte.')
  }
  if (relative.includes('\\')) {
    throw badRequest('Backslashes sind im Pfad nicht erlaubt.')
  }
  if (path.isAbsolute(relative)) {
    throw badRequest('Der Pfad muss relativ zum Modellverzeichnis sein.')
  }
  if (relative.split('/').some((segment) => segment === '..')) {
    throw badRequest('Der Pfad darf keine ".."-Segmente enthalten.')
  }

  const absoluteRoot = path.resolve(root)
  const resolved = path.resolve(absoluteRoot, relative)
  if (!isInside(absoluteRoot, resolved)) {
    throw badRequest('Der Pfad liegt außerhalb des Modellverzeichnisses.')
  }

  // The syntactic check above cannot see a symlink that escapes the root, so
  // compare the real paths too — for whichever part of the chain exists.
  const realRoot = realpathOrSelf(absoluteRoot)
  const realTarget = realpathOfNearestExisting(resolved)
  if (realTarget && !isInside(realRoot, realTarget)) {
    throw badRequest('Der Pfad verweist über einen Symlink aus dem Modellverzeichnis heraus.')
  }

  if (mustExist && !fs.existsSync(resolved)) {
    throw badRequest(`Datei nicht gefunden: ${relative}`)
  }

  return resolved
}

function isInside(root, target) {
  return target === root || target.startsWith(root + path.sep)
}

function realpathOrSelf(p) {
  try {
    return fs.realpathSync(p)
  } catch {
    return p
  }
}

/**
 * realpath of `target`, or of its nearest existing ancestor if it does not
 * exist yet (download destinations do not). Returns null if nothing resolves.
 */
function realpathOfNearestExisting(target) {
  let current = target
  for (let i = 0; i < 64; i++) {
    try {
      const real = fs.realpathSync(current)
      // For a not-yet-existing leaf, re-append the part we walked off.
      return current === target ? real : path.join(real, path.relative(current, target))
    } catch (err) {
      if (err.code !== 'ENOENT') return null
      const parent = path.dirname(current)
      if (parent === current) return null
      current = parent
    }
  }
  return null
}

/** Relative form of an absolute path, for sending back to the client. */
export function toRelative(root, absolute) {
  return path.relative(path.resolve(root), absolute).split(path.sep).join('/')
}
