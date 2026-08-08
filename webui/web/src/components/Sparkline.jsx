/**
 * Minimal inline SVG sparkline. Hand-rolled rather than pulling in a chart
 * library for one 60-line component.
 */
export function Sparkline({ values, max, height = 32, color = 'var(--accent)' }) {
  const points = (values ?? []).filter((v) => typeof v === 'number' && Number.isFinite(v))
  if (points.length < 2) return <div style={{ height }} />

  const width = 100
  const ceiling = max ?? Math.max(...points, 1)
  const scale = ceiling > 0 ? ceiling : 1

  const step = width / (points.length - 1)
  const coords = points.map((value, i) => {
    const x = i * step
    const y = height - (Math.min(value, scale) / scale) * height
    return [x, y]
  })

  const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
  const area = `${line} L${width},${height} L0,${height} Z`

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      width="100%"
      height={height}
      role="img"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      <path d={area} fill={color} opacity="0.14" />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/** A labelled number with an optional sparkline and secondary line. */
export function StatTile({ label, value, secondary, values, max, color }) {
  return (
    <section className="card stat-tile">
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {secondary ? <span className="small faint">{secondary}</span> : null}
      {values ? <Sparkline values={values} max={max} color={color} /> : null}
    </section>
  )
}
