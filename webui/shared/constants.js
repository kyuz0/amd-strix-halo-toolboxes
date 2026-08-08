/**
 * Constants shared by the server and the web client.
 *
 * Anything in here is imported by both sides, so it must stay free of Node
 * built-ins and browser globals alike.
 */

/** Image repository the fork publishes its llama-server toolboxes to. */
export const IMAGE_REPO = 'docker.io/st3v0rr/amd-strix-halo-toolboxes'

/** Port llama-server always listens on *inside* the container. */
export const CONTAINER_PORT = 11434

/** Where the models directory is mounted inside the container. */
export const CONTAINER_MODELS_DIR = '/workspace/models'

/**
 * Labels stamped onto every container we create. Ownership lives in the
 * container rather than in our own state file, so a wiped state.json or a
 * reboot never orphans a running server.
 */
export const LABEL = {
  managed: 'shx.managed',
  version: 'shx.version',
  profile: 'shx.profile',
  model: 'shx.model',
  image: 'shx.image',
  ctx: 'shx.ctx',
  gpuLayers: 'shx.gpu-layers',
  threads: 'shx.threads',
  port: 'shx.port',
  extraArgs: 'shx.extra-args',
  created: 'shx.created',
}

/** Schema version of the label set, so a future migration can tell them apart. */
export const LABEL_VERSION = '1'

/** The two spellings of "flash attention + no mmap" llama.cpp has used. */
export const EXTRA_ARGS_NEW = '-fa on --load-mode none'
export const EXTRA_ARGS_OLD = '-fa 1 --no-mmap'

/** Header that must accompany every mutating request (CSRF defence). */
export const CSRF_HEADER = 'x-requested-with'
export const CSRF_VALUE = 'shx'

/** Name of the auth cookie. */
export const AUTH_COOKIE = 'shx_token'

/** Defaults mirroring run-llama-server.sh, used for new profiles and dialogs. */
export const SERVER_DEFAULTS = {
  ctxSize: 65536,
  gpuLayers: 999,
  threads: 12,
  port: 11434,
  image: `${IMAGE_REPO}:vulkan-radv`,
}

/** Container and profile names. Podman is stricter than this; we are stricter still. */
export const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/

/**
 * Multi-part GGUF files, e.g. `model-00001-of-00003.gguf`. Only the first shard
 * is ever passed to `-m`.
 */
export const SHARD_RE = /^(?<base>.*)-(?<idx>\d{5})-of-(?<total>\d{5})\.gguf$/i

/** Host ports we allow binding; below 1024 needs privileges rootless podman lacks. */
export const PORT_MIN = 1024
export const PORT_MAX = 65535

/** Job lifecycle. `interrupted` means the process died while we were restarted. */
export const JOB_STATUS = /** @type {const} */ ([
  'queued',
  'running',
  'done',
  'failed',
  'cancelled',
  'interrupted',
])

export const JOB_TYPE = /** @type {const} */ ([
  'model-download',
  'image-pull',
  'feature-detect',
  'app-update',
])
