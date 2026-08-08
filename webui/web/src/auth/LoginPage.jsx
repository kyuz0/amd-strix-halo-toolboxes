import { useState } from 'react'

import { useAuth } from './AuthContext.jsx'

export function LoginPage() {
  const { login } = useAuth()
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(username, password)
    } catch (err) {
      setError(err.message)
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={onSubmit}>
        <div className="login-title">
          <h1>Strix Halo WebUI</h1>
          <span>llama.cpp-Toolboxes verwalten</span>
        </div>

        {error ? (
          <div className="alert alert-danger small" role="alert">
            {error}
          </div>
        ) : null}

        <div className="field">
          <label htmlFor="username">Benutzername</label>
          <input
            id="username"
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="password">Passwort</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <button className="btn btn-primary" type="submit" disabled={busy || !password}>
          {busy ? 'Wird angemeldet …' : 'Anmelden'}
        </button>

        <p className="small faint">
          Das Passwort wurde einmalig von <code>webui/install.sh</code> ausgegeben. Vergessen?
          Setze es auf der Box mit <code>webui/scripts/shx-passwd</code> neu.
        </p>
      </form>
    </div>
  )
}
