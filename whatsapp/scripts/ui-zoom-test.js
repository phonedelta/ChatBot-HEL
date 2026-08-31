/**
 * App zoom unit tests.
 * Run: node scripts/ui-zoom-test.js
 */
const assert = require('assert')
const path = require('path')
const fs = require('fs')

const src = fs.readFileSync(
  path.join(__dirname, '../dashboard-app/src/lib/app-zoom.ts'),
  'utf8',
)
const css = fs.readFileSync(
  path.join(__dirname, '../dashboard-app/src/index.css'),
  'utf8',
)
const zoomRoot = fs.readFileSync(
  path.join(__dirname, '../dashboard-app/src/components/layout/AppZoomRoot.tsx'),
  'utf8',
)
const shell = fs.readFileSync(
  path.join(__dirname, '../dashboard-app/src/components/layout/AppShell.tsx'),
  'utf8',
)
const sidebar = fs.readFileSync(
  path.join(__dirname, '../dashboard-app/src/components/layout/Sidebar.tsx'),
  'utf8',
)

const ZOOM_LEVELS = [25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500]

function normalizeZoomValue(raw) {
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
  const n = Math.round(Number(raw))
  if (ZOOM_LEVELS.includes(n)) return n
  return 100
}

function getInverseZoomFactor(percent) {
  const z = normalizeZoomValue(percent)
  return z ? 100 / z : 1
}

function zoomStepDown(current) {
  const idx = ZOOM_LEVELS.indexOf(normalizeZoomValue(current))
  if (idx <= 0) return ZOOM_LEVELS[0]
  return ZOOM_LEVELS[idx - 1]
}

function zoomStepUp(current) {
  const idx = ZOOM_LEVELS.indexOf(normalizeZoomValue(current))
  if (idx < 0) return 100
  if (idx >= ZOOM_LEVELS.length - 1) return ZOOM_LEVELS[ZOOM_LEVELS.length - 1]
  return ZOOM_LEVELS[idx + 1]
}

function run() {
  assert.strictEqual(zoomStepDown(100), 90)
  assert.strictEqual(zoomStepDown(90), 80)
  assert.strictEqual(zoomStepUp(100), 110)
  assert.strictEqual(getInverseZoomFactor(80), 1.25)
  assert.strictEqual(normalizeZoomValue('80%'), 80)

  assert.ok(css.includes('.app-zoom-viewport'), 'viewport wrapper')
  assert.ok(css.includes('.app-zoom-canvas'), 'zoom canvas')
  assert.ok(css.includes('zoom: var(--app-zoom)'), 'canvas uses CSS zoom var')
  // Width must be 100% — Chrome expands under zoom; calc(100%/zoom) double-compensates
  assert.ok(/\.app-zoom-canvas\s*\{[^}]*\bwidth:\s*100%;/s.test(css), 'canvas width 100% (no double width comp)')
  assert.ok(
    !/\.app-zoom-canvas\s*\{[^}]*width:\s*calc\(100%\s*\/\s*var\(--app-zoom\)\)/s.test(css),
    'canvas must not use width calc(100%/zoom)',
  )
  assert.ok(css.includes('min-height: calc(100dvh / var(--app-zoom))'), 'height compensation')
  assert.ok(css.includes('.h-app'), 'h-app utility')
  assert.ok(css.includes('.app-zoom-cover'), 'cover utility')
  assert.ok(!css.includes('transform: scale'), 'no transform scale zoom')

  assert.ok(zoomRoot.includes('app-zoom-viewport'))
  assert.ok(zoomRoot.includes('app-zoom-canvas'))
  assert.ok(shell.includes('min-h-app') || shell.includes('h-app'))
  assert.ok(sidebar.includes('lg:static'))
  assert.ok(src.includes('--app-zoom-inverse'))

  console.log('app-zoom-test: PASS')
}

run()
