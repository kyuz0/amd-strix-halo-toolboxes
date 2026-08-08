import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildRunArgv,
  hostModelPath,
  normalizeModelPath,
  splitExtraArgs,
} from '../src/podman/argv.js'

const BASE = {
  containerName: 'llamacpp-server',
  image: 'docker.io/st3v0rr/amd-strix-halo-toolboxes:vulkan-radv',
  hostPort: 11434,
  modelsDir: '/home/stefan/models',
  modelPath: 'Qwen3.6-27B-GGUF/Q8_0/Qwen3.6-27B-Q8_0.gguf',
  ctxSize: 65536,
  gpuLayers: 999,
  threads: 12,
  apiKey: 'example-key',
  extraArgs: '-fa 1 --no-mmap',
}

/**
 * The golden argv, transcribed from run-llama-server.sh lines 223-243. If this
 * assertion has to change, the script changed too — or we broke parity.
 */
const GOLDEN = [
  'run',
  '-d',
  '--restart',
  'unless-stopped',
  '--device',
  '/dev/dri',
  '--device',
  '/dev/kfd',
  '--group-add',
  'video',
  '--group-add',
  'render',
  '--security-opt',
  'seccomp=unconfined',
  '-p',
  '11434:11434',
  '--name',
  'llamacpp-server',
  '-v',
  '/home/stefan/models:/workspace/models:z',
  'docker.io/st3v0rr/amd-strix-halo-toolboxes:vulkan-radv',
  'llama-server',
  '-m',
  '/workspace/models/Qwen3.6-27B-GGUF/Q8_0/Qwen3.6-27B-Q8_0.gguf',
  '--jinja',
  '--port',
  '11434',
  '--host',
  '0.0.0.0',
  '--ctx-size',
  '65536',
  '--n-gpu-layers',
  '999',
  '--threads',
  '12',
  '--api-key',
  'example-key',
  '-fa',
  '1',
  '--no-mmap',
]

test('the default case matches run-llama-server.sh argv for argv', () => {
  assert.deepEqual(buildRunArgv(BASE), GOLDEN)
})

test('a leading models/ is stripped, as ${MODEL_PATH#models/} does', () => {
  const argv = buildRunArgv({ ...BASE, modelPath: 'models/a/b.gguf' })
  assert.equal(argv[argv.indexOf('-m') + 1], '/workspace/models/a/b.gguf')
})

test('a leading slash is stripped after the models/ prefix', () => {
  assert.equal(normalizeModelPath('/a/b.gguf'), 'a/b.gguf')
  assert.equal(normalizeModelPath('models//a/b.gguf'), '/a/b.gguf'.slice(1))
  assert.equal(normalizeModelPath('a/b.gguf'), 'a/b.gguf')
})

test('only one models/ prefix is removed, matching the shell', () => {
  // ${x#models/} strips at most one occurrence; a second must survive.
  assert.equal(normalizeModelPath('models/models/x.gguf'), 'models/x.gguf')
})

test('the new flash-attention spelling word-splits into three arguments', () => {
  const argv = buildRunArgv({ ...BASE, extraArgs: '-fa on --load-mode none' })
  assert.deepEqual(argv.slice(-4), ['-fa', 'on', '--load-mode', 'none'])
})

test('extra args collapse repeated whitespace rather than emitting empty argv entries', () => {
  assert.deepEqual(splitExtraArgs('  -fa   1   --no-mmap '), ['-fa', '1', '--no-mmap'])
  assert.deepEqual(splitExtraArgs(''), [])
  assert.deepEqual(splitExtraArgs(undefined), [])
})

test('a sharded model passes only the first shard to -m', () => {
  const modelPath = 'gpt-oss-120b-GGUF/F16/gpt-oss-120b-F16-00001-of-00003.gguf'
  const argv = buildRunArgv({ ...BASE, modelPath })
  assert.equal(argv[argv.indexOf('-m') + 1], `/workspace/models/${modelPath}`)
})

test('a second server on another port keeps the container port at 11434', () => {
  const argv = buildRunArgv({ ...BASE, containerName: 'llama-second', hostPort: 11435 })
  assert.equal(argv[argv.indexOf('-p') + 1], '11435:11434')
  assert.equal(argv[argv.indexOf('--port') + 1], '11434')
  assert.equal(argv[argv.indexOf('--name') + 1], 'llama-second')
})

test('custom ctx/threads/gpu-layers land in the right positions', () => {
  const argv = buildRunArgv({ ...BASE, ctxSize: 90000, threads: 16, gpuLayers: 99 })
  assert.equal(argv[argv.indexOf('--ctx-size') + 1], '90000')
  assert.equal(argv[argv.indexOf('--threads') + 1], '16')
  assert.equal(argv[argv.indexOf('--n-gpu-layers') + 1], '99')
})

test('labels are emitted as --label key=value between --name and -v', () => {
  const argv = buildRunArgv({ ...BASE, labels: { 'shx.managed': 'true', 'shx.port': '11434' } })
  const nameIdx = argv.indexOf('--name')
  const volumeIdx = argv.indexOf('-v')
  assert.deepEqual(argv.slice(nameIdx + 2, volumeIdx), [
    '--label',
    'shx.managed=true',
    '--label',
    'shx.port=11434',
  ])
  // Stripping the labels must give back the golden argv exactly.
  const withoutLabels = [...argv.slice(0, nameIdx + 2), ...argv.slice(volumeIdx)]
  assert.deepEqual(withoutLabels, GOLDEN)
})

test('an api key containing shell metacharacters stays a single argument', () => {
  const apiKey = "key; rm -rf / #$(whoami)"
  const argv = buildRunArgv({ ...BASE, apiKey })
  assert.equal(argv[argv.indexOf('--api-key') + 1], apiKey)
  assert.equal(argv.filter((a) => a === apiKey).length, 1)
})

test('hostModelPath joins without doubling separators', () => {
  assert.equal(hostModelPath('/home/s/models', 'a/b.gguf'), '/home/s/models/a/b.gguf')
  assert.equal(hostModelPath('/home/s/models/', 'models/a/b.gguf'), '/home/s/models/a/b.gguf')
})
