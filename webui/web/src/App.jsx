import { Navigate, Route, Routes } from 'react-router-dom'

import { LoginPage } from './auth/LoginPage.jsx'
import { useAuth } from './auth/AuthContext.jsx'
import { Layout } from './components/Layout.jsx'
import { Dashboard } from './pages/Dashboard.jsx'
import { Images } from './pages/Images.jsx'
import { Models } from './pages/Models.jsx'
import { Profiles } from './pages/Profiles.jsx'
import { ServerDetail } from './pages/ServerDetail.jsx'
import { Servers } from './pages/Servers.jsx'
import { Settings } from './pages/Settings.jsx'
import { Updates } from './pages/Updates.jsx'

export function App() {
  const { status } = useAuth()

  if (status === 'loading') {
    return (
      <div className="login-wrap">
        <span className="muted">Wird geladen …</span>
      </div>
    )
  }

  if (status !== 'authenticated') return <LoginPage />

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="servers" element={<Servers />} />
        <Route path="servers/:name" element={<ServerDetail />} />
        <Route path="models" element={<Models />} />
        <Route path="images" element={<Images />} />
        <Route path="profiles" element={<Profiles />} />
        <Route path="updates" element={<Updates />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
