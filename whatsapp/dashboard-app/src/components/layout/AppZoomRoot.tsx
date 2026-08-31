import { useEffect, useRef, type ReactNode } from 'react'
import { useAppZoom } from '@/context/AppZoomContext'
import { applyAppZoom } from '@/lib/app-zoom'

/**
 * Physical viewport wrapper + logical zoom canvas.
 * Entire AppShell (sidebar, header, main) and portals live inside the canvas.
 */
export function AppZoomRoot({ children }: { children: ReactNode }) {
  const { percent } = useAppZoom()
  const canvasRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    applyAppZoom(percent, canvasRef.current)
  }, [percent])

  return (
    <div className="app-zoom-viewport">
      <div
        ref={canvasRef}
        className="app-zoom-canvas"
        data-app-zoom={percent}
      >
        {children}
        <div id="app-portal-root" />
      </div>
    </div>
  )
}
