/**
 * Scrubs secrets out of anything on its way to a log file, an SSE stream or an
 * error response.
 *
 * Secrets reach us from three directions — the HF token, per-profile API keys,
 * and whatever the user typed into a custom extra-args field — and they end up
 * in podman argv, subprocess output and stack traces. Registering them once
 * here is far more reliable than remembering to mask at every call site.
 */

/** @type {Set<string>} */
const secrets = new Set()

/** Values shorter than this are too likely to appear in ordinary text. */
const MIN_SECRET_LENGTH = 8

export function registerSecret(value) {
  if (typeof value === 'string' && value.length >= MIN_SECRET_LENGTH) secrets.add(value)
}

export function unregisterSecret(value) {
  secrets.delete(value)
}

export function clearSecrets() {
  secrets.clear()
}

/** Replace every registered secret in `text` with `***`. */
export function redact(text) {
  if (typeof text !== 'string' || !text) return text
  let out = text
  for (const secret of secrets) {
    if (out.includes(secret)) out = out.split(secret).join('***')
  }
  return out
}

/** Mask a value for display: keep the first 4 characters, hide the rest. */
export function mask(value) {
  if (!value) return ''
  if (value.length <= 4) return '*'.repeat(value.length)
  return `${value.slice(0, 4)}${'*'.repeat(Math.min(value.length - 4, 12))}`
}
