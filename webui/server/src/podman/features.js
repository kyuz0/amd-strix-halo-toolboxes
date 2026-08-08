import { EXTRA_ARGS_NEW, EXTRA_ARGS_OLD } from '../../../shared/constants.js'
import { run } from '../lib/exec.js'
import { log } from '../lib/log.js'
import { imageId } from './client.js'

/**
 * Decide which spelling of "flash attention + no mmap" an image's llama-server
 * understands.
 *
 * On Strix Halo both are mandatory, but llama.cpp renamed them: the old
 * `-fa 1 --no-mmap` became `-fa on --load-mode none`. Old builds abort on
 * `--load-mode`, new builds only warn about `--no-mmap` — so when detection
 * fails, the old spelling is the safe default. This mirrors
 * run-llama-server.sh lines 183-195 exactly.
 *
 * @param {string} helpOutput combined stdout+stderr of `llama-server --help`
 */
export function detectExtraArgs(helpOutput) {
  if (!helpOutput || !helpOutput.trim()) return EXTRA_ARGS_OLD
  return helpOutput.includes('--load-mode') ? EXTRA_ARGS_NEW : EXTRA_ARGS_OLD
}

/**
 * Detection costs a throwaway container start, so the result is cached — keyed
 * by the local image ID rather than the tag. The project's CI moves the
 * `<backend>` channel tag onto new builds, so a tag-keyed cache would go stale
 * silently; an ID-keyed one invalidates itself the moment a pull lands.
 *
 * @param {object} ctx app context (for the state store)
 * @param {string} image image reference
 * @param {{force?: boolean, onLog?: (line: string) => void}} [opts]
 */
export async function resolveExtraArgs(ctx, image, { force = false, onLog } = {}) {
  const id = await imageId(image)
  if (!id) {
    // Image not present locally. The caller pulls first; until then fall back
    // to the spelling that cannot break a start.
    onLog?.(`Image ${image} liegt lokal nicht vor — nutze die alte Schreibweise.`)
    return { extraArgs: EXTRA_ARGS_OLD, imageId: null, cached: false, detected: false }
  }

  const cached = ctx.state.data.featureCache[id]
  if (cached && !force) {
    onLog?.(`Aus dem Cache: ${cached.extraArgs}`)
    return { extraArgs: cached.extraArgs, imageId: id, cached: true, detected: true }
  }

  onLog?.(`Ermittle unterstützte llama-server-Argumente aus ${image} …`)
  let helpOutput = ''
  try {
    const { stdout, stderr } = await run(
      'podman',
      ['run', '--rm', image, 'llama-server', '--help'],
      { timeoutMs: 180_000, allowFailure: true },
    )
    helpOutput = `${stdout}\n${stderr}`
  } catch (err) {
    log.warn(`Feature-Erkennung für ${image} fehlgeschlagen: ${err.message}`)
    onLog?.(`Erkennung fehlgeschlagen (${err.message}) — nutze die alte Schreibweise.`)
  }

  const extraArgs = detectExtraArgs(helpOutput)
  onLog?.(`Erkannt: ${extraArgs}`)

  await ctx.state.update((s) => {
    s.featureCache[id] = { extraArgs, detectedAt: new Date().toISOString() }
    return s
  })

  return { extraArgs, imageId: id, cached: false, detected: Boolean(helpOutput.trim()) }
}

/** Drop a cache entry so the next launch re-probes (used after a pull). */
export async function invalidateFeatureCache(ctx, id) {
  if (!id || !ctx.state.data.featureCache[id]) return
  await ctx.state.update((s) => {
    delete s.featureCache[id]
    return s
  })
}
