import { Minus, Plus } from 'lucide-react'
import { cn } from '@/lib/format'
import { useAppZoom } from '@/context/AppZoomContext'

export function AppZoomControl({ className }: { className?: string }) {
  const { percent, zoomIn, zoomOut, resetZoom, canZoomIn, canZoomOut } = useAppZoom()

  return (
    <div className={cn('space-y-3', className)}>
      <div
        className="inline-flex w-full max-w-sm items-center gap-2 rounded-2xl border border-border bg-[#EEF2F5] p-1.5"
        role="group"
        aria-label="Zoom de l’interface"
      >
        <button
          type="button"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-white text-navy transition hover:bg-cyan-tint disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Diminuer le zoom"
          disabled={!canZoomOut}
          onClick={zoomOut}
        >
          <Minus className="h-4 w-4" aria-hidden />
        </button>

        <button
          type="button"
          className="min-h-11 min-w-[5.5rem] flex-1 rounded-xl bg-white px-3 text-center text-sm font-semibold tabular-nums text-navy shadow-sm ring-1 ring-border transition hover:text-primary"
          aria-live="polite"
          aria-label={`Zoom actuel ${percent} pour cent. Cliquer pour réinitialiser à 100 pour cent.`}
          title="Réinitialiser à 100 %"
          onClick={resetZoom}
        >
          {percent} %
        </button>

        <button
          type="button"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-white text-navy transition hover:bg-cyan-tint disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Augmenter le zoom"
          disabled={!canZoomIn}
          onClick={zoomIn}
        >
          <Plus className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <button
        type="button"
        className="text-sm font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline"
        onClick={resetZoom}
        disabled={percent === 100}
        aria-label="Réinitialiser le zoom à 100 pour cent"
      >
        Réinitialiser
      </button>
    </div>
  )
}
