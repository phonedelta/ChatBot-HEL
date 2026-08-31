import { useEffect, useState } from 'react'

/**
 * CSS-first preferred. Use this only when layout behavior must change (e.g. master-detail).
 */
export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}

/** Tailwind `lg` = 1024px */
export function useIsLgUp() {
  return useMediaQuery('(min-width: 1024px)')
}

/** Tailwind `sm` = 640px */
export function useIsSmUp() {
  return useMediaQuery('(min-width: 640px)')
}
