/**
 * Application zoom (browser-zoom emulation).
 * CSS `zoom` on `.app-zoom-canvas` + inverse width/height. Never transform:scale.
 */

export const APP_ZOOM_KEY = 'hel-app-zoom'
export const APP_ZOOM_LEGACY_KEYS = ['hel-ui-zoom', 'hel-ui-size'] as const

export const ZOOM_LEVELS = [
  25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500,
] as const

export type AppZoomPercent = (typeof ZOOM_LEVELS)[number]

export function getZoomFactor(percent: number): number {
  return parseAppZoom(percent) / 100
}

export function getInverseZoomFactor(percent: number): number {
  const z = parseAppZoom(percent)
  return z ? 100 / z : 1
}

/** @deprecated use getInverseZoomFactor */
export const getInverseZoom = getInverseZoomFactor

/** Logical viewport width (browser-zoom-like) for JS layout helpers only. */
export function getEffectiveViewportWidth(percent?: number): number {
  if (typeof window === 'undefined') return 0
  const factor =
    percent != null
      ? getZoomFactor(percent)
      : Number(document.documentElement.style.getPropertyValue('--app-zoom')) || 1
  return window.innerWidth / (factor || 1)
}

export function getEffectiveViewportHeight(percent?: number): number {
  if (typeof window === 'undefined') return 0
  const factor =
    percent != null
      ? getZoomFactor(percent)
      : Number(document.documentElement.style.getPropertyValue('--app-zoom')) || 1
  return window.innerHeight / (factor || 1)
}

export function normalizeZoomValue(raw: unknown): AppZoomPercent {
  if (raw == null || raw === '') return 100

  if (typeof raw === 'string') {
    let s = raw.trim().toLowerCase()
    if (s.endsWith('%')) s = s.slice(0, -1).trim()
    if (s === 'compact' || s === 'small' || s === 'reduced') return 80
    if (s === 'normal') return 100
    if (s === 'comfortable' || s === 'large' || s === 'enlarged') return 110

    const asFloat = Number(s)
    if (Number.isFinite(asFloat) && asFloat > 0 && asFloat <= 5 && String(s).includes('.')) {
      return normalizeZoomValue(Math.round(asFloat * 100))
    }
    raw = s
  }

  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0 && raw <= 5 && !Number.isInteger(raw)) {
    return normalizeZoomValue(Math.round(raw * 100))
  }

  const n = Math.round(Number(raw))
  if (ZOOM_LEVELS.includes(n as AppZoomPercent)) return n as AppZoomPercent
  return 100
}

/** @deprecated alias */
export const parseAppZoom = normalizeZoomValue

export function getStoredAppZoom(): AppZoomPercent {
  try {
    const modern = localStorage.getItem(APP_ZOOM_KEY)
    if (modern != null && String(modern).trim() !== '') {
      return normalizeZoomValue(modern)
    }
    for (const key of APP_ZOOM_LEGACY_KEYS) {
      const legacy = localStorage.getItem(key)
      if (legacy != null && String(legacy).trim() !== '') {
        const migrated = normalizeZoomValue(legacy)
        try {
          localStorage.setItem(APP_ZOOM_KEY, String(migrated))
        } catch {
          /* ignore */
        }
        return migrated
      }
    }
  } catch {
    /* ignore */
  }
  return 100
}

export function zoomStepDown(current: number): AppZoomPercent {
  const idx = ZOOM_LEVELS.indexOf(normalizeZoomValue(current))
  if (idx <= 0) return ZOOM_LEVELS[0]
  return ZOOM_LEVELS[idx - 1]
}

export function zoomStepUp(current: number): AppZoomPercent {
  const idx = ZOOM_LEVELS.indexOf(normalizeZoomValue(current))
  if (idx < 0) return 100
  if (idx >= ZOOM_LEVELS.length - 1) return ZOOM_LEVELS[ZOOM_LEVELS.length - 1]
  return ZOOM_LEVELS[idx + 1]
}

export function canZoomOut(current: number): boolean {
  return normalizeZoomValue(current) > ZOOM_LEVELS[0]
}

export function canZoomIn(current: number): boolean {
  return normalizeZoomValue(current) < ZOOM_LEVELS[ZOOM_LEVELS.length - 1]
}

function clearLegacyArtifacts(root: HTMLElement | null) {
  const html = document.documentElement
  const body = document.body

  html.style.removeProperty('zoom')
  html.style.removeProperty('--ui-scale')
  html.style.removeProperty('font-size')
  delete html.dataset.uiSize
  delete html.dataset.uiZoom

  body.style.removeProperty('zoom')
  body.style.removeProperty('width')
  body.style.removeProperty('min-height')
  body.style.removeProperty('transform')
  body.style.removeProperty('transform-origin')

  if (!root) return
  root.style.removeProperty('zoom')
  root.style.removeProperty('width')
  root.style.removeProperty('min-height')
  root.style.removeProperty('max-width')
  root.style.removeProperty('transform')
  root.style.removeProperty('transform-origin')
  root.style.removeProperty('height')
  delete root.dataset.appZoom
  root.classList.remove('app-zoom-root')
}

function setZoomCssVars(percent: AppZoomPercent) {
  const factor = getZoomFactor(percent)
  const inverse = getInverseZoomFactor(percent)
  const html = document.documentElement

  html.dataset.appZoom = String(percent)
  html.style.setProperty('--app-zoom', String(factor))
  html.style.setProperty('--app-zoom-factor', String(factor))
  html.style.setProperty('--app-zoom-inverse', String(inverse))
  html.style.setProperty('--app-virtual-width', '100%')
  html.style.setProperty('--app-virtual-height', `calc(100dvh / ${factor})`)
}

/**
 * Apply zoom CSS variables and mark the canvas element.
 * Prefer passing the `.app-zoom-canvas` node; falls back to query.
 */
export function applyAppZoom(percent: number, canvasEl?: HTMLElement | null) {
  if (typeof document === 'undefined') return

  const zoom = normalizeZoomValue(percent)
  const root = document.getElementById('root')
  clearLegacyArtifacts(root)
  setZoomCssVars(zoom)

  const canvas =
    canvasEl
    || document.querySelector<HTMLElement>('.app-zoom-canvas')

  if (canvas) {
    canvas.dataset.appZoom = String(zoom)
    canvas.style.removeProperty('zoom')
    canvas.style.removeProperty('width')
    canvas.style.removeProperty('min-height')
    canvas.style.removeProperty('transform')
  }
}

export function setStoredAppZoom(percent: number) {
  const zoom = normalizeZoomValue(percent)
  try {
    localStorage.setItem(APP_ZOOM_KEY, String(zoom))
  } catch {
    /* ignore */
  }
  applyAppZoom(zoom)
  if (typeof window !== 'undefined') {
    window.requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'))
    })
  }
}
