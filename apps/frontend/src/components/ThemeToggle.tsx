import { Moon, Sun } from 'lucide-react'

import { useTheme } from '../lib/theme'

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  const nextTheme = theme === 'dark' ? 'light' : 'dark'
  const Icon = theme === 'dark' ? Moon : Sun

  return (
    <button
      type="button"
      className="secondary-button theme-toggle"
      aria-label={`Switch to ${nextTheme} theme`}
      title={`Switch to ${nextTheme} theme`}
      onClick={toggleTheme}
    >
      <Icon className="button-inline-icon" aria-hidden="true" />
      Theme: {theme === 'dark' ? 'Dark' : 'Light'}
    </button>
  )
}
