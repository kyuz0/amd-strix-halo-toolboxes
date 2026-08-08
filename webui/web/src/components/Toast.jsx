import { createContext, useCallback, useContext, useMemo, useState } from 'react'

const ToastContext = createContext(null)

let nextId = 1

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id))
  }, [])

  const push = useCallback(
    (message, kind = 'info', ttl = 6000) => {
      const id = nextId++
      setToasts((list) => [...list, { id, message, kind }])
      if (ttl) setTimeout(() => dismiss(id), ttl)
      return id
    },
    [dismiss],
  )

  const value = useMemo(
    () => ({
      push,
      dismiss,
      success: (msg) => push(msg, 'success'),
      error: (msg) => push(typeof msg === 'string' ? msg : msg?.message || 'Unbekannter Fehler', 'error', 10000),
      info: (msg) => push(msg, 'info'),
    }),
    [push, dismiss],
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.kind}`}>
            <span className="grow">{toast.message}</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => dismiss(toast.id)}
              aria-label="Meldung schließen"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast muss innerhalb von ToastProvider verwendet werden')
  return ctx
}
