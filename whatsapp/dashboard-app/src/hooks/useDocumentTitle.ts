import { useEffect } from 'react'

const BRAND = 'Centre Dentaire HEL'

export function useDocumentTitle(pageName: string) {
  useEffect(() => {
    const label = String(pageName || '').trim()
    document.title = label ? `${BRAND} | ${label}` : BRAND
  }, [pageName])
}

export function pageTitleFromPath(pathname: string): string {
  const path = String(pathname || '').replace(/\/+$/, '') || '/'
  if (path === '/' || path === '') return 'Aujourd’hui'
  if (path.includes('/messages')) return 'Messages'
  if (path.includes('/agenda') || path.includes('/commandes')) return 'Agenda'
  if (path.includes('/patients/')) return 'Fiche patient'
  if (path.includes('/patients')) return 'Patients'
  if (path.includes('/relances')) return 'Relances'
  if (path.includes('/assistant') || path.includes('/config')) return 'Assistant IA'
  if (path.includes('/analyses')) return 'Analyses'
  if (path.includes('/historique')) return 'Historique'
  if (path.includes('/integrations')) return 'Intégrations'
  if (path.includes('/parametres')) return 'Paramètres'
  return 'Smart CRM'
}
