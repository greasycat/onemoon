import { useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useState } from 'react'

import { api } from '../lib/api'
import { useAuth } from '../lib/auth'

export function LoginPage() {
  const navigate = useNavigate()
  const { login } = useAuth()
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('onemoon')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const loginMutation = useMutation({
    mutationFn: () => api.login(username, password),
    onSuccess: (response) => {
      login(response.access_token, response.username)
      navigate('/')
    },
    onError: (error: Error) => {
      setErrorMessage(error.message)
    },
  })

  return (
    <main className="login-shell">
      <section className="login-card">
        <p className="eyebrow">OneMoon</p>
        <h1>Turn notes into reviewable LaTeX.</h1>
        <p className="lede">
          Upload handwritten pages or PDFs, correct the segmentation, approve block-by-block output, and compile a clean LaTeX preview.
        </p>
        <form
          className="login-form"
          onSubmit={(event) => {
            event.preventDefault()
            setErrorMessage(null)
            loginMutation.mutate()
          }}
        >
          <label className="field">
            <span>Username</span>
            <input value={username} onChange={(event) => setUsername(event.target.value)} />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
          <button type="submit" className="primary-button" disabled={loginMutation.isPending}>
            {loginMutation.isPending ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  )
}
