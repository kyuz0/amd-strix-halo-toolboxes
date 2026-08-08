import { log } from '../lib/log.js'
import { registerSecret } from '../lib/redact.js'
import { createServer, listServers, startServer } from './servers.js'

/** Give podman's own socket activation a moment before we start poking it. */
const BOOT_DELAY_MS = 15_000
/**
 * Two large models loading at once will thrash the unified memory, so profiles
 * are brought up one at a time with a gap between them.
 */
const STAGGER_MS = 5_000

/**
 * Bring `autostart` profiles up, idempotently.
 *
 * Deliberately not delegated to podman: rootless containers with
 * `--restart unless-stopped` do *not* come back after a reboot unless
 * `podman-restart.service` is enabled for the user, and mixing that with our
 * own logic causes double starts. Owning the lifecycle here also means a
 * profile whose container was removed by hand still comes back.
 *
 * `--restart unless-stopped` is still passed on the container (script parity):
 * it covers crashes while the host stays up, which this reconciler does not see.
 */
export async function reconcile(ctx, { stagger = STAGGER_MS } = {}) {
  const profiles = ctx.profiles.data.profiles.filter((p) => p.autostart)
  if (profiles.length === 0) return { started: [], skipped: [], failed: [] }

  const started = []
  const skipped = []
  const failed = []

  let existing
  try {
    existing = await listServers()
  } catch (err) {
    log.warn(`Autostart übersprungen, podman nicht erreichbar: ${err.message}`)
    return { started, skipped, failed: profiles.map((p) => ({ name: p.name, error: err.message })) }
  }

  for (const [index, profile] of profiles.entries()) {
    if (index > 0 && stagger > 0) await sleep(stagger)

    const container = existing.find((s) => s.name === profile.name)
    try {
      if (container?.running) {
        skipped.push({ name: profile.name, reason: 'läuft bereits' })
        continue
      }

      registerSecret(profile.apiKey)

      if (container) {
        // Present but stopped — a plain start preserves its configuration.
        await startServer(profile.name)
        started.push({ name: profile.name, action: 'gestartet' })
      } else {
        await createServer(ctx, {
          name: profile.name,
          image: profile.image,
          modelPath: profile.modelPath,
          port: profile.port,
          ctxSize: profile.ctxSize,
          gpuLayers: profile.gpuLayers,
          threads: profile.threads,
          apiKey: profile.apiKey,
          extraArgs: profile.extraArgs,
          profileId: profile.id,
        })
        started.push({ name: profile.name, action: 'neu angelegt' })
      }
      log.info(`Autostart: Profil '${profile.name}' ist oben.`)
    } catch (err) {
      // A failed profile is recorded and shown on the dashboard rather than
      // retried in a loop — a missing model or image will not fix itself.
      failed.push({ name: profile.name, error: err.message })
      log.warn(`Autostart für '${profile.name}' fehlgeschlagen: ${err.message}`)
    }
  }

  const result = { started, skipped, failed, at: new Date().toISOString() }
  lastResult = result
  return result
}

let lastResult = null

/** What the most recent reconcile did, for the dashboard. */
export function lastReconcile() {
  return lastResult
}

/** Schedule the boot-time pass. */
export function scheduleReconcile(ctx) {
  const timer = setTimeout(() => {
    reconcile(ctx).catch((err) => log.warn('Autostart fehlgeschlagen', err))
  }, BOOT_DELAY_MS)
  timer.unref?.()
  return () => clearTimeout(timer)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
