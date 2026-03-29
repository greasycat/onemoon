import { useMemo, useState, type PropsWithChildren } from 'react'

import { AuthContext, type AuthContextValue, STORAGE_KEY, readStoredAuth } from './auth'

export function AuthProvider({ children }: PropsWithChildren) {
  const [auth, setAuth] = useState(readStoredAuth)

  const value = useMemo<AuthContextValue>(
    () => ({
      ...auth,
      login: (token, username) => {
        const next = { token, username }
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
        setAuth(next)
      },
      logout: () => {
        window.localStorage.removeItem(STORAGE_KEY)
        setAuth({ token: null, username: null })
      },
    }),
    [auth],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
