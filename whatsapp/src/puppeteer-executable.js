/**
 * Resolve Chromium/Chrome for Puppeteer across Windows (local) and Linux (Railway/Docker).
 */
const fs = require('fs')
const path = require('path')

function looksLikeWindowsExecutablePath(value) {
  const s = String(value || '').trim()
  if (!s) return false
  // Drive letter (C:\...) or UNC (\\server\...) or *.exe with backslashes
  return /^[A-Za-z]:[\\/]/.test(s) || s.startsWith('\\\\') || /\\.*\.exe$/i.test(s)
}

/**
 * @param {{
 *   platform?: NodeJS.Platform,
 *   env?: NodeJS.ProcessEnv,
 *   cwd?: string,
 *   existsSync?: (p: string) => boolean,
 * }} [options]
 * @returns {string}
 */
function resolvePuppeteerExecutablePath(options = {}) {
  const platform = options.platform || process.platform
  const env = options.env || process.env
  const cwd = options.cwd || process.cwd()
  const existsSync = options.existsSync || ((p) => fs.existsSync(p))
  const resolvePath = (p) => (path.isAbsolute(p) ? p : path.resolve(cwd, p))

  const configuredPath = String(
    env.PUPPETEER_EXECUTABLE_PATH
    || env.CHROME_BIN
    || '',
  ).trim()

  if (configuredPath) {
    // Linux/Railway: Windows Chrome path is not absolute → path.resolve turns it into
    // "/app/C:\\Program Files\\..." which never exists. Ignore and use Linux fallbacks.
    if (platform !== 'win32' && looksLikeWindowsExecutablePath(configuredPath)) {
      console.warn('[iadis-wa] ignoring Windows PUPPETEER_EXECUTABLE_PATH on non-Windows host', {
        configured_path: configuredPath,
        platform,
      })
    } else {
      const resolvedConfiguredPath = resolvePath(configuredPath)
      if (existsSync(resolvedConfiguredPath)) {
        return resolvedConfiguredPath
      }
      console.warn('[iadis-wa] configured PUPPETEER_EXECUTABLE_PATH was not found, trying local browser fallbacks', {
        configured_path: resolvedConfiguredPath,
      })
    }
  }

  if (platform === 'win32') {
    const candidates = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ]
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate
    }
  } else {
    const candidates = [
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
    ]
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate
    }
  }

  return ''
}

module.exports = {
  looksLikeWindowsExecutablePath,
  resolvePuppeteerExecutablePath,
}
