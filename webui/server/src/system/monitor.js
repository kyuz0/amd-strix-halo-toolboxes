import { EventEmitter } from 'node:events'

import { log } from '../lib/log.js'
import { RingBuffer } from '../lib/ringbuffer.js'
import { containerStats } from '../podman/client.js'
import { listServers } from '../podman/servers.js'
import { readGpu } from './amdgpu.js'
import { readCpu, readMemory, readUptime } from './host.js'

const TICK_MS = 2000
/** `podman stats` costs 200-400 ms, so it gets its own slower interval. */
const STATS_MS = 5000
/** 300 samples at 2 s = 10 minutes of sparkline history. */
const HISTORY = 300

/**
 * One poller for the whole process, regardless of how many browsers are
 * watching — and it stops entirely when the last one disconnects, so an idle
 * box does no work.
 */
export class Monitor extends EventEmitter {
  constructor() {
    super()
    this.history = new RingBuffer(HISTORY)
    this.timer = null
    this.statsTimer = null
    this.subscribers = 0
    this.latest = null
    this.containerStats = []
    this.setMaxListeners(0)
  }

  subscribe(listener) {
    this.on('tick', listener)
    this.subscribers += 1
    this.#ensureRunning()
    return () => {
      this.off('tick', listener)
      this.subscribers = Math.max(0, this.subscribers - 1)
      if (this.subscribers === 0) this.#stop()
    }
  }

  /** One-shot snapshot for a plain GET, without starting the interval. */
  async snapshot() {
    const sample = await this.#sample()
    return { ...sample, containers: this.containerStats, history: this.history.all().map((e) => e.value) }
  }

  #ensureRunning() {
    if (this.timer) return
    this.timer = setInterval(() => {
      this.#sample()
        .then((sample) => {
          this.history.push(sample)
          this.latest = sample
          this.emit('tick', sample)
        })
        .catch((err) => log.debug(`Monitor-Tick fehlgeschlagen: ${err.message}`))
    }, TICK_MS)
    this.timer.unref?.()

    this.statsTimer = setInterval(() => {
      this.#sampleContainers().catch(() => {})
    }, STATS_MS)
    this.statsTimer.unref?.()
  }

  #stop() {
    if (this.timer) clearInterval(this.timer)
    if (this.statsTimer) clearInterval(this.statsTimer)
    this.timer = null
    this.statsTimer = null
  }

  async #sample() {
    const [gpu, cpu, memory, uptime] = await Promise.all([
      readGpu(),
      readCpu(),
      readMemory(),
      readUptime(),
    ])
    return { at: new Date().toISOString(), gpu, cpu, memory, uptime }
  }

  async #sampleContainers() {
    const servers = await listServers()
    const running = servers.filter((s) => s.running).map((s) => s.name)
    // Skip the expensive call entirely when nothing is running.
    if (running.length === 0) {
      this.containerStats = []
      return
    }
    const stats = await containerStats(running)
    this.containerStats = stats.map((s) => ({
      name: s.Name ?? s.name,
      cpu: s.CPU ?? s.cpu_percent ?? null,
      memory: s.MemUsage ?? s.mem_usage ?? null,
      memoryPercent: s.MemPerc ?? s.mem_percent ?? null,
    }))
  }
}

export const monitor = new Monitor()
