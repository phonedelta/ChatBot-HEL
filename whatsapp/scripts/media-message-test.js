/**
 * Media message persistence + phone coercion smoke tests.
 */
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createCrmService } = require('../src/crm')
const {
  coerceReliablePhone,
  extractPhoneFromWaContact,
  parseWhatsAppId,
} = require('../src/crm/smart/contact-resolver')

async function run() {
  assert.strictEqual(coerceReliablePhone('0612345678'), '+212612345678')
  assert.strictEqual(coerceReliablePhone('200940212715738@lid'), null)
  assert.strictEqual(extractPhoneFromWaContact({
    id: { _serialized: '200940212715738@lid', user: '200940212715738' },
    number: '200940212715738',
  }), null)
  assert.ok(parseWhatsAppId('212612345678@c.us').e164)

  const tmpDb = path.join(os.tmpdir(), `hel-media-${Date.now()}.sqlite`)
  const crm = createCrmService({ dbPath: tmpDb })
  const chat = '212611122233@c.us'
  const conv = crm.smart.getOrCreateConversation({ external_key: chat })

  const mediaDir = path.join(os.tmpdir(), `hel-media-files-${Date.now()}`)
  fs.mkdirSync(mediaDir, { recursive: true })
  const mediaPath = path.join(mediaDir, 'test.png')
  // minimal 1x1 png
  fs.writeFileSync(mediaPath, Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ))

  const relative = path.relative(process.cwd(), mediaPath).replace(/\\/g, '/')
  const msg = crm.smart.addMessage(conv.id, {
    direction: 'outbound',
    author_type: 'human',
    author_name: 'Assistante',
    body: 'Plan d’accès',
    message_type: 'image',
    media_path: relative,
    media_mime: 'image/png',
    media_filename: 'test.png',
    media_size: fs.statSync(mediaPath).size,
  })

  assert.strictEqual(msg.message_type, 'image')
  assert.ok(msg.media_url)
  assert.ok(msg.has_media)

  const listed = crm.smart.listMessages(conv.id)
  assert.ok(listed.some((m) => m.id === msg.id && m.message_type === 'image'))

  try {
    fs.unlinkSync(tmpDb)
    fs.unlinkSync(`${tmpDb}-wal`)
    fs.unlinkSync(`${tmpDb}-shm`)
  } catch { /* ignore */ }

  console.log('media-message tests OK')
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
