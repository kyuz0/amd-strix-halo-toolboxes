import { useCallback, useEffect, useRef, useState } from 'react'

import { useEventStream } from '../api/sse.js'

const MAX_LINES = 2000

/**
 * Live container log.
 *
 * Auto-scroll only while the user is already at the bottom — otherwise reading
 * back through a stack trace becomes impossible as new lines arrive.
 */
export function LogView({ name }) {
  const [lines, setLines] = useState([])
  const [pinned, setPinned] = useState(true)
  const boxRef = useRef(null)

  const onLine = useCallback((data) => {
    setLines((prev) => {
      const next = prev.length >= MAX_LINES ? prev.slice(prev.length - MAX_LINES + 1) : prev.slice()
      next.push(data.line)
      return next
    })
  }, [])

  const onClosed = useCallback(() => {
    setLines((prev) => [...prev, '[webui] Der Log-Stream wurde beendet.'])
  }, [])

  const state = useEventStream(name ? `/servers/${encodeURIComponent(name)}/logs/events` : null, {
    line: onLine,
    closed: onClosed,
  })

  useEffect(() => {
    if (pinned && boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight
  }, [lines, pinned])

  function onScroll() {
    const el = boxRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24
    setPinned(atBottom)
  }

  return (
    <div className="stack-sm">
      <div className="row-between">
        <h2>Logs</h2>
        <div className="row">
          <span className={`badge ${state === 'open' ? 'badge-ok' : 'badge-warn'}`}>
            {state === 'open' ? 'live' : state === 'reconnecting' ? 'verbindet neu' : state}
          </span>
          {!pinned ? (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                setPinned(true)
                if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight
              }}
            >
              Ans Ende springen
            </button>
          ) : null}
          <button type="button" className="btn btn-sm" onClick={() => setLines([])}>
            Leeren
          </button>
        </div>
      </div>

      <pre className="logbox" ref={boxRef} onScroll={onScroll}>
        {lines.length ? lines.join('\n') : 'Noch keine Ausgabe.'}
      </pre>
    </div>
  )
}
