/** Shared French labels for Smart CRM UI — mirror backend enums safely. */

export const conversationStatusLabel = (status?: string | null) => {
  const map: Record<string, string> = {
    TO_PROCESS: 'À traiter',
    AI_IN_PROGRESS: 'IA en cours',
    WAITING_PATIENT: 'En attente du patient',
    TRANSFERRED: 'Transférée',
    HUMAN_CONTROLLED: 'Prise en charge par l’équipe',
    COMPLETED: 'Terminée',
  }
  return map[String(status || '')] || '—'
}

export const appointmentStatusLabel = (status?: string | null) => {
  const map: Record<string, string> = {
    non_confirme: 'À confirmer',
    pending_confirmation: 'À confirmer',
    confirmed: 'Confirmé',
    cancelled: 'Annulé',
    no_show: 'Patient absent',
    completed: 'Terminé',
  }
  return map[String(status || '')] || String(status || '—')
}

export const taskStatusLabel = (status?: string | null) => {
  const map: Record<string, string> = {
    planned: 'Planifiée',
    waiting_response: 'Sans réponse',
    to_call: 'À rappeler',
    completed: 'Terminée',
    cancelled: 'Annulée',
  }
  return map[String(status || '')] || String(status || '—')
}

export function isTechnicalId(value?: string | null) {
  const v = String(value || '').toLowerCase()
  return !v || v.includes('@lid') || v.includes('@broadcast') || /^\d+@/.test(v)
}

export function safePersonLabel(name?: string | null, fallback = 'Contact WhatsApp') {
  if (!name || isTechnicalId(name)) return fallback
  return name
}

export const intentLabel = (key?: string | null) => {
  const map: Record<string, string> = {
    BOOK_APPOINTMENT: 'Prise de rendez-vous',
    RESCHEDULE_APPOINTMENT: 'Déplacement de rendez-vous',
    CANCEL_APPOINTMENT: 'Annulation',
    ASK_OPENING_HOURS: 'Horaires du cabinet',
    ASK_ADDRESS: 'Demande d’adresse',
    DENTAL_PAIN: 'Douleur dentaire',
    ADMIN_REQUEST: 'Demande administrative',
    OTHER: 'Autre',
  }
  const k = String(key || '')
  return map[k] || (k && !/^[A-Z_]+$/.test(k) ? k : '—')
}

export const sourceLabel = (key?: string | null) => {
  const map: Record<string, string> = {
    whatsapp: 'WhatsApp',
    website_form: 'Formulaire du site',
    manual: 'Saisie manuelle',
    meta_lead: 'Meta Lead Ads',
    api: 'API',
    crm_form: 'Formulaire CRM',
    crm_lead: 'Lead CRM',
    booking_confirmed: 'Réservation confirmée',
  }
  return map[String(key || '')] || 'WhatsApp'
}

export const languageLabel = (key?: string | null) => {
  const v = String(key || '').toLowerCase()
  if (!v) return null
  if (v === 'darija' || v === 'ar' || v === 'arabic') return 'Darija'
  if (v === 'fr' || v === 'french') return 'Français'
  if (v === 'en' || v === 'english') return 'Anglais'
  return String(key)
}

export const aiActionLabel = (key?: string | null) => {
  const map: Record<string, string> = {
    handoff_to_human: 'Conversation reprise par l’équipe',
    handoff_to_ai: 'Conversation rendue à l’IA',
    human_reply_sent: 'Réponse envoyée au patient',
    ai_reply: 'Réponse automatique envoyée',
    booking_created: 'Demande de rendez-vous enregistrée',
    appointment_confirmed: 'Rendez-vous confirmé',
    followup_sent: 'Relance envoyée',
    proposed_slots: 'Proposition de créneaux',
    slots_proposed: 'Proposition de créneaux',
    appointment_cancelled: 'Rendez-vous annulé',
    appointment_rescheduled: 'Rendez-vous déplacé',
    admin_reply: 'Réponse administrative envoyée',
    slot_recovered: 'Créneau récupéré via liste d’attente',
  }
  return map[String(key || '')] || '—'
}

export const activityCategoryLabel = (key?: string | null) => {
  const map: Record<string, string> = {
    appointment: 'Rendez-vous',
    followup: 'Relances',
    handoff: 'Handoffs',
    waitlist: 'Liste d’attente',
    patient: 'Patients',
    assistant: 'Assistant',
    knowledge: 'Connaissances',
    whatsapp: 'WhatsApp',
    task: 'Tâches',
    system: 'Système',
    error: 'Erreurs',
  }
  return map[String(key || '')] || String(key || '—')
}

export const activityActorLabel = (actorType?: string | null, name?: string | null) => {
  const t = String(actorType || '')
  if (t === 'ai') return 'Assistant IA'
  if (t === 'patient') return 'Patient'
  if (t === 'human') return name || 'Équipe'
  return 'Système'
}

export function activitySeverityTone(severity?: string | null) {
  const s = String(severity || '')
  if (s === 'error') return 'text-danger'
  if (s === 'success') return 'text-success'
  if (s === 'sensitive' || s === 'warning') return 'text-warning'
  return 'text-muted'
}
