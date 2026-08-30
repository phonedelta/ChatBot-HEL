import { useAuth } from '@/context/AuthContext'
import { hasPermission, type PermissionKey } from '@/lib/permissions'

export function usePermissions() {
  const { user } = useAuth()

  return {
    user,
    can: (permission: PermissionKey | string) => hasPermission(user, permission),
    isAdmin: String(user?.role || '').toLowerCase() === 'admin',
  }
}
