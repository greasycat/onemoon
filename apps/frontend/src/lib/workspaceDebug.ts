export interface WorkspaceDebugSettings {
  minBlockSize: number
  freeformDrawStep: number
  pointEpsilon: number
  freeformSimplifyEpsilon: number
  saveMaskedCropToTmp: boolean
}

export type WorkspaceDebugNumericSettingKey =
  | 'minBlockSize'
  | 'freeformDrawStep'
  | 'pointEpsilon'
  | 'freeformSimplifyEpsilon'

export interface WorkspaceDebugSettingConfig {
  key: WorkspaceDebugNumericSettingKey
  label: string
  description: string
  min: number
  max: number
  step: number
}

export const WORKSPACE_DEBUG_STORAGE_KEY = 'onemoon:workspace-debug-settings'

export const DEFAULT_WORKSPACE_DEBUG_SETTINGS: WorkspaceDebugSettings = {
  minBlockSize: 0.02,
  freeformDrawStep: 0.0015,
  pointEpsilon: 0.002,
  freeformSimplifyEpsilon: 0.002,
  saveMaskedCropToTmp: false,
}

export const WORKSPACE_DEBUG_SETTING_CONFIGS: WorkspaceDebugSettingConfig[] = [
  {
    key: 'minBlockSize',
    label: 'Minimum block size',
    description: 'Rejects tiny rectangles and free-form polygons below this bounding-box size.',
    min: 0.005,
    max: 0.08,
    step: 0.001,
  },
  {
    key: 'freeformDrawStep',
    label: 'Stroke sampling distance',
    description: 'Lower values capture more points while drawing free-form regions.',
    min: 0.0005,
    max: 0.01,
    step: 0.0005,
  },
  {
    key: 'pointEpsilon',
    label: 'Endpoint close tolerance',
    description: 'Controls how near the cursor must be to close or de-duplicate a free-form path.',
    min: 0.0005,
    max: 0.02,
    step: 0.0005,
  },
  {
    key: 'freeformSimplifyEpsilon',
    label: 'Vertex merge tolerance',
    description: 'Higher values remove more nearly straight free-form vertices after capture.',
    min: 0.001,
    max: 0.03,
    step: 0.001,
  },
]

export function clampDebugSetting(
  value: number,
  config: Pick<WorkspaceDebugSettingConfig, 'min' | 'max'>,
) {
  return Math.max(config.min, Math.min(config.max, value))
}

export function normalizeWorkspaceDebugSettings(
  value: Partial<WorkspaceDebugSettings> | null | undefined,
): WorkspaceDebugSettings {
  const next = { ...DEFAULT_WORKSPACE_DEBUG_SETTINGS, ...value }
  const normalized = WORKSPACE_DEBUG_SETTING_CONFIGS.reduce<WorkspaceDebugSettings>((settings, config) => {
    const candidate = next[config.key]
    settings[config.key] = clampDebugSetting(
      typeof candidate === 'number' && Number.isFinite(candidate)
        ? candidate
        : DEFAULT_WORKSPACE_DEBUG_SETTINGS[config.key],
      config,
    )
    return settings
  }, { ...DEFAULT_WORKSPACE_DEBUG_SETTINGS })
  normalized.saveMaskedCropToTmp =
    typeof next.saveMaskedCropToTmp === 'boolean'
      ? next.saveMaskedCropToTmp
      : DEFAULT_WORKSPACE_DEBUG_SETTINGS.saveMaskedCropToTmp
  return normalized
}

export function loadWorkspaceDebugSettings() {
  if (typeof window === 'undefined') {
    return DEFAULT_WORKSPACE_DEBUG_SETTINGS
  }

  try {
    const raw = window.localStorage.getItem(WORKSPACE_DEBUG_STORAGE_KEY)
    if (!raw) {
      return DEFAULT_WORKSPACE_DEBUG_SETTINGS
    }
    return normalizeWorkspaceDebugSettings(JSON.parse(raw) as Partial<WorkspaceDebugSettings>)
  } catch {
    return DEFAULT_WORKSPACE_DEBUG_SETTINGS
  }
}
