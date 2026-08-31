import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  applyAppZoom,
  canZoomIn,
  canZoomOut,
  getStoredAppZoom,
  parseAppZoom,
  setStoredAppZoom,
  zoomStepDown,
  zoomStepUp,
  type AppZoomPercent,
} from '@/lib/app-zoom'

type AppZoomContextValue = {
  percent: AppZoomPercent
  setPercent: (percent: number) => void
  zoomIn: () => void
  zoomOut: () => void
  resetZoom: () => void
  canZoomIn: boolean
  canZoomOut: boolean
}

const AppZoomContext = createContext<AppZoomContextValue | null>(null)

export function AppZoomProvider({ children }: { children: ReactNode }) {
  const [percent, setPercentState] = useState<AppZoomPercent>(() => getStoredAppZoom())

  useEffect(() => {
    applyAppZoom(percent)
  }, [percent])

  const setPercent = useCallback((next: number) => {
    const value = parseAppZoom(next)
    setStoredAppZoom(value)
    setPercentState(value)
  }, [])

  const zoomIn = useCallback(() => {
    setPercentState((prev) => {
      const next = zoomStepUp(prev)
      setStoredAppZoom(next)
      return next
    })
  }, [])

  const zoomOut = useCallback(() => {
    setPercentState((prev) => {
      const next = zoomStepDown(prev)
      setStoredAppZoom(next)
      return next
    })
  }, [])

  const resetZoom = useCallback(() => {
    setStoredAppZoom(100)
    setPercentState(100)
  }, [])

  const value = useMemo(
    () => ({
      percent,
      setPercent,
      zoomIn,
      zoomOut,
      resetZoom,
      canZoomIn: canZoomIn(percent),
      canZoomOut: canZoomOut(percent),
    }),
    [percent, setPercent, zoomIn, zoomOut, resetZoom],
  )

  return <AppZoomContext.Provider value={value}>{children}</AppZoomContext.Provider>
}

export function useAppZoom() {
  const ctx = useContext(AppZoomContext)
  if (!ctx) throw new Error('useAppZoom must be used within AppZoomProvider')
  return ctx
}
