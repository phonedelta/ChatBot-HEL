/**
 * Puppeteer executable path resolution (Windows vs Railway/Linux).
 */
const assert = require('assert')
const {
  looksLikeWindowsExecutablePath,
  resolvePuppeteerExecutablePath,
} = require('../src/puppeteer-executable')

assert.equal(looksLikeWindowsExecutablePath('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'), true)
assert.equal(looksLikeWindowsExecutablePath('/usr/bin/chromium'), false)
assert.equal(looksLikeWindowsExecutablePath(''), false)

const winPath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const resolvedOnLinux = resolvePuppeteerExecutablePath({
  platform: 'linux',
  cwd: '/app',
  env: { PUPPETEER_EXECUTABLE_PATH: winPath },
  existsSync: (p) => p === '/usr/bin/chromium',
})
assert.equal(resolvedOnLinux, '/usr/bin/chromium')
assert.ok(!resolvedOnLinux.includes('Program Files'))
assert.ok(!resolvedOnLinux.startsWith('/app/C:'))

const resolvedDocker = resolvePuppeteerExecutablePath({
  platform: 'linux',
  cwd: '/app',
  env: { PUPPETEER_EXECUTABLE_PATH: '/usr/bin/chromium' },
  existsSync: (p) => p === '/usr/bin/chromium',
})
assert.equal(resolvedDocker, '/usr/bin/chromium')

const resolvedWin = resolvePuppeteerExecutablePath({
  platform: 'win32',
  cwd: 'C:\\Users\\Pc\\app',
  env: { PUPPETEER_EXECUTABLE_PATH: winPath },
  existsSync: (p) => p === winPath,
})
assert.equal(resolvedWin, winPath)

console.log('puppeteer-executable-test: passed')
