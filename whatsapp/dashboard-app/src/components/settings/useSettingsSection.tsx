import { useCallback, useEffect, useState } from 'react'
import { Skeleton } from '@/components/ui/Skeleton'
import { SettingsSaveBar } from '@/components/settings/SettingsFields'

type UseSettingsSectionOptions<T> = {
  load: () => Promise<T>
  save: (body: T) => Promise<T>
  canEdit: boolean
}

export function useSettingsSection<T extends object>({
  load,
  save,
  canEdit,
}: UseSettingsSectionOptions<T>) {
  const [initial, setInitial] = useState<T | null>(null)
  const [draft, setDraft] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await load()
      setInitial(data)
      setDraft(data)
    } catch {
      setError('Impossible de charger les paramètres.')
    } finally {
      setLoading(false)
    }
  }, [load])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const dirty = Boolean(initial && draft && JSON.stringify(initial) !== JSON.stringify(draft))

  const patch = useCallback((partial: Partial<T>) => {
    setDraft((prev) => (prev ? { ...prev, ...partial } : prev))
  }, [])

  const onSave = useCallback(async () => {
    if (!draft || !canEdit) return
    setSaving(true)
    setError(null)
    try {
      const saved = await save(draft)
      setInitial(saved)
      setDraft(saved)
      setToast('Paramètres enregistrés.')
      window.setTimeout(() => setToast(null), 3000)
    } catch {
      setError('Impossible d’enregistrer les paramètres. Réessayer.')
    } finally {
      setSaving(false)
    }
  }, [canEdit, draft, save])

  const onCancel = useCallback(() => {
    if (initial) setDraft(initial)
  }, [initial])

  return {
    draft,
    loading,
    saving,
    error,
    toast,
    dirty,
    patch,
    onSave,
    onCancel,
    refresh,
  }
}

export function SettingsSectionLoader({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  if (!error) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full rounded-[14px]" />
        <Skeleton className="h-32 w-full rounded-[14px]" />
      </div>
    )
  }
  return (
    <div className="rounded-[14px] border border-border bg-white p-8 text-center">
      <p className="text-sm text-muted">{error}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 rounded-xl bg-cyan px-4 py-2 text-sm font-semibold text-white"
      >
        Réessayer
      </button>
    </div>
  )
}

export function SettingsToast({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div className="fixed bottom-6 right-6 z-50 rounded-xl border border-border bg-white px-4 py-3 text-sm font-medium text-navy shadow-lg">
      {message}
    </div>
  )
}

export function SettingsPanelFooter(props: Parameters<typeof SettingsSaveBar>[0]) {
  return <SettingsSaveBar {...props} />
}
