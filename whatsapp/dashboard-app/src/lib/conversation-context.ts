export type ConversationContextPayload = {
  conversation: {
    id: number
    status: string
    status_label: string
    owner: string
    controller: string
    owner_user?: string | null
    active_language?: string | null
    last_contact_at?: string | null
    customer_id?: number | null
    whatsapp_contact_id?: number | null
  }
  contact?: {
    id: number | null
    phone: string | null
    phone_display: string
    display_name: string
    whatsapp_id?: string | null
  }
  linked_patients?: Array<{
    id: number
    full_name: string
    phone_number?: string | null
    phone_display?: string
    city?: string | null
    relationship_label?: string | null
    next_appointment?: {
      id: number
      appointment_date: string
      appointment_time: string
      status: string
    } | null
  }>
  active_patient_context_id?: number | null
  patient: {
    id: number | null
    display_name: string
    phone: string | null
    phone_display: string
    source: string
    source_label: string
    existing: boolean
    is_new_contact: boolean
    preferred_language?: string | null
    active_language?: string | null
    language_subtitle: string
  }
  next_appointment: {
    id: number
    starts_at: string
    appointment_date: string
    appointment_time: string
    display: string
    status: string
    status_label: string
  } | null
  last_contact: {
    at: string | null
    channel: string
    display: string
  }
  summary: {
    has_summary: boolean
    reason: { key: string; label: string } | null
    action: { key: string; label: string } | null
    status: { key: string; label: string }
    next_action: { key: string; label: string } | null
  }
  waitlist: {
    active: boolean
    id: number
    priority: string
    priority_label: string
    preferred_date_from?: string | null
    preferred_date_to?: string | null
    preferred_time_ranges?: string[] | string | null
    appointment_type?: string | null
    description: string
  } | null
}
