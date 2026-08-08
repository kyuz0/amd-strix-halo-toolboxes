/**
 * Parses `podman pull` progress.
 *
 * Podman redraws per-blob progress with carriage returns on stderr, in lines
 * like:
 *
 *   Copying blob 3f2b1a0c [====>-----] 1.2GiB / 5.0GiB
 *   Copying config 9d4e1f done
 *
 * This output is not a stable contract, so the parser must never be fatal:
 * anything it cannot read leaves the percentage null, and the UI falls back to
 * an indeterminate bar plus the last raw line.
 */

const BLOB_RE = /^Copying\s+(?<kind>blob|config)\s+(?<id>[0-9a-f]+)/i
const SIZE_PAIR_RE =
  /(?<done>[\d.]+)\s*(?<doneUnit>[KMGT]?i?B)\s*\/\s*(?<total>[\d.]+)\s*(?<totalUnit>[KMGT]?i?B)/i

const UNITS = {
  B: 1,
  KB: 1000,
  MB: 1000 ** 2,
  GB: 1000 ** 3,
  TB: 1000 ** 4,
  KIB: 1024,
  MIB: 1024 ** 2,
  GIB: 1024 ** 3,
  TIB: 1024 ** 4,
}

export function toBytes(value, unit) {
  const factor = UNITS[String(unit).toUpperCase()] ?? 1
  return Math.round(Number(value) * factor)
}

export class PullProgress {
  constructor() {
    /** @type {Map<string, {done: number, total: number}>} */
    this.blobs = new Map()
    this.lastLine = ''
    /** Percentages only ever move forward; blobs appear over time, so the
     *  denominator grows and a raw ratio would visibly go backwards. */
    this.maxPct = 0
    this.done = false
  }

  /** @returns {{pct: number|null, done: number|null, total: number|null, line: string}} */
  push(rawLine) {
    const line = String(rawLine ?? '').trim()
    if (line) this.lastLine = line

    if (/^(Writing manifest|Storing signatures)/i.test(line)) this.done = true

    const blob = BLOB_RE.exec(line)
    if (blob) {
      const sizes = SIZE_PAIR_RE.exec(line)
      const id = blob.groups.id
      if (sizes) {
        this.blobs.set(id, {
          done: toBytes(sizes.groups.done, sizes.groups.doneUnit),
          total: toBytes(sizes.groups.total, sizes.groups.totalUnit),
        })
      } else if (/\bdone\b/i.test(line)) {
        const existing = this.blobs.get(id)
        if (existing) existing.done = existing.total
        else this.blobs.set(id, { done: 1, total: 1 })
      }
    }

    return this.snapshot()
  }

  snapshot() {
    if (this.done) {
      this.maxPct = 100
      const total = this.total
      return { pct: 100, done: total, total, line: this.lastLine }
    }
    if (this.blobs.size === 0) {
      return { pct: null, done: null, total: null, line: this.lastLine }
    }
    const done = this.doneBytes
    const total = this.total
    if (!total) return { pct: null, done, total: null, line: this.lastLine }

    const pct = Math.min(99, Math.round((done / total) * 100))
    this.maxPct = Math.max(this.maxPct, pct)
    return { pct: this.maxPct, done, total, line: this.lastLine }
  }

  get doneBytes() {
    let sum = 0
    for (const blob of this.blobs.values()) sum += blob.done
    return sum
  }

  get total() {
    let sum = 0
    for (const blob of this.blobs.values()) sum += blob.total
    return sum
  }
}
