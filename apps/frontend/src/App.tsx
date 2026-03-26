import { Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom'

import { useAuth } from './lib/auth'
import { LoginPage } from './pages/LoginPage'
import { ProjectsPage } from './pages/ProjectsPage'
import { WorkspacePage } from './pages/WorkspacePage'

function ProtectedShell() {
  const navigate = useNavigate()
  const { token, username, logout } = useAuth()

  if (!token) {
    return <Navigate to="/login" replace />
  }

  return (
    <div className="app-shell">
      <nav className="topbar">
        <div>
          <p className="eyebrow">OneMoon</p>
          <strong>Interactive note-to-LaTeX</strong>
        </div>
        <div className="topbar-actions">
          <span className="muted-text">{username}</span>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              logout()
              navigate('/login')
            }}
          >
            Sign out
          </button>
        </div>
      </nav>
      <Outlet />
    </div>
  )
}

export default function App() {
  const { token } = useAuth()

  return (
    <Routes>
      <Route path="/login" element={token ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route element={<ProtectedShell />}>
        <Route path="/" element={<ProjectsPage />} />
        <Route path="/documents/:documentId" element={<WorkspacePage />} />
      </Route>
      <Route path="*" element={<Navigate to={token ? '/' : '/login'} replace />} />
    </Routes>
  )
}
