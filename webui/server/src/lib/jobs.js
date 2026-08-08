import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'

import { RingBuffer } from './ringbuffer.js'
import { log } from './log.js'
import { redact } from './redact.js'
import { AppError, notFound } from './errors.js'

const LOG_LINES = 500
const HISTORY = 50

/**
 * One job abstraction for every long-running thing this app does: model
 * downloads, image pulls, feature detection and self-update.
 *
 * Having a single type means there is exactly one progress API, one SSE
 * endpoint shape and one cancel path in the UI, instead of four near-identical
 * ones.
 */
export class Job {
  constructor({ id, type, title, meta = {} }) {
    this.id = id
    this.type = type
    this.title = title
    this.meta = meta
    this.status = 'queued'
    /** @type {{pct: number|null, done: number|null, total: number|null, rate: number|null, eta: number|null} | null} */
    this.progress = null
    this.message = ''
    this.result = null
    this.error = null
    this.startedAt = null
    this.endedAt = null
    this.createdAt = new Date().toISOString()
    this.logs = new RingBuffer(LOG_LINES)
    /** @type {(() => void) | null} set by the runner so cancel() can act */
    this.onCancel = null
  }

  toJSON() {
    return {
      id: this.id,
      type: this.type,
      title: this.title,
      meta: this.meta,
      status: this.status,
      progress: this.progress,
      message: redact(this.message),
      result: this.result,
      error: this.error ? redact(this.error) : null,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
    }
  }

  get finished() {
    return ['done', 'failed', 'cancelled', 'interrupted'].includes(this.status)
  }
}

export class JobManager extends EventEmitter {
  /**
   * @param {{persist?: (jobs: object[]) => void}} [opts]
   */
  constructor({ persist } = {}) {
    super()
    /** @type {Map<string, Job>} */
    this.jobs = new Map()
    /** @type {Map<string, {limit: number, running: number, queue: {job: Job, fn: Function}[]}>} */
    this.lanes = new Map()
    this.persist = persist
    this.setMaxListeners(0)
  }

  /** Concurrency is per lane, so a slow download never blocks an image pull. */
  configureLane(name, limit) {
    const lane = this.lanes.get(name) || { limit, running: 0, queue: [] }
    lane.limit = limit
    this.lanes.set(name, lane)
    this.#drain(name)
  }

  list({ type, status } = {}) {
    let out = [...this.jobs.values()]
    if (type) out = out.filter((j) => j.type === type)
    if (status) out = out.filter((j) => j.status === status)
    return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map((j) => j.toJSON())
  }

  get(id) {
    const job = this.jobs.get(id)
    if (!job) throw notFound(`Job ${id} ist unbekannt.`)
    return job
  }

  /**
   * Register and (subject to lane capacity) start a job.
   *
   * @param {{type: string, title: string, lane?: string, meta?: object}} spec
   * @param {(ctx: {job: Job, setProgress: Function, appendLog: Function, setMessage: Function,
   *              onCancel: (fn: () => void) => void, signal: AbortSignal}) => Promise<any>} fn
   */
  start(spec, fn) {
    const job = new Job({ id: randomUUID(), ...spec })
    this.jobs.set(job.id, job)
    this.#trim()
    this.#emitJob(job)

    const laneName = spec.lane || spec.type
    if (!this.lanes.has(laneName)) this.configureLane(laneName, 1)
    const lane = this.lanes.get(laneName)
    lane.queue.push({ job, fn })
    this.#drain(laneName)
    return job
  }

  #drain(laneName) {
    const lane = this.lanes.get(laneName)
    if (!lane) return
    while (lane.running < lane.limit && lane.queue.length > 0) {
      const { job, fn } = lane.queue.shift()
      if (job.status === 'cancelled') continue
      lane.running += 1
      this.#run(job, fn).finally(() => {
        lane.running -= 1
        this.#drain(laneName)
      })
    }
  }

  async #run(job, fn) {
    const controller = new AbortController()
    job.status = 'running'
    job.startedAt = new Date().toISOString()
    job.onCancel = () => controller.abort()
    this.#emitJob(job)

    const ctx = {
      job,
      signal: controller.signal,
      setProgress: (progress) => {
        job.progress = progress
        this.emit(`job:${job.id}`, { event: 'progress', data: progress })
        this.emit('job', job.toJSON())
      },
      setMessage: (message) => {
        job.message = message
        this.emit(`job:${job.id}`, { event: 'message', data: { message: redact(message) } })
      },
      appendLog: (line) => {
        const entry = job.logs.push(redact(line))
        this.emit(`job:${job.id}`, { event: 'log', data: { line: entry.value }, id: entry.seq })
      },
      onCancel: (handler) => {
        job.onCancel = () => {
          controller.abort()
          try {
            handler()
          } catch (err) {
            log.warn(`Abbruchbehandlung von Job ${job.id} schlug fehl`, err)
          }
        }
      },
    }

    try {
      job.result = (await fn(ctx)) ?? null
      job.status = controller.signal.aborted ? 'cancelled' : 'done'
    } catch (err) {
      if (controller.signal.aborted) {
        job.status = 'cancelled'
      } else {
        job.status = 'failed'
        job.error = err instanceof AppError ? err.message : String(err?.message || err)
        log.warn(`Job ${job.type} (${job.id}) fehlgeschlagen: ${job.error}`)
      }
    } finally {
      job.endedAt = new Date().toISOString()
      job.onCancel = null
      this.#emitJob(job)
      this.#persist()
    }
  }

  cancel(id) {
    const job = this.get(id)
    if (job.finished) {
      // Nothing to stop — treat it as "dismiss".
      this.jobs.delete(id)
      this.emit('job:removed', id)
      this.#persist()
      return { dismissed: true }
    }
    if (job.status === 'queued') {
      job.status = 'cancelled'
      job.endedAt = new Date().toISOString()
      this.#emitJob(job)
      return { cancelled: true }
    }
    job.onCancel?.()
    return { cancelled: true }
  }

  /** Snapshot for `state.json`, so an interrupted job is still visible later. */
  snapshot() {
    return [...this.jobs.values()]
      .filter((j) => j.type !== 'feature-detect')
      .slice(-HISTORY)
      .map((j) => j.toJSON())
  }

  /**
   * Re-adopt jobs from a previous process. Anything that claimed to be running
   * cannot be — our process died with it — so it is marked `interrupted`, which
   * the UI offers to resume.
   */
  restore(saved = []) {
    for (const raw of saved) {
      if (!raw?.id) continue
      const job = new Job({ id: raw.id, type: raw.type, title: raw.title, meta: raw.meta })
      Object.assign(job, {
        status: ['running', 'queued'].includes(raw.status) ? 'interrupted' : raw.status,
        progress: raw.progress ?? null,
        message: raw.message ?? '',
        result: raw.result ?? null,
        error: raw.error ?? null,
        createdAt: raw.createdAt ?? new Date().toISOString(),
        startedAt: raw.startedAt ?? null,
        endedAt: raw.endedAt ?? new Date().toISOString(),
      })
      this.jobs.set(job.id, job)
    }
  }

  #trim() {
    const finished = [...this.jobs.values()]
      .filter((j) => j.finished)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
    while (finished.length > HISTORY) {
      const job = finished.shift()
      this.jobs.delete(job.id)
    }
  }

  #emitJob(job) {
    const payload = job.toJSON()
    this.emit('job', payload)
    this.emit(`job:${job.id}`, { event: 'status', data: payload })
  }

  #persist() {
    try {
      this.persist?.(this.snapshot())
    } catch (err) {
      log.warn('Jobs konnten nicht persistiert werden', err)
    }
  }
}
