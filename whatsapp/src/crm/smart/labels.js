/**
 * Central UI labels for Smart CRM — never expose backend enums in the dashboard.
 */

const CONVERSATION_STATUS_LABELS = {
  TO_PROCESS: 'À traiter',
  AI_IN_PROGRESS: 'IA en cours',
  WAITING_PATIENT: 'En attente du patient',
  TRANSFERRED: 'Transférée',
  HUMAN_CONTROLLED: 'Prise en charge par l’équipe',
  COMPLETED: 'Terminée',
}

const APPOINTMENT_STATUS_LABELS = {
  non_confirme: 'À confirmer',
  pending_confirmation: 'À confirmer',
  confirmed: 'Confirmé',
  cancelled: 'Annulé',
  no_show: 'Patient absent',
  completed: 'Terminé',
}

const TASK_STATUS_LABELS = {
  planned: 'Planifiée',
  waiting_response: 'Sans réponse',
  to_call: 'À rappeler',
  completed: 'Terminée',
  cancelled: 'Annulée',
}

const WAITLIST_PRIORITY_LABELS = {
  urgence: 'Urgence',
  haute: 'Haute',
  normale: 'Normale',
}

const AUTOMATION_TRIGGER_LABELS = {
  appointment_in_24h: '24 heures avant le rendez-vous',
  no_patient_response: 'Le patient n’a pas répondu',
  appointment_cancelled: 'Un rendez-vous a été annulé',
  appointment_completed: 'Un rendez-vous est terminé',
}

const AUTOMATION_ACTION_LABELS = {
  match_waitlist: 'Notifier le créneau libéré (sans envoi auto)',
  notify_released_slot: 'Afficher le créneau libéré dans l’Agenda',
  send_whatsapp_confirmation: 'Envoyer une demande de confirmation WhatsApp',
  send_whatsapp_followup: 'Envoyer une relance WhatsApp',
  create_assistant_task: 'Créer une tâche pour l’assistante',
  admin_followup: 'Action administrative configurée',
}

const CAPABILITY_LABELS = {
  admin_questions: 'Répondre aux questions administratives',
  propose_appointments: 'Proposer des rendez-vous',
  modify_appointments: 'Modifier les rendez-vous',
  cancel_appointments: 'Annuler les rendez-vous',
  send_reminders: 'Envoyer des rappels',
  share_address: 'Partager l’adresse',
  share_hours: 'Partager les horaires',
  transfer_conversation: 'Transférer une conversation',
  create_tasks: 'Créer des tâches',
  waitlist: 'Gérer la liste d’attente',
}

const GUARDRAIL_LABELS = {
  no_diagnosis: 'Ne jamais établir un diagnostic',
  no_treatment_change: 'Ne jamais modifier un traitement',
  no_clinical_recommendation: 'Ne jamais donner une recommandation clinique non validée',
  no_invented_medical_info: 'Ne jamais inventer une information médicale',
  no_invented_hours: 'Ne jamais inventer les horaires',
  no_invented_prices: 'Ne jamais inventer les prix',
  no_invented_availability: 'Ne jamais inventer les disponibilités',
}

const CONFIRMATION_POLICY_LABELS = {
  staff_required: {
    title: 'Confirmation WhatsApp + secours équipe',
    description: 'Le patient confirme via WhatsApp 24 h avant. L’équipe n’intervient que si aucune réponse.',
  },
  patient_confirmation_allowed: {
    title: 'Confirmation possible par le patient',
    description: 'Le patient peut confirmer directement selon les règles configurées.',
  },
}

const AI_ACTION_LABELS = {
  handoff_to_human: 'Conversation reprise par l’équipe',
  handoff_to_ai: 'Conversation rendue à l’IA',
  human_reply_queued: 'Réponse de l’assistante enregistrée',
  human_reply_sent: 'Réponse envoyée au patient',
  ai_reply: 'Réponse automatique envoyée',
  slot_recovered: 'Créneau récupéré via liste d’attente',
  booking_created: 'Demande de rendez-vous enregistrée',
  confirmation_request_sent: 'Demande de confirmation WhatsApp envoyée',
  followup_sent: 'Relance envoyée',
  followup_manual_sent: 'Relance manuelle envoyée',
  followup_validated: 'Relance validée',
  appointment_confirmed: 'Rendez-vous confirmé',
  appointment_cancelled: 'Rendez-vous annulé',
  appointment_rescheduled: 'Rendez-vous déplacé',
  appointment_moved_manually: 'Rendez-vous déplacé manuellement',
  slot_proposal_sent: 'Proposition de créneau envoyée',
  slot_proposal_accepted: 'Proposition acceptée',
  slot_proposal_declined: 'Proposition refusée',
  admin_reply: 'Réponse administrative envoyée',
  proposed_slots: 'Proposition de créneaux',
  slots_proposed: 'Proposition de créneaux',
}

