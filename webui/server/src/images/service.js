import { AppError, badRequest } from '../lib/errors.js'
import { stream } from '../lib/exec.js'
import { log } from '../lib/log.js'
import { imageDigest, imageId, listImages, removeImage } from '../podman/client.js'
import { invalidateFeatureCache } from '../podman/features.js'
import { listServers } from '../podman/servers.js'
import { catalog, isKnownRef } from './catalog.js'
import { PullProgress } from './pullparse.js'
import { checkTag, fetchTags } from './registry.js'

/** Delay the first background check so boot is not competing for the network. */
const FIRST_CHECK_MS = 60_000
/** After a 429 from Docker Hub, stop asking for a day. */
const BACKOFF_MS = 24 * 60 * 60_000

/**
 * Everything the Images page shows: which known tags exist locally, their
 * digests, and whether the registry has something newer.
 */
export async function describeImages(ctx) {
  const local = await listImages()
  const state = ctx.state.data.imageStatus
  const servers = await listServers()

  const byRef = new Map()
  for (const image of local) {
    for (const name of image.Names ?? []) byRef.set(name, image)
  }

  return catalog().map((entry) => {
    const image = byRef.get(entry.ref)
    const status = state[entry.tag] ?? {}
    const inUse = servers.filter((s) => s.image === entry.ref).map((s) => s.name)

    return {
      ...entry,
      installed: Boolean(image),
      id: image?.Id ?? null,
      localDigest: image?.Digest ?? null,
      sizeBytes: image?.Size ?? null,
      createdAt: image?.Created ? new Date(image.Created * 1000).toISOString() : null,
      remoteDigest: status.remoteDigest ?? null,
      remoteCheckedAt: status.remoteCheckedAt ?? null,
      newestImmutableTag: status.newestImmutableTag ?? null,
      newestBuildAt: status.newestBuildAt ?? null,
      updateAvailable: Boolean(
        image?.Digest && status.remoteDigest && image.Digest !== status.remoteDigest,
      ),
      usedBy: inUse,
    }
  })
}

/** Refresh remote digests for every known tag. Never throws. */
export async function checkUpdates(ctx, { force = false } = {}) {
  const backoff = ctx.state.data.registryBackoffUntil
  if (!force && backoff && new Date(backoff) > new Date()) {
    log.debug(`Registry-Prüfung übersprungen, Backoff bis ${backoff}`)
    return { skipped: true, until: backoff }
  }

  const entries = catalog()
  // One tag list for the whole repository, reused for every backend.
  const tags = entries.length ? await fetchTags(entries[0].ref).catch(() => null) : null

  let rateLimited = false
  for (const entry of entries) {
    const local = await imageDigest(entry.ref)
    const result = await checkTag(entry.ref, local, tags)
    if (result.rateLimited) rateLimited = true

    await ctx.state.update((s) => {
      s.imageStatus[entry.tag] = {
        localDigest: local,
        remoteDigest: result.remoteDigest ?? null,
        remoteCheckedAt: new Date().toISOString(),
        newestImmutableTag: result.newestImmutableTag ?? null,
        newestBuildAt: result.newestBuildAt ?? null,
      }
      return s
    })
  }

  await ctx.state.update((s) => {
    s.registryBackoffUntil = rateLimited ? new Date(Date.now() + BACKOFF_MS).toISOString() : null
    return s
  })

  return { skipped: false, rateLimited }
}

/** Pull an image as a job, with progress parsed from podman's stderr. */
export function startPull(ctx, ref) {
  if (!isKnownRef(ref) && !ctx.settings.allowCustomImages) {
    throw badRequest(
      'Dieses Image steht nicht im Katalog. Beliebige Images lassen sich in den Einstellungen freischalten.',
    )
  }

  return ctx.jobs.start(
    { type: 'image-pull', lane: 'image-pull', title: `Image pullen: ${ref}`, meta: { ref } },
    ({ setProgress, appendLog, onCancel, signal }) =>
      new Promise((resolve, reject) => {
        const parser = new PullProgress()
        appendLog(`podman pull ${ref}`)

        const child = stream('podman', ['pull', ref], {
          onStdout: (line) => line.trim() && appendLog(line),
          onStderr: (line) => {
            const snapshot = parser.push(line)
            if (line.trim()) appendLog(line)
            setProgress({
              pct: snapshot.pct,
              done: snapshot.done,
              total: snapshot.total,
              rate: null,
              eta: null,
            })
          },
          onExit: async (code) => {
            if (signal.aborted) {
              resolve({ cancelled: true })
              return
            }
            if (code !== 0) {
              reject(
                new AppError(502, 'pull_failed', `podman pull endete mit Code ${code}. Details im Job-Log.`),
              )
              return
            }
            setProgress({ pct: 100, done: null, total: null, rate: null, eta: null })

            // A new image ID means the fa/mmap probe result no longer applies.
            const id = await imageId(ref)
            await invalidateFeatureCache(ctx, id)
            await checkUpdates(ctx, { force: true }).catch(() => {})
            appendLog('Pull abgeschlossen.')
            resolve({ ref, id })
          },
        })

        child.on('error', (err) =>
          reject(new AppError(500, 'pull_failed', `podman konnte nicht gestartet werden: ${err.message}`)),
        )
        onCancel(() => child.kill('SIGTERM'))
      }),
  )
}

export async function deleteImage(ctx, ref) {
  const servers = await listServers()
  const users = servers.filter((s) => s.image === ref)
  if (users.length) {
    throw new AppError(
      409,
      'conflict',
      `Das Image wird von ${users.map((s) => `'${s.name}'`).join(', ')} verwendet.`,
      { servers: users.map((s) => s.name) },
    )
  }
  const id = await imageId(ref)
  await removeImage(ref)
  await invalidateFeatureCache(ctx, id)
  return { removed: ref }
}

/**
 * Background scheduler. Deliberately fire-and-forget: a failed check must never
 * surface as an error, only as an `unknown` status in the UI.
 */
export function startUpdateScheduler(ctx) {
  const run = () => {
    checkUpdates(ctx).catch((err) => log.debug(`Update-Prüfung fehlgeschlagen: ${err.message}`))
  }

  const first = setTimeout(run, FIRST_CHECK_MS)
  first.unref?.()

  const intervalMs = Math.max(1, ctx.settings.imageCheckIntervalHours) * 60 * 60_000
  const timer = setInterval(run, intervalMs)
  timer.unref?.()

  return () => {
    clearTimeout(first)
    clearInterval(timer)
  }
}
