import { stripAnsi } from '../lib/ansi.js'
import { log } from '../lib/log.js'
import { RingBuffer } from '../lib/ringbuffer.js'
import { redact } from '../lib/redact.js'
import { followLogs } from './client.js'

const RING_SIZE = 2000
/** Keep the child alive briefly after the last client leaves, for tab switches. */
const LINGER_MS = 30_000

/**
 * One `podman logs -f` child per container, fanned out to any number of SSE
 * clients.
 *
 * Spawning per client would mean N podman processes for one container and N
 * copies of the same output; this way a second browser tab is free, and both
 * tabs get the same sequence numbers so `Last-Event-ID` resume works for each
 * independently.
 */
class LogSession {
  constructor(name) {
    this.name = name
    this.ring = new RingBuffer(RING_SIZE)
    /** @type {Set<{send: Function, close: Function}>} */
    this.clients = new Set()
    this.child = null
    this.lingerTimer = null
    this.exited = false
  }

  start() {
    if (this.child) return
    this.exited = false
    this.child = followLogs(this.name, {
      tail: 500,
      onLine: (line) => this.#push(line),
      onExit: (code) => {
        this.child = null
        this.exited = true
        this.#broadcast('closed', { code })
      },
    })
    this.child.on('error', (err) => {
      log.warn(`Log-Stream für ${this.name} fehlgeschlagen: ${err.message}`)
      this.#push(`[webui] Log-Stream konnte nicht geöffnet werden: ${err.message}`)
      this.child = null
      this.exited = true
      this.#broadcast('closed', { code: -1 })
    })
  }

  #push(rawLine) {
    const line = redact(stripAnsi(rawLine))
    if (!line) return
    const entry = this.ring.push(line)
    for (const client of this.clients) client.send('line', { line: entry.value }, entry.seq)
  }

  #broadcast(event, data) {
    for (const client of this.clients) client.send(event, data)
  }

  addClient(client, sinceSeq) {
    if (this.lingerTimer) {
      clearTimeout(this.lingerTimer)
      this.lingerTimer = null
    }
    // Replay first so a reconnecting client sees no gap, then go live.
    for (const entry of this.ring.since(sinceSeq)) {
      client.send('line', { line: entry.value }, entry.seq)
    }
    client.send('ready', { name: this.name, buffered: this.ring.length })
    this.clients.add(client)
    this.start()
  }

  removeClient(client) {
    this.clients.delete(client)
    if (this.clients.size === 0) {
      this.lingerTimer = setTimeout(() => this.stop(), LINGER_MS)
      this.lingerTimer.unref?.()
    }
  }

  stop() {
    if (this.lingerTimer) {
      clearTimeout(this.lingerTimer)
      this.lingerTimer = null
    }
    if (this.child) {
      this.child.kill('SIGTERM')
      this.child = null
    }
    for (const client of this.clients) client.close()
    this.clients.clear()
    sessions.delete(this.name)
  }
}

/** @type {Map<string, LogSession>} */
const sessions = new Map()

export function attachLogClient(name, client, sinceSeq) {
  let session = sessions.get(name)
  if (!session) {
    session = new LogSession(name)
    sessions.set(name, session)
  }
  session.addClient(client, sinceSeq)
  return () => session.removeClient(client)
}

/** Tear a session down, e.g. when its container is removed. */
export function closeLogSession(name) {
  sessions.get(name)?.stop()
}

export function closeAllLogSessions() {
  for (const session of [...sessions.values()]) session.stop()
}
