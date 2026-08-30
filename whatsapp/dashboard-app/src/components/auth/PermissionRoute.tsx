import { Navigate } from 'react-router-dom'
import { usePermissions } from '@/hooks/usePermissions'
import type { PermissionKey } from '@/lib/permissions'
import { EmptyState } from '@/components/smart/PageBits'

export function PermissionRoute({
  permission,
  children,
}: {
  permission: PermissionKey | string
  children: React.ReactNode
}) {
  const { can } = usePermissions()

  if (!can(permission)) {
    return (
      <div className="py-12">
        <EmptyState
          title="Accès non autorisé"
          description="Vous n’avez pas l’autorisation d’accéder à cette page."
        />
      </div>
    )
  }

  return <>{children}</>
}

export function RequirePermissionRedirect({
  permission,
  children,
  fallback = '/',
}: {
  permission: PermissionKey | string
  children: React.ReactNode
  fallback?: string
}) {
  const { can } = usePermissions()
  if (!can(permission)) return <Navigate to={fallback} replace />
  return <>{children}</>
}
