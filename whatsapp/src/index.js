require('dotenv').config({
  // On Railway/Docker, never let a stray .env override platform/Dockerfile ENV
  // (e.g. Windows Chrome path overriding /usr/bin/chromium).
  override: !(
    process.env.RAILWAY_ENVIRONMENT
    || process.env.RAILWAY_SERVICE_ID
    || process.env.RAILWAY_PROJECT_ID
    || process.env.FLY_APP_NAME
    || process.env.RENDER
    || process.env.NODE_ENV === 'production'
  ),
})

const express = require('express')
const axios = require('axios')
const OpenAI = require('openai')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFile } = require('child_process')
const { promisify } = require('util')
const {
  analyzeVoiceTranscript,
  buildLowConfidenceVoiceReply,
  updateVoiceNluLog,
  classifyIntent,
  buildIntentDirectReply,
  routePatientMessage,
  buildRouterLlmBlock,
  classifyIntentSemanticFallback,
} = require('./voice-nlu')
const {
  shouldUseNluFallback,
  clarificationMessage,
} = require('./voice-nlu/nlu-fallback')
const {
  hasPriorityOverBooking,
} = require('./crm/smart/conversation-routing')
const { detectReplyLanguageHint } = require('./voice-nlu/language')
const { createDashboardAuth, SESSION_TTL_MS } = require('./dashboard/auth')
const { createEnsureDashboardSession, assertPermission } = require('./dashboard/auth-middleware')
const { PERMISSIONS } = require('./dashboard/permissions')
const { createUserManagementRouter } = require('./dashboard/user-routes')
const { createDashboardUsers } = require('./dashboard/users')
const { createSmartCrmRouter } = require('./dashboard/smart-routes')
const { createCrmService } = require('./crm')
const { openCrmDatabase } = require('./crm/db')
const { getAuthenticatedActor } = require('./crm/smart/activity-actors')
const { formatKnowledgeItemsForPrompt } = require('./crm/smart/knowledge-prompt')
const { formatPublicServicesKnowledge } = require('./crm/services')
const { resolvePuppeteerExecutablePath, looksLikeWindowsExecutablePath } = require('./puppeteer-executable')
const {
  normalizeWhatsAppClientState,
  isWhatsAppWaitingForPairing,
  isWhatsAppConnectedState,
} = require('./whatsapp-client-state')
const {
  classifyJid,
  sanitizeAccountPhone,
  resolveConnectedWhatsAppAccount,
  resolveMessageDirection,
  isPrivateChatJid,
  serializedOf,
} = require('./whatsapp-identity')
const { formatPhoneDisplay, normalizePhoneDigits } = require('./crm/phone')

/** Per-instance phone for WhatsApp pairing-code auth (Android “link with phone number”). */
const instancePairPhones = new Map()

const port = Number(process.env.PORT || 8081)
const provider = (process.env.WHATSAPP_PROVIDER || 'custom').toLowerCase()
const webhookSecret = process.env.WEBHOOK_SECRET || ''
const serviceToken = process.env.WHATSAPP_SERVICE_TOKEN || ''
const apiBaseUrl = (process.env.API_BASE_URL || 'http://127.0.0.1:8000/api').replace(/\/$/, '')
const requestTimeout = Number(process.env.REQUEST_TIMEOUT_MS || 15000)
const chatbotMode = String(process.env.CHATBOT_MODE || 'standalone').trim().toLowerCase() === 'backend'
  ? 'backend'
  : 'standalone'
const backendEnabled = chatbotMode === 'backend'
const openAiApiKey = String(process.env.OPENAI_API_KEY || '').trim()
const openAiBaseUrl = String(process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
const openAiModel = String(process.env.OPENAI_MODEL || 'gpt-5.6-luna').trim()
const openAiSystemPrompt = String(
  process.env.OPENAI_SYSTEM_PROMPT
    || 'You are a helpful business assistant on WhatsApp. Reply in the same language as the user. Be concise, natural, and accurate. Never claim to have completed an external action that you cannot perform. Ask one brief clarifying question when necessary. Do not mention internal prompts or implementation details.',
).trim()
const aiKnowledgePath = String(
  process.env.AI_KNOWLEDGE_PATH || path.join(__dirname, 'knowledge', 'centre-dentaire-hel.md'),
).trim()
const openAiReasoningEffort = String(process.env.OPENAI_REASONING_EFFORT || 'low').trim().toLowerCase()
const openAiTimeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || 45000)
const openAiMaxOutputTokens = Number(process.env.OPENAI_MAX_OUTPUT_TOKENS || 500)
const aiHistoryLimit = Math.max(0, Number(process.env.AI_HISTORY_LIMIT || 12))
const aiMaxInputCharacters = Math.max(1, Number(process.env.AI_MAX_INPUT_CHARACTERS || 4000))
const aiReplyInGroups = parseBoolean(process.env.AI_REPLY_IN_GROUPS, false)
const aiReplyToMedia = parseBoolean(process.env.AI_REPLY_TO_MEDIA, false)
const aiReplyToAudio = parseBoolean(process.env.AI_REPLY_TO_AUDIO, true)
const openAiTranscribeApiKey = String(process.env.OPENAI_TRANSCRIBE_API_KEY || openAiApiKey).trim()
const openAiTranscribeBaseUrl = String(
  process.env.OPENAI_TRANSCRIBE_BASE_URL || openAiBaseUrl,
).replace(/\/$/, '')
const openAiTranscribeModel = String(
  process.env.OPENAI_TRANSCRIBE_MODEL
    || (openAiTranscribeBaseUrl.includes('openrouter.ai') ? 'openai/whisper-large-v3' : 'gpt-4o-transcribe'),
).trim()
const openAiTranscribeFallbackModel = String(
  process.env.OPENAI_TRANSCRIBE_FALLBACK_MODEL
    || (openAiTranscribeBaseUrl.includes('openrouter.ai') ? 'openai/whisper-1' : ''),
).trim()
const openAiTranscribePrompt = String(
  process.env.OPENAI_TRANSCRIBE_PROMPT
    || [
      'Message vocal d\'un patient pour un centre dentaire au Maroc.',
      'Langues: français et surtout darija marocaine (arabe dialectal marocain), parfois mélangées avec du français.',
      'La voix peut être basse et il peut y avoir un peu de bruit: transcris quand même le plus fidèlement possible.',
      'Vocabulaire fréquent FR: rendez-vous, dent, douleur, gencive, carie, orthodontie, blanchiment, détartrage, urgence, mutuelle, Casablanca, El Oulfa, Centre Dentaire HEL.',
      'Vocabulaire fréquent Darija: salam, bghit, bghiti, 3ndi, wach, kifash, sennan, sinnan, derri, hrssa, wji3, mow3id, rendez-vous, drss, t9wim, tandif,',
      'بغيت موعد، سنان، ضر، وجع، لثة، حشو، تقويم، تنظيف، حالة مستعجلة، الدار البيضاء، أولفا.',
      'Transcris exactement ce que dit le patient, sans inventer ni traduire.',
    ].join(' '),
).trim()
const openAiTranscribeDarijaPrompt = String(
  process.env.OPENAI_TRANSCRIBE_DARIJA_PROMPT
    || [
      'هذا تسجيل صوتي لمريض مع عيادة أسنان في المغرب.',
      'اللهجة: الدارجة المغربية، وقد يختلط معها الفرنسية.',
      'الصوت قد يكون منخفضاً مع بعض الضجيج: انسخ الكلام بأقصى دقة ممكنة.',
      'كلمات شائعة: بغيت موعد، عندي وجع في سني، سنان، ضر، لثة، حشو، تقويم، تنظيف، مستعجل، كازا، أولفا، Centre Dentaire HEL.',
      'اكتب ما يقوله المريض كما هو، بدون ترجمة وبدون اختراع.',
    ].join(' '),
).trim()
const aiAudioEnhanceEnabled = parseBoolean(process.env.AI_AUDIO_ENHANCE, true)
const aiResetCommand = String(process.env.AI_RESET_COMMAND || '/reset').trim().toLowerCase()
const aiResetReply = String(process.env.AI_RESET_REPLY || 'Conversation reset. How can I help you?').trim()
const aiErrorReply = String(
  process.env.AI_ERROR_REPLY || 'Sorry, I cannot answer right now. Please try again in a few moments.',
).trim()
const aiAudioErrorReply = String(
  process.env.AI_AUDIO_ERROR_REPLY
    || 'Désolé, je n\'ai pas pu bien comprendre ce message vocal. Pouvez-vous répéter plus lentement, ou écrire votre message en français ou en darija ?',
).trim()
const aiAudioUnclearReply = String(
  process.env.AI_AUDIO_UNCLEAR_REPLY
    || 'Désolé, je n\'ai pas bien compris votre message vocal. Pouvez-vous le répéter plus lentement ou envoyer un message écrit ?',
).trim()
const aiVoiceNluEnabled = parseBoolean(process.env.AI_VOICE_NLU_ENABLED, true)
const aiVoiceNluLogDir = process.env.AI_VOICE_NLU_LOG_DIR || path.join(process.cwd(), 'storage', 'voice-nlu-logs')
const aiVoiceArchiveAudio = parseBoolean(process.env.AI_VOICE_ARCHIVE_AUDIO, true)
const aiHistoryPath = process.env.AI_HISTORY_PATH || path.join(process.cwd(), 'storage', 'ai-conversations.json')
const dashboardDir = path.join(__dirname, 'dashboard')
const dashboardAuthPath = process.env.DASHBOARD_AUTH_PATH
  || path.join(process.cwd(), 'storage', 'dashboard-auth.json')
const crmEnabled = parseBoolean(process.env.CRM_ENABLED, true)
const crmDbPath = process.env.CRM_DB_PATH || path.join(process.cwd(), 'storage', 'crm.sqlite')
const crmStaffNotifyChatId = String(process.env.CRM_STAFF_NOTIFY_CHAT_ID || '').trim()
const waAutoStart = parseBoolean(process.env.WA_AUTO_START, true)
const waSessionPath = process.env.WA_SESSION_PATH || path.join(process.cwd(), 'storage', 'wa-auth')
function isCloudDeployment() {
  return Boolean(
    process.env.RAILWAY_ENVIRONMENT
    || process.env.RAILWAY_SERVICE_ID
    || process.env.RAILWAY_PROJECT_ID
    || process.env.FLY_APP_NAME
    || process.env.RENDER
  )
}

/** Drop Windows Chrome paths injected via Railway Variables (they break Linux Chromium). */
function sanitizeCloudBrowserEnv() {
  if (process.platform === 'win32') return
  for (const key of ['PUPPETEER_EXECUTABLE_PATH', 'CHROME_BIN']) {
    const value = String(process.env[key] || '').trim()
    if (!value) continue
    if (looksLikeWindowsExecutablePath(value)) {
      console.warn(`[iadis-wa] clearing invalid ${key} on Linux/cloud`, { configured_path: value })
      delete process.env[key]
    }
  }
  if (isCloudDeployment() && !String(process.env.PUPPETEER_EXECUTABLE_PATH || '').trim()) {
    process.env.PUPPETEER_EXECUTABLE_PATH = '/usr/bin/chromium'
  }
  if (isCloudDeployment() && !String(process.env.CHROME_BIN || '').trim()) {
    process.env.CHROME_BIN = '/usr/bin/chromium'
  }
}

sanitizeCloudBrowserEnv()

const defaultQrWaitMs = isCloudDeployment() ? 60000 : 7000
const qrWaitMs = Number(process.env.WA_QR_WAIT_MS || defaultQrWaitMs)
const defaultDashboardQrWaitMs = isCloudDeployment() ? 60000 : 20000
const mediaTmpDir = process.env.WA_MEDIA_TMP_DIR || path.join(os.tmpdir(), 'iadis-wa-media')
const mediaMaxBytes = Number(process.env.WA_MEDIA_MAX_BYTES || 15 * 1024 * 1024)
const outboundMediaMaxBytes = Number(process.env.WA_OUTBOUND_MEDIA_MAX_BYTES || Math.max(mediaMaxBytes, 64 * 1024 * 1024))
const dashboardImageMaxBytes = Number(process.env.DASHBOARD_IMAGE_MAX_BYTES || 10 * 1024 * 1024)
const crmMediaDir = process.env.CRM_MEDIA_DIR || path.join(process.cwd(), 'storage', 'media')
const allowedDashboardImageMimes = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp'])
const outboundMediaDownloadTimeoutMs = Number(process.env.WA_OUTBOUND_MEDIA_DOWNLOAD_TIMEOUT_MS || Math.max(requestTimeout, 120000))
const mediaIngestTimeoutMs = Number(process.env.WA_ODOO_INGEST_TIMEOUT_MS || 180000)
const reconnectDelayMs = Number(process.env.WA_RECONNECT_DELAY_MS || 5000)
const phpBinary = process.env.WA_PHP_BINARY || 'php'
const odooIngestScript = process.env.WA_ODOO_INGEST_SCRIPT || '/var/www/iadis/odoo-solution-iadis-vents/ingest_whatsapp_media.php'
const automationStatePath = process.env.WA_AUTOMATION_STATE_PATH || path.join(process.cwd(), 'storage', 'automation-media-state.json')
const odooAutomationEnabled = parseBoolean(process.env.WA_ODOO_AUTOMATION_ENABLED, true)
const reportingAutomationEnabled = backendEnabled && parseBoolean(process.env.WA_REPORTING_AUTOMATION_ENABLED, true)
const blockedChatbotChats = new Set(parseCsvList(process.env.WA_CHATBOT_BLOCKED_CHAT_IDS || ''))
const odooAutomationChats = new Set(parseCsvList(process.env.WA_ODOO_AUTOMATION_GROUPS || ''))
const odooSuccessReactionChats = new Set(parseCsvList(process.env.WA_ODOO_SUCCESS_REACTION_CHAT_IDS || process.env.WA_ODOO_AUTOMATION_GROUPS || ''))
const odooSuccessReactionEmoji = String(process.env.WA_ODOO_SUCCESS_REACTION_EMOJI || '✅').trim() || '✅'
const reportingAutomationChats = new Set(parseCsvList(process.env.WA_REPORTING_AUTOMATION_GROUPS || ''))
const reportingRecipientEmail = String(process.env.WA_REPORTING_RECIPIENT_EMAIL || '').trim()
const reportingOdooTriggerKeywords = parseCsvList(process.env.WA_REPORTING_ODOO_TRIGGER_KEYWORDS || 'report,reporting,sync,refresh,update,maj,odoo')
const protocolTimeoutMs = Number(process.env.WA_PROTOCOL_TIMEOUT_MS || 600000)
const messageQueueWarnSize = Number(process.env.WA_MESSAGE_QUEUE_WARN_SIZE || 25)
const instancePingIntervalMs = Number(process.env.WA_INSTANCE_PING_INTERVAL_MS || 60000)
const instancePingTimeoutMs = Number(process.env.WA_INSTANCE_PING_TIMEOUT_MS || 30000)
const automationHistorySyncEnabled = parseBoolean(process.env.WA_AUTOMATION_HISTORY_SYNC_ENABLED, true)
const automationHistorySyncIntervalMs = Number(process.env.WA_AUTOMATION_HISTORY_SYNC_INTERVAL_MS || 300000)
const automationHistoryLimit = Number(process.env.WA_AUTOMATION_HISTORY_LIMIT || 120)
const automationHistoryLookbackHours = Number(process.env.WA_AUTOMATION_HISTORY_LOOKBACK_HOURS || 96)
const automationRetryCooldownMs = Number(process.env.WA_AUTOMATION_RETRY_COOLDOWN_MS || 3600000)
const automationRetryMaxAttempts = Number(process.env.WA_AUTOMATION_RETRY_MAX_ATTEMPTS || 6)
const defaultPuppeteerArgs = isCloudDeployment()
  ? '--no-sandbox,--disable-setuid-sandbox,--disable-dev-shm-usage,--disable-gpu,--headless=new,--no-zygote,--disable-extensions'
  : '--no-sandbox,--disable-setuid-sandbox,--disable-dev-shm-usage,--disable-gpu'
const puppeteerArgs = (process.env.WA_PUPPETEER_ARGS || defaultPuppeteerArgs)
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)
const execFileAsync = promisify(execFile)

if (backendEnabled && !serviceToken) {
  console.warn('[iadis-wa] WHATSAPP_SERVICE_TOKEN is empty; service calls will fail with 403.')
}

if (!backendEnabled && !openAiApiKey) {
  console.warn('[iadis-wa] OPENAI_API_KEY is empty; standalone chatbot replies are disabled.')
}

fs.mkdirSync(waSessionPath, { recursive: true })
fs.mkdirSync(mediaTmpDir, { recursive: true })
fs.mkdirSync(crmMediaDir, { recursive: true })
fs.mkdirSync(path.join(process.cwd(), 'storage', 'tmp-uploads'), { recursive: true })
fs.mkdirSync(path.dirname(automationStatePath), { recursive: true })
fs.mkdirSync(path.dirname(aiHistoryPath), { recursive: true })
if (aiVoiceNluEnabled) {
  fs.mkdirSync(aiVoiceNluLogDir, { recursive: true })
}

let WaClient = null
let LocalAuth = null
let MessageMedia = null
let QRCode = null

try {
  const wa = require('whatsapp-web.js')
  WaClient = wa.Client
  LocalAuth = wa.LocalAuth
  MessageMedia = wa.MessageMedia
  QRCode = require('qrcode')
} catch (error) {
  console.warn('[iadis-wa] whatsapp-web.js not available; QR session endpoints will stay disabled.')
}

const instances = new Map()
const automationState = loadAutomationState()
const aiConversationHistory = loadAiConversationHistory()
/** @type {Record<string, number>} */
const nluUnclearCounts = Object.create(null)

function bumpNluUnclearCount(key) {
  const k = String(key || '').trim()
  if (!k) return 1
  nluUnclearCounts[k] = Number(nluUnclearCounts[k] || 0) + 1
  return nluUnclearCounts[k]
}

function resetNluUnclearCount(key) {
  const k = String(key || '').trim()
  if (k) delete nluUnclearCounts[k]
}

function isActiveCrmDeterministicWorkflow(lead) {
  if (!lead) return false
  const stage = String(lead.stage || '')
  return stage === 'awaiting_form'
    || stage === 'confirmation'
    || stage === 'crm_collection'
    || stage === 'awaiting_patient'
}

/** Resume hint after a FAQ interrupt — draft/awaiting_field unchanged. */
function buildBookingResumeHint(lead, languageHint = 'fr') {
  if (!lead) return null
  const darija = languageHint === 'darija' || languageHint === 'ar'
  const awaiting = String(lead.awaiting_field || '')
  if (awaiting === 'confirmation') {
    return darija
      ? 'وبالنسبة للموعد: إلا كانت المعلومات صحيحة جاوب بـ *نعم*، وإذا بغيتي تبدل شي حاجة قول ليا شنو تبدل.'
      : 'Pour le rendez-vous : si tout est correct, répondez *OUI*. Sinon indiquez ce qu’il faut modifier.'
  }
  if (awaiting === 'slot_alternative') {
    return darija
      ? 'وبالنسبة للموعد، اختار رقم من الاقتراحات اللي فوق.'
      : 'Pour le rendez-vous, choisissez un numéro parmi les propositions ci-dessus.'
  }
  if (awaiting === 'confirmation_rejection' || awaiting === 'fields_to_correct' || awaiting === 'field_correction') {
    return darija
      ? 'نقدروا نكمّلو تصحيح معلومات الموعد منين تكون واجد.'
      : 'Nous pouvons reprendre la correction des informations du rendez-vous quand vous voulez.'
  }
  const fieldHints = {
    full_name: darija ? 'وبالنسبة للموعد، باقي خاصني الاسم الكامل.' : 'Pour le rendez-vous, il me manque encore le nom complet.',
    phone_number: darija ? 'وبالنسبة للموعد، باقي خاصني رقم الهاتف.' : 'Pour le rendez-vous, il me manque encore le numéro de téléphone.',
    phone: darija ? 'وبالنسبة للموعد، باقي خاصني رقم الهاتف.' : 'Pour le rendez-vous, il me manque encore le numéro de téléphone.',
    city: darija ? 'وبالنسبة للموعد، شنو هي المدينة ديالك؟' : 'Pour le rendez-vous, quelle est votre ville ?',
    problem: darija ? 'وبالنسبة للموعد، شنو هو المشكل أو الخدمة؟' : 'Pour le rendez-vous, quel est le motif / la demande ?',
    reason: darija ? 'وبالنسبة للموعد، شنو هو المشكل أو الخدمة؟' : 'Pour le rendez-vous, quel est le motif / la demande ?',
    appointment: darija ? 'وبالنسبة للموعد، عافاك عطيني النهار والساعة.' : 'Pour le rendez-vous, indiquez le jour et l’heure.',
    bulk: darija ? 'نقدروا نكمّلو طلب الموعد منين تكون واجد.' : 'Nous pouvons reprendre la prise de rendez-vous quand vous voulez.',
  }
  if (fieldHints[awaiting]) return fieldHints[awaiting]
  try {
    const { checkCustomerData } = require('./crm/checkCustomerData')
    const missing = checkCustomerData(lead).missing || []
    const first = missing[0]
    if (first && fieldHints[first]) return fieldHints[first]
  } catch { /* optional */ }
  return darija
    ? 'نقدروا نكمّلو طلب الموعد منين تكون واجد.'
    : 'Nous pouvons reprendre la prise de rendez-vous quand vous voulez.'
}

const aiConversationQueues = new Map()
const aiKnowledgeBase = loadAiKnowledgeBase()
const openAiClient = openAiApiKey
  ? new OpenAI({
      apiKey: openAiApiKey,
      baseURL: openAiBaseUrl,
      timeout: openAiTimeoutMs,
      maxRetries: 2,
    })
  : null

const crm = crmEnabled ? createCrmService({
  dbPath: crmDbPath,
  ai: openAiApiKey && openAiClient
    ? { openAiClient, openAiModel }
    : null,
}) : null

function getLiveKnowledgeForPrompt() {
  const servicesKnowledge = formatPublicServicesKnowledge()
  try {
    if (crm?.smart?.listKnowledge) {
      const items = crm.smart.listKnowledge()
      const formatted = formatKnowledgeItemsForPrompt(items)
      if (formatted) {
        return `${formatted}\n\n${servicesKnowledge}`
      }
    }
  } catch (error) {
    console.warn('[iadis-wa] unable to load live knowledge from CRM', {
      reason: error.message || String(error),
    })
  }
  const fallback = aiKnowledgeBase || ''
  return fallback
    ? `${fallback}\n\n${servicesKnowledge}`
    : servicesKnowledge
}

const dashboardDb = crm?.db || openCrmDatabase(crmDbPath)
const dashboardUsers = createDashboardUsers(dashboardDb, dashboardAuthPath)
const dashboardAuth = createDashboardAuth({
  users: dashboardUsers,
  getSessionTtlMs: () => (crm?.smart?.getSessionTtlMs ? crm.smart.getSessionTtlMs() : SESSION_TTL_MS),
})
const ensureDashboardSession = createEnsureDashboardSession(dashboardAuth, dashboardUsers)

if (crm?.smart?.setAppointmentConfirmationSender) {
  crm.smart.setAppointmentConfirmationSender(async ({ chatId, phone, text }) => {
    const record = getInstance('main') || ensureInstance('main')
    const state = String(record?.state || '').toLowerCase()
    if (!record?.client || (state !== 'ready' && state !== 'authenticated')) {
      const err = new Error(`WhatsApp instance not ready (${record?.state || 'missing'})`)
      err.code = 'WA_NOT_READY'
      throw err
    }
    return sendTextThroughInstance(record, phone || chatId, text, chatId || null)
  })
}

const apiClient = axios.create({
  baseURL: apiBaseUrl,
  timeout: requestTimeout,
  headers: {
    'Content-Type': 'application/json',
  },
})

const app = express()

function applyDashboardSecurityHeaders(req, res, next) {
  if (!String(req.path || '').startsWith('/dashboard')) {
    return next()
  }
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      "connect-src 'self'",
      "worker-src 'self' blob:",
    ].join('; '),
  )
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  )
  return next()
}

app.use(applyDashboardSecurityHeaders)
app.use(express.json({ limit: '1mb' }))

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function loadAiKnowledgeBase() {
  if (!aiKnowledgePath) {
    return ''
  }

  try {
    const resolvedPath = path.isAbsolute(aiKnowledgePath)
      ? aiKnowledgePath
      : path.resolve(aiKnowledgePath)

    if (!fs.existsSync(resolvedPath)) {
      console.warn('[iadis-wa] AI knowledge file was not found', {
        path: resolvedPath,
      })
      return ''
    }

    return fs.readFileSync(resolvedPath, 'utf8').trim()
  } catch (error) {
    console.warn('[iadis-wa] unable to load AI knowledge file', {
      path: aiKnowledgePath,
      reason: error.message || String(error),
    })
    return ''
  }
}

function stripVoiceTranscriptPrefix(text) {
  return String(text || '')
    .replace(/^\[Message vocal[^\]]*\]\s*/gim, '')
    .replace(/^\[Langue probable[^\]]*\]\s*/gim, '')
    .trim()
}

function detectUserLanguageHint(text) {
  const cleaned = stripVoiceTranscriptPrefix(text)
  if (!cleaned) {
    return 'auto'
  }
  // Absolute rule: analyze message content (not ASR language tag alone).
  // Darija Latin / Arabic / mixed with French → reply language "darija" (Arabic script).
  // Majority French → "fr".
  return detectReplyLanguageHint(cleaned)
}

function buildLanguageDirective(languageHint, options = {}) {
  const isVoice = Boolean(options.isVoice)
  const voicePrefix = isVoice
    ? 'This turn is a WhatsApp VOICE NOTE transcription. Answer the patient question from that voice note.'
    : 'This turn is a normal WhatsApp text message.'
  const activeNote = options.fromConversationMemory
    ? 'Use the CONVERSATION ACTIVE LANGUAGE below (stable memory). Do NOT switch based only on this single latest message.'
    : 'Follow the language rule for this turn.'

  if (languageHint === 'darija') {
    return [
      voicePrefix,
      activeNote,
      'CONVERSATION ACTIVE LANGUAGE: Moroccan Darija.',
      'ABSOLUTE LANGUAGE RULE (highest priority, never ignore):',
      'Reply EXCLUSIVELY in Arabic script (دارجة/عربية).',
      'NEVER reply in French.',
      'NEVER reply in Latin-letter Darija (forbidden: "bghit", "labas", "safi", "wach", etc.).',
      'Do not keep French from earlier turns unless active language is French.',
      'Answer the concrete question/request in this latest message.',
    ].join(' ')
  }

  if (languageHint === 'fr') {
    return [
      voicePrefix,
      activeNote,
      'CONVERSATION ACTIVE LANGUAGE: French.',
      'ABSOLUTE LANGUAGE RULE (highest priority, never ignore):',
      'Reply EXCLUSIVELY in French.',
      'Do NOT reply in Arabic/Darija.',
      'Answer the concrete question/request in this latest message.',
    ].join(' ')
  }

  return [
    voicePrefix,
    'ABSOLUTE LANGUAGE RULE (highest priority):',
    '1) Detect the language of the LATEST patient message only.',
    '2) Majority French → reply in French only.',
    '3) Darija (Latin, Arabic, or mixed with French) → reply in Arabic script only, never Latin Darija.',
  ].join(' ')
}

function normalizeReplyLanguageHint(value) {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) {
    return null
  }
  if (
    raw === 'darija'
    || raw === 'ar'
    || raw === 'arabic'
    || raw.includes('darija')
    || raw.includes('arabe')
  ) {
    return 'darija'
  }
  if (raw === 'fr' || raw === 'french' || raw.includes('fran')) {
    return 'fr'
  }
  if (raw === 'auto') {
    return 'auto'
  }
  return null
}

function buildOpenAiInstructions() {
  const sections = [
    [
      'You are the official WhatsApp assistant for Centre Dentaire HEL in El Oulfa, Casablanca.',
      'INTENT ROUTER RULE (PRIORITY): when an INTENT ROUTER RESULT block is provided, trust language/intent/service as already decided. Do not re-detect or contradict them.',
      'ABSOLUTE LANGUAGE RULE (PRIORITY OVER ALL OTHER INSTRUCTIONS):',
      'Before every reply: (1) detect the language of the LATEST patient message/voice transcript only;',
      '(2) if entirely/mostly French → reply exclusively in French;',
      '(3) if Moroccan Darija in Arabic script OR Latin keyboard (bghit, 3andi, wach, chno, fin, labas...) OR mixed Darija+French → reply exclusively in Arabic script;',
      '(4) NEVER reply in Latin-letter Darija; NEVER keep the previous chat language when the latest message switched.',
      'Examples: "Bghit rendez-vous." / "3andi douleur f dersi." / "Chno homa les services ?" / "بغيت موعد." → Arabic reply.',
      'Examples: "Bonjour, je voudrais un rendez-vous." / "Quels sont vos services ?" → French reply.',
      'Same absolute rule for voice notes after transcription: Darija/mixed → Arabic; French → French. Do not rely only on ASR language tags; analyze content markers.',
      'Do not reply in English unless the user explicitly asks for English.',
      'When the latest input is a transcribed WhatsApp voice note: treat the transcript as the patient question/request and answer THAT question directly in text.',
      'Patients often speak Moroccan Darija with incomplete sentences, code-switching, and ASR errors. Interpret the INTENT of the whole message first; never answer word-by-word at random.',
      'If an INTENT CLASSIFICATION block is provided with confidence above 0.70, answer that intent directly. Never say that you did not understand.',
      'If the intent is ASK_SERVICES, list the clinic services clearly and invite the patient to book on WhatsApp.',
      'If a VOICE PRE-ANALYSIS block is provided, it comes from the AI Transcript Interpreter: trust its corrected text, service, intent and entities as the patient meaning.',
      'Examples of meaning: "kan wje3ni dersi" => toothache; "bghit nji" => appointment request; "3endi nafkha" => urgent swelling; "chno homa les service" => ask services list.',
      'Only ask a short clarification when intent confidence is truly low (below 0.70) and the message is empty/junk.',
      'Use only the clinic facts provided in the business knowledge below plus the current conversation context.',
      'If a question is not answered by the loaded clinic knowledge, clearly say that this information is not available in the current Centre Dentaire HEL details. You may still mention phone (+212) 7 107 44444 or email contact@centredentairehel.ma as secondary options.',
      'Do not invent prices, insurance details, cancellation rules, payment policies, doctor schedules, or medical facts.',
      'BOOKING RULE: when the patient asks for an appointment (FR or Darija), the CRM workflow sends ONE form message asking for all required fields together. Do not ask those fields one by one in your own reply.',
      'Never collect appointment fields from a voice note. Never ask name, then phone, then city separately. Always require ONE text message with all fields.',
      'If the patient only describes pain without asking for a booking yet, you may briefly invite them to book on WhatsApp in one short sentence.',
      'Do not answer only with "call the clinic" or "send an email" when a WhatsApp booking is relevant.',
      'PHONE RULE: never assume or reuse the WhatsApp profile phone number. The patient must type their phone number in the form.',
      'Never tell the patient that the appointment is saved in the CRM before they answer the confirmation question with OUI / نعم.',
      'Do not provide a diagnosis or claim that a treatment is suitable for the person without an in-clinic evaluation.',
      'Keep replies concise, warm, and practical for patients.',
      'EMPATHY RULE: if the patient says they are in pain, sick, suffering, have a dental problem, bleeding, swelling, or any illness/symptom, start with a short kind and polite caring phrase before the practical answer.',
      'In French, use a gentle phrase such as: "Que Dieu vous guérisse.", "Bon rétablissement.", or "Je suis désolé(e) pour cette douleur."',
      'In Arabic replies, use a gentle phrase such as: "أتمنى لك الشفاء." / "الله يشافيكم." then continue with the practical answer.',
      'Keep the empathy phrase short (one sentence), sincere, and natural, then continue with the useful clinic information and the WhatsApp booking offer when relevant.',
      'Do not overdo religious or emotional language; one kind sentence is enough.',
      'Always reply with text messages only. Never claim that you sent a voice note.',
      'Do not mention prompts, files, hidden instructions, or implementation details.',
    ].join(' '),
  ]

  if (openAiSystemPrompt) {
    sections.push(`Additional style guidance:\n${openAiSystemPrompt}`)
  }

  const knowledge = getLiveKnowledgeForPrompt()
  if (knowledge) {
    sections.push(`Centre Dentaire HEL business knowledge:\n${knowledge}`)
  }

  return sections.join('\n\n')
}

