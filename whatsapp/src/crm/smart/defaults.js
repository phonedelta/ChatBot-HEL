/**
 * HEL clinic defaults for Smart Mini CRM — never use mockup demo data.
 */

const { WEEKLY_HOURS } = require('../working-hours')

const HEL_CLINIC = {
  name: 'Centre Dentaire HEL',
  city: 'Casablanca',
  neighborhood: 'El Oulfa',
  phone: '(+212) 7 107 44444',
  email: 'contact@centredentairehel.ma',
  address: 'No. 10, 1st floor, Rue 52 Bd Oued Oum Rabii, opposite Busway Moulouya, El Oulfa, Casablanca',
  timezone: 'Africa/Casablanca',
  languages: {
    fr: true,
    darija: true,
    ar: false,
    en: false,
  },
}

const HEL_ASSISTANT = {
  name: 'Assistant du cabinet',
  tone: 'Professionnel et chaleureux',
  active: true,
  confirmationPolicy: 'staff_required',
  capabilities: {
    admin_questions: true,
    propose_appointments: true,
    modify_appointments: true,
    cancel_appointments: true,
    send_reminders: true,
    share_address: true,
    share_hours: true,
    transfer_conversation: true,
    create_tasks: true,
    waitlist: true,
  },
  guardrails: {
    no_diagnosis: true,
    no_treatment_change: true,
    no_clinical_recommendation: true,
    no_invented_medical_info: true,
    no_invented_hours: true,
    no_invented_prices: true,
    no_invented_availability: true,
  },
}

const DEFAULT_AUTOMATIONS = [
  {
    key: 'confirm_24h_before',
    name: 'Confirmation rendez-vous',
    description: '24 heures avant le rendez-vous → envoyer une demande de confirmation WhatsApp',
    trigger_event: 'appointment_in_24h',
    action_type: 'send_whatsapp_confirmation',
    delay_minutes: 0,
    status: 'active',
    config_json: JSON.stringify({ hours_before: 24 }),
  },
  {
    key: 'no_response_4h',
    name: 'Patient sans réponse',
    description: 'Aucune réponse 4 heures après la demande de confirmation → relance WhatsApp',
    trigger_event: 'no_patient_response',
    action_type: 'send_whatsapp_followup',
    delay_minutes: 240,
    status: 'active',
    config_json: JSON.stringify({ hours: 4 }),
  },
  {
    key: 'no_response_24h_task',
    name: 'Toujours sans réponse',
    description: 'Aucune réponse 24 heures après la demande initiale → créer une tâche assistante',
    trigger_event: 'no_patient_response',
    action_type: 'create_assistant_task',
    delay_minutes: 1440,
    status: 'active',
    config_json: JSON.stringify({ hours: 24 }),
  },
  {
    key: 'cancel_waitlist',
    name: 'Créneau libéré',
    description: 'Rendez-vous annulé → afficher le créneau libéré dans l’Agenda (aucune proposition WhatsApp automatique)',
    trigger_event: 'appointment_cancelled',
    action_type: 'notify_released_slot',
    delay_minutes: 0,
    status: 'active',
    config_json: JSON.stringify({ auto_propose: false }),
  },
  {
    key: 'after_consultation',
    name: 'Après consultation',
    description: 'Rendez-vous terminé → action administrative configurée',
    trigger_event: 'appointment_completed',
    action_type: 'admin_followup',
    delay_minutes: 0,
    status: 'paused',
    config_json: JSON.stringify({ enabled: false }),
  },
]

const DEFAULT_INTEGRATIONS = [
  {
    key: 'whatsapp',
    name: 'WhatsApp',
    status: 'connected',
    is_source_of_truth: 0,
    synced_entities: JSON.stringify(['messages', 'conversations']),
  },
  {
    key: 'local_crm',
    name: 'CRM local (SQLite)',
    status: 'connected',
    is_source_of_truth: 1,
    synced_entities: JSON.stringify(['appointments', 'patients']),
  },
  {
    key: 'google_calendar',
    name: 'Google Calendar',
    status: 'needs_configuration',
    is_source_of_truth: 0,
    synced_entities: JSON.stringify(['appointments']),
  },
  {
    key: 'outlook_calendar',
    name: 'Outlook Calendar',
    status: 'needs_configuration',
    is_source_of_truth: 0,
    synced_entities: JSON.stringify(['appointments']),
  },
  {
    key: 'webhooks',
    name: 'API / Webhooks',
    status: 'needs_configuration',
    is_source_of_truth: 0,
    synced_entities: JSON.stringify([]),
  },
]

const DEFAULT_KNOWLEDGE = [
  { category: 'cabinet', key: 'name', label: 'Nom du cabinet', value: HEL_CLINIC.name },
  { category: 'cabinet', key: 'address', label: 'Adresse', value: HEL_CLINIC.address },
  { category: 'cabinet', key: 'phone', label: 'Téléphone', value: HEL_CLINIC.phone },
  { category: 'cabinet', key: 'email', label: 'Email', value: HEL_CLINIC.email },
  { category: 'cabinet', key: 'city', label: 'Ville', value: HEL_CLINIC.city },
  { category: 'cabinet', key: 'neighborhood', label: 'Quartier', value: HEL_CLINIC.neighborhood },
  {
    category: 'services',
    key: 'catalogue',
    label: 'Services disponibles',
    value: [
      'Orthodontie',
      'Dentisterie pédiatrique',
      'Soins des gencives',
      'Blanchiment dentaire',
      'Détartrage',
      'Traitement des caries',
      'Facettes dentaires',
      'Urgences dentaires',
    ].join('\n'),
  },
  {
    category: 'horaires',
    key: 'weekdays',
    label: 'Lundi – Vendredi',
    value: '10:30 – 19:00',
  },
  {
    category: 'horaires',
    key: 'saturday',
    label: 'Samedi',
    value: '09:30 – 13:00',
  },
  {
    category: 'horaires',
    key: 'sunday',
    label: 'Dimanche',
    value: 'Fermé',
  },
  {
    category: 'medecins',
    key: 'dr_elouati',
    label: 'Praticien',
    value: 'Dr Hamza Elouati — chirurgien-dentiste',
  },
]

const DEFAULT_PRACTITIONERS = [
  { full_name: 'Dr Hamza Elouati', specialty: 'Chirurgien-dentiste' },
]

const DEFAULT_APPOINTMENT_TYPES = [
  { name: 'Consultation', duration_minutes: 30 },
  { name: 'Détartrage', duration_minutes: 45 },
  { name: 'Urgence', duration_minutes: 30 },
  { name: 'Orthodontie', duration_minutes: 30 },
]

function hoursConfigFromWeekly() {
  return {
    timezone: HEL_CLINIC.timezone,
    weekly: WEEKLY_HOURS,
  }
}

module.exports = {
  HEL_CLINIC,
  HEL_ASSISTANT,
  DEFAULT_AUTOMATIONS,
  DEFAULT_INTEGRATIONS,
  DEFAULT_KNOWLEDGE,
  DEFAULT_PRACTITIONERS,
  DEFAULT_APPOINTMENT_TYPES,
  hoursConfigFromWeekly,
}
