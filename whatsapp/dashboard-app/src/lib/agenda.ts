import { appointmentStatusLabel } from '@/lib/labels'

export type AgendaView = 'day' | 'week' | 'list'

export type AgendaAppointment = {
  id: number
  appointment_id: number
  customer_id: number
  full_name: string
  short_name: string
  phone_number?: string
  phone_display?: string
  appointment_date: string
  appointment_time: string
  end_time?: string
  duration_minutes: number
  status: string
  status_label: string
  appointment_type?: string | null
  problem?: string | null
  practitioner_id?: number | null
  practitioner_name?: string | null
  source?: string | null
}

export type AgendaSlot = {
  slot_date: string
  slot_time: string
  duration_minutes?: number
  kind: 'available' | 'released'
  appointment_id?: number
  match?: { compatible_count?: number; patients?: unknown[] }
}

export type WaitlistEntry = {
  id: number
  customer_id: number
  patient_name: string
  patient_phone?: string
  priority: string
  priority_label: string
  preference_label: string
  appointment_type?: string | null
  notes?: string | null
}

export type AgendaPayload = {
  ok: boolean
  view: AgendaView
  range: {
    from: string
    to: string
    days: Array<{
      date: string
      weekday: number | null
      label: string
      is_today: boolean
      hours: { open: string; close: string } | null
    }>
    subtitle: string
    today: string
  }
  time_axis: string[]
  slot_minutes: number
  appointments: AgendaAppointment[]
  available_slots: AgendaSlot[]
  released_slots: AgendaSlot[]
  banner: {
    slot_date: string
    slot_time: string
    compatible_count?: number
    appointment_id?: number
    message: { title: string; detail: string }
  } | null
  waitlist: WaitlistEntry[]
  waitlist_count: number
  practitioners: Array<{ id: number; full_name: string }>
  appointment_types: Array<{ id: number; name: string; duration_minutes: number }>
}

export function getAppointmentStatusStyle(status?: string | null) {
  const s = String(status || '')
  if (s === 'confirmed') {
    return {
      bg: 'bg-[#E8F6EE]',
      text: 'text-[#1B7A45]',
      muted: 'text-[#3D6B52]',
      border: 'border-[#D0EBDA]',
    }
  }
  if (s === 'non_confirme' || s === 'pending_confirmation') {
    return {
      bg: 'bg-[#FFF3E6]',
      text: 'text-[#C45C12]',
      muted: 'text-[#8A6A4A]',
      border: 'border-[#F5D9BE]',
    }
  }
  if (s === 'no_show') {
    return {
      bg: 'bg-[#FCEAEA]',
      text: 'text-[#C0392B]',
      muted: 'text-[#8A5550]',
      border: 'border-[#F0C9C9]',
    }
  }
  if (s === 'cancelled') {
    return {
      bg: 'bg-[#E8F7FA]',
      text: 'text-[#0E8A9A]',
      muted: 'text-[#4A7A85]',
      border: 'border-dashed border-[#7EC8D4]',
    }
  }
  if (s === 'completed') {
    return {
      bg: 'bg-[#EEF2F5]',
      text: 'text-[#4A5C6A]',
      muted: 'text-[#6B7C8A]',
      border: 'border-[#D8E0E6]',
    }
  }
  return {
    bg: 'bg-white',
    text: 'text-navy',
    muted: 'text-muted',
    border: 'border-[#E6EBEF]',
  }
}

export function getWaitlistPriorityStyle(priority?: string | null) {
  const p = String(priority || '').toLowerCase()
  if (p === 'urgence') {
    return 'bg-[#FDE9E9] text-[#B91C1C]'
  }
  if (p === 'haute') {
    return 'bg-[#FFF4DF] text-[#B45309]'
  }
  return 'bg-cyan-tint text-primary'
}

export function formatAgendaStatus(status?: string | null) {
  return appointmentStatusLabel(status)
}

export function addDaysISO(iso: string, days: number) {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return iso
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  d.setDate(d.getDate() + days)
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${day}`
}

export function startOfWeekMonday(iso: string) {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return iso
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const day = d.getDay()
  const offset = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + offset)
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${dd}`
}
