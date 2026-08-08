import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import { get, onUnauthorized, post } from '../api/client.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [status, setStatus] = useState('loading')

  const refresh = useCallback(async () => {
    try {
      const me = await get('/auth/me')
      setUser(me)
      setStatus('authenticated')
      return me
    } catch {
      setUser(null)
      setStatus('anonymous')
      return null
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Any 401 from anywhere in the app drops us back to the login screen rather
  // than leaving a half-dead UI behind.
  useEffect(
    () =>
      onUnauthorized(() => {
        setUser(null)
        setStatus('anonymous')
      }),
    [],
  )

  const login = useCallback(async (username, password) => {
    const me = await post('/auth/login', { username, password })
    setUser(me)
    setStatus('authenticated')
    return me
  }, [])

  const logout = useCallback(async () => {
    try {
      await post('/auth/logout')
    } finally {
      setUser(null)
      setStatus('anonymous')
    }
  }, [])

  const value = useMemo(
    () => ({ user, status, login, logout, refresh }),
    [user, status, login, logout, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth muss innerhalb von AuthProvider verwendet werden')
  return ctx
}
