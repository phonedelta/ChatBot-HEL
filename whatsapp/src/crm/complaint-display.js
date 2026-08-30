/**
 * Patient complaint display helpers.
 * Keeps raw patient wording in CRM; only builds a faithful Arabic summary for UI.
 * Never invents a medical diagnosis (carie, abcès, infection…).
 */

function normalizeKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Build a short Arabic complaint summary from Latin / Arabic patient text.
 * Returns null when no safe summary can be produced.
 */
function complaintToArabic(details) {
  const exact = String(details || '').trim()
  if (!exact) return null
  if (/[\u0600-\u06FF]/.test(exact) && !/[A-Za-z0-9]/.test(exact)) {
    return exact.slice(0, 160)
  }

  const n = normalizeKey(exact)
  const tooth = /\b(dent|dents|darss|darssa|darsa|ders|derssa|drssa|snan|snani|sni|molaire|ضرس|سن|سنان)\b/.test(n)
    || /ضرس|سن|سنان/.test(exact)
  const gum = /\b(gencive|gencives|lta7ya|lta7ia|l7ya|ltha|lta|lita)\b/.test(n) || /لثة/.test(exact)
  const burn = /\b(7ri9|hri9|7ri9a|brulure|brûlure)\b/.test(n) || /حريق|كايحرق/.test(exact)
  const pain = /\b(douleur|mal|wje3|wja3|lwja3|kadarni|kaderni|kaydrni|katdrni|kaydarni|katdarni)\b/.test(n)
    || /وجع|ألم|كايضر|كاتضر/.test(exact)
  const bleed = /\b(saigne|saignement|katnzeff|katnzef|katdemi|katdmi)\b/.test(n) || /نزيف/.test(exact)

  if (gum && (bleed || pain)) return 'ألم أو نزيف ف اللثة'
  if (tooth && burn) return 'ألم ف الضرس'
  if (tooth && pain) return 'ألم ف الضرس'
  if (burn && tooth) return 'ألم ف الضرس'
  if (pain && tooth) return 'ألم ف الضرس'
  return null
}

module.exports = {
  complaintToArabic,
  normalizeKey,
}
