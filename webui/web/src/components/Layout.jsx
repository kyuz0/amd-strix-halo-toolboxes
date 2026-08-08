import { useQuery } from '@tanstack/react-query'
import { NavLink, Outlet } from 'react-router-dom'

import { get } from '../api/client.js'
import { useAuth } from '../auth/AuthContext.jsx'

const LINKS = [
  { to: '/', label: 'Übersicht', end: true },
  { to: '/servers', label: 'Server' },
  { to: '/models', label: 'Modelle' },
  { to: '/images', label: 'Images' },
  { to: '/profiles', label: 'Profile' },
  { to: '/updates', label: 'Updates' },
  { to: '/settings', label: 'Einstellungen' },
]

export function Layout() {
  const { user, logout } = useAuth()
  const version = useQuery({
    queryKey: ['version'],
    queryFn: () => get('/version'),
    staleTime: 5 * 60_000,
  })

  return (
    <div className="shell">
      <nav className="nav">
        <div className="nav-brand">
          <strong>Strix Halo</strong>
          <span>WebUI</span>
        </div>

        {LINKS.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
          >
            {link.label}
          </NavLink>
        ))}

        <div className="nav-foot">
          <div className="row-between">
            <span className="truncate">{user?.username}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={logout}>
              Abmelden
            </button>
          </div>
          {version.data ? (
            <span className="mono truncate" title={version.data.sha}>
              {version.data.shortSha || 'unbekannt'}
              {version.data.dirty ? ' (geändert)' : ''}
            </span>
          ) : null}
        </div>
      </nav>

      <main className="main">
        <Outlet />
      </main>
    </div>
  )
}

/** Standard page header: title, one-line explanation, optional actions. */
export function PageHead({ title, description, children }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {description ? <p className="muted small">{description}</p> : null}
      </div>
      {children ? <div className="row wrap">{children}</div> : null}
    </header>
  )
}
