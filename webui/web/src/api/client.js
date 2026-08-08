const CSRF_HEADER = 'X-Requested-With'
const CSRF_VALUE = 'shx'

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

/** Fires when the server rejects us, so the shell can bounce back to /login. */
const unauthorizedListeners = new Set()
export function onUnauthorized(fn) {
  unauthorizedListeners.add(fn)
  return () => unauthorizedListeners.delete(fn)
}

/**
 * Thin fetch wrapper.
 *
 * Auth rides on an httpOnly cookie, so there is no token to attach here — but
 * every mutating call must carry the custom header, which is what makes a
 * cross-origin request impossible without a CORS preflight the server never
 * answers.
 */
export async function api(path, { method = 'GET', body, signal } = {}) {
  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (method !== 'GET' && method !== 'HEAD') headers[CSRF_HEADER] = CSRF_VALUE

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })

  if (res.status === 204) return null

  let payload = null
  const text = await res.text()
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = { error: { code: 'bad_response', message: text.slice(0, 400) } }
    }
  }

  if (!res.ok) {
    const err = payload?.error ?? {}
    if (res.status === 401 && !path.startsWith('/auth/')) {
      for (const fn of unauthorizedListeners) fn()
    }
    throw new ApiError(
      res.status,
      err.code || 'error',
      err.message || `Anfrage fehlgeschlagen (${res.status})`,
      err.details,
    )
  }
  return payload
}

export const get = (path, opts) => api(path, { ...opts, method: 'GET' })
export const post = (path, body, opts) => api(path, { ...opts, method: 'POST', body })
export const put = (path, body, opts) => api(path, { ...opts, method: 'PUT', body })
export const del = (path, opts) => api(path, { ...opts, method: 'DELETE' })

/** Build a query string, dropping empty values. */
export function qs(params) {
  const usp = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    usp.set(key, String(value))
  }
  const s = usp.toString()
  return s ? `?${s}` : ''
}
