#!/usr/bin/env node
/**
 * Fixture shim standing in for podman during development on a machine that has
 * none.
 *
 * It is a real executable rather than a mock inside the server, because the
 * whole point is to exercise the actual spawn/argv/stream code paths — line
 * splitting on \r, the pull progress parser, the log ring, feature detection —
 * against output recorded from the real box.
 *
 * State lives in a JSON file so start/stop/rm genuinely change what `ps` lists.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const devRoot = path.resolve(here, '..')
const fixtures = process.env.SHX_MOCK_FIXTURES || path.join(devRoot, 'fixtures')
const stateFile = process.env.SHX_MOCK_STATE || path.join(devRoot, 'tmp', 'podman-state.json')

const argv = process.argv.slice(2)

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  } catch {
    return { containers: [], images: seedImages() }
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true })
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2))
}

function seedImages() {
  const repo = 'docker.io/st3v0rr/amd-strix-halo-toolboxes'
  return [
    {
      Id: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      Names: [`${repo}:vulkan-radv`],
      Digest: 'sha256:aaaa000000000000000000000000000000000000000000000000000000000001',
      Created: 1754000000,
      Size: 2_400_000_000,
    },
    {
      Id: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
      Names: [`${repo}:rocm-7.14`],
      Digest: 'sha256:aaaa000000000000000000000000000000000000000000000000000000000002',
      Created: 1754100000,
      Size: 8_900_000_000,
    },
  ]
}

function readFixture(name, fallback = '') {
  try {
    return fs.readFileSync(path.join(fixtures, name), 'utf8')
  } catch {
    return fallback
  }
}

function out(text) {
  process.stdout.write(text.endsWith('\n') ? text : `${text}\n`)
}

function fail(msg, code = 125) {
  process.stderr.write(`Error: ${msg}\n`)
  process.exit(code)
}

// Wrapped in a function so the streaming commands can `return` and leave their
// timers running instead of falling through to the "unhandled command" error.
function main() {
const state = loadState()
const cmd = argv[0]

/* ---------------- version ---------------- */
if (cmd === '--version' || cmd === 'version') {
  out('podman version 5.3.1 (mock)')
  process.exit(0)
}

/* ---------------- ps ---------------- */
if (cmd === 'ps') {
  const filters = argv.filter((a, i) => argv[i - 1] === '--filter')
  let list = state.containers
  for (const f of filters) {
    const [key, value] = f.split('=').length > 2 ? [f.slice(0, f.indexOf('=')), f.slice(f.indexOf('=') + 1)] : f.split('=')
    if (key === 'label') {
      const [lk, lv] = value.split('=')
      list = list.filter((c) => (lv === undefined ? lk in c.Labels : c.Labels[lk] === lv))
    }
  }
  if (!argv.includes('-a') && !argv.includes('--all')) {
    list = list.filter((c) => c.State === 'running')
  }
  const fmtIdx = argv.indexOf('--format')
  const fmt = fmtIdx >= 0 ? argv[fmtIdx + 1] : ''
  if (fmt === 'json') {
    out(JSON.stringify(list, null, 2))
  } else {
    for (const c of list) out(c.Names[0])
  }
  process.exit(0)
}

