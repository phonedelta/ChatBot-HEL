/**
 * Outbound image routing tests (@lid direct send + mime handling).
 * Run: node scripts/dashboard-image-send-test.js
 */
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

function loadIndexHelpers() {
  const file = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8')
  assert.ok(file.includes('direct chat_id image send failed, fallback to phone lookup'), 'direct @lid image send path missing')
  assert.ok(file.includes('toPhone: phone || null'), 'image send must not pass @lid as phone fallback')
  assert.ok(file.includes("'storage', 'tmp-uploads'"), 'upload dir under storage')
}

async function run() {
  loadIndexHelpers()

  const tmpImage = path.join(os.tmpdir(), `hel-img-${Date.now()}.png`)
  fs.writeFileSync(tmpImage, Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ))

  const { MessageMedia } = require('whatsapp-web.js')
  const media = MessageMedia.fromFilePath(tmpImage)
  assert.ok(media.mimetype)

  try { fs.unlinkSync(tmpImage) } catch { /* ignore */ }

  console.log('dashboard-image-send-test: PASS')
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
