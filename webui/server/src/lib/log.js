import fs from 'node:fs'
import path from 'node:path'

import { redact } from './redact.js'

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 }
const MAX_BYTES = 5 * 1024 * 1024
const KEEP = 3

/**
 * Writes to stdout (which systemd captures into the journal) and, once a state
 * directory exists, additionally to a rotating app.log.
 */
class Logger {
  constructor() {
    this.level = LEVELS[process.env.SHX_LOG_LEVEL] ?? LEVELS.info
    /** @type {fs.WriteStream | null} */
    this.stream = null
    this.file = null
    this.bytes = 0
  }

  /** Start mirroring to a file. Called once the state directory is known. */
  attachFile(file) {
    this.file = file
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
      this.bytes = fs.existsSync(file) ? fs.statSync(file).size : 0
      this.stream = fs.createWriteStream(file, { flags: 'a' })
      this.stream.on('error', () => {
        // A broken log file must never take the service down.
        this.stream = null
      })
    } catch {
      this.stream = null
    }
  }

  #rotate() {
    if (!this.file) return
    try {
      this.stream?.end()
      this.stream = null
      for (let i = KEEP - 1; i >= 1; i--) {
        const from = `${this.file}.${i}`
        const to = `${this.file}.${i + 1}`
        if (fs.existsSync(from)) fs.renameSync(from, to)
      }
      fs.renameSync(this.file, `${this.file}.1`)
      this.bytes = 0
      this.stream = fs.createWriteStream(this.file, { flags: 'a' })
    } catch {
      this.stream = null
    }
  }

  #emit(level, msg, err) {
    if (LEVELS[level] < this.level) return
    const line =
      `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${redact(String(msg))}` +
      (err ? `\n${redact(err.stack || String(err))}` : '')

    if (level === 'error' || level === 'warn') process.stderr.write(line + '\n')
    else process.stdout.write(line + '\n')

    if (this.stream) {
      this.bytes += Buffer.byteLength(line) + 1
      this.stream.write(line + '\n')
      if (this.bytes > MAX_BYTES) this.#rotate()
    }
  }

  debug(msg, err) {
    this.#emit('debug', msg, err)
  }
  info(msg, err) {
    this.#emit('info', msg, err)
  }
  warn(msg, err) {
    this.#emit('warn', msg, err)
  }
  error(msg, err) {
    this.#emit('error', msg, err)
  }
}

export const log = new Logger()
