/**
 * Progressive booking field extraction — Darija Latin name/city/complaint fixes.
 */
const assert = require('assert')
const path = require('path')
const os = require('os')
const fs = require('fs')

const {
  extractBulkBookingFields,
  extractIntroducedName,
  extractTargetPersonName,
  looksLikeClinicLocationQuestion,
} = require('../src/crm/extract')
const { resolveMoroccanCity } = require('../src/crm/morocco-cities')
const { transliterateNameToArabic, displayNameArabic } = require('../src/crm/name-transliteration')
const { complaintToArabic } = require('../src/crm/complaint-display')
const { resolveService } = require('../src/crm/services')
const { serviceArabicLabel } = require('../src/voice-nlu/intent-table')
const { motifDisplayValue } = require('../src/crm/messages')
const { checkCustomerData } = require('../src/crm/checkCustomerData')
const { createCrmService } = require('../src/crm')

function assertNoDiagnosis(text) {
  const n = String(text || '').toLowerCase()
  assert.ok(!/\b(carie|caries|infection|absces|abcès|pulpite)\b/.test(n), `invented diagnosis in: ${text}`)
}

function joinReplies(turn) {
  const parts = []
  if (turn?.forceReply) parts.push(String(turn.forceReply))
  if (Array.isArray(turn?.replies)) parts.push(...turn.replies.map(String))
  return parts.join('\n')
}

