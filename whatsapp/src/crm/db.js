/**
 * SQLite persistence for the dental CRM (Node built-in node:sqlite).
 */

const fs = require('fs')
const path = require('path')
const { DatabaseSync } = require('node:sqlite')

/**
 * @param {string} dbPath
 * @returns {DatabaseSync}
 */
function openCrmDatabase(dbPath) {
  const absolute = path.resolve(dbPath)
  fs.mkdirSync(path.dirname(absolute), { recursive: true })

  const db = new DatabaseSync(absolute)
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec('PRAGMA journal_mode = WAL;')

  const schemaPath = path.join(__dirname, 'schema.sql')
  const schema = fs.readFileSync(schemaPath, 'utf8')
  db.exec(schema)

  return db
}

module.exports = {
  openCrmDatabase,
}
