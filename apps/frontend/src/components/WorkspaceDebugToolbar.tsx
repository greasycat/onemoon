import { useId, useState } from 'react'
import { Bug, X } from 'lucide-react'

import type { CanvasViewportState } from './DocumentCanvas'
import {
  WORKSPACE_DEBUG_SETTING_CONFIGS,
  type WorkspaceDebugSettings,
} from '../lib/workspaceDebug'

interface WorkspaceDebugToolbarProps {
  settings: WorkspaceDebugSettings
  hoveredBlockLabel: string
  viewportState: CanvasViewportState
  onChange: (key: keyof WorkspaceDebugSettings, value: number) => void
  onReset: () => void
}

function formatSettingValue(value: number) {
  return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
}

function formatDimensionValue(value: number) {
  return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

export function WorkspaceDebugToolbar({ settings, hoveredBlockLabel, viewportState, onChange, onReset }: WorkspaceDebugToolbarProps) {
  const [isOpen, setIsOpen] = useState(false)
  const panelId = useId()

  return (
    <div className="workspace-debug-dock">
      {isOpen ? (
        <aside id={panelId} className="workspace-debug-panel" aria-label="Workspace debug controls">
          <div className="workspace-debug-panel-header">
            <div>
              <p className="eyebrow">Debug Controls</p>
              <h2>Editor Thresholds</h2>
            </div>
            <button type="button" className="secondary-button" onClick={onReset}>
              Reset defaults
            </button>
          </div>

          <p className="workspace-debug-copy muted-text">
            Tune free-form capture in place. Tighter values keep more stroke detail. Looser values close paths and merge
            vertices more aggressively.
          </p>

          <section className="workspace-debug-section" aria-label="Cursor debug">
            <div className="workspace-debug-indicator-card">
              <span className="workspace-debug-indicator-label">Hovered block</span>
              <code>{hoveredBlockLabel}</code>
            </div>
          </section>

          <section className="workspace-debug-section" aria-label="Viewport debug">
            <div className="workspace-debug-indicator-grid">
              <div className="workspace-debug-indicator-card">
                <span className="workspace-debug-indicator-label">Viewport zoom</span>
                <code>{formatSettingValue(viewportState.zoom)}</code>
              </div>
              <div className="workspace-debug-indicator-card">
                <span className="workspace-debug-indicator-label">Fit-page zoom</span>
                <code>{formatSettingValue(viewportState.fitPageZoom)}</code>
              </div>
              <div className="workspace-debug-indicator-card">
                <span className="workspace-debug-indicator-label">Content width</span>
                <code>{formatDimensionValue(viewportState.contentWidth)}px</code>
              </div>
              <div className="workspace-debug-indicator-card">
                <span className="workspace-debug-indicator-label">Content height</span>
                <code>{formatDimensionValue(viewportState.contentHeight)}px</code>
              </div>
              <div className="workspace-debug-indicator-card">
                <span className="workspace-debug-indicator-label">Page width</span>
                <code>{formatDimensionValue(viewportState.pageWidth)}px</code>
              </div>
              <div className="workspace-debug-indicator-card">
                <span className="workspace-debug-indicator-label">Page height</span>
                <code>{formatDimensionValue(viewportState.pageHeight)}px</code>
              </div>
            </div>
          </section>

          <section className="workspace-debug-section" aria-label="Drawing controls">
            {WORKSPACE_DEBUG_SETTING_CONFIGS.map((config) => {
              const inputId = `${panelId}-${config.key}`
              const value = settings[config.key]
              return (
                <label className="workspace-debug-field" key={config.key} htmlFor={inputId}>
                  <div className="workspace-debug-field-header">
                    <span>{config.label}</span>
                    <code>{formatSettingValue(value)}</code>
                  </div>
                  <p className="muted-text">{config.description}</p>
                  <div className="workspace-debug-input-row">
                    <input
                      id={inputId}
                      type="range"
                      min={config.min}
                      max={config.max}
                      step={config.step}
                      value={value}
                      onChange={(event) => onChange(config.key, Number(event.target.value))}
                    />
                    <input
                      className="workspace-debug-number"
                      type="number"
                      min={config.min}
                      max={config.max}
                      step={config.step}
                      value={value}
                      onChange={(event) => onChange(config.key, Number(event.target.value))}
                    />
                  </div>
                </label>
              )
            })}
          </section>

          <details className="workspace-debug-section workspace-debug-placeholder">
            <summary>LLM Controls (coming soon)</summary>
            <p className="muted-text">
              These fields are placeholders only in this change. They do not send request overrides and the mock provider
              flow stays unchanged.
            </p>
            <div className="workspace-debug-placeholder-grid" aria-hidden="true">
              <label className="field">
                <span>Provider</span>
                <input disabled value="mock" readOnly />
              </label>
              <label className="field">
                <span>Model</span>
                <input disabled value="mock-notes-v1" readOnly />
              </label>
              <label className="field">
                <span>Temperature</span>
                <input disabled value="0.2" readOnly />
              </label>
              <label className="field">
                <span>Top-p</span>
                <input disabled value="0.95" readOnly />
              </label>
              <label className="field">
                <span>Instruction preset</span>
                <input disabled value="review-default" readOnly />
              </label>
            </div>
          </details>
        </aside>
      ) : null}

      <button
        type="button"
        className="workspace-debug-launcher"
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={() => setIsOpen((current) => !current)}
      >
        <span className="workspace-debug-launcher-label">Debug</span>
        <span className="workspace-debug-launcher-icon" aria-hidden="true">
          {isOpen ? <X /> : <Bug />}
        </span>
      </button>
    </div>
  )
}
