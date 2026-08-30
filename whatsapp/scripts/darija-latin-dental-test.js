const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  createCrmService,
  checkCustomerData,
} = require('../src/crm')
const {
  extractBulkBookingFields,
  extractCustomerSignals,
  extractPhone,
} = require('../src/crm/extract')
const { isOfficialService, resolveService } = require('../src/crm/services')
const { normalizeDarijaText } = require('../src/voice-nlu/normalize')

function joinReplies(result) {
  if (result.forceReplies && result.forceReplies.length) return result.forceReplies
  return result.forceReply ? [result.forceReply] : []
}

function assertNoDiagnosis(value) {
  const text = String(value || '')
  assert.ok(!/\b(carie|caries|abc[eè]s|pulpite|infection|cavité|cavite)\b/i.test(text))
  assert.ok(!/تسوس|خراج|التهاب العصب/.test(text))
}

function assertMotifFilled(extracted, source, expectedDetails = null) {
  assert.ok(extracted.problem, `motif empty for "${source}"`)
  assert.ok(isOfficialService(extracted.problem), `non-official motif for "${source}": ${extracted.problem}`)
  assert.ok(extracted.problem_details, `details empty for "${source}"`)
  if (expectedDetails != null) {
    assert.strictEqual(extracted.problem_details, expectedDetails)
  }
  assertNoDiagnosis(extracted.problem)
  assertNoDiagnosis(extracted.problem_details)
}

function assertNoMotif(source) {
  const extracted = extractBulkBookingFields(source)
  assert.strictEqual(extracted.problem, null, `false positive motif for "${source}": ${extracted.problem}`)
}

async function runExtractTests() {
  const positives = [
    '3andi darssa kadarni',
    'Darssa kadarni',
    '3andi mochkil diali darssa kat3tini lwja3',
    '3andi darsa kaydarni',
    'drssa katwja3ni',
    '3ndi lwja3 f darssa',
    'sni kaywja3ni',
    'snani kaywja3oni',
    'tksrat lia darsa',
    '3andi mochkil f snani',
    'lta7ya katwja3ni',
    '3andi nfakh 7da darsa',
    'عندي ضرس كايضرني',
    'سناني كيوجعوني',
    'عندي الوجع فالضرس',
    'تكسر ليا ضرس',
    "j'ai une dent qui me fait mal",
    "j'ai mal à une dent",
    "j'ai une douleur à la molaire",
    'une dent est cassée',
    "j'ai mal aux gencives",
  ]

  for (const source of positives) {
    const extracted = extractBulkBookingFields(source)
    assertMotifFilled(extracted, source, source)
    assert.ok(
      String(extracted.problem_details).toLowerCase().includes(source.slice(0, 8).toLowerCase())
      || extracted.problem_details === source
      || /[\u0600-\u06FF]/.test(source),
      `details should stay close to patient wording for "${source}"`,
    )
  }

  const combined = extractBulkBookingFields('0602269407\nDarssa kadarni')
  assert.strictEqual(extractPhone('0602269407\nDarssa kadarni'), combined.phone_number)
  assert.ok(combined.phone_number)
  assert.ok(combined.phone_number.includes('602269407'))
  assert.ok(!/ain|ع|trois/.test(combined.phone_number))
  assertMotifFilled(combined, '0602269407 Darssa kadarni')

  const sameLine = extractBulkBookingFields('0602269407 darssa kadarni')
  assert.ok(sameLine.phone_number)
  assertMotifFilled(sameLine, '0602269407 darssa kadarni')

  const withCity = extractBulkBookingFields('0602269407 darssa kadarni ana f casa')
  assert.ok(withCity.phone_number)
  assertMotifFilled(withCity, '0602269407 darssa kadarni ana f casa')
  assert.strictEqual(withCity.city, 'Casablanca')

  const withSlot = extractBulkBookingFields('darssa kadarni bghit mardi m3a 15h', {
    now: new Date('2026-08-24T10:00:00Z'),
  })
  assertMotifFilled(withSlot, 'darssa kadarni bghit mardi m3a 15h')
  assert.ok(withSlot.appointment_date, 'date missing after Darija motif+slot')
  assert.strictEqual(withSlot.appointment_time, '15:00')

  const normalizedPhone = normalizeDarijaText('0602269407 darssa kadarni')
  assert.match(normalizedPhone.normalizedText, /0602269407/)
  assert.ok(
    normalizedPhone.canonicalTokens.includes('dent')
    || normalizedPhone.canonicalTokens.includes('douleur'),
  )

  const conservative = extractCustomerSignals('3andi darssa kadarni', { conservative: true })
  assertMotifFilled(conservative, 'conservative 3andi darssa kadarni', '3andi darssa kadarni')

  assertNoMotif('ch7al taman dyal implant')
  assertNoMotif('wach katdirou dars l3a9l')
  assertNoMotif('wach 7alin lyom')
  assertNoMotif('fin kayna clinique')
  assertNoMotif('bghit n3rf taman')
  assertNoMotif('wach darssa hiya molaire ?')
  assertNoMotif('bghit n3rf wach katdirou implant')

  const arabicPain = resolveService('عندي ضرس كايضرني')
  assert.ok(arabicPain)
  assert.strictEqual(arabicPain.service, 'Urgences dentaires')

  const frenchPain = resolveService("j'ai une dent qui me fait mal")
  assert.ok(frenchPain)
  assert.strictEqual(frenchPain.service, 'Urgences dentaires')

  console.log('darija latin dental extract: ok')
}

