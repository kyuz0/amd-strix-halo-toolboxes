import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

import { sysfsRoot } from '../config/paths.js'
import { log } from '../lib/log.js'

const AMD_VENDOR = '0x1002'

/** @type {{device: string, hwmon: string|null} | null | undefined} */
let discovered

/**
 * Locate the amdgpu card once.
 *
 * The `vendor == 0x1002` probe is the same one systemd/gpu-workload-watch uses,
 * so both agree on which card is the iGPU on a machine that also has a
 * discrete card.
 */
export function findCard() {
  if (discovered !== undefined) return discovered

  const drmDir = path.join(sysfsRoot(), 'class', 'drm')
  let entries = []
  try {
    entries = fs.readdirSync(drmDir)
  } catch {
    discovered = null
    return discovered
  }

  for (const entry of entries.sort()) {
    if (!/^card\d+$/.test(entry)) continue
    const device = path.join(drmDir, entry, 'device')
    try {
      if (fs.readFileSync(path.join(device, 'vendor'), 'utf8').trim() !== AMD_VENDOR) continue
    } catch {
      continue
    }
    discovered = { card: entry, device, hwmon: findHwmon(device) }
    log.info(`amdgpu gefunden: ${entry}${discovered.hwmon ? '' : ' (ohne hwmon)'}`)
    return discovered
  }

  discovered = null
  return discovered
}

function findHwmon(device) {
  const base = path.join(device, 'hwmon')
  try {
    const dirs = fs.readdirSync(base).filter((d) => d.startsWith('hwmon'))
    return dirs.length ? path.join(base, dirs.sort()[0]) : null
  } catch {
    return null
  }
}

/** Reset the cached discovery. Only used by tests. */
export function resetCard() {
  discovered = undefined
}

async function readNumber(file, scale = 1) {
  try {
    const raw = (await fsp.readFile(file, 'utf8')).trim()
    // Number('') is 0, which would render as a real reading; an empty counter
    // means "not available" and must stay null.
    if (!raw) return null
    const value = Number(raw)
    return Number.isFinite(value) ? value * scale : null
  } catch {
    // Missing counters are normal across kernel versions; the UI hides them
    // rather than showing a zero that looks like real data.
    return null
  }
}

/**
 * One monitoring tick. About a dozen reads of files under 64 bytes — cheap
 * enough for a 2 s interval, and no subprocess involved.
 */
export async function readGpu() {
  const card = findCard()
  if (!card) return null

  const d = card.device
  const [busy, vramUsed, vramTotal, gttUsed, gttTotal, visUsed, visTotal] = await Promise.all([
    readNumber(path.join(d, 'gpu_busy_percent')),
    readNumber(path.join(d, 'mem_info_vram_used')),
    readNumber(path.join(d, 'mem_info_vram_total')),
    readNumber(path.join(d, 'mem_info_gtt_used')),
    readNumber(path.join(d, 'mem_info_gtt_total')),
    readNumber(path.join(d, 'mem_info_vis_vram_used')),
    readNumber(path.join(d, 'mem_info_vis_vram_total')),
  ])

  let temperature = null
  let power = null
  let clock = null
  if (card.hwmon) {
    ;[temperature, power, clock] = await Promise.all([
      // millidegrees, microwatts, hertz
      readNumber(path.join(card.hwmon, 'temp1_input'), 1 / 1000),
      readNumber(path.join(card.hwmon, 'power1_average'), 1 / 1_000_000),
      readNumber(path.join(card.hwmon, 'freq1_input'), 1 / 1_000_000),
    ])
  }

  return {
    card: card.card,
    busyPercent: busy,
    vramUsed,
    vramTotal,
    // GTT is the number that matters on Strix Halo: it is the slice of unified
    // memory the iGPU may use, set by the amdgpu.gttsize boot parameter.
    gttUsed,
    gttTotal,
    visibleVramUsed: visUsed,
    visibleVramTotal: visTotal,
    temperatureC: temperature,
    powerW: power,
    clockMhz: clock,
  }
}
