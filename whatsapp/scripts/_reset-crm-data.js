/**
 * Wipe operational CRM data; keep dashboard users + clinic config seeds.
 * Usage: node scripts/_reset-crm-data.js [--media]
 */
const path = require('path')
const { resetOperationalCrmData } = require('../src/crm/reset-operational-data')

const clearMedia = process.argv.includes('--media')

const result = resetOperationalCrmData({
  rootDir: path.join(__dirname, '..'),
  clearMedia,
})

if (result.skipped) {
  console.log('No DB at', result.dbPath, '— nothing to reset')
  process.exit(0)
}

console.log('DB:', result.dbPath)
for (const row of result.clearedTables) {
  console.log(`cleared ${row.table}: ${row.rows} → 0`)
}
if (result.extras.length) {
  console.log('cleared extras:', result.extras.join(', '))
}
console.log('Reset OK — kept:', result.keptTables.join(', '))
