/**
 * Knowledge prompt formatting tests.
 */
const assert = require('assert')
const { formatKnowledgeItemsForPrompt } = require('../src/crm/smart/knowledge-prompt')

function run() {
  const empty = formatKnowledgeItemsForPrompt([])
  assert.strictEqual(empty, '')

  const formatted = formatKnowledgeItemsForPrompt([
    { category: 'cabinet', key: 'phone', label: 'Téléphone', value: '(+212) 6 00 00 00 00', status: 'filled' },
    { category: 'horaires', key: 'weekdays', label: 'Lundi – Vendredi', value: '09:00 – 18:00', status: 'filled' },
    { category: 'cabinet', key: 'email', label: 'Email', value: '', status: 'empty' },
  ])

  assert.match(formatted, /Téléphone: \(\+212\) 6 00 00 00 00/)
  assert.match(formatted, /Lundi – Vendredi: 09:00 – 18:00/)
  assert.ok(!formatted.includes('Email:'))

  console.log('knowledge-prompt-test: OK')
}

run()
