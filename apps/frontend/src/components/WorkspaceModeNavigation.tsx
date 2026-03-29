import type { LucideIcon } from 'lucide-react'
import { ArrowRight, GitMerge, RefreshCw, Scan } from 'lucide-react'

export type WorkspaceMode = 'review' | 'conversion' | 'merging'

interface WorkspaceModeNavigationProps {
  activeMode: WorkspaceMode
  disabled?: boolean
  onChangeMode: (mode: WorkspaceMode) => void
}

interface WorkspaceModeStep {
  mode: WorkspaceMode
  label: string
  hint: string
  icon: LucideIcon
}

const WORKSPACE_MODE_STEPS: WorkspaceModeStep[] = [
  {
    mode: 'review',
    label: 'Segment',
    hint: 'Review and edit page segmentation',
    icon: Scan,
  },
  {
    mode: 'conversion',
    label: 'Conversion',
    hint: 'Review converted block output',
    icon: RefreshCw,
  },
  {
    mode: 'merging',
    label: 'Merging',
    hint: 'Assemble and refine merged document output',
    icon: GitMerge,
  },
]

export function WorkspaceModeNavigation({ activeMode, disabled = false, onChangeMode }: WorkspaceModeNavigationProps) {
  return (
    <nav className="workspace-mode-navigation" aria-label="Workspace modes">
      {WORKSPACE_MODE_STEPS.map((step, index) => {
        const Icon = step.icon
        const isActive = step.mode === activeMode

        return (
          <div className="workspace-mode-navigation-item" key={step.mode}>
            <button
              type="button"
              className={`workspace-mode-navigation-button ${isActive ? 'workspace-mode-navigation-button-active' : ''}`}
              aria-pressed={isActive}
              disabled={disabled}
              title={step.hint}
              onClick={() => onChangeMode(step.mode)}
            >
              <span className="workspace-mode-navigation-button-icon" aria-hidden="true">
                <Icon />
              </span>
              <span className="workspace-mode-navigation-button-copy">
                <span className="workspace-mode-navigation-button-label">{step.label}</span>
                <span className="workspace-mode-navigation-button-hint">{step.hint}</span>
              </span>
            </button>
            {index < WORKSPACE_MODE_STEPS.length - 1 ? (
              <span className="workspace-mode-navigation-separator" aria-hidden="true">
                <ArrowRight />
              </span>
            ) : null}
          </div>
        )
      })}
    </nav>
  )
}
