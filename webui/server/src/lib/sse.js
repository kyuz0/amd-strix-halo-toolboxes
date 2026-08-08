import { redact } from './redact.js'

const HEARTBEAT_MS = 15_000

/**
 * Turn a response into a server-sent-event stream.
 *
 * Two details matter for this deployment: `X-Accel-Buffering: no` in case the
 * user later puts nginx in front, and `flushHeaders()` so the browser sees an
 * open stream immediately rather than after the first event. Response
 * compression is deliberately absent from the middleware chain — it buffers SSE
 * into uselessness.
 */
export function openSse(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.flushHeaders?.()

  const heartbeat = setInterval(() => {
    // A comment line keeps the connection warm without producing an event.
    res.write(': ping\n\n')
  }, HEARTBEAT_MS)
  heartbeat.unref?.()

  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    clearInterval(heartbeat)
    try {
      res.end()
    } catch {
      // client already gone
    }
  }

  req.on('close', close)
  res.on('error', close)

  return {
    /**
     * @param {string} event
     * @param {unknown} data
     * @param {number} [id] sequence number for Last-Event-ID resume
     */
    send(event, data, id) {
      if (closed) return false
      let frame = ''
      if (id !== undefined) frame += `id: ${id}\n`
      frame += `event: ${event}\n`
      const payload = redact(JSON.stringify(data ?? null))
      // Multi-line payloads need one `data:` per line; JSON has none, but stay
      // correct in case a raw string is ever passed.
      for (const line of payload.split('\n')) frame += `data: ${line}\n`
      frame += '\n'
      try {
        res.write(frame)
        return true
      } catch {
        close()
        return false
      }
    },
    close,
    get closed() {
      return closed
    },
  }
}

/** Parse the `Last-Event-ID` header (or `?lastEventId=`) into a number. */
export function lastEventId(req) {
  const raw = req.get('last-event-id') || req.query?.lastEventId
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}
