import { createContext, useContext } from 'react'

interface AuthState {
  token: string | null
  username: string | null
}

export interface AuthContextValue extends AuthState {
  login: (token: string, username: string) => void
  logout: () => void
}

export const STORAGE_KEY = 'onemoon.auth'
export const AuthContext = createContext<AuthContextValue | null>(null)

export function readStoredAuth(): AuthState {
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return { token: null, username: null }
  }
  try {
    return JSON.parse(raw) as AuthState
  } catch {
    return { token: null, username: null }
  }
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider')
  }
  return context
}
