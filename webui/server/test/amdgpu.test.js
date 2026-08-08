import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import * as amdgpu from '../src/system/amdgpu.js'

/**
 * Point the module at a freshly built fake sysfs tree. The discovered card is
 * cached after the first probe, so each case resets it.
 */
function withSysfs(build) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shx-sysfs-'))
  build(root)
  process.env.SHX_SYSFS_ROOT = root
  amdgpu.resetCard()
  return amdgpu
}

function card(root, name, { vendor = '0x1002', values = {}, hwmon = null } = {}) {
  const device = path.join(root, 'class', 'drm', name, 'device')
  fs.mkdirSync(device, { recursive: true })
  fs.writeFileSync(path.join(device, 'vendor'), `${vendor}\n`)
  for (const [file, value] of Object.entries(values)) {
    fs.writeFileSync(path.join(device, file), `${value}\n`)
  }
  if (hwmon) {
    const dir = path.join(device, 'hwmon', 'hwmon3')
    fs.mkdirSync(dir, { recursive: true })
    for (const [file, value] of Object.entries(hwmon)) {
      fs.writeFileSync(path.join(dir, file), `${value}\n`)
    }
  }
}

test('finds the AMD card and reads its counters', async () => {
  const mod = withSysfs((root) =>
    card(root, 'card1', {
      values: {
        gpu_busy_percent: 42,
        mem_info_vram_used: 1024,
        mem_info_vram_total: 4096,
        mem_info_gtt_used: 28991029248,
        mem_info_gtt_total: 133143986176,
      },
      hwmon: { temp1_input: 61000, power1_average: 42000000, freq1_input: 2200000000 },
    }),
  )

  const gpu = await mod.readGpu()
  assert.equal(gpu.card, 'card1')
  assert.equal(gpu.busyPercent, 42)
  assert.equal(gpu.gttUsed, 28991029248)
  assert.equal(gpu.gttTotal, 133143986176)
  // Raw units are millidegrees, microwatts and hertz.
  assert.equal(gpu.temperatureC, 61)
  assert.equal(gpu.powerW, 42)
  assert.equal(gpu.clockMhz, 2200)
})

test('skips non-AMD cards and picks the AMD one', async () => {
  const mod = withSysfs((root) => {
    card(root, 'card0', { vendor: '0x8086', values: { gpu_busy_percent: 99 } })
    card(root, 'card1', { values: { gpu_busy_percent: 7 } })
  })
  const gpu = await mod.readGpu()
  assert.equal(gpu.card, 'card1')
  assert.equal(gpu.busyPercent, 7)
})

test('returns null when no AMD card exists', async () => {
  const mod = withSysfs((root) => card(root, 'card0', { vendor: '0x10de' }))
  assert.equal(await mod.readGpu(), null)
})

test('returns null when sysfs is absent entirely', async () => {
  const mod = withSysfs(() => {})
  assert.equal(await mod.readGpu(), null)
})

test('missing counters become null rather than zero', async () => {
  // A zero would render as real data; the dashboard hides nulls instead.
  const mod = withSysfs((root) => card(root, 'card1', { values: { gpu_busy_percent: 5 } }))
  const gpu = await mod.readGpu()
  assert.equal(gpu.busyPercent, 5)
  assert.equal(gpu.gttUsed, null)
  assert.equal(gpu.temperatureC, null)
})

test('unparseable counter contents become null', async () => {
  const mod = withSysfs((root) =>
    card(root, 'card1', { values: { gpu_busy_percent: 'N/A', mem_info_gtt_used: '' } }),
  )
  const gpu = await mod.readGpu()
  assert.equal(gpu.busyPercent, null)
  assert.equal(gpu.gttUsed, null)
})
