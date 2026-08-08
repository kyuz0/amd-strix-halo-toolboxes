#!/usr/bin/env node
/**
 * Fixture shim for the Hugging Face CLI.
 *
 * It does two things the real `hf download` does, because both are what the
 * server actually watches: it prints tqdm-style progress to stderr, and it
 * grows `*.incomplete` files in the target directory. The byte-counting
 * progress path in the server reads the files, not the text, so this shim is
 * what proves that path works.
 */
import fs from 'node:fs'
import path from 'node:path'

const argv = process.argv.slice(2)

function argValue(flag) {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}

function argValues(flag) {
  const out = []
  for (let i = 0; i < argv.length; i++) if (argv[i] === flag) out.push(argv[i + 1])
  return out
}

if (argv[0] === '--version' || argv[0] === 'version') {
  process.stdout.write('hf version 0.28.0 (mock)\n')
  process.exit(0)
}

if (argv[0] !== 'download') {
  process.stderr.write(`mock hf: unhandled command '${argv.join(' ')}'\n`)
  process.exit(2)
}

const repo = argv[1]
const localDir = argValue('--local-dir') || process.cwd()
const includes = argValues('--include')

// One file per --include pattern; a glob becomes a single stand-in file.
const files = (includes.length ? includes : ['model.gguf']).map((pattern) =>
  pattern.replace(/\*/g, 'part').replace(/\/$/, '/model.gguf'),
)

const TOTAL_PER_FILE = 48 * 1024 * 1024
const CHUNK = 2 * 1024 * 1024
const CHUNK_MS = 60

let fileIndex = 0
let written = 0

function step() {
  if (fileIndex >= files.length) {
    process.stderr.write(`\nDownload complete: ${repo}\n`)
    process.stdout.write(`${localDir}\n`)
    process.exit(0)
  }

  const rel = files[fileIndex]
  const target = path.join(localDir, rel)
  const partial = `${target}.incomplete`
  fs.mkdirSync(path.dirname(target), { recursive: true })

  if (written === 0) process.stderr.write(`Downloading '${rel}' to '${partial}'\n`)

  const chunk = Math.min(CHUNK, TOTAL_PER_FILE - written)
  fs.appendFileSync(partial, Buffer.alloc(chunk))
  written += chunk

  const pct = Math.round((written / TOTAL_PER_FILE) * 100)
  const mb = (written / 1024 / 1024).toFixed(1)
  const totalMb = (TOTAL_PER_FILE / 1024 / 1024).toFixed(1)
  // tqdm redraws with \r; the server captures these as secondary log lines.
  process.stderr.write(
    `${rel}: ${String(pct).padStart(3)}%|${'█'.repeat(Math.floor(pct / 4))}${' '.repeat(25 - Math.floor(pct / 4))}| ${mb}M/${totalMb}M [00:0${fileIndex}<00:01, 33.4MB/s]\r`,
  )

  if (written >= TOTAL_PER_FILE) {
    fs.renameSync(partial, target)
    fileIndex += 1
    written = 0
    process.stderr.write('\n')
  }

  setTimeout(step, CHUNK_MS)
}

process.on('SIGINT', () => {
  // Real hf leaves partials behind so the next run resumes; keep that faithful.
  process.stderr.write('\nAbgebrochen.\n')
  process.exit(130)
})

step()
