import { useEffect } from 'react'
import { Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom'

import { useAuth } from './lib/auth'
import { ThemeToggle } from './components/ThemeToggle'
import { LoginPage } from './pages/LoginPage'
import { ProjectsPage } from './pages/ProjectsPage'
import { WorkspacePage } from './pages/WorkspacePage'

const SCROLL_EPSILON = 1

function isScrollable(element: HTMLElement) {
  const style = window.getComputedStyle(element)
  if (!['auto', 'scroll', 'overlay'].includes(style.overflowY)) {
    return false
  }
  return element.scrollHeight - element.clientHeight > SCROLL_EPSILON
}

function canScrollInDirection(element: HTMLElement, deltaY: number) {
  if (element === document.scrollingElement) {
    const maxScrollTop = document.documentElement.scrollHeight - window.innerHeight
    if (maxScrollTop <= SCROLL_EPSILON) {
      return false
    }
    return deltaY < 0 ? window.scrollY > SCROLL_EPSILON : window.scrollY < maxScrollTop - SCROLL_EPSILON
  }

  const maxScrollTop = element.scrollHeight - element.clientHeight
  if (maxScrollTop <= SCROLL_EPSILON) {
    return false
  }
  return deltaY < 0 ? element.scrollTop > SCROLL_EPSILON : element.scrollTop < maxScrollTop - SCROLL_EPSILON
}

function getScrollableAncestors(target: EventTarget | null) {
  const scrollableAncestors: HTMLElement[] = []
  let current = target instanceof HTMLElement ? target : null

  while (current) {
    if (isScrollable(current)) {
      scrollableAncestors.push(current)
    }
    current = current.parentElement
  }

  const scrollingElement = document.scrollingElement
  if (scrollingElement instanceof HTMLElement && !scrollableAncestors.includes(scrollingElement)) {
    scrollableAncestors.push(scrollingElement)
  }

  return scrollableAncestors
}

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
          <ThemeToggle />
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

  useEffect(() => {
    let lastTouchY: number | null = null

    const shouldPreventScroll = (deltaY: number, target: EventTarget | null) => {
      if (Math.abs(deltaY) <= SCROLL_EPSILON) {
        return false
      }
      const scrollableAncestors = getScrollableAncestors(target)
      if (scrollableAncestors.length === 0) {
        return false
      }
      return !scrollableAncestors.some((element) => canScrollInDirection(element, deltaY))
    }

    const handleWheel = (event: WheelEvent) => {
      if (shouldPreventScroll(event.deltaY, event.target)) {
        event.preventDefault()
      }
    }

    const handleTouchStart = (event: TouchEvent) => {
      lastTouchY = event.touches[0]?.clientY ?? null
    }

    const handleTouchMove = (event: TouchEvent) => {
      const currentTouchY = event.touches[0]?.clientY
      if (currentTouchY == null || lastTouchY == null) {
        return
      }
      const deltaY = lastTouchY - currentTouchY
      if (shouldPreventScroll(deltaY, event.target)) {
        event.preventDefault()
      }
      lastTouchY = currentTouchY
    }

    const resetTouchState = () => {
      lastTouchY = null
    }

    document.addEventListener('wheel', handleWheel, { passive: false })
    document.addEventListener('touchstart', handleTouchStart, { passive: true })
    document.addEventListener('touchmove', handleTouchMove, { passive: false })
    document.addEventListener('touchend', resetTouchState)
    document.addEventListener('touchcancel', resetTouchState)

    return () => {
      document.removeEventListener('wheel', handleWheel)
      document.removeEventListener('touchstart', handleTouchStart)
      document.removeEventListener('touchmove', handleTouchMove)
      document.removeEventListener('touchend', resetTouchState)
      document.removeEventListener('touchcancel', resetTouchState)
    }
  }, [])

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
