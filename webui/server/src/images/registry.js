import { log } from '../lib/log.js'

/**
 * Ask Docker Hub whether a tag has moved, without pulling a single blob.
 *
 * A HEAD on the manifest returns `Docker-Content-Digest`, which is directly
 * comparable to what `podman image inspect --format '{{.Digest}}'` reports for
 * a locally pulled image. That is the whole update check: two digests, no
 * download, no skopeo, no extra dependency.
 */

const AUTH_URL = 'https://auth.docker.io/token'
const REGISTRY = 'https://registry-1.docker.io'
const TOKEN_TTL_MS = 4 * 60_000
const TIMEOUT_MS = 12_000

const ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ')

/** Immutable build tags the CI pushes alongside the moving channel tag. */
const BUILD_TAG_RE = /^(?<backend>.+)_(?<stamp>\d{8}T\d{6})$/

/** @type {Map<string, {token: string, at: number}>} */
const tokenCache = new Map()

export class RateLimited extends Error {}

/** `docker.io/user/repo:tag` -> `{ repository: 'user/repo', tag }`. */
export function parseRef(ref) {
  const withoutHost = ref.replace(/^docker\.io\//, '').replace(/^index\.docker\.io\//, '')
  const colon = withoutHost.lastIndexOf(':')
  const slash = withoutHost.lastIndexOf('/')
  if (colon > slash) {
    return { repository: withoutHost.slice(0, colon), tag: withoutHost.slice(colon + 1) }
  }
  return { repository: withoutHost, tag: 'latest' }
}

async function timedFetch(url, options = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function anonymousToken(repository) {
  const cached = tokenCache.get(repository)
  if (cached && Date.now() - cached.at < TOKEN_TTL_MS) return cached.token

  const url = new URL(AUTH_URL)
  url.searchParams.set('service', 'registry.docker.io')
  url.searchParams.set('scope', `repository:${repository}:pull`)

  const res = await timedFetch(url)
  if (res.status === 429) throw new RateLimited('Docker Hub rate limit')
  if (!res.ok) throw new Error(`Token-Anfrage fehlgeschlagen (${res.status})`)

  const body = await res.json()
  const token = body.token ?? body.access_token
  if (!token) throw new Error('Docker Hub lieferte kein Token')
  tokenCache.set(repository, { token, at: Date.now() })
  return token
}

/** The digest Docker Hub currently serves for this tag, or null. */
export async function remoteDigest(ref) {
  const { repository, tag } = parseRef(ref)
  const token = await anonymousToken(repository)

  const res = await timedFetch(`${REGISTRY}/v2/${repository}/manifests/${tag}`, {
    method: 'HEAD',
    headers: { Authorization: `Bearer ${token}`, Accept: ACCEPT },
  })

  if (res.status === 429) throw new RateLimited('Docker Hub rate limit')
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Manifest-Anfrage fehlgeschlagen (${res.status})`)

  return res.headers.get('docker-content-digest')
}

/**
 * Every tag in a repository.
 *
 * Fetched once per update run rather than once per image: all four backends
 * live in the same repository, so four calls would return the same list and
 * burn four times the anonymous rate limit for nothing.
 */
export async function fetchTags(ref) {
  const { repository } = parseRef(ref)
  const token = await anonymousToken(repository)

  let url = `${REGISTRY}/v2/${repository}/tags/list?n=1000`
  const tags = []

  // The tag list is paginated via a Link header; a handful of pages at most.
  for (let page = 0; page < 10 && url; page++) {
    const res = await timedFetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
    if (res.status === 429) throw new RateLimited('Docker Hub rate limit')
    if (!res.ok) throw new Error(`Tag-Liste fehlgeschlagen (${res.status})`)

    const body = await res.json()
    tags.push(...(body.tags ?? []))

    const link = res.headers.get('link')
    const next = link && /<([^>]+)>;\s*rel="next"/.exec(link)
    url = next ? new URL(next[1], REGISTRY).toString() : null
  }
  return tags
}

/**
 * The newest immutable build tag for a backend, taken from a tag list.
 *
 * CI pushes `<backend>_<YYYYmmddTHHMMSS>` alongside the moving `<backend>`
 * tag, so this dates the newest build without fetching a manifest. The prune
 * workflow may have removed all of them, in which case this is legitimately
 * null and the UI simply omits the build date.
 */
export function newestBuildFromTags(tags, backend) {
  let newest = null
  for (const candidate of tags ?? []) {
    const match = BUILD_TAG_RE.exec(candidate)
    if (!match || match.groups.backend !== backend) continue
    if (!newest || match.groups.stamp > newest.stamp) {
      newest = { tag: candidate, stamp: match.groups.stamp }
    }
  }
  if (!newest) return null
  return { tag: newest.tag, builtAt: stampToIso(newest.stamp) }
}

/** `20260801T120000` -> ISO 8601. CI stamps these in UTC. */
export function stampToIso(stamp) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(stamp)
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m
  return `${y}-${mo}-${d}T${h}:${mi}:${s}Z`
}

/**
 * Compare a local digest against the registry.
 *
 * Any failure yields `unknown` rather than an error: the box may be offline,
 * and a red banner for a missing update check would be worse than silence.
 */
export async function checkTag(ref, localDigest, tags = null) {
  try {
    const digest = await remoteDigest(ref)
    const build = newestBuildFromTags(tags, parseRef(ref).tag)

    let status = 'unknown'
    if (!localDigest) status = 'not-installed'
    else if (digest && localDigest === digest) status = 'up-to-date'
    else if (digest && localDigest !== digest) status = 'update-available'

    return {
      status,
      remoteDigest: digest,
      newestImmutableTag: build?.tag ?? null,
      newestBuildAt: build?.builtAt ?? null,
      rateLimited: false,
    }
  } catch (err) {
    if (err instanceof RateLimited) {
      log.warn(`Docker Hub rate limit erreicht bei ${ref}`)
      return { status: 'unknown', remoteDigest: null, rateLimited: true }
    }
    log.debug(`Update-Prüfung für ${ref} fehlgeschlagen: ${err.message}`)
    return { status: localDigest ? 'unknown' : 'not-installed', remoteDigest: null, rateLimited: false }
  }
}
