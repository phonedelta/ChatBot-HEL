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
  if (path === '/' || path === '') return 'Dashboard'
  if (path.endsWith('/commandes') || path === '/commandes') return 'Commandes'
  if (path.endsWith('/config') || path === '/config') return 'Config ChatBot'
  if (path.endsWith('/parametres') || path === '/parametres') return 'Paramètres'
  return 'Dashboard'
}