async function main() {
  console.log('--- name extraction ---')
  assert.strictEqual(extractIntroducedName('Smiti Salim Zouhairi').full_name, 'Salim Zouhairi')
  assert.strictEqual(extractIntroducedName('Smiti salim zouhairi 3andi mochkil f snani').full_name, 'Salim Zouhairi')
  assert.strictEqual(extractIntroducedName('ana smiti Salim Zouhairi').full_name, 'Salim Zouhairi')
  assert.strictEqual(extractIntroducedName('سميتي سليم زهيري').full_name, 'سليم زهيري')
  assert.ok(String(extractTargetPersonName('khoya smito Yassine Zouhairi')).includes('Yassine'))
  assert.notStrictEqual(
    extractIntroducedName('Smiti Salim Zouhairi').full_name,
    extractTargetPersonName('khoya smito Yassine Zouhairi'),
  )

  console.log('--- transliteration ---')
  assert.strictEqual(transliterateNameToArabic('Salim Zouhairi'), 'سليم زهيري')
  assert.strictEqual(displayNameArabic('Salim Zouhairi'), 'سليم زهيري')

  console.log('--- city context ---')
  assert.ok(looksLikeClinicLocationQuestion('Ntoma fin kaynin ?'))
  assert.strictEqual(extractBulkBookingFields('Ntoma fin kaynin ?').city, null)
  assert.strictEqual(extractBulkBookingFields('Ah Casa ana kayn f kenitra').city, 'Kénitra')
  assert.strictEqual(
    extractBulkBookingFields('khoya kayn f casa walakin ana saken f kenitra').city,
    'Kénitra',
  )
  assert.strictEqual(extractBulkBookingFields('ana saken f kenitra').city, 'Kénitra')
  assert.strictEqual(extractBulkBookingFields('ana saken f casa').city, 'Casablanca')
  assert.strictEqual(extractBulkBookingFields('ana saken f AtlantisCityXYZ').city, null)
  assert.strictEqual(resolveMoroccanCity('AtlantisCityXYZ'), null)

  console.log('--- fuzzy city ---')
  assert.strictEqual(resolveMoroccanCity('kenitra'), 'Kénitra')
  assert.strictEqual(resolveMoroccanCity('kénitra'), 'Kénitra')
  assert.strictEqual(resolveMoroccanCity('knetra'), 'Kénitra')
  assert.strictEqual(resolveMoroccanCity('القنيطرة'), 'Kénitra')
  assert.strictEqual(resolveMoroccanCity('casa'), 'Casablanca')

  console.log('--- complaint vs service ---')
  {
    const burn = extractBulkBookingFields('3andi 7ri9 f darssa diali')
    assert.strictEqual(burn.problem, 'Urgences dentaires')
    assert.match(String(burn.problem_details), /7ri9/i)
    assert.notStrictEqual(burn.problem_details, 'Urgences dentaires')
    assertNoDiagnosis(burn.problem_details)
    assert.strictEqual(serviceArabicLabel('Urgences dentaires'), 'علاج حالات ألم الأسنان المستعجلة')
    const display = motifDisplayValue(burn, 'darija')
    assert.match(display, /ألم ف الضرس/)
    assert.ok(!/^علاج حالات ألم الأسنان المستعجلة$/.test(display))
    assert.strictEqual(complaintToArabic('3andi 7ri9 f darssa diali'), 'ألم ف الضرس')
  }

  {
    const pain = extractBulkBookingFields('darssa kadarni')
    assert.strictEqual(pain.problem, 'Urgences dentaires')
    assertNoDiagnosis(pain.problem_details)
  }

  console.log('--- other services ---')
  assert.strictEqual(resolveService('bghit appareil lsnani').service, 'Orthodontie')
  assert.strictEqual(resolveService('lta7ya katnzeff').service, 'Soins des gencives')
  assert.strictEqual(resolveService('bghit nbyed snani').service, 'Blanchiment des dents')
  assert.strictEqual(resolveService('bghit n7yed ljir').service, 'Détartrage')
  assert.strictEqual(resolveService('3andi tssous').service, 'Soins dentaires et traitement des caries')
  assert.strictEqual(resolveService('bghit facettes').service, 'Facettes dentaires')
  assert.strictEqual(resolveService('wldi khaso tbib snan').service, 'Dentisterie pédiatrique')

  console.log('--- progressive scenario via CRM seed ---')
  const tmp = path.join(os.tmpdir(), `hel-progressive-fields-${Date.now()}.sqlite`)
  const crm = createCrmService({ dbPath: tmp })
  const chat = '212600000777@c.us'
  const conv = `main:${chat}`

  await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: 'Smiti salim zouhairi 3andi mochkil f snani',
    languageHint: 'darija',
  })
  await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: '3andi 7ri9 f darssa diali',
    languageHint: 'darija',
  })
  await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: 'Ntoma fin kaynin ?',
    languageHint: 'darija',
  })
  await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: 'Ah Casa ana kayn f kenitra',
    languageHint: 'darija',
  })
  const turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: 'Safi ghadi nakhod rendez-vous hna f whatsapp ca marche',
    languageHint: 'darija',
  })

  assert.ok(turn?.lead, 'lead missing')
  assert.strictEqual(turn.lead.full_name, 'Salim Zouhairi')
  assert.strictEqual(turn.lead.city, 'Kénitra')
  assert.strictEqual(turn.lead.problem, 'Urgences dentaires')
  assert.match(String(turn.lead.problem_details || ''), /7ri9|darssa|mochkil/i)
  assert.notStrictEqual(turn.lead.city, 'Casablanca')

  const missing = checkCustomerData(turn.lead).missing
  assert.ok(!missing.includes('full_name'), `should not re-ask name, missing=${missing}`)
  assert.ok(!missing.includes('city'), `should not re-ask city, missing=${missing}`)
  assert.ok(!missing.includes('problem'), `should not re-ask problem, missing=${missing}`)

  const replies = joinReplies(turn)
  assert.ok(!/• الاسم الكامل/.test(replies) || turn.lead.full_name === 'Salim Zouhairi')
  assert.strictEqual(transliterateNameToArabic(turn.lead.full_name), 'سليم زهيري')
  assert.strictEqual(serviceArabicLabel(turn.lead.problem), 'علاج حالات ألم الأسنان المستعجلة')

  try {
    fs.rmSync(tmp, { force: true })
    fs.rmSync(`${tmp}-wal`, { force: true })
    fs.rmSync(`${tmp}-shm`, { force: true })
  } catch {
    // ignore
  }

  console.log('OK progressive-booking-fields-test')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