const INTENT_LABELS = {
  BOOK_APPOINTMENT: 'Prise de rendez-vous',
  RESCHEDULE_APPOINTMENT: 'Déplacement de rendez-vous',
  CANCEL_APPOINTMENT: 'Annulation',
  ASK_OPENING_HOURS: 'Horaires du cabinet',
  ASK_ADDRESS: 'Demande d’adresse',
  DENTAL_PAIN: 'Douleur dentaire',
  ADMIN_REQUEST: 'Demande administrative',
  OTHER: 'Autre',
}

const SOURCE_LABELS = {
  whatsapp: 'WhatsApp',
  website_form: 'Formulaire du site',
  manual: 'Saisie manuelle',
  meta_lead: 'Meta Lead Ads',
  api: 'API',
  crm_form: 'Formulaire CRM',
  crm_lead: 'Lead CRM',
  booking_confirmed: 'Réservation confirmée',
}

const CHANNEL_LABELS = {
  whatsapp: 'WhatsApp',
  phone: 'Téléphone',
  web: 'Site web',
}

function labelOf(map, key, fallback = null) {
  if (key == null || key === '') return fallback || '—'
  return map[String(key)] || fallback || String(key)
}

function conversationStatusLabel(status) {
  return labelOf(CONVERSATION_STATUS_LABELS, status, status)
}

function appointmentStatusLabel(status) {
  return labelOf(APPOINTMENT_STATUS_LABELS, status, status)
}

function taskStatusLabel(status) {
  return labelOf(TASK_STATUS_LABELS, status, status)
}

function automationTriggerLabel(key) {
  return labelOf(AUTOMATION_TRIGGER_LABELS, key, key)
}

function automationActionLabel(key) {
  return labelOf(AUTOMATION_ACTION_LABELS, key, key)
}

function capabilityLabel(key) {
  return labelOf(CAPABILITY_LABELS, key, key)
}

function guardrailLabel(key) {
  return labelOf(GUARDRAIL_LABELS, key, key)
}

function confirmationPolicyLabel(key) {
  return CONFIRMATION_POLICY_LABELS[String(key)] || {
    title: String(key || 'Politique de confirmation'),
    description: '',
  }
}

function aiActionLabel(key) {
  return labelOf(AI_ACTION_LABELS, key, key)
}

function intentLabel(key) {
  return labelOf(INTENT_LABELS, key, key)
}

function sourceLabel(key) {
  return labelOf(SOURCE_LABELS, key, key)
}

function channelLabel(key) {
  return labelOf(CHANNEL_LABELS, key, key)
}

function languageLabel(key) {
  const v = String(key || '').toLowerCase()
  if (!v) return null
  if (v === 'darija' || v === 'ar' || v === 'arabic') return 'Darija'
  if (v === 'fr' || v === 'french') return 'Français'
  if (v === 'en' || v === 'english') return 'Anglais'
  return String(key)
}

function formatDelayMinutes(minutes) {
  const n = Number(minutes) || 0
  if (n <= 0) return 'Immédiatement'
  if (n < 60) return `${n} min`
  const h = Math.round(n / 60)
  if (n % 60 === 0) return h === 1 ? '1 heure' : `${h} heures`
  return `${n} min`
}

function formatAiActionLine(row) {
  const when = String(row.created_at || '').replace('T', ' ').slice(0, 16)
  const action = aiActionLabel(row.action_type)
  const detail = row.reason || row.result || ''
  return {
    id: row.id,
    at: when,
    text: detail ? `${action} — ${detail}` : action,
    action_type: row.action_type,
  }
}

module.exports = {
  CONVERSATION_STATUS_LABELS,
  APPOINTMENT_STATUS_LABELS,
  TASK_STATUS_LABELS,
  WAITLIST_PRIORITY_LABELS,
  AUTOMATION_TRIGGER_LABELS,
  AUTOMATION_ACTION_LABELS,
  CAPABILITY_LABELS,
  GUARDRAIL_LABELS,
  CONFIRMATION_POLICY_LABELS,
  AI_ACTION_LABELS,
  INTENT_LABELS,
  SOURCE_LABELS,
  CHANNEL_LABELS,
  conversationStatusLabel,
  appointmentStatusLabel,
  taskStatusLabel,
  automationTriggerLabel,
  automationActionLabel,
  capabilityLabel,
  guardrailLabel,
  confirmationPolicyLabel,
  aiActionLabel,
  intentLabel,
  sourceLabel,
  channelLabel,
  languageLabel,
  formatDelayMinutes,
  formatAiActionLine,
}
