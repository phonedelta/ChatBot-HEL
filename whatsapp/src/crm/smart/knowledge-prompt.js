/**
 * Format dashboard knowledge_items for OpenAI / assistant prompts.
 */

const CATEGORY_LABELS = {
  cabinet: 'Cabinet',
  horaires: 'Horaires',
  medecins: 'Praticiens',
  faq: 'Questions fréquentes',
  services: 'Services',
  rdv: 'Rendez-vous',
}

/**
 * @param {Array<{ category?: string, key?: string, label?: string, value?: string|null, status?: string }>} items
 * @returns {string}
 */
function formatKnowledgeItemsForPrompt(items) {
  if (!Array.isArray(items) || !items.length) return ''

  const filled = items.filter((item) => {
    const value = String(item?.value || '').trim()
    return value && (item.status === 'filled' || item.status == null || item.status !== 'empty')
  })
  if (!filled.length) return ''

  const byCategory = new Map()
  for (const item of filled) {
    const cat = String(item.category || 'general').trim() || 'general'
    if (!byCategory.has(cat)) byCategory.set(cat, [])
    byCategory.get(cat).push(item)
  }

  const lines = [
    'Informations officielles du cabinet (mises à jour depuis le dashboard — source authoritative):',
  ]

  for (const [cat, catItems] of byCategory) {
    lines.push(`\n## ${CATEGORY_LABELS[cat] || cat}`)
    for (const item of catItems) {
      const label = String(item.label || item.key || 'Info').trim()
      const value = String(item.value || '').trim()
      lines.push(`- ${label}: ${value}`)
    }
  }

  return lines.join('\n').trim()
}

module.exports = {
  CATEGORY_LABELS,
  formatKnowledgeItemsForPrompt,
}
