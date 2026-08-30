/**
 * New-person booking reset + fullName label cleaning.
 */
const assert = require('assert')
const path = require('path')
const os = require('os')
const fs = require('fs')

const { createCrmService } = require('../src/crm')
const { validateFullName, stripPersonNameLabels } = require('../src/crm/name-validator')
const { askConfirmation, personDisplayName } = require('../src/crm/messages')
const { checkCustomerData } = require('../src/crm/checkCustomerData')

function futureSlotLine() {
  const d = new Date()
  d.setDate(d.getDate() + 4)
  while (d.getDay() === 0) d.setDate(d.getDate() + 1)
  const iso = d.toISOString().slice(0, 10)
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} 11:00`
}

function allText(turn) {
  return [turn?.forceReply, ...(turn?.forceReplies || [])].filter(Boolean).join('\n')
}

async function bookSalim(crm, conv, chat) {
  let turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: 'je veux un rendez-vous',
    languageHint: 'fr',
  })
  const slot = futureSlotLine()
  turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: [
      'Nom : Salim Zouhairi',
      'Téléphone : 0600000001',
      'Ville : Kenitra',
      'Problème : controle',
      `Rendez-vous : ${slot}`,
    ].join('\n'),
    languageHint: 'fr',
  })
  if (turn.lead.stage === 'awaiting_patient') {
    turn = await crm.processCrmTurn({
      conversationId: conv,
      chatId: chat,
      userText: '1',
      languageHint: 'fr',
    })
    turn = await crm.processCrmTurn({
      conversationId: conv,
      chatId: chat,
      userText: [
        'Nom : Salim Zouhairi',
        'Téléphone : 0600000001',
        'Ville : Kenitra',
        'Problème : controle',
        `Rendez-vous : ${slot}`,
      ].join('\n'),
      languageHint: 'fr',
    })
  }
  assert.strictEqual(turn.lead.stage, 'confirmation', `expected confirmation got ${turn.lead.stage}`)
  turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: 'oui',
    languageHint: 'fr',
  })
  assert.ok(turn.booking?.customer?.id, 'Salim booking missing')
  return turn.booking.customer
}

async function main() {
  console.log('--- name label cleaning ---')
  assert.strictEqual(stripPersonNameLabels('Le Nom Salim Zouhairi'), 'Salim Zouhairi')
  assert.strictEqual(validateFullName('Le Nom Salim Zouhairi'), 'Salim Zouhairi')
  assert.strictEqual(validateFullName('Nom: Salim Zouhairi'), 'Salim Zouhairi')
  assert.strictEqual(validateFullName('Smiya dialo Salim Zouhairi'), 'Salim Zouhairi')
  assert.strictEqual(validateFullName('smito Salim Zouhairi'), 'Salim Zouhairi')
  const summary = askConfirmation({
    full_name: 'Le Nom Salim Zouhairi',
    phone_number: '+212600000001',
    city: 'Kénitra',
    problem: 'Consultation',
    problem_details: 'controle',
    appointment_date: '2026-09-03',
    appointment_time: '11:00',
  }, 'darija')
  assert.match(summary, /الاسم: سليم زهيري|الاسم: Salim Zouhairi/)
  assert.ok(!/Le Nom|Smiya Dialo|Nom Salim/i.test(summary))
  assert.strictEqual(
    personDisplayName({ full_name: 'Le Nom Salim Zouhairi' }, 'fr'),
    'Salim Zouhairi',
  )

  const tmp = path.join(os.tmpdir(), `hel-new-person-reset-${Date.now()}.sqlite`)
  const crm = createCrmService({ dbPath: tmp })
  const chat = '212612377001@c.us'
  const conv = `main:${chat}`

  console.log('--- TEST A: choose 2 clears Salim ---')
  const salim = await bookSalim(crm, conv, chat)
  let turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: 'bghit rendez vous jdid',
    languageHint: 'darija',
  })
  assert.strictEqual(turn.lead.stage, 'awaiting_patient')
  assert.match(allText(turn), /شخص جديد|Salim/)
  turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: '2',
    languageHint: 'darija',
  })
  assert.strictEqual(turn.lead.booking_target, 'new_patient')
  assert.strictEqual(turn.lead.selected_patient_id, null)
  assert.strictEqual(turn.lead.full_name, null)
  assert.strictEqual(turn.lead.phone_number, null)
  assert.notStrictEqual(turn.lead.full_name, salim.full_name)
  assert.ok(!phonesLike(turn.lead.phone_number, salim.phone_number))
  // City/problem/slot must not stay as Salim draft leftovers
  assert.strictEqual(turn.lead.appointment_date, null)
  assert.strictEqual(turn.lead.appointment_time, null)
  const missing = checkCustomerData(turn.lead).missing
  assert.ok(missing.includes('full_name'))
  assert.ok(missing.includes('phone_number'))
  assert.ok(!/Salim Zouhairi/.test(allText(turn)) || /شخص جديد|Personne/.test(allText(turn)))

  console.log('--- TEST B: choose 1 prefills Salim ---')
  turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: 'bghit rendez vous jdid',
    languageHint: 'darija',
  })
  turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: '1',
    languageHint: 'darija',
  })
  assert.strictEqual(turn.lead.booking_target, 'existing_patient')
  assert.strictEqual(Number(turn.lead.selected_patient_id), Number(salim.id))
  assert.strictEqual(turn.lead.full_name, 'Salim Zouhairi')

  console.log('--- TEST C: Yassine candidates kept, Salim phone dropped ---')
  turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: 'bghit rendez vous jdid',
    languageHint: 'darija',
  })
  // Seed third-party info before picking new person
  await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: 'khoya smito yassine zouhairi bgha ydir tabyid l asnan howa mn kenitra',
    languageHint: 'darija',
  })
  // Reminder may keep picker; select 2
  turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: '2',
    languageHint: 'darija',
  })
  if (turn.lead.stage === 'awaiting_patient') {
    turn = await crm.processCrmTurn({
      conversationId: conv,
      chatId: chat,
      userText: '2',
      languageHint: 'darija',
    })
  }
  assert.strictEqual(turn.lead.booking_target, 'new_patient')
  assert.strictEqual(turn.lead.selected_patient_id, null)
  assert.strictEqual(turn.lead.full_name, 'Yassine Zouhairi')
  assert.strictEqual(turn.lead.city, 'Kénitra')
  assert.strictEqual(turn.lead.problem, 'Blanchiment des dents')
  assert.ok(!phonesLike(turn.lead.phone_number, salim.phone_number))

  console.log('--- TEST G: jdid after summary starts clean picker ---')
  crm.repo.upsertLead(conv, {
    stage: 'confirmation',
    awaiting_field: 'confirmation',
    booking_target: 'existing_patient',
    selected_patient_id: salim.id,
    full_name: 'Salim Zouhairi',
    phone_number: salim.phone_number,
    city: 'Kénitra',
    problem: 'Consultation',
    appointment_date: '2026-09-10',
    appointment_time: '11:00',
    booking_intent: 1,
  })
  turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: 'Bghit rendez vous jdid',
    languageHint: 'darija',
  })
  assert.strictEqual(turn.lead.stage, 'awaiting_patient')
  assert.strictEqual(turn.lead.selected_patient_id, null)
  assert.strictEqual(turn.lead.full_name, null)
  assert.match(allText(turn), /شخص جديد/)

  console.log('--- TEST H: new_patient not auto-resolved via WhatsApp phone ---')
  turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: 'bghit rendez vous jdid',
    languageHint: 'darija',
  })
  turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: '2',
    languageHint: 'darija',
  })
  assert.strictEqual(turn.lead.booking_target, 'new_patient')
  assert.strictEqual(turn.lead.selected_patient_id, null)
  // Fill only city — must not flip back to Salim via chat phone
  turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: 'ana mn rabat',
    languageHint: 'darija',
  })
  assert.strictEqual(turn.lead.booking_target, 'new_patient')
  assert.strictEqual(turn.lead.selected_patient_id, null)
  assert.notStrictEqual(turn.lead.full_name, 'Salim Zouhairi')

  console.log('--- TEST D: incomplete Salim draft then 2 drops slot ---')
  crm.repo.upsertLead(conv, {
    stage: 'awaiting_patient',
    awaiting_field: 'patient_select',
    booking_target: null,
    selected_patient_id: null,
    full_name: 'Salim Zouhairi',
    phone_number: salim.phone_number,
    city: 'Kénitra',
    problem: 'Consultation',
    appointment_date: '2026-09-10',
    appointment_time: '11:00',
    booking_intent: 1,
    language: 'darija',
    whatsapp_chat_id: chat,
  })
  // Simulate seed pollution: patient typed Salim form earlier without confirming
  crm.repo.logConversation({
    conversation_id: conv,
    whatsapp_chat_id: chat,
    direction: 'inbound',
    message_text: [
      'Nom : Salim Zouhairi',
      'Téléphone : 0600000001',
      'Ville : Kenitra',
      'Problème : controle',
      'Rendez-vous : 10/09/2026 11:00',
    ].join('\n'),
    extracted: {},
    appointment_status: 'awaiting_patient',
  })
  turn = await crm.processCrmTurn({
    conversationId: conv,
    chatId: chat,
    userText: '2',
    languageHint: 'darija',
  })
  assert.strictEqual(turn.lead.booking_target, 'new_patient')
  assert.strictEqual(turn.lead.selected_patient_id, null)
  assert.strictEqual(turn.lead.full_name, null)
  assert.strictEqual(turn.lead.appointment_date, null)
  assert.strictEqual(turn.lead.appointment_time, null)
  assert.ok(!phonesLike(turn.lead.phone_number, salim.phone_number))

  try {
    fs.rmSync(tmp, { force: true })
    fs.rmSync(`${tmp}-wal`, { force: true })
    fs.rmSync(`${tmp}-shm`, { force: true })
  } catch { /* ignore */ }

  console.log('OK new-person-reset-test')
}

function phonesLike(a, b) {
  const left = String(a || '').replace(/\D/g, '')
  const right = String(b || '').replace(/\D/g, '')
  if (!left || !right) return false
  return left.slice(-9) === right.slice(-9)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