/* ---------------- run ---------------- */
if (cmd === 'run') {
  // Feature probe: `run --rm <image> llama-server --help`
  if (argv.includes('--help') && argv.includes('llama-server')) {
    const variant = process.env.SHX_MOCK_HELP_VARIANT || 'new'
    out(readFixture(`llama-server-help-${variant}.txt`, 'usage: llama-server [options]'))
    process.exit(0)
  }
  // VRAM estimator or other one-shot commands: just echo a fixture.
  if (argv.some((a) => a.includes('gguf-vram-estimator'))) {
    out(readFixture('vram-estimate.txt'))
    process.exit(0)
  }

  const nameIdx = argv.indexOf('--name')
  const name = nameIdx >= 0 ? argv[nameIdx + 1] : `mock-${Date.now()}`
  if (state.containers.some((c) => c.Names[0] === name)) {
    fail(`creating container storage: the container name "${name}" is already in use`)
  }

  const labels = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--label') {
      const eq = argv[i + 1].indexOf('=')
      labels[argv[i + 1].slice(0, eq)] = argv[i + 1].slice(eq + 1)
    }
  }
  const portIdx = argv.indexOf('-p')
  const ports = portIdx >= 0 ? argv[portIdx + 1] : ''
  const [hostPort, containerPort] = ports.split(':')
  // The image is the first non-flag argument after the option block; in our
  // argv it directly precedes `llama-server`.
  const llamaIdx = argv.indexOf('llama-server')
  const image = llamaIdx > 0 ? argv[llamaIdx - 1] : 'unknown'

  const id = Math.random().toString(16).slice(2).padEnd(64, '0')
  state.containers.push({
    Id: id,
    Names: [name],
    Image: image,
    State: 'running',
    Status: 'Up 1 second',
    CreatedAt: new Date().toISOString(),
    Created: Math.floor(Date.now() / 1000),
    Labels: labels,
    Ports: hostPort
      ? [{ host_ip: '', container_port: Number(containerPort), host_port: Number(hostPort), protocol: 'tcp' }]
      : [],
    Command: argv.slice(llamaIdx),
  })
  saveState(state)

  // Record the argv so the parity harness can diff it against the real script.
  try {
    fs.mkdirSync(path.join(devRoot, 'tmp'), { recursive: true })
    fs.writeFileSync(path.join(devRoot, 'tmp', 'last-run-argv.json'), JSON.stringify(argv, null, 2))
  } catch {
    /* non-fatal */
  }

  out(id)
  process.exit(0)
}

/* ---------------- start / stop / rm ---------------- */
if (cmd === 'start' || cmd === 'stop' || cmd === 'rm' || cmd === 'restart') {
  // Flags that take a value (`stop -t 30`) must not have that value mistaken
  // for a container name.
  const VALUED = new Set(['-t', '--time', '--timeout'])
  const targets = []
  for (let i = 1; i < argv.length; i++) {
    if (VALUED.has(argv[i])) {
      i++
      continue
    }
    if (argv[i].startsWith('-')) continue
    targets.push(argv[i])
  }
  for (const target of targets) {
    const idx = state.containers.findIndex((c) => c.Names[0] === target || c.Id === target)
    if (idx < 0) fail(`no container with name or ID "${target}" found`, 125)
    if (cmd === 'rm') state.containers.splice(idx, 1)
    else if (cmd === 'stop') {
      state.containers[idx].State = 'exited'
      state.containers[idx].Status = 'Exited (0) 1 second ago'
    } else {
      state.containers[idx].State = 'running'
      state.containers[idx].Status = 'Up 1 second'
    }
    out(target)
  }
  saveState(state)
  process.exit(0)
}

/* ---------------- inspect ---------------- */
if (cmd === 'inspect') {
  const target = argv.find((a, i) => i > 0 && !a.startsWith('-') && argv[i - 1] !== '--format')
  const container = state.containers.find((c) => c.Names[0] === target || c.Id === target)
  if (!container) fail(`no such object: "${target}"`, 125)
  out(
    JSON.stringify(
      [
        {
          Id: container.Id,
          Name: container.Names[0],
          Created: container.CreatedAt,
          State: { Status: container.State, Running: container.State === 'running', ExitCode: 0 },
          Image: container.Image,
          Config: { Labels: container.Labels, Cmd: container.Command },
          HostConfig: { RestartPolicy: { Name: 'unless-stopped' } },
        },
      ],
      null,
      2,
    ),
  )
  process.exit(0)
}

