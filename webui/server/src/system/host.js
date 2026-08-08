import fsp from 'node:fs/promises'
import os from 'node:os'

/**
 * Host metrics from /proc. On a Mac (development) these files do not exist, so
 * every reader degrades to null and the dashboard simply omits the tile.
 */

let lastCpu = null

/** CPU busy percentage from jiffy deltas between two ticks. */
export async function readCpu() {
  let line
  try {
    const stat = await fsp.readFile('/proc/stat', 'utf8')
    line = stat.split('\n')[0]
  } catch {
    // Fall back to load average, which macOS and Linux both provide.
    return { busyPercent: null, cores: os.cpus().length, load: os.loadavg() }
  }

  const parts = line.trim().split(/\s+/).slice(1).map(Number)
  const idle = (parts[3] ?? 0) + (parts[4] ?? 0)
  const total = parts.reduce((sum, n) => sum + n, 0)

  let busyPercent = null
  if (lastCpu) {
    const deltaTotal = total - lastCpu.total
    const deltaIdle = idle - lastCpu.idle
    if (deltaTotal > 0) {
      busyPercent = Math.max(0, Math.min(100, Math.round(((deltaTotal - deltaIdle) / deltaTotal) * 100)))
    }
  }
  lastCpu = { total, idle }

  return { busyPercent, cores: os.cpus().length, load: os.loadavg() }
}

export async function readMemory() {
  try {
    const text = await fsp.readFile('/proc/meminfo', 'utf8')
    const values = {}
    for (const line of text.split('\n')) {
      const match = /^(\w+):\s+(\d+)\s*kB$/.exec(line.trim())
      if (match) values[match[1]] = Number(match[2]) * 1024
    }
    return {
      totalBytes: values.MemTotal ?? null,
      availableBytes: values.MemAvailable ?? null,
      usedBytes:
        values.MemTotal != null && values.MemAvailable != null
          ? values.MemTotal - values.MemAvailable
          : null,
      swapTotalBytes: values.SwapTotal ?? null,
      swapFreeBytes: values.SwapFree ?? null,
    }
  } catch {
    const total = os.totalmem()
    const free = os.freemem()
    return {
      totalBytes: total,
      availableBytes: free,
      usedBytes: total - free,
      swapTotalBytes: null,
      swapFreeBytes: null,
    }
  }
}

export async function readUptime() {
  try {
    const text = await fsp.readFile('/proc/uptime', 'utf8')
    return Number(text.trim().split(/\s+/)[0])
  } catch {
    return os.uptime()
  }
}

export async function readKernel() {
  try {
    const text = await fsp.readFile('/proc/version', 'utf8')
    return text.trim().split(/\s+/).slice(0, 3).join(' ')
  } catch {
    return `${os.type()} ${os.release()}`
  }
}

/**
 * The kernel boot parameters that matter on Strix Halo, surfaced so a
 * misconfigured host is visible rather than showing up later as an
 * inexplicable out-of-memory during model load.
 */
export async function readBootParams() {
  try {
    const cmdline = await fsp.readFile('/proc/cmdline', 'utf8')
    const params = cmdline.trim().split(/\s+/)
    const find = (prefix) => params.find((p) => p.startsWith(prefix)) ?? null
    return {
      gttSize: find('amdgpu.gttsize='),
      ttmPagesLimit: find('ttm.pages_limit='),
      iommu: find('amd_iommu=') ?? find('iommu='),
    }
  } catch {
    return null
  }
}