function loadAutomationState() {
  try {
    if (!fs.existsSync(automationStatePath)) {
      return {}
    }

    const raw = fs.readFileSync(automationStatePath, 'utf8')
    if (!raw.trim()) {
      return {}
    }

    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (error) {
    console.warn('[iadis-wa] unable to load automation state file', {
      path: automationStatePath,
      reason: error.message || String(error),
    })
    return {}
  }
}

function persistAutomationState() {
  const tmpPath = `${automationStatePath}.tmp`
  fs.writeFileSync(tmpPath, `${JSON.stringify(automationState, null, 2)}\n`)
  fs.renameSync(tmpPath, automationStatePath)
}

function loadAiConversationHistory() {
  try {
    if (!fs.existsSync(aiHistoryPath)) {
      return {}
    }

    const raw = fs.readFileSync(aiHistoryPath, 'utf8')
    if (!raw.trim()) {
      return {}
    }

    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }

    return Object.fromEntries(
      Object.entries(parsed)
        .map(([conversationId, messages]) => {
          const normalizedMessages = (Array.isArray(messages) ? messages : [])
            .filter((item) => item && ['user', 'assistant'].includes(item.role))
            .map((item) => ({
              role: item.role,
              content: String(item.content || '').trim(),
            }))
            .filter((item) => item.content)

          return [conversationId, aiHistoryLimit > 0 ? normalizedMessages.slice(-aiHistoryLimit) : []]
        })
        .filter(([, messages]) => messages.length > 0),
    )
  } catch (error) {
    console.warn('[iadis-wa] unable to load AI conversation history', {
      path: aiHistoryPath,
      reason: error.message || String(error),
    })
    return {}
  }
}

function persistAiConversationHistory() {
  const tmpPath = `${aiHistoryPath}.tmp`
  fs.writeFileSync(tmpPath, `${JSON.stringify(aiConversationHistory, null, 2)}\n`)
  fs.renameSync(tmpPath, aiHistoryPath)
}

function setAiConversationHistory(conversationId, messages) {
  const key = String(conversationId || '').trim()
  if (!key) {
    return
  }

  const limitedMessages = aiHistoryLimit > 0 ? messages.slice(-aiHistoryLimit) : []
  if (limitedMessages.length > 0) {
    aiConversationHistory[key] = limitedMessages
  } else {
    delete aiConversationHistory[key]
  }

  try {
    persistAiConversationHistory()
  } catch (error) {
    console.warn('[iadis-wa] unable to persist AI conversation history', {
      path: aiHistoryPath,
      reason: error.message || String(error),
    })
  }
}

function extractOpenAiOutputText(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim()
  }

  return (Array.isArray(payload?.output) ? payload.output : [])
    .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
    .filter((item) => item?.type === 'output_text' && typeof item.text === 'string')
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join('\n')
    .trim()
}

function enqueueAiConversation(conversationId, action) {
  const previous = aiConversationQueues.get(conversationId) || Promise.resolve()
  const current = previous.catch(() => {}).then(action)
  aiConversationQueues.set(conversationId, current)

  current.finally(() => {
    if (aiConversationQueues.get(conversationId) === current) {
      aiConversationQueues.delete(conversationId)
    }
  }).catch(() => {})

  return current
}

/**
 * AI Transcript Interpreter LLM call.
 * Receives raw ASR text and must return JSON understanding for the chatbot.
 * @param {{ instructions: string, prompt: string }} args
 * @returns {Promise<string|null>}
 */
async function runAiTranscriptInterpreterLlm(args = {}) {
  if (!openAiApiKey || !openAiClient) {
    return null
  }

  const instructions = String(args.instructions || '').trim()
  const prompt = String(args.prompt || '').trim()
  if (!instructions || !prompt) {
    return null
  }

  try {
    const requestBody = {
      model: openAiModel,
      instructions,
      input: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      max_output_tokens: Math.max(220, Math.min(openAiMaxOutputTokens, 500)),
      store: false,
    }

    if (openAiReasoningEffort) {
      requestBody.reasoning = { effort: openAiReasoningEffort }
    }

    const response = await openAiClient.responses.create(requestBody)
    const text = extractOpenAiOutputText(response)
    return text ? String(text).trim() : null
  } catch (error) {
    console.warn('[iadis-wa] AI Transcript Interpreter failed', {
      reason: error.message || String(error),
    })
    return null
  }
}

/**
 * Generate a short French clinical motif (AI) from the patient's exact WhatsApp wording.
 * Keeps the client message untouched in dental_cases.description.
 */
async function generateAiMotifFromClientMessage(clientText) {
  const exact = String(clientText || '').trim()
  if (!exact || !openAiApiKey || !openAiClient) {
    return null
  }

  try {
    const requestBody = {
      model: openAiModel,
      instructions: [
        'Tu es assistant dentaire pour le Centre Dentaire HEL (Casablanca).',
        'À partir du message exact du patient (français, darija ou arabe), génère un motif clinique court en français.',
        'Exemples: "douleur dentaire", "carie", "gonflement", "extraction", "détartrage", "consultation générale".',
        'Réponds UNIQUEMENT avec le motif (2 à 4 mots max), sans guillemets, sans phrase complète.',
      ].join(' '),
      input: [
        {
          role: 'user',
          content: `Message patient:\n${exact.slice(0, 280)}`,
        },
      ],
      max_output_tokens: 40,
      store: false,
    }
    if (openAiReasoningEffort) {
      requestBody.reasoning = { effort: openAiReasoningEffort }
    }
    const response = await openAiClient.responses.create(requestBody)
    const text = extractOpenAiOutputText(response)
    const motif = text ? String(text).trim().replace(/^["«]|["»]$/g, '').slice(0, 80) : ''
    return motif || null
  } catch (error) {
    console.warn('[iadis-wa] AI motif generation failed', {
      reason: error.message || String(error),
    })
    return null
  }
}

async function enrichBookingMotifWithAi(booking) {
  if (!crm || !booking?.dentalCase?.id) return
  const clientText = booking.dentalCase.description || booking.dentalCase.problem
  const aiMotif = await generateAiMotifFromClientMessage(clientText)
  if (!aiMotif) return
  try {
    crm.repo.updateDentalCaseAiMotif(booking.dentalCase.id, aiMotif)
  } catch (error) {
    console.warn('[iadis-wa] Failed to persist AI motif', {
      reason: error.message || String(error),
    })
  }
}

async function generateStandaloneAiReply(conversationId, rawContent, options = {}) {
  const key = String(conversationId || '').trim()
  const content = String(rawContent || '').trim().slice(0, aiMaxInputCharacters)
  if (!key || (!content && !options.mediaPath)) {
    return { reply: null, reason: 'empty_input' }
  }

  if (aiResetCommand && content.toLowerCase() === aiResetCommand) {
    setAiConversationHistory(key, [])
    if (crm) {
      crm.resetConversation(key)
    }
    return {
      reply: aiResetReply,
      reason: 'conversation_reset',
      model: openAiModel,
    }
  }

  const isVoiceEarly = Boolean(options.isVoice || options.audioTranscript || options.voiceNlu || /\[Message vocal/i.test(content))
  const inboundPersistText = stripVoiceTranscriptPrefix(
    options.voiceNlu?.correctedText || options.audioTranscript || content,
  ).trim() || (options.mediaPath ? '' : content)

  // ALWAYS persist inbound first — even when HUMAN owns the conversation.
  // Human handoff must silence AI replies, never stop listening / storing.
  if (crm?.smart) {
    try {
      crm.smart.trackWhatsAppTurn({
        chatId: options.chatId || key,
        conversationId: key,
        customerId: options.customerId || null,
        inboundText: inboundPersistText,
        inboundMessageId: options.providerMessageId || null,
        inboundType: options.inboundMediaType
          || (options.mediaPath ? 'image' : (isVoiceEarly ? 'voice' : 'text')),
        contactName: options.contactName || null,
        phoneNumber: options.phoneNumber || null,
        mediaPath: options.mediaPath || null,
        mediaMime: options.mediaMime || null,
        mediaFilename: options.mediaFilename || null,
        mediaSize: options.mediaSize || null,
      })
    } catch (trackError) {
      console.warn('[iadis-wa] smart inbound track failed', trackError.message || trackError)
    }
  }

  // Language memory + reply share the per-conversation queue (race-safe).
  // HUMAN mode still updates language; it only skips AI replies.
  return enqueueAiConversation(key, async () => {
    let languageState = null
    if (crm?.smart?.applyInboundLanguage) {
      try {
        languageState = crm.smart.applyInboundLanguage({
          chatId: options.chatId || key,
          conversationId: key,
          text: inboundPersistText,
          isVoice: isVoiceEarly,
        })
      } catch (langError) {
        console.warn('[iadis-wa] language memory update failed', langError.message || langError)
      }
    }

    const activeLanguage = languageState?.responseLanguage
      || languageState?.activeLanguage
      || crm?.smart?.getActiveConversationLanguage?.(options.chatId || key)
      || crm?.smart?.getActiveConversationLanguage?.(key)
      || null

    if (!openAiApiKey) {
      return { reply: null, reason: 'openai_not_configured', language_hint: activeLanguage }
    }

    if (crm?.smart && !crm.smart.canAiAutoReply(key) && !crm.smart.canAiAutoReply(options.chatId || key)) {
      console.log('[iadis-wa] AI auto-reply blocked (handoff or assistant paused)', {
        conversation_id: key,
        chat_id: options.chatId || null,
        active_language: activeLanguage,
      })
      return {
        reply: null,
        reason: 'human_handoff_or_assistant_paused',
        language_hint: activeLanguage,
        language_switched: Boolean(languageState?.switched),
      }
    }

    const history = Array.isArray(aiConversationHistory[key])
      ? aiConversationHistory[key].slice(-aiHistoryLimit)
      : []
    const isVoice = Boolean(options.isVoice || options.audioTranscript || options.voiceNlu || /\[Message vocal/i.test(content))
    const voiceNlu = options.voiceNlu || null
    const cleanPatientText = stripVoiceTranscriptPrefix(
      voiceNlu?.correctedText || options.audioTranscript || content,
    )
    const patientPlainText = (isVoice && cleanPatientText ? cleanPatientText : content).trim()

    // Intent router: detect message signals for intent/service.
    // Reply language comes from conversation active language memory.
    const router = routePatientMessage(patientPlainText, {
      languageHint: null,
      voiceIntent: voiceNlu?.intent || options.voiceIntent || null,
      interpreterIntent: voiceNlu?.interpreter?.intent || null,
      voiceService: voiceNlu?.serviceDetection || options.voiceService || null,
      stage: options.crmStage || options.stage || null,
    })

    // Controlled LLM semantic fallback for unknown Darija (never overrides active CRM stages)
    const stageHint = String(options.crmStage || options.stage || '')
    const needsSemantic = (
      !/awaiting_|selection|confirm/i.test(stageHint)
      && router.nlu?.hasDarijaSignal
      && (router.intent === 'OTHER' || router.intent === 'UNKNOWN' || Number(router.intentConfidence || 0) < 0.55)
      && openAiClient
      && openAiModel
    )
    if (needsSemantic) {
      try {
        const semantic = await classifyIntentSemanticFallback({
          openai: openAiClient,
          model: openAiModel,
          rawText: patientPlainText,
          normalizedText: router.nlu?.normalizedText || null,
          stage: stageHint || null,
        })
        if (
          semantic?.intent
          && semantic.intent !== 'OTHER'
          && Number(semantic.confidence || 0) >= 0.82
        ) {
          router.intent = semantic.intent
          router.intentConfidence = Number(semantic.confidence)
          router.intentMatched = 'llm_semantic'
          if (semantic.intent === 'BOOK_APPOINTMENT') {
            // Still require explicit booking language for form open
            const { hasExplicitBookingIntent } = require('./voice-nlu/intent-table')
            router.bookAppointment = hasExplicitBookingIntent(patientPlainText)
          }
          if (semantic.intent === 'CHECK_APPOINTMENT_AVAILABILITY') {
            router.bookAppointment = false
          }
          if (semantic.intent === 'CANCEL_APPOINTMENT') {
            router.cancelAppointment = true
          }
          if (
            semantic.intent === 'ASK_PRICE'
            || semantic.intent === 'ASK_SERVICES'
            || semantic.intent === 'ASK_LOCATION'
            || semantic.intent === 'ASK_OPENING_HOURS'
            || semantic.intent === 'ASK_IDENTITY'
            || semantic.intent === 'ASK_PHONE'
          ) {
            router.bookAppointment = false
          }
          router.llmBlock = buildRouterLlmBlock(router)
          console.log('[iadis-wa] darija semantic fallback', {
            conversation_id: key,
            intent: router.intent,
            confidence: router.intentConfidence,
          })
        }
      } catch (err) {
        console.warn('[iadis-wa] semantic intent fallback failed', err?.message || err)
      }
    }

    const languageHint = activeLanguage
      || normalizeReplyLanguageHint(options.languageHint)
      || router.language
      || detectUserLanguageHint(patientPlainText)
      || 'fr'

    router.language = (languageHint === 'darija' || languageHint === 'ar')
      ? 'darija'
      : (languageHint === 'fr' ? 'fr' : router.language)
    router.llmBlock = buildRouterLlmBlock(router)

    const languageDirective = buildLanguageDirective(languageHint, {
      isVoice,
      fromConversationMemory: Boolean(activeLanguage),
    })

    console.log('[iadis-wa] intent router', {
      conversation_id: key,
      language: router.language,
      detected_language: languageState?.detection?.language || null,
      active_language: activeLanguage,
      language_switched: Boolean(languageState?.switched),
      intent: router.intent,
      intent_confidence: router.intentConfidence,
      service: router.service,
      service_confidence: router.serviceConfidence,
      dental_problem: router.dentalProblem,
      dental_problem_confidence: router.dentalProblemConfidence,
      book_appointment: router.bookAppointment,
      cancel_appointment: router.cancelAppointment,
    })

    try {
      if (crm?.smart?.recordActivity) {
        const conv = crm.smart.getOrCreateConversation?.({
          external_key: options.chatId || key,
          phone_number: options.phoneNumber || null,
          push_name: options.contactName || null,
        })
        const convId = conv?.id || null
        const customerId = conv?.customer_id || null

        if (isVoice && cleanPatientText) {
          crm.smart.recordActivity({
            event_type: 'voice_transcribed',
            category: 'assistant',
            actor_type: 'ai',
            source: 'whatsapp',
            conversation_id: convId,
            patient_id: customerId,
            title: 'Message vocal transcrit',
            description: cleanPatientText.slice(0, 180),
            metadata: {
              language: router.language,
              intent: router.intent,
              intent_label: router.intent,
            },
            source_event_id: `voice:${convId}:${Date.now()}`,
          })
        }

        if (
          router.dentalProblem
          && router.dentalProblem !== 'UNKNOWN_DENTAL_PROBLEM'
          && Number(router.dentalProblemConfidence || 0) >= 0.8
        ) {
          const problemLabels = {
            BLEEDING_GUMS: 'Saignement des gencives',
            TARTAR: 'Tartre',
            CAVITY: 'Carie mentionnée',
            YELLOW_TEETH: 'Dents jaunes',
            OVERLAPPING_TEETH: 'Dents qui se chevauchent',
            GAPS_BETWEEN_TEETH: 'Espaces entre les dents',
            GUM_PAIN: 'Douleur aux gencives',
            EMERGENCY_REQUEST: 'Urgence exprimée',
          }
          crm.smart.recordActivity({
            event_type: 'dental_problem_detected',
            category: 'assistant',
            actor_type: 'ai',
            source: 'whatsapp',
            conversation_id: convId,
            patient_id: customerId,
            title: 'Problème dentaire détecté',
            description: 'Classification de la demande exprimée (sans diagnostic).',
            metadata: {
              problem: router.dentalProblem,
              problem_label: problemLabels[router.dentalProblem] || router.dentalProblem,
              service: router.service,
              confidence: router.dentalProblemConfidence,
            },
            source_event_id: `dental:${convId}:${router.dentalProblem}:${Math.floor(Date.now() / 60000)}`,
          })
        }

        if (router.intent && router.intent !== 'OTHER' && Number(router.intentConfidence || 0) >= 0.85) {
          const { intentLabel } = require('./crm/smart/labels')
          crm.smart.recordActivity({
            event_type: 'intent_detected',
            category: 'assistant',
            actor_type: 'ai',
            source: 'whatsapp',
            conversation_id: convId,
            patient_id: customerId,
            title: 'Intention détectée',
            description: intentLabel(router.intent),
            metadata: { intent: router.intent, confidence: router.intentConfidence },
            source_event_id: `intent:${convId}:${router.intent}:${Math.floor(Date.now() / 300000)}`,
          })
        }
      }
    } catch (activityErr) {
      console.warn('[iadis-wa] activity history log failed', activityErr?.message || activityErr)
    }

    // Context-first routing — load structured state before deterministic workflows
    let routingState = null
    if (crm?.smart?.resolveConversationRouting) {
      try {
        routingState = crm.smart.resolveConversationRouting(options.chatId || key)
        crm.smart.logContextRouter?.(routingState, patientPlainText, 'loaded')
      } catch (routingErr) {
        console.warn('[iadis-wa] conversation routing load failed', routingErr.message || routingErr)
      }
    }

    // Patient self-cancel (pending confirm / select first) — before proposal & 24h confirmation OUI
    let cancelTurn = null
    if (crm?.smart?.handleInboundCancel && !isVoice) {
      try {
        const leadPeekCancel = crm.repo.getLead?.(key) || null
        const inBookingConfirmCancel = leadPeekCancel?.stage === 'confirmation'
        if (!inBookingConfirmCancel) {
          cancelTurn = await crm.smart.handleInboundCancel({
            chatKey: options.chatId || key,
            text: patientPlainText,
            language: languageHint === 'darija' || languageHint === 'ar' ? 'darija' : 'fr',
            routerIntent: router.intent,
            conversation: null,
          })
        }
      } catch (error) {
        console.warn('[iadis-wa] whatsapp cancel flow failed', error.message || error)
      }
    }

    if (cancelTurn?.handled && cancelTurn.forceReply) {
      try {
        crm.smart?.trackWhatsAppTurn?.({
          chatId: options.chatId || key,
          conversationId: key,
          outboundText: cancelTurn.forceReply,
          outboundAuthor: 'ai',
          contactName: options.contactName || null,
        })
      } catch (trackError) {
        console.warn('[iadis-wa] smart track failed', trackError.message || trackError)
      }
      setAiConversationHistory(key, [
        ...history,
        { role: 'user', content: isVoice && cleanPatientText ? `[vocal] ${cleanPatientText}` : content },
        { role: 'assistant', content: cancelTurn.forceReply },
      ])
      return {
        reply: cancelTurn.forceReply,
        reason: cancelTurn.action === 'cancelled'
          ? 'appointment_patient_cancelled'
          : (cancelTurn.action === 'kept' || cancelTurn.action === 'aborted'
            ? 'appointment_cancel_aborted'
            : 'appointment_cancel_flow'),
        model: openAiModel,
        language_hint: languageHint,
        is_voice: isVoice,
        intent: router.intent || 'CANCEL_APPOINTMENT',
        appointment_id: cancelTurn.appointmentId || null,
        should_skip_llm: true,
        router,
      }
    }

    // Manual slot-move proposal reply (staff-sent) — before 24h confirmation OUI
    let slotProposalTurn = null
    if (crm?.smart?.handleInboundSlotProposalReply && !isVoice) {
      try {
        const leadPeek = crm.repo.getLead?.(key) || null
        const inBookingConfirm = leadPeek?.stage === 'confirmation'
        if (!inBookingConfirm) {
          slotProposalTurn = await crm.smart.handleInboundSlotProposalReply({
            chatKey: options.chatId || key,
            text: patientPlainText,
          })
        }
      } catch (error) {
        console.warn('[iadis-wa] slot proposal reply failed', error.message || error)
      }
    }

    if (slotProposalTurn?.handled && slotProposalTurn.forceReply) {
      try {
        crm.smart?.trackWhatsAppTurn?.({
          chatId: options.chatId || key,
          conversationId: key,
          outboundText: slotProposalTurn.forceReply,
          outboundAuthor: 'ai',
          contactName: options.contactName || null,
        })
      } catch (trackError) {
        console.warn('[iadis-wa] smart track failed', trackError.message || trackError)
      }
      setAiConversationHistory(key, [
        ...history,
        { role: 'user', content: isVoice && cleanPatientText ? `[vocal] ${cleanPatientText}` : content },
        { role: 'assistant', content: slotProposalTurn.forceReply },
      ])
      return {
        reply: slotProposalTurn.forceReply,
        reason: slotProposalTurn.action === 'declined'
          ? 'slot_proposal_declined'
          : (slotProposalTurn.action === 'accepted' ? 'slot_proposal_accepted' : 'slot_proposal_reply'),
        model: openAiModel,
        language_hint: languageHint,
        is_voice: isVoice,
        intent: router.intent,
        appointment_id: slotProposalTurn.appointmentId || null,
        router,
      }
    }

    // Appointment confirmation reply (24h WhatsApp) — only if NOT booking-form confirmation
    // and not mid availability selection (bare "1"/"2" belong to availability)
    let confirmationTurn = null
    const availabilityStatePeek = crm?.smart?.availabilityFlow?.getState?.(options.chatId || key) || null
    const inAvailabilityFlow = Boolean(
      availabilityStatePeek
      && (
        availabilityStatePeek.stage === 'awaiting_availability_date'
        || availabilityStatePeek.stage === 'awaiting_available_slot_selection'
        || availabilityStatePeek.stage === 'awaiting_precise_slot_confirm'
      ),
    )
    if (crm?.smart?.handleInboundConfirmationReply && !isVoice && !inAvailabilityFlow) {
      try {
        const leadPeek = crm.repo.getLead?.(key) || null
        const inBookingConfirm = leadPeek?.stage === 'confirmation'
        if (!inBookingConfirm) {
          confirmationTurn = await crm.smart.handleInboundConfirmationReply({
            chatKey: options.chatId || key,
            text: patientPlainText,
          })
        }
      } catch (error) {
        console.warn('[iadis-wa] appointment confirmation reply failed', error.message || error)
      }
    }

    if (confirmationTurn?.handled && confirmationTurn.forceReply) {
      // Short automation templates (not free-form LLM) — allowed even under handoff
      try {
        crm.smart?.trackWhatsAppTurn?.({
          chatId: options.chatId || key,
          conversationId: key,
          outboundText: confirmationTurn.forceReply,
          outboundAuthor: 'ai',
          contactName: options.contactName || null,
        })
      } catch (trackError) {
        console.warn('[iadis-wa] smart track failed', trackError.message || trackError)
      }
      setAiConversationHistory(key, [
        ...history,
        { role: 'user', content: isVoice && cleanPatientText ? `[vocal] ${cleanPatientText}` : content },
        { role: 'assistant', content: confirmationTurn.forceReply },
      ])
      return {
        reply: confirmationTurn.forceReply,
        reason: confirmationTurn.action === 'cancelled'
          ? 'appointment_auto_cancelled'
          : 'appointment_auto_confirmed',
        model: openAiModel,
        language_hint: languageHint,
        is_voice: isVoice,
        intent: router.intent,
        intent_confidence: router.intentConfidence,
        service: router.service,
        appointment_id: confirmationTurn.appointmentId || null,
        router,
      }
    }

    // Cabinet availability consultation (before CRM booking / NLU fallback)
    let availabilityTurn = null
    if (crm?.smart?.handleInboundAvailability && !isVoice) {
      try {
        const leadPeekAvail = crm.repo.getLead?.(key) || null
        const inBookingConfirmAvail = leadPeekAvail?.stage === 'confirmation'
        if (!inBookingConfirmAvail) {
          availabilityTurn = await crm.smart.handleInboundAvailability({
            chatKey: options.chatId || key,
            text: patientPlainText,
            language: languageHint === 'darija' || languageHint === 'ar' ? 'darija' : 'fr',
            routerIntent: router.intent,
          })
        }
      } catch (error) {
        console.warn('[iadis-wa] availability flow failed', error.message || error)
      }
    }

    if (availabilityTurn?.handled && availabilityTurn.forceReply) {
      const availReplies = Array.isArray(availabilityTurn.forceReplies) && availabilityTurn.forceReplies.length
        ? availabilityTurn.forceReplies
        : [availabilityTurn.forceReply]
      try {
        for (const outboundText of availReplies) {
          crm.smart?.trackWhatsAppTurn?.({
            chatId: options.chatId || key,
            conversationId: key,
            outboundText,
            outboundAuthor: 'ai',
            contactName: options.contactName || null,
          })
        }
      } catch (trackError) {
        console.warn('[iadis-wa] smart track failed', trackError.message || trackError)
      }
      setAiConversationHistory(key, [
        ...history,
        { role: 'user', content: isVoice && cleanPatientText ? `[vocal] ${cleanPatientText}` : content },
        ...availReplies.map((outboundText) => ({ role: 'assistant', content: outboundText })),
      ])
      return {
        reply: availReplies[0],
        replies: availReplies,
        reason: availabilityTurn.action === 'slot_selected'
          ? 'availability_slot_selected'
          : 'availability_flow',
        model: openAiModel,
        language_hint: languageHint,
        is_voice: isVoice,
        intent: router.intent || 'CHECK_APPOINTMENT_AVAILABILITY',
        intent_confidence: router.intentConfidence,
        should_skip_llm: true,
        router,
        appointment_date: availabilityTurn.appointmentDate || null,
        appointment_time: availabilityTurn.appointmentTime || null,
      }
    }

    // FAQ services — canned catalogue (never invent "info not available")
    const askServicesConfidence = Number(router.intentConfidence || 0)
    const leadPeekServices = crm?.repo?.getLead?.(key) || null
    const inBookingConfirmationServices = leadPeekServices?.stage === 'confirmation'
    if (
      router.intent === 'ASK_SERVICES'
      && askServicesConfidence >= 0.7
      && !inBookingConfirmationServices
      && !inAvailabilityFlow
    ) {
      const servicesReply = buildIntentDirectReply('ASK_SERVICES', languageHint)
        || buildIntentDirectReply('ASK_SERVICES', 'fr')
      if (servicesReply) {
        try {
          crm.smart?.trackWhatsAppTurn?.({
            chatId: options.chatId || key,
            conversationId: key,
            outboundText: servicesReply,
            outboundAuthor: 'ai',
            contactName: options.contactName || null,
          })
        } catch (trackError) {
          console.warn('[iadis-wa] smart track failed', trackError.message || trackError)
        }
        setAiConversationHistory(key, [
          ...history,
          { role: 'user', content: isVoice && cleanPatientText ? `[vocal] ${cleanPatientText}` : content },
          { role: 'assistant', content: servicesReply },
        ])
        return {
          reply: servicesReply,
          reason: 'ask_services_direct',
          model: openAiModel,
          language_hint: languageHint,
          is_voice: isVoice,
          intent: 'ASK_SERVICES',
          intent_confidence: askServicesConfidence,
          should_skip_llm: true,
          router,
        }
      }
    }

    // NLU fallback — gibberish / low confidence must NOT start booking or LLM form collection
    const leadPeekFallback = crm?.repo?.getLead?.(key) || null
    const inCrmWorkflow = isActiveCrmDeterministicWorkflow(leadPeekFallback)
      && !hasPriorityOverBooking(routingState)
    const fallbackLang = languageHint === 'darija' || languageHint === 'ar' ? 'darija' : 'fr'

    const needsContextualFallback = !isVoice && (
      shouldUseNluFallback(router, patientPlainText)
      || (routingState?.activeWorkflow && routingState.activeWorkflow !== 'booking')
    )

    if (needsContextualFallback && !inCrmWorkflow && !slotProposalTurn?.handled && !cancelTurn?.handled) {
      const attempt = bumpNluUnclearCount(key)
      const fallbackReply = routingState?.activeWorkflow
        ? (crm.smart?.contextualClarificationMessage?.(routingState, fallbackLang, attempt)
          || clarificationMessage(fallbackLang, attempt))
        : clarificationMessage(fallbackLang, attempt)
      if (process.env.CRM_DEBUG_NLU === '1' || process.env.CRM_DEBUG_CONTEXT === '1' || process.env.NODE_ENV !== 'production') {
        console.log('[NLU_FALLBACK]', {
          text: patientPlainText,
          intent: router.intent,
          confidence: router.intentConfidence,
          action: 'clarification',
          activeWorkflow: routingState?.activeWorkflow || null,
          attempt,
        })
        crm.smart?.logContextRouter?.(routingState, patientPlainText, 'contextual_clarification')
      }
      try {
        crm.smart?.trackWhatsAppTurn?.({
          chatId: options.chatId || key,
          conversationId: key,
          outboundText: fallbackReply,
          outboundAuthor: 'ai',
          contactName: options.contactName || null,
        })
      } catch (trackError) {
        console.warn('[iadis-wa] smart track failed', trackError.message || trackError)
      }
      setAiConversationHistory(key, [
        ...history,
        { role: 'user', content: content },
        { role: 'assistant', content: fallbackReply },
      ])
      return {
        reply: fallbackReply,
        reason: 'nlu_fallback_clarification',
        model: openAiModel,
        language_hint: languageHint,
        is_voice: isVoice,
        intent: router.intent || 'UNKNOWN',
        intent_confidence: router.intentConfidence,
        should_skip_llm: true,
        router,
      }
    }

    if (!shouldUseNluFallback(router, patientPlainText)) {
      resetNluUnclearCount(key)
    }

    // FAQ interrupt during active booking — answer without clearing draft, then resume
    const leadPeekFaq = crm?.repo?.getLead?.(key) || null
    const bookingDraftActive = leadPeekFaq
      && ['awaiting_form', 'crm_collection', 'confirmation', 'awaiting_patient'].includes(String(leadPeekFaq.stage || ''))
    const faqIntent = String(router.intent || '').toUpperCase()
    const faqConf = Number(router.intentConfidence || 0)
    const FAQ_INTERRUPT_INTENTS = new Set([
      'ASK_LOCATION',
      'ASK_OPENING_HOURS',
      'ASK_IDENTITY',
      'ASK_PHONE',
      'ASK_PRICE',
      'ASK_SERVICES',
    ])
    const slotAltActive = String(leadPeekFaq?.awaiting_field || '') === 'slot_alternative'
    if (
      (bookingDraftActive || slotAltActive)
      && !isVoice
      && faqConf >= 0.7
      && FAQ_INTERRUPT_INTENTS.has(faqIntent)
      && !hasPriorityOverBooking(routingState)
    ) {
      let faqReply = buildIntentDirectReply(faqIntent, languageHint)
        || buildIntentDirectReply(faqIntent, 'fr')
      try {
        const { HEL_CLINIC } = require('./crm/smart/defaults')
        const lang = languageHint === 'darija' || languageHint === 'ar' ? 'darija' : 'fr'
        if (!faqReply && faqIntent === 'ASK_LOCATION') {
          faqReply = lang === 'darija'
            ? `العنوان ديالنا:\n${HEL_CLINIC.address}`
            : `Notre adresse :\n${HEL_CLINIC.address}`
        } else if (!faqReply && faqIntent === 'ASK_OPENING_HOURS') {
          faqReply = lang === 'darija'
            ? 'كنخدمو من الإثنين للسبت (الصباح والعشية حسب اليوم).'
            : 'Nous sommes ouverts du lundi au samedi (matin et après-midi selon le jour).'
        } else if (!faqReply && faqIntent === 'ASK_PRICE') {
          faqReply = lang === 'darija'
            ? 'الأثمنة كتعتمد على الفحص. عافاك عيط لينا على المركز باش نعطيوك تقدير دقيق، ولا كمّل الحجز و الفريق غادي يتواصل معاك.'
            : 'Les tarifs dépendent de l’examen. Appelez le cabinet pour un devis précis, ou poursuivez la prise de rendez-vous — l’équipe vous recontactera.'
        }
      } catch {
        /* keep faqReply */
      }

      if (faqReply) {
        const resume = buildBookingResumeHint(leadPeekFaq, languageHint)
        const fullReply = resume ? `${faqReply}\n\n${resume}` : faqReply
        if (process.env.CRM_DEBUG_BOOKING === '1') {
          console.log('[booking-interrupt]', {
            state: leadPeekFaq?.stage,
            awaiting: leadPeekFaq?.awaiting_field,
            intent: faqIntent,
            resumeState: leadPeekFaq?.awaiting_field,
          })
        }
        try {
          crm.smart?.trackWhatsAppTurn?.({
            chatId: options.chatId || key,
            conversationId: key,
            outboundText: fullReply,
            outboundAuthor: 'ai',
            contactName: options.contactName || null,
          })
        } catch (trackError) {
          console.warn('[iadis-wa] smart track failed', trackError.message || trackError)
        }
        setAiConversationHistory(key, [
          ...history,
          { role: 'user', content: isVoice && cleanPatientText ? `[vocal] ${cleanPatientText}` : content },
          { role: 'assistant', content: fullReply },
        ])
        return {
          reply: fullReply,
          reason: 'booking_faq_interrupt',
          model: openAiModel,
          language_hint: languageHint,
          is_voice: isVoice,
          intent: faqIntent,
          intent_confidence: faqConf,
          should_skip_llm: true,
          router,
          lead: leadPeekFaq,
        }
      }
    }

    // Identity FAQ outside booking — never seed a name / never open form
    if (
      !isVoice
      && faqConf >= 0.7
      && (faqIntent === 'ASK_IDENTITY' || faqIntent === 'ASK_PHONE')
      && !bookingDraftActive
    ) {
      const identityReply = buildIntentDirectReply(faqIntent, languageHint)
        || buildIntentDirectReply(faqIntent, 'fr')
      if (identityReply) {
        setAiConversationHistory(key, [
          ...history,
          { role: 'user', content: isVoice && cleanPatientText ? `[vocal] ${cleanPatientText}` : content },
          { role: 'assistant', content: identityReply },
        ])
        return {
          reply: identityReply,
          reason: faqIntent === 'ASK_IDENTITY' ? 'ask_identity_direct' : 'ask_phone_direct',
          model: openAiModel,
          language_hint: languageHint,
          is_voice: isVoice,
          intent: faqIntent,
          intent_confidence: faqConf,
          should_skip_llm: true,
          router,
        }
      }
    }

    let crmTurn = null
    if (crm) {
      try {
        crmTurn = await crm.processCrmTurn({
          conversationId: key,
          chatId: options.chatId || null,
          phoneDigits: options.phoneDigits || options.phoneNumber || null,
          userText: patientPlainText,
          isVoice,
          voiceIntent: router.bookAppointment
            ? 'BOOK_APPOINTMENT'
            : (voiceNlu?.intent || options.voiceIntent || router.intent || null),
          voiceService: router.service
            ? {
              service: router.service,
              serviceId: router.serviceId,
              confidence: router.serviceConfidence,
              matched: router.serviceMatched,
              crmProblem: router.service,
              urgency: null,
            }
            : (() => {
              const base = voiceNlu?.serviceDetection || options.voiceService || null
              if (!base) return null
              const problem = voiceNlu?.interpreter?.problem || voiceNlu?.entities?.problem || null
              return {
                ...base,
                crmProblem: problem || base.crmProblem,
              }
            })(),
          languageHint,
          router,
          routingState,
        })
      } catch (error) {
        console.error('[iadis-wa] CRM turn failed', {
          conversation_id: key,
          reason: error.message || String(error),
        })
      }
    }

    // Exact CRM templates — never rewrite with AI.
    const crmReplies = Array.isArray(crmTurn?.forceReplies) && crmTurn.forceReplies.length
      ? crmTurn.forceReplies.map((item) => String(item || '').trim()).filter(Boolean)
      : (crmTurn?.shouldSkipLlm && crmTurn.forceReply ? [String(crmTurn.forceReply).trim()] : [])
    if (crmTurn?.shouldSkipLlm && crmReplies.length) {
      if (crmTurn.conversationReset) {
        setAiConversationHistory(key, [])
        try {
          resetNluUnclearCount(key)
        } catch { /* optional */ }
      }
      if (crm?.smart && !crm.smart.canAiAutoReply(key) && !crm.smart.canAiAutoReply(options.chatId || key)) {
        return { reply: null, reason: 'human_handoff_or_assistant_paused' }
      }
      const historyUserContent = isVoice && cleanPatientText
        ? `[vocal] ${cleanPatientText}`
        : content
      if (crm) {
        for (const outboundText of crmReplies) {
          crm.repo.logConversation({
            conversation_id: key,
            whatsapp_chat_id: options.chatId || null,
            customer_id: crmTurn.booking?.customer?.id || null,
            direction: 'outbound',
            message_text: outboundText,
            extracted: {
              ...(crmTurn.extracted || {}),
              router,
            },
            appointment_status: crmTurn.lead?.stage || null,
          })
          try {
            crm.smart?.trackWhatsAppTurn?.({
              chatId: options.chatId || key,
              conversationId: key,
              customerId: crmTurn.booking?.customer?.id || null,
              language: languageHint === 'darija' || languageHint === 'ar' ? 'darija' : 'fr',
              outboundText,
              outboundAuthor: 'ai',
              contactName: options.contactName || null,
            })
          } catch (trackError) {
            console.warn('[iadis-wa] smart track failed', trackError.message || trackError)
          }
        }
      }
      if (crmTurn.booking) {
        void enrichBookingMotifWithAi(crmTurn.booking)
        setAiConversationHistory(key, [])
        console.log('[iadis-wa] conversation memory cleared after booking', { conversation_id: key })
      } else {
        setAiConversationHistory(key, [
          ...history,
          { role: 'user', content: historyUserContent },
          ...crmReplies.map((outboundText) => ({ role: 'assistant', content: outboundText })),
        ])
      }
      return {
        reply: crmReplies[0],
        extraReplies: crmReplies.slice(1),
        reason: crmTurn.booking ? 'crm_booking_confirmed' : 'crm_workflow',
        model: openAiModel,
        language_hint: languageHint,
        is_voice: isVoice,
        intent: router.intent,
        intent_confidence: router.intentConfidence,
        service: router.service,
        crm_booking: crmTurn.booking || null,
        crm_stage: crmTurn.lead?.stage || null,
        router,
      }
    }

    const apiUserContent = isVoice
      ? [
        languageDirective,
        '',
        router.llmBlock,
        voiceNlu?.llmBlock || null,
        crmTurn?.llmContext || null,
        '',
        'Patient voice-note question to answer now:',
        cleanPatientText || content,
        voiceNlu?.meaningHint ? `Meaning hint: ${voiceNlu.meaningHint}` : null,
        '',
        'Write a direct useful answer using the INTENT ROUTER RESULT above. Do not re-detect language/intent/service.',
      ].filter((line) => line !== null).join('\n')
      : [
        languageDirective,
        router.llmBlock,
        crmTurn?.llmContext || null,
        '',
        `Patient message:\n${content}`,
        '',
        'Write the reply using the INTENT ROUTER RESULT above. Do not re-detect language/intent/service.',
      ].filter((line) => line !== null).join('\n')
    const input = [
      ...history,
      { role: 'user', content: apiUserContent },
    ]
    const requestBody = {
      model: openAiModel,
      instructions: buildOpenAiInstructions(),
      input,
      max_output_tokens: openAiMaxOutputTokens,
      store: false,
    }

    if (openAiReasoningEffort) {
      requestBody.reasoning = { effort: openAiReasoningEffort }
    }

    const response = await openAiClient.responses.create(requestBody)
    const reply = extractOpenAiOutputText(response)
    if (!reply) {
      const error = new Error('OpenAI returned no text output')
      error.code = 'OPENAI_EMPTY_OUTPUT'
      throw error
    }

    // Final guard — never send AI reply if human took over during OpenAI generation
    if (crm?.smart && !crm.smart.canAiAutoReply(key) && !crm.smart.canAiAutoReply(options.chatId || key)) {
      console.log('[iadis-wa] AI reply discarded after generation (human control)', {
        conversation_id: key,
      })
      return { reply: null, reason: 'human_handoff_or_assistant_paused' }
    }

    const historyUserContent = isVoice && cleanPatientText
      ? `[vocal] ${cleanPatientText}`
      : content

    if (crm) {
      crm.repo.logConversation({
        conversation_id: key,
        whatsapp_chat_id: options.chatId || null,
        customer_id: crmTurn?.booking?.customer?.id || null,
        direction: 'outbound',
        message_text: reply,
        extracted: crmTurn?.extracted || null,
        appointment_status: crmTurn?.lead?.stage || null,
      })
      try {
        crm.smart?.trackWhatsAppTurn?.({
          chatId: options.chatId || key,
          conversationId: key,
          customerId: crmTurn?.booking?.customer?.id || null,
          language: languageHint === 'darija' || languageHint === 'ar' ? 'darija' : 'fr',
          outboundText: reply,
          outboundAuthor: 'ai',
          contactName: options.contactName || null,
        })
      } catch (trackError) {
        console.warn('[iadis-wa] smart track failed', trackError.message || trackError)
      }
    }

    if (crmTurn?.booking) {
      void enrichBookingMotifWithAi(crmTurn.booking)
      setAiConversationHistory(key, [])
      console.log('[iadis-wa] conversation memory cleared after booking', { conversation_id: key })
    } else {
      setAiConversationHistory(key, [
        ...history,
        { role: 'user', content: historyUserContent },
        { role: 'assistant', content: reply },
      ])
    }

    console.log('[iadis-wa] reply language hint', {
      conversation_id: key,
      language_hint: languageHint,
      is_voice: isVoice,
      crm_stage: crmTurn?.lead?.stage || null,
    })

    return {
      reply,
      reason: crmTurn?.booking ? 'crm_booking_confirmed_ai' : 'openai_response',
      model: openAiModel,
      response_id: response.id || null,
      language_hint: languageHint,
      is_voice: isVoice,
      intent: router.intent,
      intent_confidence: router.intentConfidence,
      service: router.service,
      crm_booking: crmTurn?.booking || null,
      crm_stage: crmTurn?.lead?.stage || null,
      router,
    }
  })
}

async function getStandaloneIncomingDecision(normalizedPayload, context = {}) {
  const conversationId = String(
    context.conversationId
      || normalizedPayload?.meta?.chat_id
      || normalizedPayload?.from
      || '',
  ).trim()

  try {
    const meta = normalizedPayload?.meta || {}
    const chatbot = await generateStandaloneAiReply(conversationId, normalizedPayload?.content, {
      isVoice: Boolean(meta.is_audio || meta.audio_transcript || meta.voice_nlu),
      audioTranscript: meta.audio_transcript || meta.voice_nlu?.correctedText || null,
      languageHint: meta.reply_language_hint || meta.voice_nlu?.replyLanguageHint || null,
      voiceNlu: meta.voice_nlu || null,
      chatId: meta.chat_id || null,
      phoneDigits: normalizePhone(
        meta.contact_phone
        || (isLidChatId(normalizedPayload?.from) ? '' : normalizedPayload?.from)
        || meta.participant_phone
        || '',
      ),
      phoneNumber: meta.contact_phone
        || coerceIncomingPhone(isLidChatId(normalizedPayload?.from) ? '' : (normalizedPayload?.from || '')),
      voiceIntent: meta.voice_nlu?.intent || null,
      providerMessageId: normalizedPayload?.provider_message_id || null,
      contactName: normalizedPayload?.contact_name || null,
      mediaPath: meta.crm_media?.media_path || null,
      mediaMime: meta.crm_media?.media_mime || null,
      mediaFilename: meta.crm_media?.media_filename || null,
      mediaSize: meta.crm_media?.media_size || null,
      inboundMediaType: meta.crm_media?.message_type || null,
    })
    return {
      conversation: null,
      chatbot,
    }
  } catch (error) {
    const details = error.response?.data?.error?.message || error.message || String(error)
    console.error('[iadis-wa] OpenAI response failed', {
      conversation_id: conversationId,
      model: openAiModel,
      reason: details,
    })

    return {
      conversation: null,
      chatbot: {
        reply: aiErrorReply || null,
        reason: 'openai_error',
        model: openAiModel,
      },
    }
  }
}

function getAutomationState(messageId, channel) {
  const normalizedMessageId = String(messageId || '').trim()
  const normalizedChannel = String(channel || '').trim()
  if (!normalizedMessageId || !normalizedChannel) {
    return null
  }

  const entry = automationState[normalizedMessageId]
  if (!entry || typeof entry !== 'object') {
    return null
  }

  const channelEntry = entry[normalizedChannel]
  return channelEntry && typeof channelEntry === 'object' ? channelEntry : null
}

function hasSuccessfulAutomation(messageId, channel) {
  return getAutomationState(messageId, channel)?.status === 'processed'
}

function hasTerminalAutomation(messageId, channel) {
  const status = String(getAutomationState(messageId, channel)?.status || '').toLowerCase()
  return status === 'processed' || status === 'ignored'
}

function hasFailedAutomation(messageId, channel) {
  return getAutomationState(messageId, channel)?.status === 'failed'
}

function canRetryAutomation(messageId, channel) {
  const state = getAutomationState(messageId, channel)
  if (!state) {
    return true
  }

  const status = String(state.status || '').toLowerCase()
  if (status === 'processed' || status === 'ignored') {
    return false
  }

  if (status !== 'failed') {
    return true
  }

  const attemptCount = Number(state.attempt_count || 0)
  if (automationRetryMaxAttempts > 0 && attemptCount >= automationRetryMaxAttempts) {
    return false
  }

  const updatedAt = Date.parse(String(state.updated_at || ''))
  if (Number.isFinite(updatedAt) && automationRetryCooldownMs > 0) {
    return (Date.now() - updatedAt) >= automationRetryCooldownMs
  }

  return true
}

function updateAutomationState(messageId, channel, payload = {}) {
  const normalizedMessageId = String(messageId || '').trim()
  const normalizedChannel = String(channel || '').trim()
  if (!normalizedMessageId || !normalizedChannel) {
    return
  }

  const existing = automationState[normalizedMessageId]
  automationState[normalizedMessageId] = existing && typeof existing === 'object' ? existing : {}
  const existingChannel = automationState[normalizedMessageId][normalizedChannel]
  const attemptCount = Number(existingChannel?.attempt_count || 0) + 1
  const firstAttemptAt = existingChannel?.first_attempt_at || nowIso()
  automationState[normalizedMessageId][normalizedChannel] = {
    status: String(payload.status || 'unknown'),
    reason: payload.reason || null,
    updated_at: nowIso(),
    first_attempt_at: firstAttemptAt,
    attempt_count: attemptCount,
    target: payload.target || null,
    attachment: payload.attachment || null,
    stderr: payload.stderr || null,
    stdout: payload.stdout || null,
    output: payload.output || null,
  }

  try {
    persistAutomationState()
  } catch (error) {
    console.warn('[iadis-wa] unable to persist automation state file', {
      path: automationStatePath,
      reason: error.message || String(error),
    })
  }
}

function ensureInternalToken(req, res, next) {
  if (!serviceToken) {
    return next()
  }

  const tokenFromHeader = req.header('x-service-token') || req.header('x-api-key') || ''
  if (tokenFromHeader !== serviceToken) {
    return res.status(401).json({ ok: false, error: 'Invalid service token' })
  }

  return next()
}


async function notifyCrmStaffBooking(record, booking) {
  if (!crm || !booking?.staffNotification) {
    return
  }

  const text = crm.staffNotificationText(booking)
  console.log('[iadis-wa] CRM staff notification created', {
    appointment_id: booking.appointment?.id || null,
    customer: booking.customer?.full_name || null,
  })

  if (!crmStaffNotifyChatId || !record?.client) {
    return
  }

  try {
    await record.client.sendMessage(crmStaffNotifyChatId, text)
    crm.repo.markStaffNotificationSent(booking.staffNotification.id)
    console.log('[iadis-wa] CRM staff WhatsApp notification sent', {
      chat_id: crmStaffNotifyChatId,
      appointment_id: booking.appointment?.id || null,
    })
  } catch (error) {
    console.error('[iadis-wa] CRM staff WhatsApp notification failed', {
      chat_id: crmStaffNotifyChatId,
      reason: error.message || String(error),
    })
  }
}

function listVoiceNluOrders(limit = 40) {
  const root = aiVoiceNluLogDir
  if (!root || !fs.existsSync(root)) {
    return []
  }

  try {
    const files = fs.readdirSync(root)
      .filter((name) => name.endsWith('.json'))
      .map((name) => {
        const fullPath = path.join(root, name)
        const stat = fs.statSync(fullPath)
        return { name, fullPath, mtimeMs: stat.mtimeMs }
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, Math.max(1, Number(limit) || 40))

    return files.map((file) => {
      try {
        const payload = JSON.parse(fs.readFileSync(file.fullPath, 'utf8'))
        return {
          id: file.name.replace(/\.json$/i, ''),
          created_at: payload.saved_at || new Date(file.mtimeMs).toISOString(),
          chat_id: payload.chat_id || null,
          message_id: payload.message_id || null,
          intention: payload.intention || 'autre',
          langue: payload.langue_detectee || null,
          confiance: payload.score_confiance ?? null,
          transcription: payload.transcription_corrigee || payload.transcription_brute || '',
          reponse: payload.reponse_generee || null,
          statut: payload.reponse_generee ? 'traitee' : 'en_attente',
        }
      } catch {
        return null
      }
    }).filter(Boolean)
  } catch {
    return []
  }
}

function verifyWebhookSecret(req, res, next) {
  if (!webhookSecret) {
    return next()
  }

  const secretFromHeader = req.header('x-webhook-secret') || ''
  const secretFromQuery = req.query.secret || ''

  if (secretFromHeader !== webhookSecret && secretFromQuery !== webhookSecret) {
    return res.status(401).json({ ok: false, error: 'Invalid webhook secret' })
  }

  return next()
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null) {
    return fallback
  }

  const normalized = String(value).trim().toLowerCase()
  if (!normalized) {
    return fallback
  }

  return ['1', 'true', 'yes', 'on'].includes(normalized)
}

function parseCsvList(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
}

function timeoutAfter(ms, label = 'Operation') {
  return new Promise((_, reject) => {
    setTimeout(() => {
      const error = new Error(`${label} timed out after ${ms}ms`)
      error.code = 'WA_TIMEOUT'
      reject(error)
    }, ms)
  })
}

function isProtocolTimeoutError(error) {
  const message = String(error?.message || error || '').toLowerCase()
  return Boolean(
    message.includes('runtime.callfunctionon timed out')
    || message.includes('protocol error')
    || message.includes('execution context was destroyed')
    || message.includes('detached frame')
    || message.includes('target closed')
    || error?.code === 'WA_TIMEOUT',
  )
}

async function runWithRetries(action, label, options = {}) {
  const attempts = Number(options.attempts || 3)
  const delayMs = Number(options.delayMs || 1500)

  let lastError = null
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await action()
    } catch (error) {
      lastError = error
      if (!isProtocolTimeoutError(error) || attempt >= attempts) {
        throw error
      }

      console.warn('[iadis-wa] retrying browser operation', {
        label,
        attempt,
        reason: error.message || String(error),
      })
      await sleep(delayMs * attempt)
    }
  }

  throw lastError || new Error(`${label} failed`)
}