async function startDarijaBooking(crm, conversationId, chatId) {
  const turn = await crm.processCrmTurn({
    conversationId,
    chatId,
    userText: 'bghit rendez-vous',
    languageHint: 'darija',
  })
  assert.strictEqual(turn.lead.stage, 'awaiting_form')
  return turn
}

function missingSection(text) {
  const raw = String(text || '')
  const parts = raw.split(/باقي خاصني|المعلومات الناقصة|Il me manque encore|envoyez-moi uniquement/i)
  return parts.slice(1).join('\n')
}

function assertArabicReply(turn, source) {
  const text = joinReplies(turn).join('\n')
  assert.match(text, /[\u0600-\u06FF]/, `Darija reply must be Arabic script for "${source}"`)
  assert.ok(!/\b(mzyan|fhemt|ba9i|khasni|darssa|kifach)\b/i.test(text), `Latin Darija leaked for "${source}": ${text}`)
}

async function runWorkflowTests() {
  const tmpDb = path.join(os.tmpdir(), `hel-darija-latin-dental-${Date.now()}.sqlite`)
  const crm = createCrmService({ dbPath: tmpDb })

  try {
    const conv1 = 'main:212699900001@c.us'
    await startDarijaBooking(crm, conv1, '212699900001@c.us')
    let turn = await crm.processCrmTurn({
      conversationId: conv1,
      chatId: '212699900001@c.us',
      userText: '3andi darssa kadarni',
      languageHint: 'darija',
    })
    assertMotifFilled(turn.lead, 'workflow 3andi darssa kadarni')
    const missing1 = checkCustomerData(turn.lead).missing
    assert.ok(!missing1.includes('problem'), 'problem still missing after 3andi darssa kadarni')
    assert.ok(missing1.includes('phone_number'))
    const reply1 = joinReplies(turn).join('\n')
    assert.match(reply1, /رقم الهاتف/)
    assert.ok(!/المشكل ديال السنان/.test(missingSection(reply1)))
    assertArabicReply(turn, '3andi darssa kadarni')

    const conv2 = 'main:212699900002@c.us'
    await startDarijaBooking(crm, conv2, '212699900002@c.us')
    turn = await crm.processCrmTurn({
      conversationId: conv2,
      chatId: '212699900002@c.us',
      userText: 'Darssa kadarni',
      languageHint: 'darija',
    })
    assertMotifFilled(turn.lead, 'workflow Darssa kadarni')
    assert.ok(!checkCustomerData(turn.lead).missing.includes('problem'))
    assert.ok(!/المشكل ديال السنان/.test(missingSection(joinReplies(turn).join('\n'))))

    const conv3 = 'main:212699900003@c.us'
    await startDarijaBooking(crm, conv3, '212699900003@c.us')
    turn = await crm.processCrmTurn({
      conversationId: conv3,
      chatId: '212699900003@c.us',
      userText: '0602269407\nDarssa kadarni',
      languageHint: 'darija',
    })
    assert.ok(turn.lead.phone_number)
    assert.ok(String(turn.lead.phone_number).includes('602269407'))
    assertMotifFilled(turn.lead, 'workflow phone+motif')
    const missing3 = checkCustomerData(turn.lead).missing
    assert.ok(!missing3.includes('problem'))
    assert.ok(!missing3.includes('phone_number'))
    const reply3 = joinReplies(turn).join('\n')
    const missingReply3 = missingSection(reply3)
    assert.ok(!/المشكل ديال السنان/.test(missingReply3))
    assert.ok(!/رقم الهاتف/.test(missingReply3))

    const conv4 = 'main:212699900004@c.us'
    await startDarijaBooking(crm, conv4, '212699900004@c.us')
    turn = await crm.processCrmTurn({
      conversationId: conv4,
      chatId: '212699900004@c.us',
      userText: '3andi mochkil diali darssa kat3tini lwja3',
      languageHint: 'darija',
    })
    assertMotifFilled(turn.lead, 'workflow long darija latin')
    assert.ok(!checkCustomerData(turn.lead).missing.includes('problem'))

    const convSeed = 'main:212699900030@c.us'
    await crm.processCrmTurn({
      conversationId: convSeed,
      chatId: '212699900030@c.us',
      userText: '3andi darssa kadarni',
      languageHint: 'darija',
    })
    turn = await crm.processCrmTurn({
      conversationId: convSeed,
      chatId: '212699900030@c.us',
      userText: 'bghit rendez-vous',
      languageHint: 'darija',
    })
    assertMotifFilled(turn.lead, 'seed before BOOK_APPOINTMENT')
    assert.ok(!checkCustomerData(turn.lead).missing.includes('problem'))
    assert.ok(!/المشكل ديال السنان/.test(missingSection(joinReplies(turn).join('\n'))))
    assertArabicReply(turn, 'seed then bghit rendez-vous')

    const convFix = 'main:212699900031@c.us'
    await startDarijaBooking(crm, convFix, '212699900031@c.us')
    await crm.processCrmTurn({
      conversationId: convFix,
      chatId: '212699900031@c.us',
      userText: 'darssa kadarni',
      languageHint: 'darija',
    })
    turn = await crm.processCrmTurn({
      conversationId: convFix,
      chatId: '212699900031@c.us',
      userText: 'la, mochkil f l lta7ya',
      languageHint: 'darija',
    })
    assert.strictEqual(turn.lead.problem, 'Soins des gencives')
    assert.match(String(turn.lead.problem_details), /lta7ya/i)

    const convAr = 'main:212699900033@c.us'
    await startDarijaBooking(crm, convAr, '212699900033@c.us')
    turn = await crm.processCrmTurn({
      conversationId: convAr,
      chatId: '212699900033@c.us',
      userText: 'عندي ضرس كايضرني',
      languageHint: 'darija',
    })
    assertMotifFilled(turn.lead, 'arabic tooth pain')
    assert.ok(!checkCustomerData(turn.lead).missing.includes('problem'))

    const convFr = 'main:212699900034@c.us'
    await crm.processCrmTurn({
      conversationId: convFr,
      chatId: '212699900034@c.us',
      userText: 'je veux un rendez-vous',
      languageHint: 'fr',
    })
    turn = await crm.processCrmTurn({
      conversationId: convFr,
      chatId: '212699900034@c.us',
      userText: "j'ai une dent qui me fait mal",
      languageHint: 'fr',
    })
    assertMotifFilled(turn.lead, 'french tooth pain')
    assert.ok(!checkCustomerData(turn.lead).missing.includes('problem'))

    const convAdmin = 'main:212699900029@c.us'
    await startDarijaBooking(crm, convAdmin, '212699900029@c.us')
    turn = await crm.processCrmTurn({
      conversationId: convAdmin,
      chatId: '212699900029@c.us',
      userText: 'ch7al taman dyal implant',
      languageHint: 'darija',
    })
    assert.strictEqual(turn.lead.problem, null)

    console.log('darija latin dental workflow: ok')
  } finally {
    try {
      fs.rmSync(tmpDb, { force: true })
      fs.rmSync(`${tmpDb}-wal`, { force: true })
      fs.rmSync(`${tmpDb}-shm`, { force: true })
    } catch {
      // ignore cleanup errors on Windows locks
    }
  }
}

async function run() {
  await runExtractTests()
  await runWorkflowTests()
  console.log('darija latin dental: ok')
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
