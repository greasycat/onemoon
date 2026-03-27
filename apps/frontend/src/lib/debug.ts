function parseBooleanEnv(value: unknown) {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim().toLowerCase()
  if (normalized === 'true') {
    return true
  }
  if (normalized === 'false') {
    return false
  }
  return null
}

export const FRONTEND_DEBUG = parseBooleanEnv(import.meta.env.VITE_FRONTEND_DEBUG) ?? import.meta.env.DEV
