const path = require('path')
const { DatabaseSync } = require('node:sqlite')

const dbPath = path.join(__dirname, '..', 'storage', 'crm.sqlite')
const db = new DatabaseSync(dbPath)
const result = db.prepare(
  "UPDATE appointments SET status = 'non_confirme' WHERE status = 'confirmed'",
).run()

console.log('updated', result.changes)
console.log(db.prepare('SELECT id, status FROM appointments ORDER BY id').all())
db.close()