/* ---------------- logs ---------------- */
if (cmd === 'logs') {
  const lines = readFixture('llama-server.log', 'mock: no log fixture present\n').split('\n')
  const follow = argv.includes('-f') || argv.includes('--follow')
  let i = 0
  const emit = () => {
    if (i < lines.length) {
      process.stdout.write(`${lines[i++]}\n`)
      setTimeout(emit, follow ? 400 : 0)
    } else if (follow) {
      // Keep the stream open with an occasional heartbeat line, the way a live
      // server would.
      setTimeout(() => {
        process.stdout.write(`srv  update_slots: all slots are idle (${new Date().toISOString()})\n`)
        emit()
      }, 3000)
    } else {
      process.exit(0)
    }
  }
  emit()
  return
}

/* ---------------- images ---------------- */
if (cmd === 'images') {
  const fmtIdx = argv.indexOf('--format')
  if (fmtIdx >= 0 && argv[fmtIdx + 1] === 'json') {
    out(JSON.stringify(state.images, null, 2))
  } else {
    for (const img of state.images) out(`${img.Names[0]} ${img.Id}`)
  }
  process.exit(0)
}

if (cmd === 'image') {
  const sub = argv[1]
  if (sub === 'inspect') {
    const fmtIdx = argv.indexOf('--format')
    const target = argv[argv.length - 1]
    const img = state.images.find((i) => i.Names.includes(target))
    if (!img) fail(`no such image ${target}`, 125)
    if (fmtIdx >= 0) {
      const fmt = argv[fmtIdx + 1]
      if (fmt.includes('.Id')) out(img.Id)
      else if (fmt.includes('.Digest')) out(img.Digest)
      else out(JSON.stringify(img))
    } else {
      out(JSON.stringify([img], null, 2))
    }
    process.exit(0)
  }
  if (sub === 'rm') {
    const target = argv[argv.length - 1]
    state.images = state.images.filter((i) => !i.Names.includes(target) && i.Id !== target)
    saveState(state)
    out('untagged')
    process.exit(0)
  }
}

/* ---------------- pull ---------------- */
if (cmd === 'pull') {
  const ref = argv[argv.length - 1]
  const fixture = readFixture('pull-progress.txt')
  const frames = fixture ? fixture.split('\n') : defaultPullFrames()
  let i = 0
  const emit = () => {
    if (i >= frames.length) {
      const id = Math.random().toString(16).slice(2).padEnd(64, '0')
      if (!state.images.some((img) => img.Names.includes(ref))) {
        state.images.push({
          Id: `sha256:${id}`,
          Names: [ref],
          Digest: `sha256:${id}`,
          Created: Math.floor(Date.now() / 1000),
          Size: 3_000_000_000,
        })
        saveState(state)
      }
      process.stdout.write(`${id}\n`)
      process.exit(0)
    }
    // Real podman redraws progress with \r on stderr; keep that faithful.
    process.stderr.write(`${frames[i++]}\r`)
    setTimeout(emit, 120)
  }
  emit()
  return
}

function defaultPullFrames() {
  const frames = []
  const total = 5.0
  for (let pct = 0; pct <= 100; pct += 4) {
    const done = ((total * pct) / 100).toFixed(1)
    frames.push(`Copying blob 3f2b1a0c9d4e [${'='.repeat(pct / 4)}${'-'.repeat(25 - pct / 4)}] ${done}GiB / ${total}GiB`)
  }
  frames.push('Writing manifest to image destination')
  return frames
}

/* ---------------- stats ---------------- */
if (cmd === 'stats') {
  const running = state.containers.filter((c) => c.State === 'running')
  out(
    JSON.stringify(
      running.map((c) => ({
        Name: c.Names[0],
        CPU: `${(Math.abs(Math.sin(c.Id.length)) * 400).toFixed(2)}%`,
        MemUsage: '18.4GB / 128GB',
        MemPerc: '14.4%',
      })),
      null,
      2,
    ),
  )
  process.exit(0)
}

fail(`mock podman: unhandled command '${argv.join(' ')}'`, 127)
}

main()