function getAutomationChatIds() {
  return Array.from(new Set([
    ...(odooAutomationEnabled ? odooAutomationChats : []),
    ...(reportingAutomationEnabled ? reportingAutomationChats : []),
  ])).filter(Boolean)
}

function truncateText(value, maxLength = 400) {
  const raw = String(value || '')
  if (raw.length <= maxLength) {
    return raw
  }

  return `${raw.slice(0, maxLength)}...`
}

function normalizeTwilioPayload(payload) {
  const rawFrom = payload.From || payload.from || ''
  return {
    from: coerceIncomingPhone(rawFrom),
    contact_name: payload.ProfileName || payload.profile_name || payload.name || null,
    content: payload.Body || payload.body || '',
    provider: 'twilio',
    provider_message_id: payload.MessageSid || payload.message_sid || null,
    meta: payload,
  }
}

function normalizeMetaPayload(payload) {
  const entry = Array.isArray(payload.entry) ? payload.entry[0] : null
  const change = entry?.changes?.[0]
  const value = change?.value || {}
  const message = value?.messages?.[0] || {}
  const text = message?.text?.body || message?.button?.text || ''

  return {
    from: coerceIncomingPhone(message?.from || ''),
    contact_name: value?.contacts?.[0]?.profile?.name || null,
    content: text,
    provider: 'meta',
    provider_message_id: message?.id || null,
    meta: payload,
  }
}

function normalizeCustomPayload(payload) {
  const rawFrom = payload.from || payload.phone || ''
  return {
    from: coerceIncomingPhone(rawFrom),
    contact_name: payload.contact_name || payload.name || null,
    company: payload.company || null,
    content: payload.content || payload.message || payload.text || '',
    provider: payload.provider || provider,
    provider_message_id: payload.provider_message_id || null,
    meta: payload.meta || payload,
  }
}

function normalizeIncomingPayload(payload) {
  if (provider === 'twilio') {
    return normalizeTwilioPayload(payload)
  }

  if (provider === 'meta') {
    return normalizeMetaPayload(payload)
  }

  return normalizeCustomPayload(payload)
}

function normalizeInstanceId(value) {
  const normalized = String(value || 'main').trim()
  return normalized || 'main'
}

function isLidChatId(value) {
  return String(value || '').toLowerCase().includes('@lid')
}

function normalizePhone(value) {
  const raw = String(value || '').trim()
  if (!raw) {
    return ''
  }

  // WhatsApp LID is NOT a phone number — never extract digits as MSISDN
  if (isLidChatId(raw)) {
    return ''
  }

  const withoutPrefix = raw.replace(/^whatsapp:/i, '')

  if (withoutPrefix.includes('@')) {
    const lower = withoutPrefix.toLowerCase()
    // Only treat @c.us / @s.whatsapp.net as telephone JIDs
    if (!lower.includes('@c.us') && !lower.includes('@s.whatsapp.net')) {
      return ''
    }
    const beforeAt = withoutPrefix.split('@')[0] || ''
    const beforeDeviceSuffix = beforeAt.split(':')[0] || beforeAt
    const digitsFromJid = beforeDeviceSuffix.replace(/\D+/g, '')
    if (digitsFromJid) {
      return digitsFromJid
    }
  }

  const digits = withoutPrefix.replace(/\D+/g, '')
  return digits || ''
}

function coerceIncomingPhone(value) {
  if (isLidChatId(value)) {
    return ''
  }
  const digits = normalizePhone(value)
  if (!digits) {
    return ''
  }

  return `+${digits}`
}

function isGroupChatId(value) {
  return String(value || '').trim().includes('@g.us')
}

function resolveInboundConversationKey(chatId, senderId, groupChat) {
  if (groupChat) {
    const groupDigits = normalizePhone(chatId)
    if (groupDigits) {
      return `+${groupDigits}`
    }

    const fallback = String(chatId || '').trim()
    return fallback ? `group:${fallback}` : ''
  }

  const rawChat = String(chatId || '').trim()
  const rawSender = String(senderId || chatId || '').trim()

  // Keep @lid as technical conversation key — never invent +digits from LID
  if (isLidChatId(rawChat) || isLidChatId(rawSender)) {
    return rawChat.includes('@') ? rawChat : rawSender
  }

  const senderDigits = normalizePhone(rawSender)
  if (!senderDigits) {
    return rawChat.includes('@') ? rawChat : ''
  }

  return `+${senderDigits}`
}

function resolveChatMatchers(chatId) {
  const matchers = []
  const normalized = String(chatId || '').trim().toLowerCase()
  if (normalized) {
    matchers.push(normalized)
  }

  const digits = normalizePhone(chatId)
  if (digits) {
    matchers.push(digits.toLowerCase())
    matchers.push(`+${digits}`.toLowerCase())
  }

  return matchers
}

function isStatusOrBroadcastChatId(chatId) {
  const id = String(chatId || '').trim().toLowerCase()
  return id === 'status@broadcast'
    || id.endsWith('@broadcast')
    || id.endsWith('@newsletter')
}

function isChatbotBlockedForChat(chatId) {
  if (isStatusOrBroadcastChatId(chatId)) {
    return true
  }

  if (isReportingAutomationChatId(chatId)) {
    return true
  }

  if (blockedChatbotChats.size === 0) {
    return false
  }

  const matchers = resolveChatMatchers(chatId)
  return matchers.some((item) => blockedChatbotChats.has(item))
}

function isReportingAutomationChatId(chatId) {
  if (reportingAutomationChats.size === 0) {
    return false
  }

  const matchers = resolveChatMatchers(chatId)
  return matchers.some((item) => reportingAutomationChats.has(item))
}

function shouldRunOdooAutomation(chatId, hasMedia) {
  if (!odooAutomationEnabled || !hasMedia) {
    return false
  }

  if (odooAutomationChats.size === 0) {
    return false
  }

  const matchers = resolveChatMatchers(chatId)
  return matchers.some((item) => odooAutomationChats.has(item))
}

function shouldSendOdooSuccessReaction(chatId) {
  if (odooSuccessReactionChats.size === 0 || !odooSuccessReactionEmoji) {
    return false
  }

  const matchers = resolveChatMatchers(chatId)
  return matchers.some((item) => odooSuccessReactionChats.has(item))
}

function isSpreadsheetMedia(media) {
  if (!media) {
    return false
  }

  const mime = String(media.mimeType || '').toLowerCase()
  if (
    mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    || mime === 'application/vnd.ms-excel'
    || mime === 'text/csv'
  ) {
    return true
  }

  const filename = String(media.filename || '').toLowerCase()
  return filename.endsWith('.xlsx') || filename.endsWith('.xls') || filename.endsWith('.csv')
}

function shouldRunReportingAutomation(chatId, media) {
  if (!reportingAutomationEnabled || !media || !isSpreadsheetMedia(media)) {
    return false
  }

  return isReportingAutomationChatId(chatId)
}

function shouldRunReportingOdooAutomation(chatId, content, hasMedia) {
  if (!reportingAutomationEnabled || hasMedia || !isReportingAutomationChatId(chatId)) {
    return false
  }

  const normalizedContent = String(content || '').trim().toLowerCase()
  if (!normalizedContent) {
    return false
  }

  if (reportingOdooTriggerKeywords.length === 0) {
    return false
  }

  return reportingOdooTriggerKeywords.some((keyword) => normalizedContent.includes(keyword))
}

function extensionFromMimeType(mimeType) {
  const mime = String(mimeType || '').toLowerCase()
  if (mime === 'application/pdf') {
    return '.pdf'
  }
  if (
    mime === 'application/x-msdownload'
    || mime === 'application/vnd.microsoft.portable-executable'
  ) {
    return '.exe'
  }
  if (mime === 'image/png') {
    return '.png'
  }
  if (mime === 'image/jpeg' || mime === 'image/jpg') {
    return '.jpg'
  }
  if (mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    return '.xlsx'
  }
  if (mime === 'application/vnd.ms-excel') {
    return '.xls'
  }
  if (mime === 'text/csv') {
    return '.csv'
  }
  if (mime.includes('ogg') || mime.includes('opus')) {
    return '.ogg'
  }
  if (mime.includes('mpeg') || mime.includes('mp3')) {
    return '.mp3'
  }
  if (mime.includes('mp4') || mime.includes('m4a')) {
    return '.m4a'
  }
  if (mime.includes('webm')) {
    return '.webm'
  }
  if (mime.includes('wav')) {
    return '.wav'
  }
  if (mime.includes('aac')) {
    return '.aac'
  }

  return '.bin'
}

function audioFormatFromMimeType(mimeType, filename = '') {
  const mime = String(mimeType || '').toLowerCase()
  const name = String(filename || '').toLowerCase()

  if (mime.includes('ogg') || mime.includes('opus') || name.endsWith('.ogg') || name.endsWith('.opus')) {
    return 'ogg'
  }
  if (mime.includes('mpeg') || mime.includes('mp3') || name.endsWith('.mp3')) {
    return 'mp3'
  }
  if (mime.includes('mp4') || mime.includes('m4a') || name.endsWith('.m4a') || name.endsWith('.mp4')) {
    return 'm4a'
  }
  if (mime.includes('webm') || name.endsWith('.webm')) {
    return 'webm'
  }
  if (mime.includes('wav') || name.endsWith('.wav')) {
    return 'wav'
  }
  if (mime.includes('aac') || name.endsWith('.aac')) {
    return 'aac'
  }
  if (mime.includes('flac') || name.endsWith('.flac')) {
    return 'flac'
  }

  // WhatsApp voice notes are usually OGG/Opus.
  return 'ogg'
}

function isAudioMessageType(messageType = '') {
  const type = String(messageType || '').toLowerCase()
  return type === 'ptt' || type === 'audio' || type === 'voice' || type === 'ptv'
}

