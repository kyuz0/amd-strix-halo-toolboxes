/** Shared display helpers. */

export function formatBytes(bytes, digits = 1) {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return '–'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let value = Number(bytes)
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : digits)} ${units[unit]}`
}

export function formatNumber(n) {
  return typeof n === 'number' ? n.toLocaleString('de-DE') : '–'
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '–'
  const s = Math.round(seconds)
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ${s % 60} s`
  const h = Math.floor(m / 60)
  return `${h} h ${m % 60} min`
}

export function formatDate(iso) {
  if (!iso) return '–'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })
}

/** Short image label: the tag alone when it comes from the known repository. */
export function shortImage(image) {
  if (!image) return '–'
  const colon = image.lastIndexOf(':')
  return colon > 0 ? image.slice(colon + 1) : image
}
