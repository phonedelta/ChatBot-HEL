export type AppointmentStatus = string

export interface AppointmentOrder {
  id: string
  appointment_id: number
  customer_id?: number
  full_name: string
  phone_number: string
  phone_display?: string
  city?: string
  problem?: string
  problem_details?: string
  problem_ai?: string
  problem_client?: string
  urgency?: string
  appointment_date: string
  appointment_time: string
  status: AppointmentStatus
  created_at?: string
  type?: string
}

export interface Customer {
  id: number
  full_name: string
  phone_number: string
  city?: string
  email?: string | null
  created_at?: string
}

export interface WaInstance {
  instance_id: string
  state: string
  managed?: boolean
  stored_session?: boolean
  can_connect?: boolean
  phone_number?: string | null
  lastSeenAt?: string | null
  lastError?: string | null
  qrCreatedAt?: string | null
}

export interface OverviewPayload {
  ok: boolean
  clinic: { name: string; city: string; neighborhood: string }
  chatbot: {
    mode: string
    reply_to_audio: boolean
    model: string | null
    transcribe_model: string | null
    voice_nlu: boolean
    crm_enabled: boolean
  }
  stats: {
    instances_total: number
    instances_ready: number
    demandes_total: number
    demandes_traitees: number
    crm_customers: number
    crm_appointments: number
    crm_upcoming: number
    appointments_today: number
    pending_appointments: number
    messages_total: number
    uptime_seconds: number
  }
  weekly_appointments: Array<{ day: string; count: number }>
  instances: WaInstance[]
  recent_orders: AppointmentOrder[]
  month_appointments: AppointmentOrder[]
  frequent_problems: { problem: string; count: number }[]
}

export interface OrdersPayload {
  ok: boolean
  tab: string
  orders: AppointmentOrder[]
  upcoming?: AppointmentOrder[]
  customers: Customer[]
  cases: unknown[]
  frequent_problems: { problem: string; count: number }[]
  notifications?: unknown[]
}