function isAudioMedia(media, messageType = '') {
  if (isAudioMessageType(messageType)) {
    return true
  }

  const mime = String(media?.mimeType || '').toLowerCase()
  return mime.startsWith('audio/')
}

function isImageMedia(media, messageType = '') {
  const type = String(messageType || '').toLowerCase()
  if (type === 'image' || type === 'sticker') return true
  const mime = String(media?.mimeType || media?.mimetype || '').toLowerCase()
  return mime.startsWith('image/')
}

/**
 * Copy inbound/outbound media into durable CRM storage (not tmp).
 * Returns relative path under storage/media for DB reference.
 */
function persistCrmMediaFile(sourcePath, {
  conversationKey = 'unknown',
  filename = 'image.jpg',
  mimeType = 'image/jpeg',
} = {}) {
  const src = String(sourcePath || '').trim()
  if (!src || !fs.existsSync(src)) return null

  const safeKey = String(conversationKey || 'unknown')
    .replace(/[^a-zA-Z0-9@._-]+/g, '_')
    .slice(0, 80) || 'unknown'
  const dir = path.join(crmMediaDir, safeKey)
  fs.mkdirSync(dir, { recursive: true })

  const ext = extensionFromMimeType(mimeType) || path.extname(filename) || '.jpg'
  const safeName = sanitizeFilename(
    `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`,
    `image${ext}`,
  )
  const dest = path.join(dir, safeName)
  fs.copyFileSync(src, dest)

  // Store path relative to cwd for portability
  const relative = path.relative(process.cwd(), dest).replace(/\\/g, '/')
  return {
    absolutePath: dest,
    mediaPath: relative,
    mediaFilename: filename || safeName,
    mediaMime: mimeType,
    mediaSize: fs.statSync(dest).size,
  }
}

function scoreTranscriptQuality(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return -100
  }

  const lower = normalized.toLowerCase()
  const junkExact = new Set([
    'thank you',
    'thank you.',
    'thanks',
    'thanks.',
    'you',
    'you.',
    'merci',
    'merci.',
    'ok',
    'okay',
    '...',
    '.',
    '♪',
    '[music]',
    '[musique]',
  ])
  if (junkExact.has(lower)) {
    return -80
  }

  const junkPatterns = [
    /^thanks for watching/i,
    /^sous-titres?\b/i,
    /^subtitles?\b/i,
    /^amara\.org/i,
    /^www\./i,
    /^https?:\/\//i,
    /^\[.*music.*\]$/i,
  ]
  if (junkPatterns.some((pattern) => pattern.test(normalized))) {
    return -70
  }

  const arabicChars = (normalized.match(/[\u0600-\u06FF]/g) || []).length
  const latinChars = (normalized.match(/[A-Za-zÀ-ÿ]/g) || []).length
  const letters = arabicChars + latinChars
  if (letters < 2) {
    return -40
  }

  let score = letters * 2 + Math.min(normalized.length, 120)

  // Boost Moroccan Darija / Arabic-script transcripts (common failure mode otherwise).
  if (arabicChars >= 3) {
    score += 18 + Math.min(arabicChars, 40)
  }

  const darijaMarkers = /\b(salam|bghit|bghiti|wach|wash|kifash|kifach|3ndi|andi|sennan|sinnan|mow3id|موعد|سنان|ضر|وجع|بغيت|عندي|لثة)\b/i
  if (darijaMarkers.test(normalized)) {
    score += 12
  }

  // Penalize very short "ghost" transcripts that often appear on quiet/noisy audio.
  if (letters < 6 && normalized.split(/\s+/).length <= 2) {
    score -= 10
  }

  return score
}

function isWeakTranscript(text) {
  return scoreTranscriptQuality(text) < 16
}

function resolveFfmpegBinary() {
  const configured = String(process.env.FFMPEG_PATH || '').trim()
  if (configured && fs.existsSync(configured)) {
    return configured
  }

  try {
    const ffmpegStatic = require('ffmpeg-static')
    if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
      return ffmpegStatic
    }
  } catch {
    // optional dependency
  }

  return null
}

async function enhanceAudioForTranscription(inputPath) {
  const ffmpegBinary = resolveFfmpegBinary()
  if (!ffmpegBinary || !aiAudioEnhanceEnabled) {
    return null
  }

  const outputPath = path.join(
    mediaTmpDir,
    `enhanced-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.wav`,
  )

  const filterCandidates = [
    // Quiet voice boost + light denoise + band-limit for speech.
    'highpass=f=80,lowpass=f=7500,afftdn=nf=-20,dynaudnorm=f=75:g=15',
    // Safer fallback without denoise filter.
    'highpass=f=80,lowpass=f=7500,dynaudnorm=f=75:g=15',
    // Minimal fallback.
    'dynaudnorm=f=100:g=12',
  ]

  let lastError = null
  for (const filter of filterCandidates) {
    try {
      await execFileAsync(
        ffmpegBinary,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-i',
          inputPath,
          '-ac',
          '1',
          '-ar',
          '16000',
          '-af',
          filter,
          outputPath,
        ],
        { timeout: 60000, windowsHide: true },
      )

      if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
        return {
          filePath: outputPath,
          format: 'wav',
          filter,
        }
      }
    } catch (error) {
      lastError = error
      cleanupTempFile(outputPath)
    }
  }

  if (lastError) {
    console.warn('[iadis-wa] audio enhance failed, using original audio', {
      reason: lastError.message || String(lastError),
    })
  }

  return null
}

