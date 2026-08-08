import { AppError } from '../lib/errors.js'
import { log } from '../lib/log.js'

const API = 'https://huggingface.co/api'
const TIMEOUT_MS = 15_000

async function hfFetch(url, token) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
    if (res.status === 401 || res.status === 403) {
      throw new AppError(
        res.status,
        'hf_forbidden',
        'Hugging Face verweigert den Zugriff. Für gated Repositories wird ein Token in den Einstellungen benötigt.',
      )
    }
    if (res.status === 404) {
      throw new AppError(404, 'hf_not_found', 'Dieses Repository existiert nicht (oder ist privat).')
    }
    if (!res.ok) {
      throw new AppError(502, 'hf_error', `Hugging Face antwortete mit ${res.status}.`)
    }
    return await res.json()
  } catch (err) {
    if (err instanceof AppError) throw err
    if (err.name === 'AbortError') {
      throw new AppError(504, 'hf_timeout', 'Hugging Face hat nicht rechtzeitig geantwortet.')
    }
    log.warn(`Hugging-Face-Anfrage fehlgeschlagen: ${err.message}`)
    throw new AppError(502, 'hf_unreachable', `Hugging Face nicht erreichbar: ${err.message}`)
  } finally {
    clearTimeout(timer)
  }
}

/** Search for repositories that contain GGUF files. */
export async function searchRepos(query, token, limit = 30) {
  const url = new URL(`${API}/models`)
  url.searchParams.set('search', query)
  url.searchParams.set('filter', 'gguf')
  url.searchParams.set('sort', 'downloads')
  url.searchParams.set('direction', '-1')
  url.searchParams.set('limit', String(limit))

  const results = await hfFetch(url, token)
  // The search endpoint does not return lastModified, so it is not exposed
  // here — a permanently null field in the UI would only be noise.
  return (Array.isArray(results) ? results : []).map((r) => ({
    id: r.modelId ?? r.id,
    downloads: r.downloads ?? 0,
    likes: r.likes ?? 0,
    gated: Boolean(r.gated),
  }))
}

/**
 * List a repository's GGUF files with exact byte sizes.
 *
 * The sizes are the whole point: knowing the total up front is what lets the
 * download job report byte-accurate progress by watching the target directory,
 * instead of screen-scraping tqdm output whose format is not a contract.
 */
export async function listGgufFiles(repo, token, revision = 'main') {
  const url = new URL(`${API}/models/${repo}/tree/${revision}`)
  url.searchParams.set('recursive', 'true')

  const tree = await hfFetch(url, token)
  const files = (Array.isArray(tree) ? tree : [])
    .filter((e) => e.type === 'file' && e.path.toLowerCase().endsWith('.gguf'))
    .map((e) => ({
      path: e.path,
      // LFS-backed files report their real size under `lfs`; `size` is the
      // pointer file's size for those.
      size: e.lfs?.size ?? e.size ?? 0,
      dir: e.path.includes('/') ? e.path.slice(0, e.path.lastIndexOf('/')) : '',
    }))
    .sort((a, b) => a.path.localeCompare(b.path))

  return { repo, revision, files, totalBytes: files.reduce((sum, f) => sum + f.size, 0) }
}
