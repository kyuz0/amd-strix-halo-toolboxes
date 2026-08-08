import { useEffect, useRef, useState } from 'react'

/**
 * Subscribe to a server-sent-event stream.
 *
 * The auth cookie is attached by the browser automatically, so no token
 * handling is needed here. EventSource reconnects on its own and replays
 * `Last-Event-ID`, which the log and job endpoints honour.
 *
 * @param {string|null} path API path (without the `/api` prefix), or null to stay closed
 * @param {Record<string, (data: any) => void>} handlers event name -> callback
 */
export function useEventStream(path, handlers) {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers
  const [state, setState] = useState('idle')

  useEffect(() => {
    if (!path) {
      setState('idle')
      return undefined
    }

    const source = new EventSource(`/api${path}`, { withCredentials: true })
    const registered = []

    setState('connecting')
    source.onopen = () => setState('open')
    source.onerror = () => {
      // EventSource retries by itself; surface the gap without tearing down.
      setState((prev) => (prev === 'open' ? 'reconnecting' : 'connecting'))
    }

    const names = new Set(Object.keys(handlersRef.current ?? {}))
    for (const name of names) {
      const listener = (event) => {
        let data = null
        try {
          data = event.data ? JSON.parse(event.data) : null
        } catch {
          data = event.data
        }
        handlersRef.current?.[name]?.(data, event)
      }
      source.addEventListener(name, listener)
      registered.push([name, listener])
    }

    return () => {
      for (const [name, listener] of registered) source.removeEventListener(name, listener)
      source.close()
      setState('idle')
    }
    // Handlers are read through a ref, so only the path drives resubscription.
  }, [path])

  return state
}
