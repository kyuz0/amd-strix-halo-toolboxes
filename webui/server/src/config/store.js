import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

/**
 * A single JSON file held in memory, validated by a zod schema, and written
 * back atomically.
 *
 * The dataset here is a few dozen records, so "load it all, keep it in memory,
 * rewrite the whole file on change" is both simpler and faster than a database
 * — and it keeps every dependency pure JS, which is what makes `npm ci` on the
 * box reliable across Node upgrades.
 */
export class JsonStore {
  /**
   * @param {object} opts
   * @param {string} opts.file
   * @param {import('zod').ZodTypeAny} opts.schema
   * @param {number} [opts.mode] file mode; 0o600 for anything holding secrets
   * @param {number} [opts.debounceMs]
   * @param {(msg: string, err?: unknown) => void} [opts.log]
   */
  constructor({ file, schema, mode = 0o600, debounceMs = 200, log = () => {} }) {
    this.file = file
    this.schema = schema
    this.mode = mode
    this.debounceMs = debounceMs
    this.log = log
    this.data = schema.parse({})

    /** Serialises writes so two flushes can never interleave. */
    this.tail = Promise.resolve()
    /** @type {NodeJS.Timeout | null} */
    this.timer = null
    /** @type {{resolve: () => void, reject: (e: unknown) => void}[]} */
    this.waiters = []
  }

  /**
   * Load from disk. A corrupt file is moved aside rather than thrown: crash
   * looping a boot service over one bad JSON byte helps nobody.
   */
  load() {
    let raw
    try {
      raw = fs.readFileSync(this.file, 'utf8')
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
      this.data = this.schema.parse({})
      return this.data
    }

    try {
      this.data = this.schema.parse(JSON.parse(raw))
    } catch (err) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const backup = `${this.file}.corrupt-${stamp}`
      try {
        fs.renameSync(this.file, backup)
      } catch {
        // if we cannot even move it aside, carry on with defaults anyway
      }
      this.log(`config file ${this.file} was unreadable, moved to ${backup}; using defaults`, err)
      this.data = this.schema.parse({})
    }
    return this.data
  }

  /**
   * Mutate in memory, re-validate, and schedule a debounced flush.
   * The mutator may edit `data` in place or return a replacement.
   *
   * @param {(data: any) => any} mutator
   */
  update(mutator) {
    const next = mutator(this.data)
    this.data = this.schema.parse(next === undefined ? this.data : next)
    return this.scheduleFlush()
  }

  /** @returns {Promise<void>} resolves once the pending write has hit disk */
  scheduleFlush() {
    const promise = new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject })
    })
    if (!this.timer) {
      // The timer's own promise has no awaiter; the waiters above carry the
      // outcome, so swallow it here to avoid an unhandled rejection.
      this.timer = setTimeout(() => {
        this.flush().catch(() => {})
      }, this.debounceMs)
      // Deliberately NOT unref'd: an unwritten change must keep the process
      // alive until it lands. Unref'ing here made the short-lived CLI tools
      // (install.sh's init-config, shx-passwd) exit silently with code 0
      // before ever writing config.json.
    }
    return promise
  }

  /** Write immediately, collapsing any debounce that is still pending. */
  flush() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const waiters = this.waiters
    this.waiters = []

    const write = this.#enqueueWrite()
    write.then(
      () => waiters.forEach((w) => w.resolve()),
      (err) => waiters.forEach((w) => w.reject(err)),
    )
    return write
  }

  #enqueueWrite() {
    const run = this.tail.then(
      () => this.#write(),
      () => this.#write(),
    )
    // Keep the chain alive regardless of individual failures.
    this.tail = run.catch(() => {})
    return run
  }

  async #write() {
    const snapshot = JSON.stringify(this.data, null, 2) + '\n'
    const dir = path.dirname(this.file)
    await fsp.mkdir(dir, { recursive: true, mode: 0o700 })
    const tmp = path.join(dir, `.${path.basename(this.file)}.tmp-${process.pid}`)

    const handle = await fsp.open(tmp, 'w', this.mode)
    try {
      await handle.writeFile(snapshot, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await fsp.rename(tmp, this.file)
    // rename keeps the tmp file's mode, but enforce on every write anyway so a
    // file that arrived some other way cannot stay world-readable.
    await fsp.chmod(this.file, this.mode)
  }
}
