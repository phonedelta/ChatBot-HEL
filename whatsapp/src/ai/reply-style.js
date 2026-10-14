/**
 * Reply style = the language AND the script the patient writes in.
 * The conversation language memory only knows "fr" and "darija"; the style adds what it lacks:
 * Darija typed in Latin letters is answered in Latin letters, and English is answered in English.
 */

const REPLY_STYLES = ['fr', 'darija_latin', 'darija_arabic', 'en']

const STYLE_INSTRUCTIONS = {
  fr: 'en français',
  darija_latin: 'en darija marocaine écrite en lettres latines (Arabizi), comme le patient, sans aucune lettre arabe',
  darija_arabic: 'en darija marocaine écrite en lettres arabes',
  en: 'en anglais',
}

const ENGLISH_MARKERS = /\b(the|you|your|i am|i'm|i have|i want|i need|i would|can i|do you|please|thanks|thank you|hello|appointment|tooth|teeth|toothache|tomorrow|today|what|where|when|how much|my name)\b/gi
const FRENCH_MARKERS = /\b(je|j'ai|vous|votre|bonjour|bonsoir|merci|s'il|svp|rendez|est-ce|pour|avec|aujourd'hui|demain|combien|où|quand|mon nom|une|des|les)\b/gi

function countMatches(text, pattern) {
  return (String(text || '').match(pattern) || []).length
}

/** @returns {'arabic'|'latin'|null} null when the text has no letters (a number, an emoji). */
function scriptOf(text) {
  const arabic = countMatches(text, /[؀-ۿ]/g)
  const latin = countMatches(text, /[A-Za-zÀ-ÿ]/g)
  if (arabic >= 2 && arabic >= latin) return 'arabic'
  if (latin >= 2 && arabic === 0) return 'latin'
  return null
}

function lastPatientScript(history) {
  const messages = (Array.isArray(history) ? history : []).filter((item) => item?.role === 'user')
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const script = scriptOf(messages[index].content)
    if (script) return script
  }
  return null
}

function looksEnglish(text) {
  return countMatches(text, ENGLISH_MARKERS) >= 2 && countMatches(text, FRENCH_MARKERS) === 0
}

function looksFrench(text) {
  return countMatches(text, FRENCH_MARKERS) >= 1
}

/**
 * @param {{ language?: string|null, text?: string, history?: Array, previousStyle?: string|null,
 *   aiLanguage?: string|null }} input language is the conversation language memory (fr | darija).
 * @returns {'fr'|'darija_latin'|'darija_arabic'|'en'}
 */
function resolveReplyStyle(input = {}) {
  const text = String(input.text || '')
  const previousStyle = REPLY_STYLES.includes(input.previousStyle) ? input.previousStyle : null

  if (input.language === 'darija' || input.language === 'ar') {
    // A short reply without letters ("11", "0600…") keeps the script used so far.
    const script = scriptOf(text) || lastPatientScript(input.history)
    if (script === 'latin') return 'darija_latin'
    if (script === 'arabic') return 'darija_arabic'
    return previousStyle === 'darija_latin' ? 'darija_latin' : 'darija_arabic'
  }

  const wordCount = text.trim().split(/\s+/).filter(Boolean).length
  if (looksEnglish(text) || (input.aiLanguage === 'en' && wordCount >= 3)) return 'en'
  // "ok" or "yes" does not leave English; a French sentence does.
  if (previousStyle === 'en' && !looksFrench(text)) return 'en'
  return 'fr'
}

function isReplyInStyle(text, style) {
  const raw = String(text || '').trim()
  if (!raw) return false
  const arabic = countMatches(raw, /[؀-ۿ]/g)
  if (style === 'darija_arabic') return arabic > 0
  // Latin-script styles: an Arabic word slipping in means the model ignored the style.
  return arabic <= 2
}

function styleInstruction(style) {
  return STYLE_INSTRUCTIONS[style] || STYLE_INSTRUCTIONS.fr
}

module.exports = {
  REPLY_STYLES,
  isReplyInStyle,
  lastPatientScript,
  looksEnglish,
  resolveReplyStyle,
  scriptOf,
  styleInstruction,
}