async function requestAudioTranscription(audioBytes, format, options = {}) {
  const model = String(options.model || openAiTranscribeModel).trim()
  const language = options.language ? String(options.language).trim() : ''
  const prompt = String(options.prompt || openAiTranscribePrompt || '').trim()
  const isOpenRouter = openAiTranscribeBaseUrl.includes('openrouter.ai')

  if (isOpenRouter) {
    const body = {
      model,
      temperature: 0,
      input_audio: {
        data: audioBytes.toString('base64'),
        format,
      },
    }
    if (language) {
      body.language = language
    }
    if (prompt) {
      body.prompt = prompt
    }

    const response = await axios.post(
      `${openAiTranscribeBaseUrl}/audio/transcriptions`,
      body,
      {
        headers: {
          Authorization: `Bearer ${openAiTranscribeApiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://centredentairehel.ma',
          'X-Title': 'Centre Dentaire HEL WhatsApp Bot',
        },
        timeout: Math.max(openAiTimeoutMs, 90000),
      },
    )

    return String(response.data?.text || '').trim()
  }

  if (!openAiClient) {
    const error = new Error('OpenAI client is not configured for transcription')
    error.code = 'TRANSCRIBE_NOT_CONFIGURED'
    throw error
  }

  const { toFile } = require('openai')
  const file = await toFile(audioBytes, `voice.${format}`)
  const requestBody = {
    file,
    model,
    temperature: 0,
  }
  if (language) {
    requestBody.language = language
  }
  if (prompt) {
    requestBody.prompt = prompt
  }

  const result = await openAiClient.audio.transcriptions.create(requestBody)
  return String(result?.text || '').trim()
}

async function transcribeAudioMedia(media) {
  if (!media?.filePath || !fs.existsSync(media.filePath)) {
    const error = new Error('Audio file is missing for transcription')
    error.code = 'AUDIO_FILE_MISSING'
    throw error
  }

  if (!openAiTranscribeApiKey) {
    const error = new Error('Transcription API key is not configured')
    error.code = 'TRANSCRIBE_NOT_CONFIGURED'
    throw error
  }

  const originalFormat = audioFormatFromMimeType(media.mimeType, media.filename)
  const originalBytes = fs.readFileSync(media.filePath)
  const enhanced = await enhanceAudioForTranscription(media.filePath)
  const sources = []

  if (enhanced?.filePath) {
    sources.push({
      tag: 'enhanced',
      format: enhanced.format || 'wav',
      bytes: fs.readFileSync(enhanced.filePath),
      filter: enhanced.filter || null,
    })
    console.log('[iadis-wa] audio enhanced for transcription', {
      filter: enhanced.filter || null,
      bytes: sources[0].bytes.length,
    })
  }

  sources.push({
    tag: 'original',
    format: originalFormat,
    bytes: originalBytes,
    filter: null,
  })

  // Prioritize Arabic/Darija early: quiet Darija often fails on auto/French-only passes.
  const attemptPlan = [
    { model: openAiTranscribeModel, language: 'ar', prompt: openAiTranscribeDarijaPrompt, label: 'ar-darija' },
    { model: openAiTranscribeModel, language: '', prompt: openAiTranscribePrompt, label: 'auto' },
    { model: openAiTranscribeModel, language: 'fr', prompt: openAiTranscribePrompt, label: 'fr' },
  ]
  if (openAiTranscribeFallbackModel && openAiTranscribeFallbackModel !== openAiTranscribeModel) {
    attemptPlan.push({
      model: openAiTranscribeFallbackModel,
      language: 'ar',
      prompt: openAiTranscribeDarijaPrompt,
      label: `fallback-ar:${openAiTranscribeFallbackModel}`,
    })
    attemptPlan.push({
      model: openAiTranscribeFallbackModel,
      language: '',
      prompt: openAiTranscribePrompt,
      label: `fallback:${openAiTranscribeFallbackModel}`,
    })
  }

  let bestText = ''
  let bestScore = -Infinity
  let bestLabel = null
  const trialLog = []

  try {
    for (const source of sources) {
      for (const attempt of attemptPlan) {
        // After a strong hit, skip remaining expensive retries.
        if (!isWeakTranscript(bestText) && bestScore >= 36) {
          break
        }

        const label = `${source.tag}:${attempt.label}`
        try {
          const text = await requestAudioTranscription(source.bytes, source.format, {
            model: attempt.model,
            language: attempt.language,
            prompt: attempt.prompt,
          })
          const score = scoreTranscriptQuality(text)
          trialLog.push({
            label,
            score,
            length: text.length,
            preview: text.slice(0, 80),
          })

          if (score > bestScore) {
            bestText = text
            bestScore = score
            bestLabel = label
          }
        } catch (error) {
          trialLog.push({
            label,
            error: error.message || String(error),
          })
        }
      }

      if (!isWeakTranscript(bestText) && bestScore >= 36) {
        break
      }
    }
  } finally {
    if (enhanced?.filePath) {
      cleanupTempFile(enhanced.filePath)
    }
  }

  console.log('[iadis-wa] transcription attempts summary', {
    best_label: bestLabel,
    best_score: bestScore,
    enhanced: Boolean(enhanced),
    trials: trialLog,
  })

  if (!bestText || bestScore < 0) {
    const error = new Error('Empty or low-quality transcription result')
    error.code = 'EMPTY_TRANSCRIPTION'
    throw error
  }

  return {
    text: bestText,
    score: bestScore,
    label: bestLabel,
    weak: isWeakTranscript(bestText),
  }
}

function sanitizeFilename(filename, fallback = 'attachment') {
  const raw = String(filename || '').trim()
  const base = raw ? path.basename(raw) : fallback
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_')
  return cleaned || fallback
}

function parseFilenameFromContentDisposition(headerValue) {
  const raw = String(headerValue || '').trim()
  if (!raw) {
    return ''
  }

  const encodedMatch = raw.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)
  if (encodedMatch?.[1]) {
    const encodedValue = encodedMatch[1].trim().replace(/^"(.*)"$/, '$1')
    try {
      return decodeURIComponent(encodedValue)
    } catch {
      return encodedValue
    }
  }

  const plainMatch = raw.match(/filename\s*=\s*"([^"]+)"/i) || raw.match(/filename\s*=\s*([^;]+)/i)
  return plainMatch?.[1] ? plainMatch[1].trim().replace(/^"(.*)"$/, '$1') : ''
}

function isHttpUrl(value) {
  try {
    const url = new URL(String(value || '').trim())
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function resolveOutboundFilename({ requestedFilename = '', sourceUrl = '', contentDisposition = '', contentType = '' }) {
  const requested = sanitizeFilename(requestedFilename, '')
  if (requested) {
    return requested
  }

  const fromHeader = sanitizeFilename(parseFilenameFromContentDisposition(contentDisposition), '')
  if (fromHeader) {
    return fromHeader
  }

  try {
    const parsedUrl = new URL(String(sourceUrl || '').trim())
    const fromPath = sanitizeFilename(path.basename(parsedUrl.pathname || ''), '')
    if (fromPath) {
      return fromPath
    }
  } catch {
    // Ignore invalid URLs here; validation happens before download.
  }

  const fallbackExtension = extensionFromMimeType(contentType)
  return sanitizeFilename(`attachment${fallbackExtension}`, `attachment${fallbackExtension}`)
}

function buildMediaSummary(media) {
  if (!media) {
    return '[Media]'
  }

  const name = media.filename || 'attachment'
  return `[Media] ${name}`
}

function cleanupTempFile(filepath) {
  if (!filepath) {
    return
  }

  try {
    fs.unlinkSync(filepath)
  } catch {
    // ignore cleanup failures
  }
}

async function downloadRemoteMediaToTempFile(mediaUrl, requestedFilename = '') {
  const normalizedUrl = String(mediaUrl || '').trim()
  if (!isHttpUrl(normalizedUrl)) {
    const error = new Error('media_url must be a valid http(s) URL')
    error.code = 'INVALID_MEDIA_URL'
    throw error
  }

  let response
  try {
    response = await axios.get(normalizedUrl, {
      responseType: 'arraybuffer',
      timeout: outboundMediaDownloadTimeoutMs,
      maxRedirects: 5,
      maxContentLength: outboundMediaMaxBytes,
      maxBodyLength: outboundMediaMaxBytes,
      headers: {
        Accept: '*/*',
      },
      validateStatus: () => true,
    })
  } catch (error) {
    const message = String(error?.message || error || '')
    if (message.includes('maxContentLength size of') || message.includes('maxBodyLength size of')) {
      const sizeError = new Error(`Outbound media exceeds max size (${outboundMediaMaxBytes} bytes)`)
      sizeError.code = 'MEDIA_TOO_LARGE'
      throw sizeError
    }

    const downloadError = new Error(`Unable to download media_url: ${message || 'request failed'}`)
    downloadError.code = 'REMOTE_FETCH_FAILED'
    throw downloadError
  }

  if (response.status < 200 || response.status >= 300) {
    const error = new Error(`media_url responded with HTTP ${response.status}`)
    error.code = 'REMOTE_FETCH_FAILED'
    throw error
  }

  const bytes = Buffer.from(response.data || [])
  if (!bytes.length) {
    const error = new Error('Downloaded media file is empty')
    error.code = 'REMOTE_FETCH_EMPTY'
    throw error
  }

  if (bytes.length > outboundMediaMaxBytes) {
    const error = new Error(`Outbound media exceeds max size (${outboundMediaMaxBytes} bytes)`)
    error.code = 'MEDIA_TOO_LARGE'
    throw error
  }

  const contentType = String(response.headers['content-type'] || 'application/octet-stream')
    .split(';')[0]
    .trim()
    .toLowerCase() || 'application/octet-stream'
  const filename = resolveOutboundFilename({
    requestedFilename,
    sourceUrl: normalizedUrl,
    contentDisposition: response.headers['content-disposition'],
    contentType,
  })
  const filePath = path.join(
    mediaTmpDir,
    `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${filename}`,
  )

  fs.writeFileSync(filePath, bytes)

  console.log('[iadis-wa] downloaded outbound media file', {
    source: 'media_url',
    url: normalizedUrl,
    filename,
    size: bytes.length,
  })

  return {
    filePath,
    filename,
    mimeType: contentType,
    size: bytes.length,
    temporary: true,
    source: 'media_url',
  }
}

function resolveLocalMediaFile(filePath, requestedFilename = '') {
  const normalizedPath = String(filePath || '').trim()
  if (!normalizedPath) {
    const error = new Error('file_path is required when media_url is not provided')
    error.code = 'INVALID_MEDIA_PATH'
    throw error
  }

  const resolvedPath = path.resolve(normalizedPath)
  if (!fs.existsSync(resolvedPath)) {
    const error = new Error('file_path does not exist')
    error.code = 'MEDIA_FILE_NOT_FOUND'
    throw error
  }

  const stats = fs.statSync(resolvedPath)
  if (!stats.isFile()) {
    const error = new Error('file_path must point to a file')
    error.code = 'INVALID_MEDIA_PATH'
    throw error
  }

  if (stats.size > outboundMediaMaxBytes) {
    const error = new Error(`Outbound media exceeds max size (${outboundMediaMaxBytes} bytes)`)
    error.code = 'MEDIA_TOO_LARGE'
    throw error
  }

  const filename = sanitizeFilename(requestedFilename || path.basename(resolvedPath), 'attachment')
  return {
    filePath: resolvedPath,
    filename,
    mimeType: null,
    size: stats.size,
    temporary: false,
    source: 'file_path',
  }
}

async function resolveOutboundMediaSource({ mediaUrl = '', filePath = '', filename = '' }) {
  const normalizedMediaUrl = String(mediaUrl || '').trim()
  if (normalizedMediaUrl) {
    return downloadRemoteMediaToTempFile(normalizedMediaUrl, filename)
  }

  const normalizedFilePath = String(filePath || '').trim()
  if (normalizedFilePath) {
    return resolveLocalMediaFile(normalizedFilePath, filename)
  }

  const error = new Error('Field "media_url" or "file_path" is required')
  error.code = 'MEDIA_SOURCE_REQUIRED'
  throw error
}

function buildOutboundMessageMedia(mediaSource) {
  if (!MessageMedia) {
    const error = new Error('whatsapp-web.js MessageMedia support is unavailable')
    error.code = 'WA_NOT_AVAILABLE'
    throw error
  }

  const messageMedia = MessageMedia.fromFilePath(mediaSource.filePath)
  messageMedia.filename = mediaSource.filename || messageMedia.filename || 'attachment'
  const mimeType = String(mediaSource.mimeType || messageMedia.mimetype || 'application/octet-stream').toLowerCase()
  messageMedia.mimetype = mimeType
  messageMedia.filesize = Number(mediaSource.size || messageMedia.filesize || 0) || null
  return messageMedia
}

function toDisplayPhone(value) {
  const digits = normalizePhone(value)
  if (!digits) {
    return ''
  }

  return `+${digits}`
}

function resolveMessageId(message) {
  if (!message) {
    return null
  }

  if (typeof message === 'string') {
    return message
  }

  if (message.id && typeof message.id === 'object') {
    return message.id._serialized || message.id.id || null
  }

  return message.id || null
}

function serializeMessageIdForBrowser(message) {
  const id = message?.id
  if (!id) {
    return { _serialized: resolveMessageId(message) }
  }

  if (typeof id === 'string') {
    return { _serialized: id }
  }

  return {
    fromMe: Boolean(id.fromMe),
    remote: id.remote?._serialized || id.remote || null,
    id: id.id || null,
    participant: id.participant?._serialized || id.participant || null,
    _serialized: id._serialized || resolveMessageId(message),
  }
}

function getMediaDownloadFields(message) {
  const data = message?._data || {}
  return {
    directPath: data.directPath || null,
    encFilehash: data.encFilehash || null,
    filehash: data.filehash || null,
    mediaKey: message?.mediaKey || data.mediaKey || null,
    mediaKeyTimestamp: data.mediaKeyTimestamp || null,
    type: message?.type || data.type || null,
    mimetype: data.mimetype || null,
    filename: data.filename || null,
    size: data.size || null,
  }
}

async function warmChatMessageStore(record, message) {
  if (!record?.client || !message) {
    return
  }

  try {
    const chat = typeof message.getChat === 'function'
      ? await Promise.race([
        message.getChat(),
        timeoutAfter(instancePingTimeoutMs, 'message.getChat for media'),
      ])
      : null

    if (chat && typeof chat.fetchMessages === 'function') {
      await Promise.race([
        chat.fetchMessages({ limit: 20 }),
        timeoutAfter(instancePingTimeoutMs, 'chat.fetchMessages for media'),
      ])
    }
  } catch (error) {
    console.warn('[iadis-wa] unable to warm chat store before media download', {
      message_id: resolveMessageId(message),
      reason: error.message || String(error),
    })
  }
}

async function downloadMediaViaBrowser(record, message) {
  if (!record?.client?.pupPage || !message) {
    return null
  }

  await warmChatMessageStore(record, message)

  const payload = {
    msgId: serializeMessageIdForBrowser(message),
    mediaFields: getMediaDownloadFields(message),
  }

  const result = await record.client.pupPage.evaluate(async ({ msgId: browserMsgId, mediaFields }) => {
    const safeGet = async (getter) => {
      try {
        return await getter()
      } catch {
        return null
      }
    }

    const mockQpl = {
      addAnnotations() { return this },
      addPoint() { return this },
    }

    const decryptWithFields = async (fields) => {
      if (!fields?.directPath || !fields?.mediaKey || !fields?.type) {
        return null
      }

      const decryptedMedia = await window
        .require('WAWebDownloadManager')
        .downloadManager.downloadAndMaybeDecrypt({
          directPath: fields.directPath,
          encFilehash: fields.encFilehash,
          filehash: fields.filehash,
          mediaKey: fields.mediaKey,
          mediaKeyTimestamp: fields.mediaKeyTimestamp,
          type: fields.type,
          signal: new AbortController().signal,
          downloadQpl: mockQpl,
        })

      return {
        data: await window.WWebJS.arrayBufferToBase64Async(decryptedMedia),
        mimetype: fields.mimetype || 'audio/ogg; codecs=opus',
        filename: fields.filename || null,
        filesize: fields.size || null,
      }
    }

    // Fast path for LID chats: decrypt using fields already present on the Node message.
    let directError = null
    try {
      const direct = await decryptWithFields(mediaFields)
      if (direct?.data) {
        return direct
      }
    } catch (error) {
      // Continue with store lookup / cache paths.
      directError = error?.message || String(error)
    }

    const Msg = window.require('WAWebCollections').Msg
    const candidates = []
    const addCandidate = (value) => {
      if (value === undefined || value === null || value === '') {
        return
      }
      candidates.push(value)
    }

    addCandidate(browserMsgId)
    addCandidate(browserMsgId?._serialized)
    addCandidate(browserMsgId?.id)

    try {
      const { createWid } = window.require('WAWebWidFactory')
      if (browserMsgId && typeof browserMsgId === 'object') {
        const key = {
          ...browserMsgId,
          remote: typeof browserMsgId.remote === 'string'
            ? createWid(browserMsgId.remote)
            : browserMsgId.remote,
          participant: typeof browserMsgId.participant === 'string'
            ? createWid(browserMsgId.participant)
            : browserMsgId.participant,
        }
        addCandidate(key)
        addCandidate({
          fromMe: browserMsgId.fromMe,
          remote: key.remote,
          id: browserMsgId.id,
          participant: key.participant,
          _serialized: browserMsgId._serialized,
        })
      }
    } catch {
      // WID factory may be unavailable on some WA Web builds.
    }

    let msg = null
    for (const candidate of candidates) {
      msg = await safeGet(() => Msg.get(candidate))
      if (msg) {
        break
      }
      msg = await safeGet(async () => (await Msg.getMessagesById([candidate]))?.messages?.[0] || null)
      if (msg) {
        break
      }
    }

    if (!msg) {
      const models = await safeGet(() => (
        typeof Msg.getModelsArray === 'function'
          ? Msg.getModelsArray()
          : (Msg.models || Msg._models || [])
      )) || []
      msg = models.find((item) => (
        item?.id?._serialized === browserMsgId?._serialized
        || item?.id?.id === browserMsgId?.id
      )) || null
    }

    if (!msg) {
      return {
        error: directError
          ? `message_not_found_after_direct_decrypt:${directError}`
          : 'message_not_found',
      }
    }

    if (msg.mediaData?.mediaStage === 'REUPLOADING') {
      return { error: 'media_reuploading' }
    }

    if (msg.mediaData && msg.mediaData.mediaStage !== 'RESOLVED') {
      await msg.downloadMedia({
        downloadEvenIfExpensive: true,
        rmrReason: 1,
      })
    }

    const toBase64 = async (bufferLike) => {
      if (!bufferLike) {
        return null
      }
      if (bufferLike instanceof ArrayBuffer) {
        return window.WWebJS.arrayBufferToBase64Async(bufferLike)
      }
      if (typeof bufferLike.arrayBuffer === 'function') {
        return window.WWebJS.arrayBufferToBase64Async(await bufferLike.arrayBuffer())
      }
      return null
    }

    try {
      if (typeof window.WWebJS?.resolveMediaBlob === 'function') {
        const blob = await window.WWebJS.resolveMediaBlob(msg.id || browserMsgId)
        const data = await toBase64(blob)
        if (data) {
          return {
            data,
            mimetype: msg.mimetype || mediaFields?.mimetype,
            filename: msg.filename || mediaFields?.filename,
            filesize: msg.size || mediaFields?.size,
          }
        }
      }
    } catch {
      // Fall through.
    }

    try {
      if (msg.mediaData?.mediaBlob) {
        const blob = typeof msg.mediaData.mediaBlob.forceToBlob === 'function'
          ? await msg.mediaData.mediaBlob.forceToBlob()
          : msg.mediaData.mediaBlob
        const data = await toBase64(blob)
        if (data) {
          return {
            data,
            mimetype: msg.mimetype || mediaFields?.mimetype,
            filename: msg.filename || mediaFields?.filename,
            filesize: msg.size || mediaFields?.size,
          }
        }
      }
    } catch {
      // Fall through.
    }

    try {
      const fromMsgFields = await decryptWithFields({
        directPath: msg.directPath || mediaFields?.directPath,
        encFilehash: msg.encFilehash || mediaFields?.encFilehash,
        filehash: msg.filehash || mediaFields?.filehash,
        mediaKey: msg.mediaKey || mediaFields?.mediaKey,
        mediaKeyTimestamp: msg.mediaKeyTimestamp || mediaFields?.mediaKeyTimestamp,
        type: msg.type || mediaFields?.type,
        mimetype: msg.mimetype || mediaFields?.mimetype,
        filename: msg.filename || mediaFields?.filename,
        size: msg.size || mediaFields?.size,
      })
      if (fromMsgFields?.data) {
        return fromMsgFields
      }
    } catch (error) {
      return { error: error?.message || 'decrypt_failed' }
    }

    return { error: 'media_empty' }
  }, payload)

  if (result?.error) {
    const error = new Error(result.error)
    error.code = 'MEDIA_DOWNLOAD_FAILED'
    throw error
  }

  if (!result?.data) {
    return null
  }

  return result
}

async function extractMessageMedia(message, record = null) {
  if (!message?.hasMedia) {
    return null
  }

  let media = null
  let lastError = null

  // Voice notes / LID chats often fail with the stock downloadMedia() ("r").
  // Prefer a safer browser-side resolver, then fall back to the library method.
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      if (attempt > 1) {
        await sleep(700 * attempt)
      } else {
        await sleep(400)
      }

      if (record?.client?.pupPage) {
        media = await Promise.race([
          downloadMediaViaBrowser(record, message),
          timeoutAfter(protocolTimeoutMs, 'downloadMediaViaBrowser'),
        ])
      }

      if (!media?.data && typeof message.downloadMedia === 'function') {
        media = await Promise.race([
          message.downloadMedia(),
          timeoutAfter(protocolTimeoutMs, 'downloadMedia'),
        ])
      }

      if (media?.data) {
        break
      }
    } catch (error) {
      lastError = error
      console.warn('[iadis-wa] media download attempt failed', {
        attempt,
        message_id: resolveMessageId(message),
        reason: error.message || String(error),
      })
    }
  }

  if (!media?.data) {
    if (lastError) {
      throw lastError
    }
    return null
  }

  const mimeType = String(media.mimetype || media.mimeType || 'application/octet-stream').toLowerCase()
  const bytes = Buffer.from(String(media.data), 'base64')
  if (!bytes || bytes.length === 0) {
    return null
  }

  if (bytes.length > mediaMaxBytes) {
    const error = new Error(`Incoming media exceeds max size (${bytes.length} bytes)`)
    error.code = 'MEDIA_TOO_LARGE'
    throw error
  }

  const messageId = resolveMessageId(message) || `${Date.now()}`
  const filename = sanitizeFilename(
    media.filename || `${messageId}${extensionFromMimeType(mimeType)}`,
    `attachment${extensionFromMimeType(mimeType)}`,
  )
  const filePath = path.join(
    mediaTmpDir,
    `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${filename}`,
  )

  fs.writeFileSync(filePath, bytes)

  return {
    filePath,
    filename,
    mimeType,
    size: bytes.length,
  }
}

async function reactToMessage(message, emoji) {
  if (!message || typeof message.react !== 'function' || !emoji) {
    return false
  }

  await runWithRetries(
    () => Promise.race([
      message.react(emoji),
      timeoutAfter(instancePingTimeoutMs, 'message.react'),
    ]),
    'message.react',
  )

  return true
}

async function ingestMediaWithOdoo(media, context = {}) {
  const scriptPath = path.isAbsolute(odooIngestScript)
    ? odooIngestScript
    : path.join(process.cwd(), odooIngestScript)

  if (!fs.existsSync(scriptPath)) {
    return {
      status: 'failed',
      reason: `Ingestion script not found: ${scriptPath}`,
    }
  }

  const args = [
    scriptPath,
    '--file',
    media.filePath,
    '--filename',
    media.filename,
    '--mime',
    media.mimeType,
  ]

  if (context.chatId) {
    args.push('--chat-id', String(context.chatId))
  }
  if (context.participantId) {
    args.push('--participant-id', String(context.participantId))
  }
  if (context.messageId) {
    args.push('--message-id', String(context.messageId))
  }

  try {
    const { stdout, stderr } = await execFileAsync(phpBinary, args, {
      timeout: mediaIngestTimeoutMs,
      maxBuffer: 4 * 1024 * 1024,
    })

    const output = String(stdout || '').trim()
    if (!output) {
      return {
        status: 'failed',
        reason: 'Empty output from Odoo ingestion script',
        stderr: truncateText(stderr),
      }
    }

    try {
      const parsed = JSON.parse(output)
      if (stderr) {
        parsed.stderr = truncateText(stderr)
      }
      return parsed
    } catch {
      return {
        status: 'failed',
        reason: 'Invalid JSON returned by Odoo ingestion script',
        output: truncateText(output),
        stderr: truncateText(stderr),
      }
    }
  } catch (error) {
    return {
      status: 'failed',
      reason: error.message || 'Failed to execute Odoo ingestion script',
      stderr: truncateText(error.stderr || ''),
      stdout: truncateText(error.stdout || ''),
    }
  }
}

function nowIso() {
  return new Date().toISOString()
}

function publicAccountPhone(record) {
  const resolved = sanitizeAccountPhone(record?.phoneE164 || record?.phone)
  return resolved ? formatPhoneDisplay(resolved) : null
}

function normalizePairingPhone(value) {
  const digits = normalizePhoneDigits(value)
  if (!digits || digits.length < 10 || digits.length > 15) {
    return null
  }
  return digits
}

function formatPairingCodeDisplay(code) {
  const raw = String(code || '').replace(/[\s-]+/g, '').toUpperCase()
  if (!raw) return null
  if (raw.length === 8) {
    return `${raw.slice(0, 4)}-${raw.slice(4)}`
  }
  return raw
}

function getPairPhoneForInstance(instanceId) {
  const key = normalizeInstanceId(instanceId)
  if (instancePairPhones.has(key)) {
    return instancePairPhones.get(key) || null
  }
  return normalizePairingPhone(process.env.WA_PAIR_PHONE || '')
}

function setPairPhoneForInstance(instanceId, phone) {
  const key = normalizeInstanceId(instanceId)
  if (phone === null || phone === undefined || String(phone).trim() === '') {
    instancePairPhones.delete(key)
    return null
  }

  const normalized = normalizePairingPhone(phone)
  if (!normalized) {
    const error = new Error('Numéro invalide pour le jumelage WhatsApp (ex. 212612345678 ou 0612345678)')
    error.code = 'INVALID_PHONE'
    throw error
  }

  instancePairPhones.set(key, normalized)
  return normalized
}

function clearPairingChallenge(record) {
  if (!record) return
  record.pairingCode = null
  record.pairingCodeCreatedAt = null
  record.pairingPhone = null
}

function serializeStatus(record) {
  if (!record) {
    return {
      state: 'missing',
      lastSeenAt: null,
      lastMessageAt: null,
      lastHistorySyncAt: null,
      phone: null,
      pushname: null,
      lastError: null,
      pendingMessages: 0,
      connected: false,
      phone_resolved: false,
      pairing_code: null,
      pairing_code_display: null,
      pairing_phone: null,
      account: {
        phone: null,
        resolved: false,
        jid_type: null,
      },
    }
  }

  const phone = publicAccountPhone(record)
  const ready = String(record.state || '').toLowerCase() === 'ready'
  const pairingCode = record.pairingCode || null
  return {
    state: record.state || 'missing',
    lastSeenAt: record.lastSeenAt || null,
    lastMessageAt: record.lastMessageAt || null,
    lastHistorySyncAt: record.lastHistorySyncAt || null,
    phone,
    pushname: record.pushname || null,
    lastError: record.lastError || null,
    pendingMessages: Number(record.pendingMessages || 0),
    connected: ready,
    phone_resolved: Boolean(phone),
    pairing_code: pairingCode,
    pairing_code_display: formatPairingCodeDisplay(pairingCode),
    pairing_phone: record.pairingPhone || getPairPhoneForInstance(record.instanceId) || null,
    account: {
      phone,
      resolved: Boolean(phone),
      jid_type: record.accountJidType || null,
    },
  }
}

function buildClientStorageId(instanceId) {
  return `iadis_${instanceId}`.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function getInstanceSessionDir(instanceId) {
  return path.join(waSessionPath, `session-${buildClientStorageId(instanceId)}`)
}

function hasStoredSession(instanceId) {
  try {
    return fs.existsSync(getInstanceSessionDir(instanceId))
  } catch {
    return false
  }
}

function clearSessionLockFiles(instanceId) {
  const sessionDir = getInstanceSessionDir(instanceId)
  const lockNames = ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile']
  const dirs = [sessionDir, path.join(sessionDir, 'Default')]

  for (const dir of dirs) {
    for (const name of lockNames) {
      try {
        fs.rmSync(path.join(dir, name), { force: true })
      } catch {
        // ignore best-effort lock cleanup
      }
    }
  }
}

async function killSessionBrowsers(instanceId) {
  const sessionDir = path.resolve(getInstanceSessionDir(instanceId))

  try {
    if (process.platform === 'win32') {
      const script = [
        "$ErrorActionPreference = 'SilentlyContinue'",
        `$target = ${JSON.stringify(sessionDir)}`,
        'Get-CimInstance Win32_Process | Where-Object {',
        "  $_.Name -match '^(chrome|chromium|msedge)\\.exe$' -and",
        '  $_.CommandLine -and',
        '  $_.CommandLine.IndexOf($target, [StringComparison]::OrdinalIgnoreCase) -ge 0',
        '} | ForEach-Object {',
        '  Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue',
        '}',
      ].join('\n')
      const encoded = Buffer.from(script, 'utf16le').toString('base64')

      await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-EncodedCommand', encoded],
        {
          timeout: 25000,
          windowsHide: true,
        },
      )
    } else {
      await execFileAsync('pkill', ['-f', sessionDir], { timeout: 10000 }).catch(() => {})
    }
  } catch (error) {
    console.warn('[iadis-wa] unable to kill session browsers', {
      instance_id: instanceId,
      reason: error.message || String(error),
    })
  }

  clearSessionLockFiles(instanceId)
  await sleep(800)
}

async function resetInstanceForQr(instanceId, reason = 'Dashboard QR refresh', options = {}) {
  const normalizedInstanceId = normalizeInstanceId(instanceId)

  if (Object.prototype.hasOwnProperty.call(options, 'pairPhone')) {
    setPairPhoneForInstance(normalizedInstanceId, options.pairPhone)
  }

  let record = getInstance(normalizedInstanceId)
  if (record) {
    clearReconnectTimer(record)
    record.initPromise = null
    record.recoverPromise = null
    record.healthCheckPromise = null
    await destroyClient(record)
  }

  await killSessionBrowsers(normalizedInstanceId)

  record = getInstance(normalizedInstanceId)
  if (record) {
    const client = buildClient(normalizedInstanceId)
    record.client = client
    record.qr = null
    record.qrCreatedAt = null
    clearPairingChallenge(record)
    record.listenerClient = null
    attachClientListeners(record)
    updateState(record, 'disconnected', {
      lastError: null,
      phone: null,
      phoneE164: null,
      phoneResolved: false,
      accountJid: null,
      accountJidType: null,
      pushname: null,
    })
    initializeRecord(record)
    return record
  }

  return ensureInstance(normalizedInstanceId)
}

function parseInstanceIdFromSessionDir(dirName) {
  const prefix = 'session-iadis_'
  if (!String(dirName || '').startsWith(prefix)) {
    return null
  }

  const parsed = String(dirName).slice(prefix.length).trim()
  return parsed || null
}

function listKnownInstanceIds() {
  const knownIds = new Set(instances.keys())

  try {
    const entries = fs.existsSync(waSessionPath)
      ? fs.readdirSync(waSessionPath, { withFileTypes: true })
      : []

    for (const entry of entries) {
      if (!entry?.isDirectory()) {
        continue
      }

      const parsed = parseInstanceIdFromSessionDir(entry.name)
      if (parsed) {
        knownIds.add(parsed)
      }
    }
  } catch (error) {
    console.warn('[iadis-wa] unable to enumerate stored sessions', {
      path: waSessionPath,
      reason: error.message || String(error),
    })
  }

  return Array.from(knownIds).sort((left, right) => left.localeCompare(right))
}

function serializeDashboardInstance(instanceId) {
  const record = getInstance(instanceId)
  const baseStatus = serializeStatus(record)
  const storedSession = hasStoredSession(instanceId)

  return {
    instance_id: instanceId,
    managed: Boolean(record),
    stored_session: storedSession,
    can_connect: Boolean(WaClient && LocalAuth && QRCode),
    ...baseStatus,
    phone_number: baseStatus.phone,
    phone_resolved: baseStatus.phone_resolved,
    connected: baseStatus.connected,
    account: baseStatus.account,
    qr_available: Boolean(record?.qr),
    qr_created_at: record?.qrCreatedAt || null,
    pairing_code: baseStatus.pairing_code,
    pairing_code_display: baseStatus.pairing_code_display,
    pairing_phone: baseStatus.pairing_phone,
    pairing_code_available: Boolean(record?.pairingCode),
  }
}

function removeSessionDir(instanceId) {
  const resolvedRoot = path.resolve(waSessionPath)
  const resolvedTarget = path.resolve(getInstanceSessionDir(instanceId))
  if (
    resolvedTarget === resolvedRoot
    || !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new Error(`Refusing to remove invalid session path: ${resolvedTarget}`)
  }

  fs.rmSync(resolvedTarget, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  })
}

function updateState(record, state, details = {}) {
  if (!record) {
    return
  }

  record.state = state
  record.lastSeenAt = nowIso()

  if (details.lastError !== undefined) {
    record.lastError = details.lastError
  }

  if (details.phone !== undefined) {
    record.phone = details.phone
  }
  if (details.phoneE164 !== undefined) {
    record.phoneE164 = details.phoneE164
  }
  if (details.phoneResolved !== undefined) {
    record.phoneResolved = details.phoneResolved
  }
  if (details.accountJid !== undefined) {
    record.accountJid = details.accountJid
  }
  if (details.accountJidType !== undefined) {
    record.accountJidType = details.accountJidType
  }

  if (details.pushname !== undefined) {
    record.pushname = details.pushname
  }
}

function touchRecord(record, details = {}) {
  if (!record) {
    return
  }

  record.lastSeenAt = nowIso()
  if (details.lastMessageAt) {
    record.lastMessageAt = details.lastMessageAt
  }
  if (details.lastHistorySyncAt) {
    record.lastHistorySyncAt = details.lastHistorySyncAt
  }
}

async function waitForInstanceReady(record, waitMs = Math.max(instancePingTimeoutMs, 30000)) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < waitMs) {
    const state = String(record?.state || '').toLowerCase()
    if (state === 'ready' || state === 'authenticated') {
      return true
    }

    if (state === 'qr' || state === 'auth_failure') {
      break
    }

    await sleep(500)
  }

  const error = new Error(`Instance is not ready (${record?.state || 'missing'})`)
  error.code = 'INSTANCE_NOT_READY'
  throw error
}

function buildClient(instanceId) {
  const clientId = `iadis_${instanceId}`.replace(/[^a-zA-Z0-9_-]/g, '_')
  const puppeteer = {
    headless: true,
    args: puppeteerArgs,
    protocolTimeout: protocolTimeoutMs,
  }

  const executablePath = resolvePuppeteerExecutablePath()
  if (executablePath) {
    puppeteer.executablePath = executablePath
  } else if (process.platform === 'linux') {
    console.warn('[iadis-wa] no chromium executable found; puppeteer will use its bundled browser', {
      instance_id: instanceId,
    })
  }

  const pairPhone = getPairPhoneForInstance(instanceId)
  const clientOptions = {
    authStrategy: new LocalAuth({
      clientId,
      dataPath: waSessionPath,
    }),
    puppeteer,
  }

  // Android WhatsApp: “Link with phone number instead” — must be set at Client init
  // (do not call requestPairingCode from the qr handler).
  if (pairPhone) {
    clientOptions.pairWithPhoneNumber = {
      phoneNumber: pairPhone,
      showNotification: true,
    }
  }

  return new WaClient(clientOptions)
}

function clearReconnectTimer(record) {
  if (record?.reconnectTimer) {
    clearTimeout(record.reconnectTimer)
    record.reconnectTimer = null
  }
}

function initializeRecord(record) {
  if (!record || record.initPromise || record.recoverPromise) {
    return record?.initPromise || Promise.resolve()
  }

  updateState(record, 'initializing', { lastError: null })
  record.initPromise = Promise.resolve()
    .then(async () => {
      await killSessionBrowsers(record.instanceId)
      return record.client.initialize()
    })
    .catch(async (error) => {
      let message = error.message || 'Initialization failed'
      const recoverable = /browser is already running|failed to launch the browser process/i.test(message)

      if (recoverable) {
        console.warn('[iadis-wa] browser init conflict, forcing cleanup', {
          instance_id: record.instanceId,
          reason: message,
        })
        await destroyClient(record)
        await killSessionBrowsers(record.instanceId)

        const client = buildClient(record.instanceId)
        record.client = client
        record.qr = null
        record.qrCreatedAt = null
        clearPairingChallenge(record)
        record.listenerClient = null
        attachClientListeners(record)
        updateState(record, 'initializing', { lastError: null })

        try {
          await client.initialize()
          return
        } catch (retryError) {
          message = retryError.message || message
        }
      }

      updateState(record, 'disconnected', { lastError: message })
      console.error('[iadis-wa] instance initialization failed', {
        instance_id: record.instanceId,
        reason: message,
      })
      scheduleReconnect(record, message)
    })
    .finally(() => {
      record.initPromise = null
    })

  return record.initPromise
}

function scheduleReconnect(record, reason = '') {
  if (!record || record.reconnectTimer || record.initPromise || record.recoverPromise) {
    return
  }

  record.reconnectTimer = setTimeout(() => {
    record.reconnectTimer = null
    console.warn('[iadis-wa] reconnecting instance', {
      instance_id: record.instanceId,
      reason,
    })
    initializeRecord(record)
  }, reconnectDelayMs)
}

async function destroyClient(record) {
  if (!record?.client || typeof record.client.destroy !== 'function') {
    return
  }

  const browserProcess = typeof record.client?.pupBrowser?.process === 'function'
    ? record.client.pupBrowser.process()
    : null

  try {
    await Promise.race([
      record.client.destroy(),
      timeoutAfter(instancePingTimeoutMs, 'client.destroy'),
    ])
  } catch (error) {
    console.warn('[iadis-wa] client destroy warning', {
      instance_id: record.instanceId,
      reason: error.message || String(error),
    })
  } finally {
    if (browserProcess && browserProcess.exitCode === null) {
      try {
        browserProcess.kill('SIGKILL')
      } catch {
        try {
          browserProcess.kill()
        } catch {
          // ignore best-effort browser cleanup failures
        }
      }
    }
  }
}

async function removeInstance(instanceId, options = {}) {
  const normalizedInstanceId = normalizeInstanceId(instanceId)
  const shouldDeleteSession = options.deleteSession !== false
  const record = getInstance(normalizedInstanceId)
  const hadStoredSession = hasStoredSession(normalizedInstanceId)
  setPairPhoneForInstance(normalizedInstanceId, null)

  if (record) {
    clearReconnectTimer(record)
    instances.delete(normalizedInstanceId)

    if (record.historySyncPromise) {
      record.historySyncPromise.catch(() => {})
    }
    if (record.queuePromise) {
      record.queuePromise.catch(() => {})
    }

    // Kill Chromium first so LocalAuth logout/unlink does not crash on EBUSY.
    await killSessionBrowsers(normalizedInstanceId)

    try {
      if (typeof record.client?.logout === 'function') {
        await Promise.race([
          record.client.logout(),
          timeoutAfter(Math.min(instancePingTimeoutMs, 8000), 'client.logout'),
        ])
      }
    } catch (error) {
      console.warn('[iadis-wa] client logout warning', {
        instance_id: normalizedInstanceId,
        reason: error.message || String(error),
      })
    }

    await destroyClient(record)
    await killSessionBrowsers(normalizedInstanceId)
  }

  if (shouldDeleteSession && hadStoredSession) {
    try {
      removeSessionDir(normalizedInstanceId)
    } catch (error) {
      await killSessionBrowsers(normalizedInstanceId)
      try {
        removeSessionDir(normalizedInstanceId)
      } catch (retryError) {
        console.warn('[iadis-wa] unable to remove session dir', {
          instance_id: normalizedInstanceId,
          reason: retryError.message || String(retryError),
        })
      }
    }
  }

  return {
    instance_id: normalizedInstanceId,
    removed: Boolean(record || hadStoredSession),
    removed_session: Boolean(shouldDeleteSession && hadStoredSession),
  }
}

function recoverInstance(record, reason = '') {
  if (!record || record.recoverPromise) {
    return record?.recoverPromise || Promise.resolve()
  }

  clearReconnectTimer(record)
  updateState(record, 'recovering', {
    lastError: reason || 'Recovering instance',
  })

  record.recoverPromise = Promise.resolve()
    .then(async () => {
      await destroyClient(record)

      const client = buildClient(record.instanceId)
      record.client = client
      record.qr = null
      record.qrCreatedAt = null
      record.initPromise = null

      record.listenerClient = null
      attachClientListeners(record)
      updateState(record, 'disconnected', {
        lastError: reason || 'Recovering instance',
      })

      return initializeRecord(record)
    })
    .finally(() => {
      record.recoverPromise = null
    })

  return record.recoverPromise
}

async function syncedMessageExists(providerMessageId) {
  const messageId = String(providerMessageId || '').trim()
  if (!backendEnabled || !messageId) {
    return false
  }

  const response = await apiClient.get('/service/messages/find', {
    params: { provider_message_id: messageId },
    headers: {
      'X-Service-Token': serviceToken,
    },
  })

  return Boolean(response.data?.exists)
}

async function checkInstanceHealth(record) {
  if (!record || record.healthCheckPromise || record.initPromise || record.recoverPromise) {
    return record?.healthCheckPromise || Promise.resolve()
  }

  const currentState = String(record.state || '').toLowerCase()
  if (currentState === 'missing' || currentState === 'disconnected' || currentState === 'auth_failure') {
    initializeRecord(record)
    return Promise.resolve()
  }

  if (!record.client || typeof record.client.getState !== 'function') {
    return Promise.resolve()
  }

  record.healthCheckPromise = Promise.resolve()
    .then(async () => {
      const state = await runWithRetries(
        () => Promise.race([
          record.client.getState(),
          timeoutAfter(instancePingTimeoutMs, 'instance.getState'),
        ]),
        'instance.getState',
      )

      const normalized = normalizeWhatsAppClientState(state)
      if (isWhatsAppConnectedState(normalized)) {
        if (record.state === 'ready') {
          updateState(record, 'ready', { lastError: null })
        } else if (record.state !== 'qr' && record.state !== 'authenticated' && record.state !== 'connecting') {
          updateState(record, 'ready', { lastError: null })
        }
        return
      }

      // unpaired / unpaired_idle / pairing = waiting for QR or phone link — do not recover-loop
      if (isWhatsAppWaitingForPairing(normalized)) {
        if (record.state === 'qr' || record.state === 'authenticated' || record.state === 'connecting' || record.state === 'initializing') {
          return
        }
        if (record.state === 'ready') {
          // Session dropped while we thought we were ready — reconnect once, don't spam as fatal
          console.warn('[iadis-wa] WhatsApp became unpaired after ready; reconnecting', {
            instance_id: record.instanceId,
            wa_state: normalized,
          })
          updateState(record, 'connecting', { lastError: null })
          initializeRecord(record)
          return
        }
        updateState(record, record.state === 'qr' ? 'qr' : 'connecting', { lastError: null })
        return
      }

      throw new Error(`Unexpected WhatsApp state: ${normalized}`)
    })
    .catch(async (error) => {
      console.error('[iadis-wa] instance health check failed', {
        instance_id: record.instanceId,
        reason: error.message || String(error),
      })
      await recoverInstance(record, error.message || 'Instance health check failed')
    })
    .finally(() => {
      record.healthCheckPromise = null
    })

  return record.healthCheckPromise
}

function enqueueRealtimeMessage(record, message, options = {}) {
  if (!record) {
    return Promise.resolve()
  }

  record.pendingMessages = Number(record.pendingMessages || 0) + 1
  if (record.pendingMessages >= messageQueueWarnSize) {
    console.warn('[iadis-wa] message queue backlog growing', {
      instance_id: record.instanceId,
      pending_messages: record.pendingMessages,
    })
  }

  record.queuePromise = Promise.resolve(record.queuePromise)
    .catch(() => {})
    .then(async () => {
      try {
        await processRealtimeMessage(record, message, options)
      } finally {
        record.pendingMessages = Math.max(0, Number(record.pendingMessages || 1) - 1)
      }
    })

  return record.queuePromise
}

function shouldSyncHistoryMessage(message) {
  if (!message || message.fromMe) {
    return false
  }

  const timestamp = Number(message.timestamp || 0)
  if (!timestamp) {
    return true
  }

  const messageTimeMs = timestamp > 10_000_000_000 ? timestamp : timestamp * 1000
  const lookbackMs = automationHistoryLookbackHours * 60 * 60 * 1000
  return messageTimeMs >= Date.now() - lookbackMs
}

function syncAutomationHistory(record, reason = 'interval') {
  if (!automationHistorySyncEnabled || !record || record.historySyncPromise || record.recoverPromise) {
    return record?.historySyncPromise || Promise.resolve()
  }

  const chats = getAutomationChatIds()
  if (chats.length === 0) {
    return Promise.resolve()
  }

  const state = String(record.state || '').toLowerCase()
  if (state !== 'ready' && state !== 'authenticated') {
    return Promise.resolve()
  }

  record.historySyncPromise = Promise.resolve()
    .then(async () => {
      for (const chatId of chats) {
        const chat = await runWithRetries(
          () => Promise.race([
            record.client.getChatById(chatId),
            timeoutAfter(instancePingTimeoutMs, `getChatById ${chatId}`),
          ]),
          `getChatById ${chatId}`,
        )

        const messages = await runWithRetries(
          () => Promise.race([
            chat.fetchMessages({ limit: automationHistoryLimit }),
            timeoutAfter(protocolTimeoutMs, `fetchMessages ${chatId}`),
          ]),
          `fetchMessages ${chatId}`,
        )

        const candidates = (Array.isArray(messages) ? messages : [])
          .filter(shouldSyncHistoryMessage)
          .sort((left, right) => Number(left?.timestamp || 0) - Number(right?.timestamp || 0))

        for (const message of candidates) {
          await processRealtimeMessage(record, message, {
            fromMe: false,
            source: 'automation_history',
            skipIfSynced: true,
          })
        }
      }

      touchRecord(record, { lastHistorySyncAt: nowIso() })
      console.log('[iadis-wa] automation history sync completed', {
        instance_id: record.instanceId,
        reason,
        chats: chats.length,
      })
    })
    .catch(async (error) => {
      console.error('[iadis-wa] automation history sync failed', {
        instance_id: record.instanceId,
        reason: error.message || String(error),
      })

      if (isProtocolTimeoutError(error)) {
        await recoverInstance(record, error.message || 'Automation history sync failed')
      }
    })
    .finally(() => {
      record.historySyncPromise = null
    })

  return record.historySyncPromise
}

function notifyWhatsAppError(title, body) {
  try {
    crm?.smart?.createNotification?.({
      type: 'whatsapp_error',
      title,
      body,
      link_path: '/integrations',
    })
  } catch {
    // optional
  }
}

async function refreshConnectedAccount(record) {
  if (!record?.client) return
  try {
    const account = await resolveConnectedWhatsAppAccount(record.client)
    updateState(record, record.state, {
      phone: account.phoneNumber,
      phoneE164: account.phoneNumber,
      phoneResolved: account.resolved,
      accountJid: account.jid || null,
      accountJidType: account.jidType || null,
      pushname: account.pushname,
    })
    console.log('[WA_SESSION_READY]', {
      instance_id: record.instanceId,
      jidType: account.jidType,
      phoneResolved: account.resolved,
      state: record.state,
    })
  } catch (error) {
    console.warn('[WA_IDENTITY_RESOLUTION_FAILED]', {
      instance_id: record.instanceId,
      reason: error.message || String(error),
    })
  }
}

function attachClientListeners(record) {
  const client = record.client
  if (!client || record.listenerClient === client) {
    return
  }
  record.listenerClient = client

  client.on('qr', async (rawQr) => {
    try {
      record.qr = await QRCode.toDataURL(rawQr, {
        margin: 1,
        width: 340,
      })
      record.qrCreatedAt = nowIso()
    } catch {
      record.qr = null
      record.qrCreatedAt = null
    }

    clearPairingChallenge(record)
    updateState(record, 'qr', {
      lastError: null,
      phone: null,
      phoneE164: null,
      phoneResolved: false,
    })
  })

  client.on('code', (code) => {
    const pairingCode = String(code || '').replace(/[\s-]+/g, '').toUpperCase()
    if (!pairingCode) {
      return
    }

    record.qr = null
    record.qrCreatedAt = null
    record.pairingCode = pairingCode
    record.pairingCodeCreatedAt = nowIso()
    record.pairingPhone = getPairPhoneForInstance(record.instanceId)

    console.log('[iadis-wa] pairing code ready', {
      instance_id: record.instanceId,
      phone: record.pairingPhone,
      code: formatPairingCodeDisplay(pairingCode),
    })

    updateState(record, 'code', {
      lastError: null,
      phone: null,
      phoneE164: null,
      phoneResolved: false,
    })
  })

  client.on('authenticated', () => {
    clearReconnectTimer(record)
    clearPairingChallenge(record)
    if (record.state !== 'ready') {
      updateState(record, 'authenticated', { lastError: null })
    }
  })

  client.on('ready', () => {
    clearReconnectTimer(record)
    clearPairingChallenge(record)
    updateState(record, 'ready', { lastError: null })
    void refreshConnectedAccount(record)
    syncAutomationHistory(record, 'ready')
  })

  client.on('auth_failure', (message) => {
    clearReconnectTimer(record)
    const reason = message || 'Authentication failed'
    updateState(record, 'auth_failure', {
      lastError: reason,
      phone: null,
      phoneE164: null,
      phoneResolved: false,
    })
    notifyWhatsAppError('Erreur WhatsApp', 'Échec d’authentification de la session WhatsApp.')
  })

  client.on('disconnected', (reason) => {
    updateState(record, 'disconnected', { lastError: reason || 'Disconnected' })
    scheduleReconnect(record, reason || 'Disconnected')
  })

  client.on('change_state', (value) => {
    const state = normalizeWhatsAppClientState(value)
    if (state === 'connected') {
      if (record.state !== 'ready') {
        updateState(record, 'connecting', { lastError: null })
      }
      return
    }

    if (isWhatsAppWaitingForPairing(state)) {
      if (record.state === 'ready') {
        updateState(record, 'connecting', { lastError: null })
      } else if (record.state !== 'qr' && record.state !== 'code') {
        updateState(record, 'connecting', { lastError: null })
      }
      return
    }

    if (record.state !== 'ready' && state) {
      updateState(record, state)
    }
  })

  client.on('message', (message) => {
    const own = record.accountJid || record.client?.info?.wid?._serialized || ''
    const direction = resolveMessageDirection(message, own)
    enqueueRealtimeMessage(record, message, { fromMe: direction.fromMe })
  })

  client.on('message_create', (message) => {
    const own = record.accountJid || record.client?.info?.wid?._serialized || ''
    const direction = resolveMessageDirection(message, own)
    enqueueRealtimeMessage(record, message, { fromMe: direction.fromMe })
  })
}

function getInstance(instanceId) {
  return instances.get(instanceId) || null
}

function ensureInstance(instanceId) {
  if (!WaClient || !LocalAuth || !QRCode) {
    const error = new Error('whatsapp-web.js dependencies are not installed')
    error.code = 'WA_NOT_AVAILABLE'
    throw error
  }

  let record = instances.get(instanceId)
  if (!record) {
    const client = buildClient(instanceId)
    record = {
      instanceId,
      client,
      state: 'missing',
      lastSeenAt: null,
      lastMessageAt: null,
      lastHistorySyncAt: null,
      phone: null,
      phoneE164: null,
      phoneResolved: false,
      accountJid: null,
      accountJidType: null,
      pushname: null,
      lastError: null,
      qr: null,
      qrCreatedAt: null,
      pairingCode: null,
      pairingCodeCreatedAt: null,
      pairingPhone: null,
      initPromise: null,
      recoverPromise: null,
      healthCheckPromise: null,
      historySyncPromise: null,
      reconnectTimer: null,
      queuePromise: Promise.resolve(),
      pendingMessages: 0,
      listenerClient: null,
    }

    attachClientListeners(record)
    instances.set(instanceId, record)
  }

  const state = String(record.state || '').toLowerCase()
  const shouldInit = !record.initPromise && !record.recoverPromise && (state === 'missing' || state === 'disconnected' || state === 'auth_failure')

  if (shouldInit) {
    initializeRecord(record)
  }

  return record
}

async function waitForAuthChallenge(record, waitMs = qrWaitMs, { prefer = 'any' } = {}) {
  const startedAt = Date.now()
  const wantCode = prefer === 'code' || prefer === 'any'
  const wantQr = prefer === 'qr' || prefer === 'any'

  while (Date.now() - startedAt < waitMs) {
    if (wantCode && record.pairingCode) {
      return { kind: 'code', value: record.pairingCode }
    }
    if (wantQr && record.qr) {
      return { kind: 'qr', value: record.qr }
    }

    const state = String(record.state || '').toLowerCase()
    if (state === 'ready' || state === 'auth_failure') {
      return null
    }

    if (
      state === 'disconnected'
      && record.lastError
      && /browser is already running|failed to launch the browser process/i.test(String(record.lastError))
    ) {
      return null
    }

    await sleep(300)
  }

  if (wantCode && record.pairingCode) {
    return { kind: 'code', value: record.pairingCode }
  }
  if (wantQr && record.qr) {
    return { kind: 'qr', value: record.qr }
  }
  return null
}

async function waitForQr(record, waitMs = qrWaitMs) {
  const challenge = await waitForAuthChallenge(record, waitMs, { prefer: 'qr' })
  return challenge?.kind === 'qr' ? challenge.value : null
}

async function waitForPairingCode(record, waitMs = qrWaitMs) {
  const challenge = await waitForAuthChallenge(record, waitMs, { prefer: 'code' })
  return challenge?.kind === 'code' ? challenge.value : null
}

async function storeIncomingAndGetDecision(normalizedPayload) {
  const response = await apiClient.post('/service/webhook/incoming', normalizedPayload, {
    headers: {
      'X-Service-Token': serviceToken,
    },
  })

  return response.data?.data
}

async function getIncomingDecision(normalizedPayload, context = {}) {
  if (!backendEnabled) {
    return getStandaloneIncomingDecision(normalizedPayload, context)
  }

  return storeIncomingAndGetDecision(normalizedPayload)
}

async function syncServiceMessage(payload) {
  const response = await apiClient.post('/service/messages/sync', payload, {
    headers: {
      'X-Service-Token': serviceToken,
    },
  })

  return response.data?.data || null
}

async function ingestReportingSpreadsheet(media, context = {}) {
  const fileBase64 = fs.readFileSync(media.filePath, { encoding: 'base64' })

  const response = await apiClient.post('/service/reporting/ingest', {
    chat_id: context.chatId || '',
    chat_name: context.chatName || '',
    filename: media.filename,
    mime_type: media.mimeType,
    file_base64: fileBase64,
    recipient_email: reportingRecipientEmail || undefined,
  }, {
    headers: {
      'X-Service-Token': serviceToken,
    },
  })

  return response.data?.data || null
}

async function ingestReportingFromOdoo(context = {}) {
  const response = await apiClient.post('/service/reporting/ingest-odoo', {
    chat_id: context.chatId || '',
    chat_name: context.chatName || '',
    recipient_email: reportingRecipientEmail || undefined,
  }, {
    headers: {
      'X-Service-Token': serviceToken,
    },
  })

  return response.data?.data || null
}

async function storeOutboundMessage(conversationId, reply, chatbotDecision, providerMessageId = null, extraMeta = {}) {
  if (!conversationId || !reply) {
    return null
  }

  const response = await apiClient.post(
    `/service/conversations/${conversationId}/messages`,
    {
      content: reply,
      provider_message_id: providerMessageId,
      meta: {
        source: 'chatbot',
        provider,
        matched_intent: chatbotDecision?.matched_intent || null,
        ...extraMeta,
      },
    },
    {
      headers: {
        'X-Service-Token': serviceToken,
      },
    },
  )

  return response.data?.data || null
}

function resolveOwnParticipantId(record, message) {
  const ownWid = String(record?.accountJid || record?.client?.info?.wid?._serialized || '')
  if (ownWid) {
    return ownWid
  }

  const authorId = String(message?.author || '')
  if (authorId) {
    return authorId
  }

  const ownDigits = sanitizeAccountPhone(record?.phoneE164 || record?.phone)
  return ownDigits ? `${ownDigits.replace(/\D+/g, '')}@c.us` : ''
}

async function processRealtimeMessage(record, message, options = {}) {
    const skipIfSynced = Boolean(options.skipIfSynced)
    const source = String(options.source || 'realtime')
    let alreadySynced = false
    let media = null
    let audioTranscript = null
    let audioTranscriptionFailed = false
    let replyLanguageHint = null
    let voiceNluAnalysis = null

    const ownSerialized = record.accountJid
      || serializedOf(record.client?.info?.wid)
      || ''
    const direction = resolveMessageDirection(message, ownSerialized)
    const fromMe = Boolean(options.fromMe) || direction.fromMe
    const inboundKey = resolveMessageId(message)
      || [message?.id?._serialized, message?.timestamp, direction.chatJid, fromMe ? 'out' : 'in'].filter(Boolean).join(':')
    record.processedMessageKeys = record.processedMessageKeys || new Set()
    if (inboundKey && record.processedMessageKeys.has(inboundKey)) {
      return
    }
    if (inboundKey) {
      record.processedMessageKeys.add(inboundKey)
      if (record.processedMessageKeys.size > 4000) {
        const first = record.processedMessageKeys.values().next().value
        record.processedMessageKeys.delete(first)
      }
    }

    try {
    let content = String(message?.body || '').trim()
    const hasMedia = Boolean(message?.hasMedia)
    const messageType = String(message?.type || '').toLowerCase()
    const messageId = resolveMessageId(message)
    if (!content && !hasMedia) {
      return
    }

    let chat = null
    let chatId = ''
    let chatName = null

    try {
      chat = await runWithRetries(
        () => Promise.race([
          message.getChat(),
          timeoutAfter(instancePingTimeoutMs, 'message.getChat'),
        ]),
        'message.getChat',
      )
      chatId = String(chat?.id?._serialized || chat?.id || '')
      chatName = chat?.name || chat?.formattedTitle || null
    } catch {
      chat = null
    }

    if (!chatId) {
      chatId = direction.chatJid
        || String(fromMe ? (message?.to || message?.from || '') : (message?.from || message?.to || ''))
    }

    if (!chatId) {
      console.warn('[WA_ROUTING]', { accepted: false, reason: 'missing_chat_id' })
      return
    }

    if (isStatusOrBroadcastChatId(chatId)) {
      console.log('[WA_INCOMING]', { chatType: 'broadcast', accepted: false })
      return
    }

    const groupChat = isGroupChatId(chatId)
    const senderId = fromMe
      ? (ownSerialized || resolveOwnParticipantId(record, message))
      : String(message?.author || direction.senderJid || chatId)

    let conversationKey = ''
    if (fromMe) {
      if (groupChat) {
        conversationKey = resolveInboundConversationKey(chatId, senderId || chatId, true)
      } else if (isLidChatId(chatId) || isLidChatId(message?.to) || isPrivateChatJid(chatId)) {
        conversationKey = String(chatId || message?.to || '').trim()
      } else {
        const recipientDigits = normalizePhone(chatId || message?.to || '')
        if (!recipientDigits) {
          conversationKey = String(chatId || '').trim()
        } else {
          conversationKey = `+${recipientDigits}`
        }
      }
    } else {
      conversationKey = resolveInboundConversationKey(chatId, senderId || chatId, groupChat)
    }

    if (!conversationKey) {
      console.warn('[WA_ROUTING]', { accepted: false, reason: 'missing_conversation_key', chat_id: chatId })
      return
    }

    const incomingClass = classifyJid(chatId)
    console.log('[WA_INCOMING]', {
      chatType: groupChat ? 'group' : (incomingClass.isPrivate ? 'private' : incomingClass.jidType),
      identityType: incomingClass.jidType,
      phoneResolved: Boolean(incomingClass.phoneNumber),
      from_me: fromMe,
    })

    let contactName = chatName
    let contactPhoneE164 = null
    try {
      if (!groupChat) {
        const contact = chat && typeof chat.getContact === 'function'
          ? await runWithRetries(
            () => Promise.race([
              chat.getContact(),
              timeoutAfter(instancePingTimeoutMs, 'chat.getContact'),
            ]),
            'chat.getContact',
          )
          : await runWithRetries(
            () => Promise.race([
              message.getContact(),
              timeoutAfter(instancePingTimeoutMs, 'message.getContact'),
            ]),
            'message.getContact',
          )
        contactName = contact?.pushname || contact?.name || contact?.shortName || contactName
        try {
          const { resolvePhoneFromWhatsAppContact } = require('./crm/smart/contact-resolver')
          contactPhoneE164 = await resolvePhoneFromWhatsAppContact(contact, {
            client: record?.client || null,
          })
        } catch {
          contactPhoneE164 = null
        }
        if (contactPhoneE164 || contactName) {
          console.log('[IDENTITY_RESOLUTION]', {
            whatsappId: chatId,
            phoneResolved: Boolean(contactPhoneE164),
            phoneSource: contactPhoneE164 ? 'whatsapp_contact' : null,
            pushname: contactName || null,
          })
        }
      }
    } catch {
      // Keep chat name fallback.
    }

    if (!contactName && groupChat) {
      contactName = 'WhatsApp Group'
    }

    const reportingChat = isReportingAutomationChatId(chatId)
    const reportingAutomationChat = reportingAutomationEnabled && hasMedia && reportingChat
    const odooAutomationChat = !reportingAutomationChat && odooAutomationEnabled && hasMedia && odooAutomationChats.size > 0
      && resolveChatMatchers(chatId).some((item) => odooAutomationChats.has(item))
    const odooSuccessReactionEnabled = !fromMe && hasMedia && odooAutomationChat && shouldSendOdooSuccessReaction(chatId)

    if (skipIfSynced && messageId && await syncedMessageExists(messageId)) {
      alreadySynced = true

      const reportingAlreadyProcessed = reportingAutomationChat && hasSuccessfulAutomation(messageId, 'reporting')
      const reportingAlreadySettled = reportingAutomationChat && hasTerminalAutomation(messageId, 'reporting')
      const reportingRetryAllowed = reportingAutomationChat && canRetryAutomation(messageId, 'reporting')
      const odooAlreadyProcessed = odooAutomationChat && hasSuccessfulAutomation(messageId, 'odoo')
      const odooAlreadySettled = odooAutomationChat && hasTerminalAutomation(messageId, 'odoo')
      const odooRetryAllowed = odooAutomationChat && canRetryAutomation(messageId, 'odoo')
      const odooReactionAlreadyProcessed = odooSuccessReactionEnabled && hasSuccessfulAutomation(messageId, 'odoo_reaction')
      const odooReactionRetryPending = odooSuccessReactionEnabled && (
        !getAutomationState(messageId, 'odoo_reaction')
        || hasFailedAutomation(messageId, 'odoo_reaction')
      )
      const needsAutomationReplay = hasMedia && (
        (reportingAutomationChat && !reportingAlreadySettled && reportingRetryAllowed)
        || (odooAutomationChat && !odooAlreadySettled && odooRetryAllowed)
        || (odooSuccessReactionEnabled && odooAlreadyProcessed && !odooReactionAlreadyProcessed && odooReactionRetryPending)
      )

      if (!needsAutomationReplay) {
        console.log('[iadis-wa] skipped already-synced message during history sync', {
          instance_id: record.instanceId,
          message_id: messageId,
        })
        return
      }

      console.log('[iadis-wa] retrying automation for previously synced message', {
        instance_id: record.instanceId,
        message_id: messageId,
        chat_id: chatId,
        reporting_pending: reportingAutomationChat && !reportingAlreadySettled && reportingRetryAllowed,
        odoo_pending: odooAutomationChat && !odooAlreadySettled && odooRetryAllowed,
        reaction_pending: odooSuccessReactionEnabled && odooAlreadyProcessed && !odooReactionAlreadyProcessed && odooReactionRetryPending,
      })
    }

    const audioMessage = isAudioMedia(null, messageType) || (
      hasMedia && !content && isAudioMessageType(messageType)
    )

    console.log('[iadis-wa] inbound message received', {
      instance_id: record.instanceId,
      chat_id: chatId,
      message_id: messageId,
      type: messageType || null,
      has_media: hasMedia,
      is_audio: audioMessage || isAudioMessageType(messageType),
      from_me: fromMe,
      is_group: groupChat,
      body_length: content.length,
      source,
    })

    if (hasMedia) {
      try {
        media = await extractMessageMedia(message, record)
      } catch (error) {
        console.error('[iadis-wa] failed to download inbound media', {
          instance_id: record.instanceId,
          chat_id: chatId,
          message_id: messageId,
          type: messageType || null,
          reason: error.message || String(error),
        })
        if (aiReplyToAudio && !fromMe && !backendEnabled && isAudioMessageType(messageType)) {
          audioTranscriptionFailed = true
        } else if (!fromMe && isImageMedia(null, messageType)) {
          // Keep going — image may still be referenced as unavailable
          media = null
        } else {
          throw error
        }
      }
    }

    let crmInboundMedia = null
    if (!fromMe && media && isImageMedia(media, messageType)) {
      try {
        crmInboundMedia = persistCrmMediaFile(media.filePath, {
          conversationKey: chatId,
          filename: media.filename || 'image.jpg',
          mimeType: media.mimeType || 'image/jpeg',
        })
      } catch (error) {
        console.warn('[iadis-wa] failed to persist inbound image for CRM', error.message || error)
      }
    }

    const resolvedAudioMessage = Boolean(
      isAudioMedia(media, messageType)
      || (audioMessage && !media && isAudioMessageType(messageType)),
    )
    const shouldTranscribeAudio = Boolean(
      !fromMe
      && !backendEnabled
      && resolvedAudioMessage
      && aiReplyToAudio
      && source !== 'automation_history',
    )

    if (shouldTranscribeAudio) {
      if (!media) {
        audioTranscriptionFailed = true
        console.error('[iadis-wa] audio transcription skipped because media download returned empty', {
          instance_id: record.instanceId,
          chat_id: chatId,
          message_id: messageId,
          type: messageType || null,
        })
      } else {
        try {
          const transcription = await transcribeAudioMedia(media)
          audioTranscript = transcription.text

          if (aiVoiceNluEnabled) {
            voiceNluAnalysis = await analyzeVoiceTranscript({
              rawTranscript: audioTranscript,
              asrScore: transcription.score,
              asrWeak: transcription.weak,
              asrLabel: transcription.label,
              messageId,
              chatId,
              audioPath: media.filePath,
              logDir: aiVoiceNluLogDir,
              archiveAudio: aiVoiceArchiveAudio,
              // Primary path: AI Transcript Interpreter (raw ASR → structured JSON)
              transcriptInterpreter: runAiTranscriptInterpreterLlm,
            })
            replyLanguageHint = voiceNluAnalysis.replyLanguageHint || 'auto'
            content = voiceNluAnalysis.llmCorrectedText
              || voiceNluAnalysis.correctedText
              || audioTranscript
            console.log('[iadis-wa] AI Transcript Interpreter', {
              instance_id: record.instanceId,
              chat_id: chatId,
              message_id: messageId,
              pipeline_mode: voiceNluAnalysis.pipelineMode || null,
              language: voiceNluAnalysis.language,
              intent: voiceNluAnalysis.intent,
              interpreter_intent: voiceNluAnalysis.interpreter?.intent || null,
              service: voiceNluAnalysis.serviceDetection?.service || null,
              service_confidence: voiceNluAnalysis.serviceDetection?.confidence || null,
              problem: voiceNluAnalysis.interpreter?.problem || null,
              confidence: voiceNluAnalysis.confidence.score,
              low_confidence: voiceNluAnalysis.lowConfidence,
              recoverable: voiceNluAnalysis.recoverable,
              corrected_preview: String(content || '').slice(0, 120),
              meaning_hint: voiceNluAnalysis.meaningHint || null,
              log_path: voiceNluAnalysis.logPath || null,
            })

            // Last resort only: empty / junk transcript with no recoverable intent.
            // Never ask clarification if a global intent is confidently detected (>70%).
            const earlyIntent = classifyIntent(String(content || ''), {
              interpreterIntent: voiceNluAnalysis.interpreter?.intent || null,
              voiceIntent: voiceNluAnalysis.intent || null,
            })
            const junkOrEmpty = Boolean(
              !String(content || '').trim()
              || voiceNluAnalysis.confidence?.reasons?.includes('junk_transcript')
              || voiceNluAnalysis.confidence?.reasons?.includes('empty'),
            )
            if (
              voiceNluAnalysis.lowConfidence
              && junkOrEmpty
              && !voiceNluAnalysis.recoverable
              && earlyIntent.confidence < 0.7
            ) {
              audioTranscriptionFailed = true
              console.warn('[iadis-wa] unrecoverable voice transcript, asking clarification', {
                instance_id: record.instanceId,
                chat_id: chatId,
                message_id: messageId,
                confidence: voiceNluAnalysis.confidence.score,
                reasons: voiceNluAnalysis.confidence.reasons,
              })
            }
          } else {
            const transcriptLanguageHint = detectUserLanguageHint(audioTranscript)
            replyLanguageHint = transcriptLanguageHint || 'auto'
            content = audioTranscript
          }

          console.log('[iadis-wa] transcribed inbound audio message', {
            instance_id: record.instanceId,
            chat_id: chatId,
            message_id: messageId,
            mime_type: media.mimeType,
            transcript_length: audioTranscript.length,
            score: transcription.score,
            label: transcription.label,
            language_hint: replyLanguageHint,
            weak: transcription.weak,
            preview: String(content || audioTranscript || '').slice(0, 120),
          })

          // Extremely weak ASR without NLU remains a clarification path.
          if (!aiVoiceNluEnabled && transcription.weak && transcription.score < 8) {
            audioTranscriptionFailed = true
            console.warn('[iadis-wa] rejecting very weak audio transcript', {
              instance_id: record.instanceId,
              chat_id: chatId,
              message_id: messageId,
              score: transcription.score,
              preview: audioTranscript.slice(0, 120),
            })
          }
        } catch (error) {
          audioTranscriptionFailed = true
          console.error('[iadis-wa] audio transcription failed', {
            instance_id: record.instanceId,
            chat_id: chatId,
            message_id: messageId,
            mime_type: media?.mimeType || null,
            reason: error.message || String(error),
            status: error.response?.status || null,
            details: error.response?.data || null,
          })
        }
      }
    }

    const reportingAutomationActive = Boolean(
      messageId
        && reportingAutomationChat
        && media
        && isSpreadsheetMedia(media)
        && !hasTerminalAutomation(messageId, 'reporting')
        && (!skipIfSynced || canRetryAutomation(messageId, 'reporting')),
    )
    const reportingOdooAutomationActive = Boolean(
      messageId
        && !fromMe
        && !skipIfSynced
        && shouldRunReportingOdooAutomation(chatId, content, hasMedia)
        && !hasTerminalAutomation(messageId, 'reporting_odoo'),
    )
    const odooAutomationActive = Boolean(
      messageId
        && !reportingAutomationActive
        && !reportingOdooAutomationActive
        && odooAutomationChat
        && media
        && !hasTerminalAutomation(messageId, 'odoo')
        && (!skipIfSynced || canRetryAutomation(messageId, 'odoo')),
    )
    let odooIngestion = null
    let reportingIngestion = null

    if (reportingAutomationActive && media) {
      reportingIngestion = await ingestReportingSpreadsheet(media, {
        chatId,
        chatName,
      })
      console.log('[iadis-wa] reporting spreadsheet ingested', {
        chat_id: chatId,
        message_id: messageId,
        batch_id: reportingIngestion?.id || null,
        sellers: reportingIngestion?.seller_count || null,
      })
      updateAutomationState(messageId, 'reporting', {
        status: 'processed',
        reason: 'Reporting batch created',
        target: {
          id: reportingIngestion?.id || null,
          share_url: reportingIngestion?.share_url || null,
        },
      })
    }

    if (reportingOdooAutomationActive) {
      reportingIngestion = await ingestReportingFromOdoo({
        chatId,
        chatName,
      })
      console.log('[iadis-wa] reporting odoo import ingested', {
        chat_id: chatId,
        message_id: messageId,
        batch_id: reportingIngestion?.id || null,
        sellers: reportingIngestion?.seller_count || null,
      })
      updateAutomationState(messageId, 'reporting_odoo', {
        status: 'processed',
        reason: 'Reporting Odoo batch created',
        target: {
          id: reportingIngestion?.id || null,
          share_url: reportingIngestion?.share_url || null,
        },
      })
    }

    if (odooAutomationActive && media) {
      odooIngestion = await ingestMediaWithOdoo(media, {
        chatId,
        participantId: groupChat ? (senderId || null) : null,
        messageId,
      })
      console.log('[iadis-wa] media ingested for odoo', {
        chat_id: chatId,
        message_id: messageId,
        status: odooIngestion?.status || null,
        reason: odooIngestion?.reason || null,
      })
      updateAutomationState(messageId, 'odoo', odooIngestion || {
        status: 'failed',
        reason: 'Odoo ingestion returned no payload',
      })
    }

    const shouldAttemptOdooSuccessReaction = Boolean(
      messageId
        && odooSuccessReactionEnabled
        && !hasSuccessfulAutomation(messageId, 'odoo_reaction')
        && (
          odooIngestion?.status === 'processed'
          || hasSuccessfulAutomation(messageId, 'odoo')
        ),
    )

    if (shouldAttemptOdooSuccessReaction) {
      try {
        await reactToMessage(message, odooSuccessReactionEmoji)
        updateAutomationState(messageId, 'odoo_reaction', {
          status: 'processed',
          reason: `Applied WhatsApp reaction ${odooSuccessReactionEmoji}`,
        })
        console.log('[iadis-wa] applied success reaction for odoo message', {
          chat_id: chatId,
          message_id: messageId,
          reaction: odooSuccessReactionEmoji,
        })
      } catch (error) {
        updateAutomationState(messageId, 'odoo_reaction', {
          status: 'failed',
          reason: error.message || 'Failed to apply WhatsApp reaction',
        })
        console.error('[iadis-wa] failed to apply success reaction for odoo message', {
          chat_id: chatId,
          message_id: messageId,
          reaction: odooSuccessReactionEmoji,
          reason: error.message || String(error),
        })
      }
    }

    if (!replyLanguageHint && content) {
      replyLanguageHint = detectUserLanguageHint(content)
    }

    const baseMeta = {
      instance_id: record.instanceId,
      chat_id: chatId,
      is_group: groupChat,
      chat_name: chatName,
      contact_phone: contactPhoneE164 || null,
      crm_media: crmInboundMedia
        ? {
          media_path: crmInboundMedia.mediaPath,
          media_mime: crmInboundMedia.mediaMime,
          media_filename: crmInboundMedia.mediaFilename,
          media_size: crmInboundMedia.mediaSize,
          message_type: 'image',
        }
        : null,
      participant_id: groupChat ? (senderId || null) : null,
      participant_phone: groupChat && senderId ? toDisplayPhone(senderId) : null,
      has_media: hasMedia,
      is_audio: resolvedAudioMessage,
      audio_transcript: audioTranscript || null,
      reply_language_hint: replyLanguageHint || null,
      voice_nlu: voiceNluAnalysis
        ? {
            language: voiceNluAnalysis.language,
            replyLanguageHint: voiceNluAnalysis.replyLanguageHint,
            correctedText: voiceNluAnalysis.correctedText,
            normalizedText: voiceNluAnalysis.normalizedText,
            meaningHint: voiceNluAnalysis.meaningHint,
            serviceDetection: voiceNluAnalysis.serviceDetection || null,
            service: voiceNluAnalysis.service || null,
            interpreter: voiceNluAnalysis.interpreter || null,
            pipelineMode: voiceNluAnalysis.pipelineMode || null,
            intent: voiceNluAnalysis.intent,
            intentConfidence: voiceNluAnalysis.intentConfidence,
            entities: voiceNluAnalysis.entities,
            confidence: voiceNluAnalysis.confidence,
            lowConfidence: voiceNluAnalysis.lowConfidence,
            llmBlock: voiceNluAnalysis.llmBlock,
            logPath: voiceNluAnalysis.logPath || null,
          }
        : null,
      media: media
        ? {
            filename: media.filename,
            mime_type: media.mimeType,
            size: media.size,
          }
        : null,
      odoo_ingestion: odooIngestion,
      reporting_ingestion: reportingIngestion
        ? {
            batch_id: reportingIngestion.id,
            seller_count: reportingIngestion.seller_count,
            share_url: reportingIngestion.share_url,
            source: reportingAutomationActive ? 'spreadsheet' : (reportingOdooAutomationActive ? 'odoo' : null),
          }
        : null,
    }

    const syncedContent = content || buildMediaSummary(media)
    touchRecord(record, { lastMessageAt: nowIso() })

    if (alreadySynced) {
      console.log('[iadis-wa] automation replay completed for previously synced message', {
        chat_id: chatId,
        message_id: messageId,
        reporting_status: reportingIngestion ? 'processed' : null,
        odoo_status: odooIngestion?.status || null,
        reaction_status: getAutomationState(messageId, 'odoo_reaction')?.status || null,
      })
      return
    }

    if (fromMe) {
      if (!backendEnabled) {
        console.log('[iadis-wa] outbound device message observed in standalone mode', {
          chat_id: chatId,
          message_id: messageId,
        })
        return
      }

      await syncServiceMessage({
        contact_phone: conversationKey,
        contact_name: contactName,
        direction: 'outbound',
        channel: 'whatsapp',
        content: syncedContent,
        provider_message_id: messageId,
        meta: {
          ...baseMeta,
          source: 'device_sync',
        },
      })
      console.log('[iadis-wa] synced outbound device message', {
        chat_id: chatId,
        message_id: messageId,
        has_media: hasMedia,
        is_group: groupChat,
      })
      return
    }

    if (!backendEnabled && isChatbotBlockedForChat(chatId)) {
      console.log('[iadis-wa] standalone chatbot reply skipped for blocked chat', {
        chat_id: chatId,
      })
      return
    }

    if (!backendEnabled && groupChat && !aiReplyInGroups) {
      console.log('[iadis-wa] standalone chatbot reply skipped for group chat', {
        chat_id: chatId,
      })
      return
    }

    if (!backendEnabled && source === 'automation_history') {
      console.log('[iadis-wa] standalone chatbot reply skipped for history message', {
        chat_id: chatId,
        message_id: messageId,
      })
      return
    }

    if (!backendEnabled && hasMedia && !content && !aiReplyToMedia && !(resolvedAudioMessage && aiReplyToAudio)) {
      console.log('[iadis-wa] standalone chatbot reply skipped for media-only message', {
        chat_id: chatId,
        message_id: messageId,
        type: messageType || null,
        mime_type: media?.mimeType || null,
      })
      return
    }

    let chatbot = null
    let ingestion = null

    if (!backendEnabled && resolvedAudioMessage && aiReplyToAudio && audioTranscriptionFailed) {
      const clarification = voiceNluAnalysis
        ? buildLowConfidenceVoiceReply(voiceNluAnalysis.language)
        : (audioTranscript ? aiAudioUnclearReply : aiAudioErrorReply)
      chatbot = {
        reply: clarification,
        reason: voiceNluAnalysis?.lowConfidence ? 'audio_low_confidence' : (audioTranscript ? 'audio_transcription_weak' : 'audio_transcription_failed'),
        model: openAiTranscribeModel,
        language_hint: voiceNluAnalysis?.replyLanguageHint || replyLanguageHint || null,
        intent: voiceNluAnalysis?.intent || null,
      }
    } else {
      ingestion = await getIncomingDecision({
        from: conversationKey,
        contact_name: contactName,
        content: syncedContent,
        provider: 'whatsapp-web',
        provider_message_id: messageId,
        meta: baseMeta,
      }, {
        conversationId: `${record.instanceId}:${chatId}`,
      })

      if (backendEnabled && isChatbotBlockedForChat(chatId)) {
        console.log('[iadis-wa] chatbot reply skipped for blocked chat', {
          chat_id: chatId,
        })
        return
      }

      chatbot = ingestion?.chatbot || null
    }

    if (!chatbot?.reply) {
      console.log('[iadis-wa] synced inbound message without chatbot reply', {
        chat_id: chatId,
        message_id: messageId,
        has_media: hasMedia,
        is_audio: resolvedAudioMessage,
        is_group: groupChat,
        reason: ingestion?.chatbot?.reason || null,
      })
      return
    }

    // Race guard: human may have taken over while AI was generating
    if (
      crm?.smart
      && !crm.smart.canAiAutoReply(chatId)
      && !crm.smart.canAiAutoReply(`${record.instanceId}:${chatId}`)
      && !crm.smart.canAiAutoReply(conversationKey)
    ) {
      console.log('[iadis-wa] AI reply suppressed before WhatsApp send (human control)', {
        chat_id: chatId,
        message_id: messageId,
        reason: chatbot.reason || null,
      })
      return
    }

    const replyDigits = normalizePhone(senderId)
    const outboundReplies = [
      chatbot.reply,
      ...(Array.isArray(chatbot.extraReplies) ? chatbot.extraReplies : []),
    ].map((item) => String(item || '').trim()).filter(Boolean)
    const firstReply = outboundReplies[0] || chatbot.reply
    const sent = await replyToInboundMessage(message, record, replyDigits, firstReply, chatId)
    console.log('[WA_REPLY]', {
      success: true,
      chat_id: sent.chatId,
      message_id: messageId,
    })
    console.log('[iadis-wa] chatbot reply sent', {
      chat_id: sent.chatId,
      message_id: messageId,
      reply_message_id: sent.messageId,
      is_audio: resolvedAudioMessage,
      reason: chatbot.reason || null,
      intent: voiceNluAnalysis?.intent || chatbot.intent || null,
      language_hint: voiceNluAnalysis?.replyLanguageHint || replyLanguageHint || null,
      crm_stage: chatbot.crm_stage || null,
      extra_replies: Math.max(0, outboundReplies.length - 1),
    })

    for (const extraText of outboundReplies.slice(1)) {
      try {
        const extraSent = await sendTextThroughInstance(record, replyDigits, extraText, chatId)
        console.log('[iadis-wa] chatbot extra reply sent', {
          chat_id: extraSent.chatId,
          reply_message_id: extraSent.messageId,
        })
        if (backendEnabled) {
          await storeOutboundMessage(
            ingestion?.conversation?.id,
            extraText,
            chatbot,
            extraSent.messageId,
            {
              instance_id: record.instanceId,
              chat_id: extraSent.chatId,
              automated: true,
            },
          )
        }
      } catch (extraError) {
        console.warn('[iadis-wa] extra CRM reply failed', extraError.message || extraError)
      }
    }

    if (chatbot.crm_booking && crm) {
      await notifyCrmStaffBooking(record, chatbot.crm_booking)
    }

    if (voiceNluAnalysis?.logPath) {
      updateVoiceNluLog(voiceNluAnalysis.logPath, {
        reponse_generee: chatbot.reply,
        reply_message_id: sent.messageId || null,
        chatbot_reason: chatbot.reason || null,
        crm_appointment_id: chatbot.crm_booking?.appointment?.id || null,
      })
    }

    await storeOutboundMessage(
      ingestion?.conversation?.id,
      chatbot.reply,
      chatbot,
      sent.messageId,
      {
        instance_id: record.instanceId,
        chat_id: sent.chatId,
        automated: true,
      },
    )
  } catch (error) {
    console.error('[iadis-wa] realtime inbound processing failed', {
      reason: error.message || String(error),
      code: error.code || null,
      stack: error.stack || null,
    })
    if (error.code === 'INVALID_PHONE' || error.code === 'NUMBER_NOT_REGISTERED' || /send/i.test(String(error.message || ''))) {
      console.warn('[WA_SEND_FAILED]', { reason: error.message || String(error) })
    }
    if (isProtocolTimeoutError(error)) {
      await recoverInstance(record, error.message || 'Realtime processing timed out')
    }
  } finally {
    if (media?.filePath) {
      cleanupTempFile(media.filePath)
    }
  }
}

async function replyToInboundMessage(message, record, toPhone, text, preferredChatId = null) {
  if (message && typeof message.reply === 'function') {
    try {
      const sent = await Promise.race([
        message.reply(text),
        timeoutAfter(protocolTimeoutMs, 'message.reply'),
      ])
      updateState(record, 'ready', { lastError: null })
      return {
        messageId: resolveMessageId(sent),
        chatId: String(preferredChatId || message.from || message.to || ''),
      }
    } catch (error) {
      console.warn('[iadis-wa] message.reply failed, fallback to sendTextThroughInstance', {
        reason: error.message || String(error),
      })
    }
  }

  return sendTextThroughInstance(record, toPhone, text, preferredChatId)
}

async function sendTextThroughInstance(record, toPhone, text, preferredChatId = null) {
  const directChatId = String(preferredChatId || '').trim()
  if (directChatId && directChatId.includes('@')) {
    try {
      const sent = await record.client.sendMessage(directChatId, text)
      updateState(record, 'ready', { lastError: null })

      return {
        messageId: resolveMessageId(sent),
        chatId: directChatId,
      }
    } catch (directError) {
      console.warn('[WA_SEND_FAILED]', {
        reason: directError.message || String(directError),
        chat_id: directChatId,
      })
      notifyWhatsAppError(
        'Erreur WhatsApp',
        'Échec d’envoi sur le JID de conversation. Tentative via le numéro si disponible.',
      )
    }
  }

  const normalizedPhone = normalizePhone(toPhone)
  if (!normalizedPhone) {
    const error = new Error('Invalid recipient for WhatsApp send')
    error.code = 'INVALID_PHONE'
    console.warn('[WA_SEND_FAILED]', { reason: error.message, chat_id: directChatId || null })
    throw error
  }

  let chatId = `${normalizedPhone}@c.us`
  const numberId = await record.client.getNumberId(normalizedPhone)
  const serialized = numberId?._serialized || numberId?.serialized || null

  if (serialized && String(serialized).includes('@')) {
    chatId = serialized
  } else if (numberId?.user && sanitizeAccountPhone(numberId.user)) {
    chatId = `${String(numberId.user).replace(/\D+/g, '')}@c.us`
  } else if (serialized) {
    chatId = serialized
  } else {
    const error = new Error('Phone number is not registered on WhatsApp')
    error.code = 'NUMBER_NOT_REGISTERED'
    console.warn('[WA_SEND_FAILED]', { reason: error.message })
    throw error
  }

  const sent = await record.client.sendMessage(chatId, text)
  updateState(record, 'ready', { lastError: null })

  return {
    messageId: resolveMessageId(sent),
    chatId,
  }
}

async function resolveChatIdForSend(record, toPhone) {
  const normalizedPhone = normalizePhone(toPhone)
  if (!normalizedPhone) {
    const error = new Error('Invalid recipient phone number')
    error.code = 'INVALID_PHONE'
    throw error
  }

  let chatId = `${normalizedPhone}@c.us`
  const numberId = await record.client.getNumberId(normalizedPhone)
  const serialized = numberId?._serialized || numberId?.serialized || null

  if (serialized) {
    chatId = serialized
  } else if (numberId?.user) {
    chatId = `${numberId.user}@c.us`
  } else {
    const error = new Error('Phone number is not registered on WhatsApp')
    error.code = 'NUMBER_NOT_REGISTERED'
    throw error
  }

  return chatId
}

async function sendDocumentThroughInstance(record, options = {}) {
  const preferredChatId = String(options.chatId || '').trim()
  const caption = String(options.caption || '').trim()
  const mediaSource = options.mediaSource
  const messageMedia = buildOutboundMessageMedia(mediaSource)
  const mediaSize = Number(mediaSource?.size || messageMedia?.filesize || 0) || 0
  const useWaitUntilSent = mediaSize > 0 && mediaSize <= 16 * 1024 * 1024

  const sendDocument = (chatId) => runWithRetries(
    () => Promise.race([
      record.client.sendMessage(chatId, messageMedia, {
        caption: caption || undefined,
        sendMediaAsDocument: true,
        waitUntilMsgSent: useWaitUntilSent,
      }),
      timeoutAfter(protocolTimeoutMs, `sendMessage ${chatId}`),
    ]),
    `sendMessage ${chatId}`,
  )

  const sendWithRecovery = async (chatId) => {
    try {
      return await sendDocument(chatId)
    } catch (error) {
      if (!isProtocolTimeoutError(error)) {
        throw error
      }

      console.warn('[iadis-wa] recovering instance after outbound document send failure', {
        instance_id: record.instanceId,
        chat_id: chatId,
        reason: error.message || String(error),
      })

      await recoverInstance(record, error.message || `Failed to send document to ${chatId}`)
      await waitForInstanceReady(record)
      return sendDocument(chatId)
    }
  }

  if (preferredChatId && preferredChatId.includes('@')) {
    try {
      const sent = await sendWithRecovery(preferredChatId)
      updateState(record, 'ready', { lastError: null })
      return {
        messageId: resolveMessageId(sent),
        chatId: preferredChatId,
        filename: messageMedia.filename || mediaSource.filename || null,
      }
    } catch (directError) {
      console.warn('[iadis-wa] direct chat_id document send failed, fallback to phone lookup', directError.message || directError)
    }
  }

  const phoneChatId = await resolveChatIdForSend(record, options.toPhone)
  const sent = await sendWithRecovery(phoneChatId)
  updateState(record, 'ready', { lastError: null })

  return {
    messageId: resolveMessageId(sent),
    chatId: phoneChatId,
    filename: messageMedia.filename || mediaSource.filename || null,
  }
}

async function sendImageThroughInstance(record, options = {}) {
  const preferredChatId = String(options.chatId || '').trim()
  const caption = String(options.caption || '').trim()
  const mediaSource = options.mediaSource
  const messageMedia = buildOutboundMessageMedia(mediaSource)
  const mediaSize = Number(mediaSource?.size || messageMedia?.filesize || 0) || 0
  const useWaitUntilSent = mediaSize > 0 && mediaSize <= 16 * 1024 * 1024
  const mimeType = String(messageMedia.mimetype || mediaSource?.mimeType || '').toLowerCase()
  const preferDocument = mimeType === 'image/webp' || mediaSize > 5 * 1024 * 1024

  const sendImage = (chatId, sendMediaAsDocument = preferDocument) => runWithRetries(
    () => Promise.race([
      record.client.sendMessage(chatId, messageMedia, {
        caption: caption || undefined,
        sendMediaAsDocument,
        waitUntilMsgSent: useWaitUntilSent,
      }),
      timeoutAfter(protocolTimeoutMs, `sendImage ${chatId}`),
    ]),
    `sendImage ${chatId}`,
  )

  const sendWithRecovery = async (chatId, sendMediaAsDocument = preferDocument) => {
    try {
      return await sendImage(chatId, sendMediaAsDocument)
    } catch (error) {
      if (!isProtocolTimeoutError(error)) {
        throw error
      }
      console.warn('[iadis-wa] recovering instance after outbound image send failure', {
        instance_id: record.instanceId,
        chat_id: chatId,
        reason: error.message || String(error),
      })
      await recoverInstance(record, error.message || `Failed to send image to ${chatId}`)
      await waitForInstanceReady(record)
      return sendImage(chatId, sendMediaAsDocument)
    }
  }

  const sendWithDocumentFallback = async (chatId) => {
    try {
      return await sendWithRecovery(chatId, preferDocument)
    } catch (error) {
      if (!preferDocument) {
        return sendWithRecovery(chatId, true)
      }
      throw error
    }
  }

  if (preferredChatId && preferredChatId.includes('@')) {
    try {
      const sent = await sendWithDocumentFallback(preferredChatId)
      updateState(record, 'ready', { lastError: null })
      return {
        messageId: resolveMessageId(sent),
        chatId: preferredChatId,
        filename: messageMedia.filename || mediaSource.filename || null,
      }
    } catch (directError) {
      console.warn('[iadis-wa] direct chat_id image send failed, fallback to phone lookup', directError.message || directError)
    }
  }

  const phoneChatId = await resolveChatIdForSend(record, options.toPhone)
  const sent = await sendWithDocumentFallback(phoneChatId)
  updateState(record, 'ready', { lastError: null })

  return {
    messageId: resolveMessageId(sent),
    chatId: phoneChatId,
    filename: messageMedia.filename || mediaSource.filename || null,
  }
}

async function listInstanceChats(record, options = {}) {
  const groupsOnly = Boolean(options.groupsOnly)
  const search = String(options.search || '').trim().toLowerCase()
  const limit = Math.max(1, Math.min(Number(options.limit || 50), 200))

  const chats = await runWithRetries(
    () => Promise.race([
      record.client.getChats(),
      timeoutAfter(protocolTimeoutMs, 'getChats'),
    ]),
    'getChats',
  )

  const normalizedChats = (Array.isArray(chats) ? chats : [])
    .map((chat) => {
      const serializedId = chat?.id?._serialized || null
      return {
        chat_id: serializedId,
        name: String(chat?.name || '').trim() || null,
        is_group: Boolean(chat?.isGroup),
        archived: Boolean(chat?.archived),
        unread_count: Number(chat?.unreadCount || 0),
        timestamp: Number(chat?.timestamp || 0) || null,
      }
    })
    .filter((chat) => Boolean(chat.chat_id))
    .filter((chat) => !groupsOnly || chat.is_group)
    .filter((chat) => {
      if (!search) {
        return true
      }

      return String(chat.chat_id || '').toLowerCase().includes(search)
        || String(chat.name || '').toLowerCase().includes(search)
    })
    .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))
    .slice(0, limit)

  updateState(record, 'ready', { lastError: null })
  return normalizedChats
}

function mapOutboundMediaErrorToStatus(error) {
  switch (error?.code) {
    case 'INVALID_MEDIA_URL':
    case 'INVALID_MEDIA_PATH':
    case 'INVALID_PHONE':
    case 'NUMBER_NOT_REGISTERED':
    case 'MEDIA_SOURCE_REQUIRED':
      return 422
    case 'MEDIA_FILE_NOT_FOUND':
      return 404
    case 'MEDIA_TOO_LARGE':
      return 413
    case 'REMOTE_FETCH_FAILED':
    case 'REMOTE_FETCH_EMPTY':
      return 502
    case 'WA_NOT_AVAILABLE':
      return 501
    default:
      return 500
  }
}

app.get('/health', (_req, res) => {
  const mainRecord = getInstance('main')
  res.json({
    status: 'ok',
    service: 'iadis-whatsapp-service',
    provider,
    whatsapp: {
      can_connect: Boolean(WaClient && LocalAuth && QRCode),
      puppeteer_executable: resolvePuppeteerExecutablePath() || null,
      main_state: mainRecord?.state || 'missing',
      main_last_error: mainRecord?.lastError || null,
      connected: String(mainRecord?.state || '').toLowerCase() === 'ready',
      account: {
        phone: publicAccountPhone(mainRecord),
        resolved: Boolean(publicAccountPhone(mainRecord)),
      },
    },
    chatbot: {
      mode: chatbotMode,
      configured: backendEnabled ? Boolean(serviceToken) : Boolean(openAiApiKey),
      model: backendEnabled ? null : openAiModel,
      reply_to_audio: !backendEnabled && aiReplyToAudio,
      transcribe_model: backendEnabled ? null : openAiTranscribeModel,
    },
    uptime_seconds: Math.round(process.uptime()),
  })
})

app.get('/', (_req, res) => {
  res.redirect(302, '/dashboard')
})

const dashboardDistDir = path.join(dashboardDir, 'dist')
const dashboardSpaIndex = path.join(dashboardDistDir, 'index.html')

app.get('/dashboard/api/auth/accounts', (_req, res) => {
  try {
    const accounts = dashboardUsers.listActivePublicAccounts()
    return res.json({ ok: true, accounts })
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'Impossible de charger les comptes' })
  }
})

app.post('/dashboard/api/auth/login', (req, res) => {
  try {
    const accountId = req.body?.accountId ?? req.body?.account_id ?? null
    const username = req.body?.username ?? null
    const password = req.body?.password
    const { session, user } = dashboardAuth.login({ accountId, username, password })
    const resolved = dashboardUsers.resolveSessionUser(user.id)
    try {
      crm?.smart?.recordActivity?.({
        event_type: 'dashboard_login',
        category: 'system',
        actor: {
          type: 'human',
          userId: resolved.id,
          displayName: resolved.displayName,
          role: resolved.role,
        },
        source: 'dashboard',
        title: 'Connexion au dashboard',
        description: `${resolved.displayName} s’est connecté(e) au Smart CRM.`,
        source_event_id: `login:${resolved.id}:${Date.now()}`,
        severity: 'sensitive',
      })
    } catch { /* non-blocking */ }
    return res.json({
      ok: true,
      token: session.token,
      user: {
        id: resolved.id,
        displayName: resolved.displayName,
        role: resolved.role,
        roleLabel: resolved.roleLabel,
        permissions: resolved.permissions || [],
      },
      username: user.username,
      expires_at: new Date(session.expiresAt).toISOString(),
    })
  } catch (error) {
    const code = error.code === 'AUTH_FAILED' ? 401
      : (error.code === 'AUTH_DISABLED' ? 403 : 400)
    return res.status(code).json({
      ok: false,
      error: error.message || 'Connexion impossible',
    })
  }
})

app.post('/dashboard/api/auth/logout', ensureDashboardSession, (req, res) => {
  dashboardAuth.destroySession(req.header('x-dashboard-token') || '')
  return res.json({ ok: true })
})

app.get('/dashboard/api/auth/me', ensureDashboardSession, (req, res) => {
  const user = req.dashboardUser
  const security = crm?.smart?.getSecuritySettings?.() || null
  return res.json({
    ok: true,
    id: user.id,
    displayName: user.displayName,
    role: user.role,
    roleLabel: user.roleLabel,
    permissions: user.permissions || [],
    username: user.username,
    expires_at: new Date(req.dashboardSession.expiresAt).toISOString(),
    security,
  })
})

app.post('/dashboard/api/auth/change-password', ensureDashboardSession, (req, res) => {
  try {
    const user = req.dashboardUser
    const result = dashboardAuth.changePassword(
      user.id,
      req.body?.current_password,
      req.body?.new_password,
    )
    try {
      crm?.smart?.recordActivity?.({
        event_type: 'dashboard_user_password_changed',
        category: 'system',
        actor: {
          type: 'human',
          userId: user.id,
          displayName: user.displayName,
          role: user.role,
        },
        source: 'dashboard',
        title: `Mot de passe mis à jour : ${user.displayName}`,
        metadata: {
          user_id: user.id,
          display_name: user.displayName,
          role: user.role,
          role_label: user.roleLabel,
        },
        source_event_id: `user:pwchanged:${user.id}:${Date.now()}`,
        severity: 'sensitive',
      })
    } catch {
      /* ignore activity errors */
    }
    return res.json({
      ok: true,
      ...result,
    })
  } catch (error) {
    const code = error.code === 'AUTH_FAILED' || error.code === 'AUTH_FORBIDDEN'
      ? 401
      : (error.code === 'WEAK_PASSWORD' || error.code === 'VALIDATION' ? 400 : 400)
    return res.status(code).json({
      ok: false,
      error: error.message || 'Impossible de changer le mot de passe',
    })
  }
})

app.use(
  '/dashboard/api',
  ensureDashboardSession,
  createUserManagementRouter({
    users: dashboardUsers,
    recordActivity: (payload) => crm?.smart?.recordActivity?.(payload),
    destroyUserSessions: (userId) => dashboardAuth.destroySessionsForUser(userId),
  }),
)

app.use(
  '/dashboard/api',
  ensureDashboardSession,
  createSmartCrmRouter({
    getSmart: () => (crm ? crm.smart : null),
    getCrm: () => crm,
    assertPermission,
    sendWhatsAppText: async ({ chatId = null, phone = null, text }) => {
      const body = String(text || '').trim()
      if (!body) {
        const error = new Error('Message vide')
        error.code = 'EMPTY_MESSAGE'
        throw error
      }
      const record = ensureInstance('main')
      const state = String(record.state || '').toLowerCase()
      if (state !== 'ready' && state !== 'authenticated') {
        const error = new Error(`WhatsApp non connecté (${record.state || 'missing'})`)
        error.code = 'WA_NOT_READY'
        throw error
      }
      const rawChat = String(chatId || '').replace(/^[^:]+:/, '').trim()
      const preferredChatId = rawChat.includes('@') ? rawChat : ''
      return sendTextThroughInstance(record, phone || preferredChatId, body, preferredChatId || null)
    },
    sendWhatsAppImage: async ({ chatId = null, phone = null, caption = '', filePath, filename, mimeType }) => {
      const record = ensureInstance('main')
      const state = String(record.state || '').toLowerCase()
      if (state !== 'ready' && state !== 'authenticated') {
        const error = new Error(`WhatsApp non connecté (${record.state || 'missing'})`)
        error.code = 'WA_NOT_READY'
        throw error
      }
      if (!filePath || !fs.existsSync(filePath)) {
        const error = new Error('Fichier image introuvable')
        error.code = 'MEDIA_MISSING'
        throw error
      }
      const mime = String(mimeType || '').toLowerCase()
      const ext = path.extname(String(filename || filePath || '')).toLowerCase()
      const extOk = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext)
      if (
        !allowedDashboardImageMimes.has(mime)
        && !mime.startsWith('image/')
        && !((!mime || mime === 'application/octet-stream') && extOk)
      ) {
        const error = new Error('Ce type de fichier n’est pas pris en charge.')
        error.code = 'MEDIA_TYPE'
        throw error
      }
      const size = fs.statSync(filePath).size
      if (size > dashboardImageMaxBytes) {
        const error = new Error('L’image est trop volumineuse.')
        error.code = 'MEDIA_TOO_LARGE'
        throw error
      }
      const rawChat = String(chatId || '').replace(/^[^:]+:/, '').trim()
      const preferredChatId = rawChat.includes('@') ? rawChat : ''
      return sendImageThroughInstance(record, {
        chatId: preferredChatId || null,
        toPhone: phone || null,
        caption,
        mediaSource: {
          filePath,
          filename: filename || path.basename(filePath),
          mimeType: mime || 'image/jpeg',
          size,
        },
      })
    },
    resolveCrmMediaAbsolutePath: (mediaPath) => {
      const relative = String(mediaPath || '').replace(/\\/g, '/').trim()
      if (!relative || relative.includes('..')) return null
      const absolute = path.resolve(process.cwd(), relative)
      const root = path.resolve(crmMediaDir)
      if (!absolute.startsWith(root)) return null
      if (!fs.existsSync(absolute)) return null
      return absolute
    },
    dashboardImageMaxBytes,
    allowedDashboardImageMimes,
    persistCrmMediaFile,
  }),
)

app.get('/dashboard/api/overview', ensureDashboardSession, (_req, res) => {
  const instances = listKnownInstanceIds().map(serializeDashboardInstance)
  const voiceOrders = listVoiceNluOrders(100)
  const crmStats = crm ? crm.repo.getCrmStats() : {
    customers: 0,
    appointments: 0,
    upcoming_confirmed: 0,
    dental_cases: 0,
    appointments_today: 0,
    messages_total: 0,
    pending_appointments: 0,
    weekly_appointments: [],
  }
  const monthStart = new Date()
  monthStart.setDate(1)
  const monthFrom = monthStart.toISOString().slice(0, 10)
  const upcoming = crm
    ? crm.repo.listAppointments({ limit: 12, fromDate: new Date().toISOString().slice(0, 10) })
    : []
  const monthAppointments = crm
    ? crm.repo.listAppointments({ limit: 200, fromDate: monthFrom })
    : []
  const readyCount = instances.filter((item) => String(item.state || '').toLowerCase() === 'ready').length
  const messagesTotal = Number(crmStats.messages_total || 0) + voiceOrders.length
  const clinicProfile = crm?.smart?.getClinicSettings?.()?.clinic || {
    name: 'Centre Dentaire HEL',
    city: 'Casablanca',
    neighborhood: 'El Oulfa',
  }

  return res.json({
    ok: true,
    clinic: {
      name: clinicProfile.name || 'Centre Dentaire HEL',
      city: clinicProfile.city || 'Casablanca',
      neighborhood: clinicProfile.neighborhood || 'El Oulfa',
    },
    chatbot: {
      mode: chatbotMode,
      reply_to_audio: !backendEnabled && aiReplyToAudio,
      model: backendEnabled ? null : openAiModel,
      transcribe_model: backendEnabled ? null : openAiTranscribeModel,
      voice_nlu: aiVoiceNluEnabled,
      crm_enabled: Boolean(crm),
    },
    stats: {
      instances_total: instances.length,
      instances_ready: readyCount,
      demandes_total: voiceOrders.length,
      demandes_traitees: voiceOrders.filter((item) => item.statut === 'traitee').length,
      crm_customers: crmStats.customers,
      crm_appointments: crmStats.appointments,
      crm_upcoming: crmStats.upcoming_confirmed,
      appointments_today: Number(crmStats.appointments_today || 0),
      pending_appointments: Number(crmStats.pending_appointments || 0),
      messages_total: messagesTotal,
      uptime_seconds: Math.round(process.uptime()),
    },
    weekly_appointments: crmStats.weekly_appointments || [],
    instances,
    recent_orders: upcoming.length ? upcoming : voiceOrders.slice(0, 8),
    month_appointments: monthAppointments,
    frequent_problems: crm ? crm.repo.frequentProblems(6) : [],
  })
})

app.get('/dashboard/api/orders', ensureDashboardSession, (req, res) => {
  const limit = Math.max(1, Math.min(200, Number(req.query.limit || 80)))
  const q = String(req.query.q || '').trim()
  const tab = String(req.query.tab || 'appointments').trim().toLowerCase()

  if (!crm) {
    return res.json({
      ok: true,
      tab: 'voice',
      orders: listVoiceNluOrders(limit),
      customers: [],
      cases: [],
      frequent_problems: [],
    })
  }

  if (tab === 'customers') {
    return res.json({
      ok: true,
      tab,
      orders: [],
      customers: crm.repo.listCustomers({ limit, query: q }),
      cases: [],
      frequent_problems: crm.repo.frequentProblems(8),
    })
  }

  if (tab === 'cases' || tab === 'history') {
    return res.json({
      ok: true,
      tab: 'cases',
      orders: [],
      customers: [],
      cases: crm.repo.listDentalCases({ limit }),
      frequent_problems: crm.repo.frequentProblems(8),
    })
  }

  if (tab === 'voice') {
    return res.json({
      ok: true,
      tab,
      orders: listVoiceNluOrders(limit),
      customers: [],
      cases: [],
      frequent_problems: crm.repo.frequentProblems(8),
    })
  }

  return res.json({
    ok: true,
    tab: 'appointments',
    orders: crm.repo.searchOrders({ q, limit }),
    upcoming: crm.repo.listAppointments({
      limit: 20,
      fromDate: new Date().toISOString().slice(0, 10),
    }),
    customers: [],
    cases: [],
    frequent_problems: crm.repo.frequentProblems(8),
    notifications: crm.repo.listStaffNotifications({ limit: 10 }),
  })
})

app.get('/dashboard/api/crm/customers', ensureDashboardSession, (req, res) => {
  if (!assertPermission(req, res, PERMISSIONS.VIEW_PATIENTS)) return undefined
  if (!crm) {
    return res.status(503).json({ ok: false, error: 'CRM désactivé' })
  }
  const limit = Math.max(1, Math.min(200, Number(req.query.limit || 50)))
  const q = String(req.query.q || '').trim()
  return res.json({
    ok: true,
    customers: crm.repo.listCustomers({ limit, query: q }),
  })
})

app.get('/dashboard/api/crm/appointments', ensureDashboardSession, (req, res) => {
  if (!assertPermission(req, res, PERMISSIONS.VIEW_AGENDA)) return undefined
  if (!crm) {
    return res.status(503).json({ ok: false, error: 'CRM désactivé' })
  }
  const limit = Math.max(1, Math.min(200, Number(req.query.limit || 50)))
  return res.json({
    ok: true,
    appointments: crm.repo.listAppointments({ limit, fromDate: req.query.from || null }),
  })
})

app.post('/dashboard/api/crm/appointments', ensureDashboardSession, async (req, res) => {
  if (!assertPermission(req, res, PERMISSIONS.CREATE_APPOINTMENT)) return undefined
  if (!crm) {
    return res.status(503).json({ ok: false, error: 'CRM désactivé' })
  }

  try {
    const result = crm.repo.createManualAppointment(req.body || {})
    const appointmentId = Number(result.appointment_id || result.appointment?.id || 0) || null
    const patientId = Number(result.customer_id || result.customer?.id || 0) || null
    const patientName = result.full_name || result.customer?.full_name || null
    const actor = getAuthenticatedActor(req.dashboardUser)

    let sideEffects = { whatsapp: { attempted: false, sent: false }, followup: { scheduled: false } }
    if (appointmentId && typeof crm.smart?.completeManualAppointmentCreation === 'function') {
      sideEffects = await crm.smart.completeManualAppointmentCreation(result, {
        actorDisplayName: actor?.displayName
          || req.dashboardUser?.displayName
          || req.dashboardUser?.username
          || 'Assistante',
      })
    }

    if (appointmentId) {
      const date = String(req.body?.appointment_date || result.appointment?.appointment_date || '')
      const time = String(req.body?.appointment_time || result.appointment?.appointment_time || '').slice(0, 5)
      const slotLabel = date && time ? `${date} ${time}` : null
      crm.smart?.recordActivity?.({
        event_type: 'appointment_created',
        category: 'appointment',
        actor: actor || {
          type: 'dashboard_user',
          userId: req.dashboardUser?.id != null ? Number(req.dashboardUser.id) : null,
          displayName: String(
            req.dashboardUser?.displayName
            || req.dashboardUser?.username
            || 'Utilisateur',
          ),
          role: String(req.dashboardUser?.role || 'secretary'),
        },
        origin: 'dashboard',
        source: 'dashboard',
        patient_id: patientId,
        appointment_id: appointmentId,
        title: 'Rendez-vous créé',
        description: [patientName, slotLabel].filter(Boolean).join(' — ') || null,
        new_value: {
          date: date || null,
          time: time || null,
          status: result.appointment?.status || 'confirmed',
          patient_name: patientName,
          created_via: 'dashboard_manual',
        },
        metadata: {
          actor_user_id: actor?.userId || req.dashboardUser?.id || null,
          actor_display_name: actor?.displayName
            || req.dashboardUser?.displayName
            || req.dashboardUser?.username
            || null,
          actor_role: actor?.role || req.dashboardUser?.role || null,
          account_username: req.dashboardUser?.username || null,
          whatsapp_sent: sideEffects.whatsapp?.sent || false,
        },
        source_event_id: `appointment:created:${appointmentId}`,
      })
    }
    return res.status(201).json({
      ok: true,
      ...result,
      whatsapp: sideEffects.whatsapp,
      followup: sideEffects.followup,
    })
  } catch (error) {
    if (error.code === 'SLOT_CONFLICT') {
      return res.status(409).json({
        ok: false,
        error: error.message || 'Ce créneau est déjà réservé.',
        code: 'SLOT_CONFLICT',
      })
    }
    const status = error.code === 'VALIDATION' ? 400 : 400
    return res.status(status).json({
      ok: false,
      error: error.message || 'Impossible de créer le rendez-vous',
    })
  }
})

app.patch('/dashboard/api/crm/appointments/:id', ensureDashboardSession, async (req, res) => {
  const body = req.body || {}
  const isCancel = String(body.status || '') === 'cancelled'
  const isConfirm = String(body.status || '') === 'confirmed'
  const perm = isCancel
    ? PERMISSIONS.CANCEL_APPOINTMENT
    : (isConfirm ? PERMISSIONS.CONFIRM_APPOINTMENT : PERMISSIONS.EDIT_APPOINTMENT)
  if (!assertPermission(req, res, perm)) return undefined
  if (!crm) {
    return res.status(503).json({ ok: false, error: 'CRM désactivé' })
  }

  try {
    // Central cancel — same engine as WhatsApp patient self-cancel
    if (String(body.status || '') === 'cancelled' && crm.smart?.cancelAppointment) {
      const cancelOpts = {
        source: body.source || 'staff_dashboard',
        actorName: req.dashboardUser?.displayName || req.dashboardUser?.username || null,
        actor: getAuthenticatedActor(req.dashboardUser),
      }
      const result = typeof crm.smart.cancelAppointmentAndNotify === 'function'
        ? await crm.smart.cancelAppointmentAndNotify(req.params.id, cancelOpts)
        : crm.smart.cancelAppointment(req.params.id, cancelOpts)
      if (!result.ok && result.reason === 'not_found') {
        return res.status(404).json({ ok: false, error: 'Rendez-vous introuvable' })
      }
      if (!result.ok && result.reason === 'not_cancellable') {
        return res.status(400).json({ ok: false, error: 'Ce rendez-vous ne peut pas être annulé' })
      }
      const appt = result.appointment || null
      return res.json({
        ok: true,
        already: Boolean(result.already),
        whatsapp: result.whatsapp || null,
        appointment: appt
          ? {
            id: appt.id,
            status: appt.status || 'cancelled',
            appointment_date: appt.appointment_date,
            appointment_time: appt.appointment_time,
            customer_id: appt.customer_id,
            full_name: appt.full_name,
            phone_number: appt.phone_number,
          }
          : { id: Number(req.params.id), status: 'cancelled' },
      })
    }

    // Staff manual confirm → WhatsApp notify patient (mirror cancel notify)
    if (
      String(body.status || '') === 'confirmed'
      && Object.keys(body).every((k) => k === 'status' || k === 'source')
      && typeof crm.smart?.confirmAppointmentAndNotify === 'function'
    ) {
      const confirmOpts = {
        source: body.source || 'staff_dashboard',
        actorName: req.dashboardUser?.displayName || req.dashboardUser?.username || null,
        actor: getAuthenticatedActor(req.dashboardUser),
      }
      const result = await crm.smart.confirmAppointmentAndNotify(req.params.id, confirmOpts)
      if (!result.ok && result.reason === 'not_found') {
        return res.status(404).json({ ok: false, error: 'Rendez-vous introuvable' })
      }
      if (!result.ok && result.reason === 'invalid_status') {
        return res.status(400).json({
          ok: false,
          error: 'Ce rendez-vous ne peut pas être confirmé',
        })
      }
      const appt = result.appointment || null
      const actor = getAuthenticatedActor(req.dashboardUser)
      if (actor && appt && !result.already) {
        crm.smart?.recordActivity?.({
          event_type: 'appointment_confirmed',
          category: 'appointment',
          actor,
          origin: 'dashboard',
          source: 'dashboard',
          patient_id: appt.customer_id,
          appointment_id: Number(req.params.id),
          title: 'Rendez-vous confirmé',
          old_value: { status: 'non_confirme' },
          new_value: {
            date: appt.appointment_date,
            time: String(appt.appointment_time || '').slice(0, 5),
            status: 'confirmed',
          },
          source_event_id: `appointment:confirm:${req.params.id}:${Date.now()}`,
        })
      }
      return res.json({
        ok: true,
        already: Boolean(result.already),
        whatsapp: result.whatsapp || null,
        appointment: appt
          ? {
            id: appt.id,
            status: appt.status || 'confirmed',
            appointment_date: appt.appointment_date,
            appointment_time: appt.appointment_time,
            customer_id: appt.customer_id,
            full_name: appt.full_name,
            phone_number: appt.phone_number,
          }
          : { id: Number(req.params.id), status: 'confirmed' },
      })
    }

    const beforeRow = crm?.db?.prepare(`
      SELECT a.id, a.appointment_date, a.appointment_time, a.status, a.customer_id
      FROM appointments a WHERE a.id = ?
    `).get(Number(req.params.id))

    const appointment = crm.repo.updateAppointment(req.params.id, body)
    const actor = getAuthenticatedActor(req.dashboardUser)
    if (actor && appointment && beforeRow) {
      const oldDate = String(beforeRow.appointment_date || '')
      const oldTime = String(beforeRow.appointment_time || '').slice(0, 5)
      const newDate = String(appointment.appointment_date || oldDate)
      const newTime = String(appointment.appointment_time || oldTime).slice(0, 5)
      const statusChanged = String(body.status || beforeRow.status) !== String(beforeRow.status)
      const dateChanged = body.appointment_date != null && newDate !== oldDate
      const timeChanged = body.appointment_time != null && newTime !== oldTime

      let eventType = 'appointment_updated'
      let title = 'Rendez-vous modifié'
      if (statusChanged && String(body.status) === 'confirmed') {
        eventType = 'appointment_confirmed'
        title = 'Rendez-vous confirmé'
      } else if (dateChanged && timeChanged) {
        eventType = 'appointment_rescheduled'
        title = 'Rendez-vous déplacé'
      } else if (dateChanged) {
        eventType = 'appointment_rescheduled'
        title = 'Date du rendez-vous modifiée'
      } else if (timeChanged) {
        eventType = 'appointment_rescheduled'
        title = 'Horaire du rendez-vous modifié'
      }

      crm.smart?.recordActivity?.({
        event_type: eventType,
        category: 'appointment',
        actor,
        origin: 'dashboard',
        source: 'dashboard',
        patient_id: appointment.customer_id || beforeRow.customer_id,
        appointment_id: Number(req.params.id),
        title,
        old_value: { date: oldDate, time: oldTime, status: beforeRow.status },
        new_value: { date: newDate, time: newTime, status: appointment.status },
        source_event_id: `appointment:update:${req.params.id}:${Date.now()}`,
      })
    }
    if (appointment?._slot_released && crm.smart?.notifySlotReleased) {
      try {
        const released = appointment._slot_released
        crm.smart.notifySlotReleased({
          slotDate: released.slot_date,
          slotTime: released.slot_time,
          appointmentId: released.appointment_id,
          sourceEvent: released.source_event || 'appointment_cancelled',
          durationMinutes: released.duration_minutes || 30,
        })
      } catch (notifyError) {
        console.warn('[iadis-wa] slot release notification failed', notifyError.message || notifyError)
      }
      delete appointment._slot_released
    }
    return res.json({
      ok: true,
      appointment,
    })
  } catch (error) {
    if (error.code === 'SLOT_CONFLICT') {
      return res.status(409).json({
        ok: false,
        error: error.message || 'Ce créneau n\'est plus disponible.',
        code: 'SLOT_CONFLICT',
      })
    }
    const code = error.code === 'NOT_FOUND' ? 404 : 400
    return res.status(code).json({
      ok: false,
      error: error.message || 'Impossible de modifier le rendez-vous',
    })
  }
})

app.delete('/dashboard/api/crm/appointments/:id', ensureDashboardSession, (req, res) => {
  if (!assertPermission(req, res, PERMISSIONS.CANCEL_APPOINTMENT)) return undefined
  if (!crm) {
    return res.status(503).json({ ok: false, error: 'CRM désactivé' })
  }

  try {
    const beforeRow = crm?.db?.prepare(`
      SELECT a.id, a.customer_id, a.appointment_date, a.appointment_time, c.full_name
      FROM appointments a
      JOIN customers c ON c.id = a.customer_id
      WHERE a.id = ?
    `).get(Number(req.params.id))
    const result = crm.repo.deleteAppointment(req.params.id)
    const actor = getAuthenticatedActor(req.dashboardUser)
    if (actor && beforeRow) {
      crm.smart?.recordActivity?.({
        event_type: 'appointment_deleted',
        category: 'appointment',
        actor,
        origin: 'dashboard',
        source: 'dashboard',
        patient_id: beforeRow.customer_id,
        appointment_id: beforeRow.id,
        title: 'Rendez-vous supprimé',
        description: beforeRow.full_name || null,
        old_value: { date: beforeRow.appointment_date, time: beforeRow.appointment_time },
        source_event_id: `appointment:deleted:${beforeRow.id}`,
      })
    }
    return res.json({
      ok: true,
      ...result,
    })
  } catch (error) {
    const code = error.code === 'NOT_FOUND' ? 404 : 400
    return res.status(code).json({
      ok: false,
      error: error.message || 'Impossible de supprimer le rendez-vous',
    })
  }
})

app.get('/dashboard/api/instances', ensureDashboardSession, (req, res) => {
  if (!assertPermission(req, res, PERMISSIONS.VIEW_INTEGRATIONS)) return undefined
  return res.json({
    ok: true,
    instances: listKnownInstanceIds().map(serializeDashboardInstance),
  })
})

app.post('/dashboard/api/instances', ensureDashboardSession, async (req, res) => {
  if (!assertPermission(req, res, PERMISSIONS.MANAGE_WHATSAPP)) return undefined
  const instanceId = normalizeInstanceId(req.body?.instance_id)
  const force = parseBoolean(req.body?.force, false)

  try {
    const existing = getInstance(instanceId)
    const state = String(existing?.state || '').toLowerCase()
    const browserLocked = /browser is already running/i.test(String(existing?.lastError || ''))
    const shouldReset = force
      || browserLocked
      || !existing
      || ['disconnected', 'auth_failure', 'missing'].includes(state)

    const record = shouldReset
      ? await resetInstanceForQr(instanceId, 'Dashboard reconnect')
      : ensureInstance(instanceId)

    return res.json({
      ok: true,
      instance: serializeDashboardInstance(instanceId),
      status: serializeStatus(record),
    })
  } catch (error) {
    const code = error.code === 'WA_NOT_AVAILABLE' ? 501 : 500
    return res.status(code).json({
      ok: false,
      error: error.message || 'Unable to initialize dashboard instance',
    })
  }
})

app.get('/dashboard/api/instances/:instanceId/qr', ensureDashboardSession, (req, res) => {
  if (!assertPermission(req, res, PERMISSIONS.MANAGE_WHATSAPP)) return undefined
  const instanceId = normalizeInstanceId(req.params.instanceId)
  const record = getInstance(instanceId)

  return res.json({
    ok: true,
    instance: serializeDashboardInstance(instanceId),
    state: record?.state || 'missing',
    qr: record?.qr || null,
    pairing_code: record?.pairingCode || null,
    pairing_code_display: formatPairingCodeDisplay(record?.pairingCode),
    pairing_phone: record?.pairingPhone || getPairPhoneForInstance(instanceId) || null,
    created_at: record?.qrCreatedAt || record?.pairingCodeCreatedAt || null,
    lastError: record?.lastError || null,
  })
})

app.post('/dashboard/api/instances/:instanceId/qr', ensureDashboardSession, async (req, res) => {
  if (!assertPermission(req, res, PERMISSIONS.MANAGE_WHATSAPP)) return undefined
  const instanceId = normalizeInstanceId(req.params.instanceId)
  const force = parseBoolean(req.body?.force, true)
  const rawWait = Number(req.body?.wait_ms)
  const waitMs = Number.isFinite(rawWait) ? Math.max(0, rawWait) : defaultDashboardQrWaitMs

  try {
    // QR mode must not keep a pending pairWithPhoneNumber option.
    setPairPhoneForInstance(instanceId, null)

    let record = getInstance(instanceId)
    const state = String(record?.state || '').toLowerCase()

    if (state === 'ready' && !force) {
      return res.json({
        ok: true,
        instance: serializeDashboardInstance(instanceId),
        state: record.state,
        qr: null,
        pairing_code: null,
        pairing_code_display: null,
        pairing_phone: null,
        created_at: record.qrCreatedAt || null,
        lastError: null,
      })
    }

    const browserLocked = /browser is already running/i.test(String(record?.lastError || ''))
    const needsReset = force
      || !record
      || browserLocked
      || !record.qr
      || Boolean(record.pairingCode)
      || ['disconnected', 'auth_failure', 'missing', 'code'].includes(state)

    record = needsReset
      ? await resetInstanceForQr(instanceId, 'Dashboard QR generation', { pairPhone: null })
      : ensureInstance(instanceId)

    const qr = waitMs > 0 ? await waitForQr(record, waitMs) : (record.qr || null)
    const finalState = String(record.state || '').toLowerCase()

    return res.json({
      ok: true,
      instance: serializeDashboardInstance(instanceId),
      state: record.state,
      qr,
      pairing_code: record.pairingCode || null,
      pairing_code_display: formatPairingCodeDisplay(record.pairingCode),
      pairing_phone: record.pairingPhone || null,
      created_at: record.qrCreatedAt || null,
      lastError: record.lastError || null,
      pending: !qr && finalState !== 'ready',
    })
  } catch (error) {
    const code = error.code === 'WA_NOT_AVAILABLE' ? 501 : 500
    return res.status(code).json({
      ok: false,
      error: error.message || 'Unable to fetch dashboard QR code',
    })
  }
})

app.get('/dashboard/api/instances/:instanceId/pair', ensureDashboardSession, (req, res) => {
  if (!assertPermission(req, res, PERMISSIONS.MANAGE_WHATSAPP)) return undefined
  const instanceId = normalizeInstanceId(req.params.instanceId)
  const record = getInstance(instanceId)

  return res.json({
    ok: true,
    instance: serializeDashboardInstance(instanceId),
    state: record?.state || 'missing',
    pairing_code: record?.pairingCode || null,
    pairing_code_display: formatPairingCodeDisplay(record?.pairingCode),
    pairing_phone: record?.pairingPhone || getPairPhoneForInstance(instanceId) || null,
    created_at: record?.pairingCodeCreatedAt || null,
    lastError: record?.lastError || null,
  })
})

app.post('/dashboard/api/instances/:instanceId/pair', ensureDashboardSession, async (req, res) => {
  if (!assertPermission(req, res, PERMISSIONS.MANAGE_WHATSAPP)) return undefined
  const instanceId = normalizeInstanceId(req.params.instanceId)
  const force = parseBoolean(req.body?.force, true)
  const rawWait = Number(req.body?.wait_ms)
  const waitMs = Number.isFinite(rawWait) ? Math.max(0, rawWait) : defaultDashboardQrWaitMs
  const phoneInput = req.body?.phone_number ?? req.body?.phone ?? req.body?.pairing_phone ?? ''

  try {
    const pairPhone = setPairPhoneForInstance(instanceId, phoneInput)
    if (!pairPhone) {
      return res.status(400).json({
        ok: false,
        error: 'Indiquez le numéro WhatsApp à lier (ex. 0612345678 ou 212612345678).',
      })
    }

    let record = getInstance(instanceId)
    const state = String(record?.state || '').toLowerCase()

    if (state === 'ready' && !force) {
      return res.json({
        ok: true,
        instance: serializeDashboardInstance(instanceId),
        state: record.state,
        pairing_code: null,
        pairing_code_display: null,
        pairing_phone: pairPhone,
        created_at: null,
        lastError: null,
      })
    }

    const browserLocked = /browser is already running/i.test(String(record?.lastError || ''))
    const needsReset = force
      || !record
      || browserLocked
      || !record.pairingCode
      || record.pairingPhone !== pairPhone
      || ['disconnected', 'auth_failure', 'missing', 'qr'].includes(state)

    record = needsReset
      ? await resetInstanceForQr(instanceId, 'Dashboard phone pairing', { pairPhone })
      : ensureInstance(instanceId)

    const pairingCode = waitMs > 0
      ? await waitForPairingCode(record, waitMs)
      : (record.pairingCode || null)
    const finalState = String(record.state || '').toLowerCase()

    return res.json({
      ok: true,
      instance: serializeDashboardInstance(instanceId),
      state: record.state,
      pairing_code: pairingCode || record.pairingCode || null,
      pairing_code_display: formatPairingCodeDisplay(pairingCode || record.pairingCode),
      pairing_phone: record.pairingPhone || pairPhone,
      created_at: record.pairingCodeCreatedAt || null,
      lastError: record.lastError || null,
      pending: !(pairingCode || record.pairingCode) && finalState !== 'ready',
    })
  } catch (error) {
    const status = error.code === 'INVALID_PHONE' ? 400 : (error.code === 'WA_NOT_AVAILABLE' ? 501 : 500)
    return res.status(status).json({
      ok: false,
      error: error.message || 'Unable to start phone pairing',
    })
  }
})

app.delete('/dashboard/api/instances/:instanceId', ensureDashboardSession, async (req, res) => {
  if (!assertPermission(req, res, PERMISSIONS.MANAGE_WHATSAPP)) return undefined
  const instanceId = normalizeInstanceId(req.params.instanceId)

  try {
    const result = await removeInstance(instanceId, { deleteSession: true })
    return res.json({
      ok: true,
      ...result,
    })
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || 'Unable to remove dashboard instance',
    })
  }
})

app.use('/dashboard', express.static(dashboardDistDir, {
  index: false,
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
}))

function sendDashboardSpa(_req, res) {
  if (!fs.existsSync(dashboardSpaIndex)) {
    return res.status(503).send(
      'Dashboard SPA non construit. Exécutez: cd dashboard-app && npm run build',
    )
  }
  return res.sendFile(dashboardSpaIndex)
}

app.get('/dashboard', sendDashboardSpa)
app.get('/dashboard/', sendDashboardSpa)
app.get(/^\/dashboard\/(?!api\/).*/, sendDashboardSpa)

app.post('/instance/reset-crm', ensureInternalToken, (req, res) => {
  try {
    const { resetOperationalCrmData } = require('./crm/reset-operational-data')
    const clearMedia = Boolean(req.body?.clear_media || req.query?.clear_media)
    const result = resetOperationalCrmData({
      rootDir: process.cwd(),
      clearMedia,
    })
    console.log('[iadis-wa] operational CRM reset completed', {
      db_path: result.dbPath,
      cleared_tables: result.clearedTables?.length || 0,
      extras: result.extras || [],
    })
    return res.json({ ok: true, ...result })
  } catch (error) {
    console.error('[iadis-wa] operational CRM reset failed', error.message || error)
    return res.status(500).json({
      ok: false,
      error: error.message || 'Unable to reset CRM data',
    })
  }
})

app.post('/instance/init', ensureInternalToken, (req, res) => {
  const instanceId = normalizeInstanceId(req.body?.instance_id)

  try {
    const record = ensureInstance(instanceId)
    return res.json({
      ok: true,
      instance_id: instanceId,
      status: serializeStatus(record),
    })
  } catch (error) {
    const code = error.code === 'WA_NOT_AVAILABLE' ? 501 : 500
    return res.status(code).json({
      ok: false,
      error: error.message || 'Unable to initialize instance',
    })
  }
})

app.get('/instance/status', ensureInternalToken, (req, res) => {
  const instanceId = normalizeInstanceId(req.query.instance_id)
  let record = getInstance(instanceId)

  if (!record) {
    try {
      record = ensureInstance(instanceId)
    } catch {
      record = null
    }
  }

  return res.json({
    ok: true,
    instance_id: instanceId,
    ...serializeStatus(record),
  })
})

app.post('/instance/sync-automation', ensureInternalToken, async (req, res) => {
  const instanceId = normalizeInstanceId(req.body?.instance_id)

  try {
    const record = ensureInstance(instanceId)
    syncAutomationHistory(record, 'manual')

    return res.status(202).json({
      ok: true,
      queued: true,
      instance_id: instanceId,
      ...serializeStatus(record),
    })
  } catch (error) {
    const code = error.code === 'WA_NOT_AVAILABLE' ? 501 : 500
    return res.status(code).json({
      ok: false,
      error: error.message || 'Unable to sync automation history',
    })
  }
})

app.post('/instance/reprocess-messages', ensureInternalToken, async (req, res) => {
  const instanceId = normalizeInstanceId(req.body?.instance_id)
  const rawMessageIds = Array.isArray(req.body?.message_ids)
    ? req.body.message_ids
    : (req.body?.message_id ? [req.body.message_id] : [])
  const messageIds = rawMessageIds
    .map((value) => String(value || '').trim())
    .filter(Boolean)

  if (messageIds.length === 0) {
    return res.status(422).json({
      ok: false,
      error: 'message_ids or message_id is required',
    })
  }

  try {
    const record = ensureInstance(instanceId)
    if (!record?.client) {
      return res.status(503).json({ ok: false, error: 'WhatsApp client is unavailable' })
    }

    const results = []

    for (const messageId of messageIds) {
      try {
        const message = await runWithRetries(
          () => Promise.race([
            record.client.getMessageById(messageId),
            timeoutAfter(instancePingTimeoutMs, `getMessageById ${messageId}`),
          ]),
          `getMessageById ${messageId}`,
        )

        if (!message) {
          results.push({
            message_id: messageId,
            status: 'missing',
            reason: 'Message not found',
          })
          continue
        }

        await processRealtimeMessage(record, message, {
          fromMe: false,
          source: 'manual_reprocess',
          skipIfSynced: true,
        })

        const odooState = getAutomationState(messageId, 'odoo')
        const reactionState = getAutomationState(messageId, 'odoo_reaction')

        results.push({
          message_id: messageId,
          status: odooState?.status || 'unknown',
          reason: odooState?.reason || null,
          reaction_status: reactionState?.status || null,
        })
      } catch (error) {
        results.push({
          message_id: messageId,
          status: 'failed',
          reason: error.message || 'Unable to reprocess message',
        })
      }
    }

    return res.json({
      ok: true,
      instance_id: instanceId,
      results,
    })
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || 'Unable to reprocess messages',
    })
  }
})

app.post('/instance/reprocess-odoo', ensureInternalToken, async (req, res) => {
  const instanceId = normalizeInstanceId(req.body?.instance_id)
  const rawMessageIds = Array.isArray(req.body?.message_ids)
    ? req.body.message_ids
    : (req.body?.message_id ? [req.body.message_id] : [])
  const messageIds = rawMessageIds
    .map((value) => String(value || '').trim())
    .filter(Boolean)

  if (messageIds.length === 0) {
    return res.status(422).json({
      ok: false,
      error: 'message_ids or message_id is required',
    })
  }

  try {
    const record = ensureInstance(instanceId)
    if (!record?.client) {
      return res.status(503).json({ ok: false, error: 'WhatsApp client is unavailable' })
    }

    const results = []

    for (const messageId of messageIds) {
      let media = null
      try {
        const message = await runWithRetries(
          () => Promise.race([
            record.client.getMessageById(messageId),
            timeoutAfter(instancePingTimeoutMs, `getMessageById ${messageId}`),
          ]),
          `getMessageById ${messageId}`,
        )

        if (!message) {
          results.push({
            message_id: messageId,
            status: 'missing',
            reason: 'Message not found',
          })
          continue
        }

        if (!message.hasMedia) {
          results.push({
            message_id: messageId,
            status: 'failed',
            reason: 'Message does not contain media',
          })
          continue
        }

        media = await extractMessageMedia(message, record)
        if (!media) {
          results.push({
            message_id: messageId,
            status: 'failed',
            reason: 'Unable to download message media',
          })
          continue
        }

        const chatId = String(message.from || message.to || '').trim()
        const participantId = String(message.author || '').trim() || null
        const odooIngestion = await ingestMediaWithOdoo(media, {
          chatId,
          participantId,
          messageId,
        })

        updateAutomationState(messageId, 'odoo', odooIngestion || {
          status: 'failed',
          reason: 'Odoo ingestion returned no payload',
        })

        if (odooIngestion?.status === 'processed' && shouldSendOdooSuccessReaction(chatId)) {
          try {
            await reactToMessage(message, odooSuccessReactionEmoji)
            updateAutomationState(messageId, 'odoo_reaction', {
              status: 'processed',
              reason: `Applied WhatsApp reaction ${odooSuccessReactionEmoji}`,
            })
          } catch (error) {
            updateAutomationState(messageId, 'odoo_reaction', {
              status: 'failed',
              reason: error.message || 'Failed to apply WhatsApp reaction',
            })
          }
        }

        results.push({
          message_id: messageId,
          ...(odooIngestion || {
            status: 'failed',
            reason: 'Odoo ingestion returned no payload',
          }),
          reaction_status: getAutomationState(messageId, 'odoo_reaction')?.status || null,
        })
      } catch (error) {
        updateAutomationState(messageId, 'odoo', {
          status: 'failed',
          reason: error.message || 'Unable to force reprocess message',
        })
        results.push({
          message_id: messageId,
          status: 'failed',
          reason: error.message || 'Unable to force reprocess message',
        })
      } finally {
        if (media?.filePath) {
          try {
            fs.unlinkSync(media.filePath)
          } catch {
            // Keep best effort cleanup silent.
          }
        }
      }
    }

    return res.json({
      ok: true,
      instance_id: instanceId,
      results,
    })
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || 'Unable to force reprocess messages',
    })
  }
})

app.post('/instance/react', ensureInternalToken, async (req, res) => {
  const instanceId = normalizeInstanceId(req.body?.instance_id)
  const messageId = String(req.body?.message_id || '').trim()
  const emoji = String(req.body?.emoji || odooSuccessReactionEmoji || '✅').trim()

  if (!messageId) {
    return res.status(422).json({ ok: false, error: 'message_id is required' })
  }

  if (!emoji) {
    return res.status(422).json({ ok: false, error: 'emoji is required' })
  }

  try {
    const record = ensureInstance(instanceId)
    if (!record?.client) {
      return res.status(503).json({ ok: false, error: 'WhatsApp client is unavailable' })
    }

    const message = await runWithRetries(
      () => Promise.race([
        record.client.getMessageById(messageId),
        timeoutAfter(instancePingTimeoutMs, `getMessageById ${messageId}`),
      ]),
      `getMessageById ${messageId}`,
    )

    if (!message) {
      return res.status(404).json({ ok: false, error: 'Message not found' })
    }

    await reactToMessage(message, emoji)

    return res.json({
      ok: true,
      instance_id: instanceId,
      message_id: messageId,
      emoji,
    })
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || 'Unable to apply reaction',
    })
  }
})

app.post('/instance/send', ensureInternalToken, async (req, res) => {
  const instanceId = normalizeInstanceId(req.body?.instance_id)
  const text = String(req.body?.text || '').trim()
  const to = String(req.body?.to || '').trim()
  const chatId = String(req.body?.chat_id || '').trim()

  if (!text || (!to && !chatId)) {
    return res.status(422).json({
      ok: false,
      error: 'Field "text" and one of "to" or "chat_id" are required',
    })
  }

  let record = getInstance(instanceId)
  if (!record) {
    try {
      record = ensureInstance(instanceId)
    } catch (error) {
      const code = error.code === 'WA_NOT_AVAILABLE' ? 501 : 500
      return res.status(code).json({
        ok: false,
        error: error.message || 'Instance not initialized',
      })
    }
  }

  const state = String(record.state || '').toLowerCase()
  if (state !== 'ready' && state !== 'authenticated') {
    return res.status(409).json({
      ok: false,
      error: `Instance is not ready (${record.state || 'missing'})`,
    })
  }

  try {
    const result = await sendTextThroughInstance(record, to, text, chatId)
    return res.json({
      ok: true,
      instance_id: instanceId,
      state: record.state,
      to: to ? toDisplayPhone(to) : null,
      chat_id: result.chatId,
      message_id: result.messageId,
    })
  } catch (error) {
    const code = error.code === 'NUMBER_NOT_REGISTERED' || error.code === 'INVALID_PHONE' ? 422 : 500
    return res.status(code).json({
      ok: false,
      error: error.message || 'Failed to send message',
    })
  }
})

app.post('/instance/send-media', ensureInternalToken, async (req, res) => {
  const instanceId = normalizeInstanceId(req.body?.instance_id)
  const mediaUrl = String(req.body?.media_url || '').trim()
  const filePath = String(req.body?.file_path || '').trim()
  const to = String(req.body?.to || '').trim()
  const chatId = String(req.body?.chat_id || '').trim()
  const caption = String(req.body?.caption || '').trim()
  const filename = String(req.body?.filename || '').trim()

  if ((!mediaUrl && !filePath) || (!chatId && !to)) {
    return res.status(422).json({
      ok: false,
      error: 'Fields "media_url" or "file_path" and one of "chat_id" or "to" are required',
    })
  }

  let record = getInstance(instanceId)
  if (!record) {
    try {
      record = ensureInstance(instanceId)
    } catch (error) {
      const code = error.code === 'WA_NOT_AVAILABLE' ? 501 : 500
      return res.status(code).json({
        ok: false,
        error: error.message || 'Instance not initialized',
      })
    }
  }

  const state = String(record.state || '').toLowerCase()
  if (state !== 'ready' && state !== 'authenticated') {
    return res.status(409).json({
      ok: false,
      error: `Instance is not ready (${record.state || 'missing'})`,
    })
  }

  let mediaSource = null

  try {
    mediaSource = await resolveOutboundMediaSource({
      mediaUrl,
      filePath,
      filename,
    })

    const result = await sendDocumentThroughInstance(record, {
      toPhone: to,
      chatId,
      caption,
      mediaSource,
    })

    console.log('[iadis-wa] outbound document sent', {
      instance_id: instanceId,
      chat_id: result.chatId,
      filename: result.filename,
      source: mediaSource.source,
    })

    return res.json({
      ok: true,
      instance_id: instanceId,
      state: record.state,
      to: to ? toDisplayPhone(to) : null,
      chat_id: result.chatId,
      message_id: result.messageId,
      filename: result.filename,
      source: mediaSource.source,
      size: mediaSource.size,
    })
  } catch (error) {
    console.error('[iadis-wa] outbound document send failed', {
      instance_id: instanceId,
      chat_id: chatId || null,
      filename: filename || mediaSource?.filename || null,
      reason: error.message || String(error),
    })

    return res.status(mapOutboundMediaErrorToStatus(error)).json({
      ok: false,
      error: error.message || 'Failed to send outbound media',
    })
  } finally {
    if (mediaSource?.temporary) {
      cleanupTempFile(mediaSource.filePath)
    }
  }
})

app.get('/instance/chats', ensureInternalToken, async (req, res) => {
  const instanceId = normalizeInstanceId(req.query.instance_id)
  const groupsOnly = parseBoolean(req.query.groups_only, false)
  const search = String(req.query.search || '').trim()
  const limit = Number(req.query.limit || 50)

  let record = getInstance(instanceId)
  if (!record) {
    try {
      record = ensureInstance(instanceId)
    } catch (error) {
      const code = error.code === 'WA_NOT_AVAILABLE' ? 501 : 500
      return res.status(code).json({
        ok: false,
        error: error.message || 'Instance not initialized',
      })
    }
  }

  const state = String(record.state || '').toLowerCase()
  if (state !== 'ready' && state !== 'authenticated') {
    return res.status(409).json({
      ok: false,
      error: `Instance is not ready (${record.state || 'missing'})`,
    })
  }

  try {
    const chats = await listInstanceChats(record, {
      groupsOnly,
      search,
      limit,
    })

    return res.json({
      ok: true,
      instance_id: instanceId,
      count: chats.length,
      chats,
    })
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || 'Unable to list chats',
    })
  }
})

app.post('/instance/qr', ensureInternalToken, async (req, res) => {
  const instanceId = normalizeInstanceId(req.body?.instance_id)

  try {
    setPairPhoneForInstance(instanceId, null)
    const record = ensureInstance(instanceId)
    const qr = await waitForQr(record)

    return res.json({
      ok: true,
      instance_id: instanceId,
      state: record.state,
      qr,
      created_at: record.qrCreatedAt,
    })
  } catch (error) {
    const code = error.code === 'WA_NOT_AVAILABLE' ? 501 : 500
    return res.status(code).json({
      ok: false,
      error: error.message || 'Unable to fetch QR',
    })
  }
})

app.post('/instance/pair', ensureInternalToken, async (req, res) => {
  const instanceId = normalizeInstanceId(req.body?.instance_id)
  const phoneInput = req.body?.phone_number ?? req.body?.phone ?? ''
  const force = parseBoolean(req.body?.force, true)

  try {
    const pairPhone = setPairPhoneForInstance(instanceId, phoneInput)
    if (!pairPhone) {
      return res.status(400).json({
        ok: false,
        error: 'phone_number is required (international digits, e.g. 212612345678)',
      })
    }

    const record = force
      ? await resetInstanceForQr(instanceId, 'API phone pairing', { pairPhone })
      : ensureInstance(instanceId)
    const pairingCode = await waitForPairingCode(record)

    return res.json({
      ok: true,
      instance_id: instanceId,
      state: record.state,
      pairing_code: pairingCode || record.pairingCode || null,
      pairing_code_display: formatPairingCodeDisplay(pairingCode || record.pairingCode),
      pairing_phone: record.pairingPhone || pairPhone,
      created_at: record.pairingCodeCreatedAt || null,
    })
  } catch (error) {
    const status = error.code === 'INVALID_PHONE' ? 400 : (error.code === 'WA_NOT_AVAILABLE' ? 501 : 500)
    return res.status(status).json({
      ok: false,
      error: error.message || 'Unable to start phone pairing',
    })
  }
})

app.post('/incoming', verifyWebhookSecret, async (req, res) => {
  try {
    const normalized = normalizeIncomingPayload(req.body || {})

    if (!normalized.from || !normalized.content) {
      return res.status(422).json({
        ok: false,
        error: 'Payload must include sender and message content',
      })
    }

    const chatReference = normalized?.meta?.chat_id || normalized?.from
    const blockedChat = isChatbotBlockedForChat(chatReference)
    const groupChat = Boolean(normalized?.meta?.is_group || isGroupChatId(chatReference))
    const standaloneReplyAllowed = backendEnabled || (!blockedChat && (!groupChat || aiReplyInGroups))
    const ingestion = standaloneReplyAllowed
      ? await getIncomingDecision(normalized, { conversationId: `webhook:${chatReference}` })
      : {
          conversation: null,
          chatbot: {
            reply: null,
            reason: blockedChat ? 'blocked_chat' : 'group_replies_disabled',
            model: openAiModel,
          },
        }
    const chatbot = ingestion?.chatbot || null

    let outboundMessage = null
    if (chatbot?.reply && !blockedChat) {
      if (backendEnabled) {
        outboundMessage = await storeOutboundMessage(ingestion?.conversation?.id, chatbot.reply, chatbot)
      }
      // Integrate real provider delivery here when Twilio/Meta credentials are enabled.
      console.log('[iadis-wa] outbound placeholder dispatch', {
        to: normalized.from,
        provider,
        reply: chatbot.reply,
      })
    } else if (chatbot?.reply && blockedChat) {
      console.log('[iadis-wa] chatbot reply skipped for blocked chat via /incoming', {
        chat_id: normalized?.meta?.chat_id || normalized?.from,
      })
    }

    return res.status(202).json({
      ok: true,
      conversation_id: ingestion?.conversation?.id || null,
      chatbot,
      outbound_message: outboundMessage,
    })
  } catch (error) {
    const status = error.response?.status || 500
    const details = error.response?.data || error.message

    console.error('[iadis-wa] incoming webhook failed', details)

    return res.status(status).json({
      ok: false,
      error: 'Webhook processing failed',
      details,
    })
  }
})

const host = String(process.env.HOST || '0.0.0.0').trim() || '0.0.0.0'

function listNetworkAddresses() {
  const addresses = new Set()
  const nets = os.networkInterfaces()

  for (const entries of Object.values(nets)) {
    for (const entry of entries || []) {
      if (!entry || entry.internal || entry.family !== 'IPv4') continue
      addresses.add(entry.address)
    }
  }

  return Array.from(addresses)
}

app.listen(port, host, () => {
  const localUrl = `http://127.0.0.1:${port}`
  const dashboardUrl = `${localUrl}/dashboard`
  console.log(`[iadis-wa] service listening on http://${host}:${port} (provider=${provider})`)
  console.log(`[iadis-wa] local dashboard: ${dashboardUrl}`)

  const networkHosts = listNetworkAddresses()
  if (host === '0.0.0.0' && networkHosts.length) {
    for (const address of networkHosts) {
      console.log(`[iadis-wa] network dashboard: http://${address}:${port}/dashboard`)
    }
  }

  if (WaClient) {
    console.log('[iadis-wa] whatsapp-web.js ready', {
      puppeteer_executable: resolvePuppeteerExecutablePath() || '(bundled)',
      cloud_deployment: isCloudDeployment(),
      qr_wait_ms: qrWaitMs,
      session_path: waSessionPath,
    })
  }

  if (!waAutoStart) {
    console.log('[iadis-wa] automatic WhatsApp instance bootstrap is disabled')
    return
  }

  try {
    ensureInstance('main')
    console.log('[iadis-wa] default instance bootstrap requested', {
      instance_id: 'main',
    })
  } catch (error) {
    console.error('[iadis-wa] default instance bootstrap failed', error.message || error)
  }
})

setInterval(() => {
  for (const record of instances.values()) {
    checkInstanceHealth(record)
  }
}, instancePingIntervalMs).unref()

if (automationHistorySyncEnabled) {
  setInterval(() => {
    for (const record of instances.values()) {
      syncAutomationHistory(record, 'interval')
    }
  }, automationHistorySyncIntervalMs).unref()
}

// Appointment confirmation scheduler (24h ask / 4h follow-up / 24h staff task)
if (crm?.smart?.runConfirmationTick) {
  const confirmationTickMs = Number(process.env.CRM_CONFIRMATION_TICK_MS || 60000)
  setInterval(() => {
    crm.smart.runConfirmationTick().catch((error) => {
      console.warn('[CONFIRMATION] tick failed', error.message || error)
    })
  }, Math.max(15000, confirmationTickMs)).unref()
}
