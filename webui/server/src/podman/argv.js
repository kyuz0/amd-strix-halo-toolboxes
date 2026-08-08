import {
  CONTAINER_MODELS_DIR,
  CONTAINER_PORT,
  EXTRA_ARGS_OLD,
} from '../../../shared/constants.js'

/**
 * Builds the `podman run` argv for a llama-server container.
 *
 * This is a faithful port of run-llama-server.sh lines 223-243 and the path
 * handling above it. The ordering and every flag matter: the parity harness in
 * dev/parity diffs our output against the argv the real script produces, so
 * changes here must keep that diff empty (or the script must change too).
 *
 * Pure function, no I/O — the existence check lives in servers.js so this stays
 * trivially testable.
 */

/**
 * The script accepts `models/foo.gguf`, `/foo.gguf` and `foo.gguf` alike:
 * `${MODEL_PATH#models/}` then `${...#/}`. Reproduce exactly that, including
 * the fact that it strips at most one of each, in that order.
 */
export function normalizeModelPath(modelPath) {
  let rel = String(modelPath ?? '')
  if (rel.startsWith('models/')) rel = rel.slice('models/'.length)
  if (rel.startsWith('/')) rel = rel.slice(1)
  return rel
}

/**
 * The script leaves `$EXTRA_ARGS` unquoted so it word-splits. We do the same,
 * explicitly, rather than passing one argument containing spaces — which
 * llama-server would reject.
 */
export function splitExtraArgs(extraArgs) {
  return String(extraArgs ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

/**
 * @param {object} spec
 * @param {string} spec.containerName
 * @param {string} spec.image
 * @param {number} spec.hostPort
 * @param {string} spec.modelsDir absolute host path
 * @param {string} spec.modelPath relative to modelsDir (a leading `models/` is tolerated)
 * @param {number} spec.ctxSize
 * @param {number} spec.gpuLayers
 * @param {number} spec.threads
 * @param {string} spec.apiKey
 * @param {string} [spec.extraArgs] empty means "autodetected upstream"
 * @param {Record<string,string>} [spec.labels]
 * @returns {string[]}
 */
export function buildRunArgv(spec) {
  const {
    containerName,
    image,
    hostPort,
    modelsDir,
    modelPath,
    ctxSize,
    gpuLayers,
    threads,
    apiKey,
    extraArgs = EXTRA_ARGS_OLD,
    labels = {},
  } = spec

  const rel = normalizeModelPath(modelPath)
  const containerModelPath = `${CONTAINER_MODELS_DIR}/${rel}`

  const argv = [
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
    `${hostPort}:${CONTAINER_PORT}`,
    '--name',
    containerName,
  ]

  // Our own labels come after --name so a diff against the script's argv shows
  // them as one contiguous block rather than interleaved.
  for (const [key, value] of Object.entries(labels)) {
    argv.push('--label', `${key}=${value}`)
  }

  argv.push(
    '-v',
    `${modelsDir}:${CONTAINER_MODELS_DIR}:z`,
    image,
    'llama-server',
    '-m',
    containerModelPath,
    '--jinja',
    '--port',
    String(CONTAINER_PORT),
    '--host',
    '0.0.0.0',
    '--ctx-size',
    String(ctxSize),
    '--n-gpu-layers',
    String(gpuLayers),
    '--threads',
    String(threads),
    '--api-key',
    apiKey,
    ...splitExtraArgs(extraArgs),
  )

  return argv
}

/** The host-side path the model must exist at before we start the container. */
export function hostModelPath(modelsDir, modelPath) {
  return `${modelsDir.replace(/\/+$/, '')}/${normalizeModelPath(modelPath)}`
}
