/**
 * Entity extraction for dental WhatsApp NLU.
 */

/**
 * @param {string} text
 * @param {string[]} canonicalTokens
 * @returns {Record<string, any>}
 */
function extractEntities(text, canonicalTokens = []) {
  const source = String(text || '')
  const lower = source.toLowerCase()
  const set = new Set((canonicalTokens || []).map((item) => String(item || '').toLowerCase()))

  /** @type {Record<string, any>} */
  const entities = {}

  if (set.has('douleur') || /\b(wje3|waj3|وجع|douleur|mal)\b/i.test(source)) {
    entities.douleur = true
    if (/\b(kbii?r|forte?|beaucoup|bzaf|بزاف)\b/i.test(lower)) {
      entities.intensite_douleur = 'forte'
    }
  }

  if (set.has('dent') || set.has('molaire') || /\b(dent|ders|drass|سنان|ضرس|sinn)\b/i.test(source)) {
    entities.traitement_concerne = entities.traitement_concerne || 'dent'
    entities.dent = true
  }

  if (set.has('urgence') || set.has('gonflement') || /\b(urgence|nafkha|نفخة)\b/i.test(source)) {
    entities.urgence = true
  }

  if (set.has('rendez-vous') || /\b(rdv|rendez|موعد)\b/i.test(source)) {
    entities.demande_rdv = true
  }

  if (set.has('implant')) {
    entities.traitement_demande = 'implant'
  } else if (set.has('appareil')) {
    entities.traitement_demande = 'appareil_dentaire'
  } else if (set.has('blanchiment')) {
    entities.traitement_demande = 'blanchiment'
  } else if (set.has('extraire')) {
    entities.traitement_demande = 'extraction'
  }

  if (set.has('docteur') || /\b(docteur|tbib|dentiste|طبيب)\b/i.test(source)) {
    entities.medecin_demande = true
  }

  // Relative dates
  if (set.has('demain') || /\b(ghdda|غدا|demain)\b/i.test(source)) {
    entities.date = 'demain'
  } else if (set.has('aujourd_hui') || /\b(lyoum|اليوم|aujourd)/i.test(source)) {
    entities.date = "aujourd'hui"
  } else {
    const dateMatch = source.match(/\b(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)\b/)
    if (dateMatch) {
      entities.date = dateMatch[1]
    }
  }

  const timeMatch = source.match(/\b([01]?\d|2[0-3])[:hH]([0-5]\d)\b/)
    || source.match(/\b([01]?\d|2[0-3])\s*h(?:\s*([0-5]\d))?\b/i)
  if (timeMatch) {
    const hh = timeMatch[1]
    const mm = timeMatch[2] || '00'
    entities.heure = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
  }

  const toothNumber = source.match(/\b(?:dent|رقم|num(?:ero|éro)?)\s*(\d{1,2})\b/i) || source.match(/\b([1-4]\d)\b/)
  if (toothNumber && Number(toothNumber[1]) >= 11 && Number(toothNumber[1]) <= 48) {
    entities.numero_dent = Number(toothNumber[1])
  }

  const ageMatch = source.match(/\b(\d{1,2})\s*(ans|سنة|سنین|سنين)\b/i)
  if (ageMatch) {
    entities.age = Number(ageMatch[1])
  }

  const nameMatch = source.match(/\b(?:je m'appelle|ismi|سميتي|smiti|ana)\s+([A-Za-zÀ-ÿ\u0600-\u06FF]{2,20})\b/i)
  if (nameMatch) {
    entities.prenom = nameMatch[1]
  }

  return entities
}

module.exports = {
  extractEntities,
}
