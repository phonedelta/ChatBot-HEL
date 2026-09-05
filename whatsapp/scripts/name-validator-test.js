/**
 * Unit tests for patient full-name validation (HEL CRM).
 */
const assert = require('assert')
const {
  validateFullName,
  assessFullNameCandidate,
  validateFullNameCandidate,
  stripPersonNameLabels,
} = require('../src/crm/name-validator')
const { extractBulkBookingFields } = require('../src/crm/extract')
const { createCrmService } = require('../src/crm')
const fs = require('fs')
const os = require('os')
const path = require('path')

function assertInvalid(input, label = input) {
  const v = validateFullName(input)
  assert.strictEqual(v, null, `expected invalid name: ${label}`)
  const a = assessFullNameCandidate(input)
  assert.strictEqual(a.valid, false, `assess valid=false: ${label}`)
}

function assertValid(input, expected = null) {
  const v = validateFullName(input)
  assert.ok(v, `expected valid name: ${input}`)
  if (expected) assert.strictEqual(v, expected)
}

async function run() {
  // Label / instruction prefixes must never stay in CRM fullName
  assert.strictEqual(stripPersonNameLabels('Le Nom Salim Zouhairi'), 'Salim Zouhairi')
  assertValid('Le Nom Salim Zouhairi', 'Salim Zouhairi')
  assertValid('Nom: Salim Zouhairi', 'Salim Zouhairi')
  assertValid('Smiya dialo Salim Zouhairi', 'Salim Zouhairi')
  assertValid('smito Salim Zouhairi', 'Salim Zouhairi')
  assertValid('الاسم Salim Zouhairi', 'Salim Zouhairi')

  // Exact bug
  assertInvalid('Ymkn nakhdo ?')
  assertInvalid('ymkn nakhdo')
  assertInvalid('Ymkn Nakhdo')

  // Identity questions must never become patient names
  assertInvalid('Shkon nta')
  assertInvalid('chkon nta')
  assertInvalid('Chkoun nta')
  assertInvalid('shkoun nti')
  assertInvalid('vous etes qui')
  assertInvalid('qui es-tu')
  const { looksLikeIdentityQuestion } = require('../src/crm/name-validator')
  assert.ok(looksLikeIdentityQuestion('Shkon nta'))
  assert.ok(looksLikeIdentityQuestion('شكون نتا'))
  assert.ok(!looksLikeIdentityQuestion('Salim Zouhairi'))

  // Darija / FR / AR conversational
  assertInvalid('wach kayn ghdda')
  assertInvalid('bghit nakhod rendez vous')
  assertInvalid('je veux réserver')
  assertInvalid('بغيت ناخد موعد')
  assertInvalid('السلام عليكم')
  assertInvalid('merci beaucoup')
  assertInvalid('salam khoya')
  assertInvalid('possible demain')
  assertInvalid('bghit maw3id')
  assertInvalid('fin kaynin')
  assertInvalid('test')
  assertInvalid('wakha')

  // Motifs / villes / heures
  assertInvalid('douleur dentaire')
  assertInvalid('détartrage dentaire')
  assertInvalid('Casablanca')
  assertInvalid('Casablanca Maroc')
  assertInvalid('mardi 15h')
  assertInvalid('+212606677803')

  // Single first name
  assertInvalid('Mohamed')
  assertInvalid('سلمى')

  // Valid names
  assertValid('Amine Benali', 'Amine Benali')
  assertValid('  Amine   Benali ', 'Amine Benali')
  assertValid('Mohamed El Amrani')
  assertValid('Yassine Oulmouden')
  assertValid('محمد العلوي', 'محمد العلوي')
  assertValid('سلمى الإدريسي', 'سلمى الإدريسي')

  // Bulk form with fake name must not accept it
  const badForm = extractBulkBookingFields([
    'Ymkn nakhdo ?',
    'Détartrage',
    '+212600000000',
    'Casablanca',
    'Mardi 15h',
  ].join('\n'), { now: new Date('2026-07-20T10:00:00Z') })
  assert.strictEqual(badForm.full_name, null)

  // Good form
  const goodForm = extractBulkBookingFields([
    'Amine Benali',
    'Détartrage',
    '+212600000000',
    'Casablanca',
    'Mardi 15h',
  ].join('\n'), { now: new Date('2026-07-20T10:00:00Z') })
  assert.strictEqual(goodForm.full_name, 'Amine Benali')

  // AI unavailable → reject ambiguous, never throw
  const aiFail = await validateFullNameCandidate('El Amrani', { ai: null })
  assert.strictEqual(aiFail.valid, false)

  // Existing customer name protected from phrase overwrite via CRM booking
  const tmpDb = path.join(os.tmpdir(), `hel-name-test-${Date.now()}.sqlite`)
  const crm = createCrmService({ dbPath: tmpDb })
  const customer = crm.repo.createOrUpdateCustomer({
    full_name: 'Salim Zouhairi',
    phone_number: '+212611111111',
    city: 'Casablanca',
  })
  assert.strictEqual(customer.full_name, 'Salim Zouhairi')
  let threw = false
  try {
    crm.repo.createOrUpdateCustomer({
      full_name: 'Ymkn nakhdo ?',
      phone_number: '+212611111111',
      city: 'Casablanca',
    })
  } catch {
    threw = true
  }
  assert.ok(threw, 'invalid name must not update customer')
  const still = crm.repo.findCustomerByPhone('+212611111111')
  assert.strictEqual(still.full_name, 'Salim Zouhairi')

  try {
    fs.rmSync(tmpDb, { force: true })
    fs.rmSync(`${tmpDb}-wal`, { force: true })
    fs.rmSync(`${tmpDb}-shm`, { force: true })
  } catch {
    // ignore
  }

  console.log('name-validator test: ok')
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
