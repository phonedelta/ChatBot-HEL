import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/context/AuthContext'
import { PermissionRoute } from '@/components/auth/PermissionRoute'
import { AppShell } from '@/components/layout/AppShell'
import { LoginPage } from '@/pages/LoginPage'
import { TodayPage } from '@/pages/TodayPage'
import { MessagesPage } from '@/pages/MessagesPage'
import { AgendaPage } from '@/pages/AgendaPage'
import { PatientsPage, PatientDetailPage } from '@/pages/PatientsPage'
import { FollowUpsPage } from '@/pages/FollowUpsPage'
import { AssistantPage } from '@/pages/AssistantPage'
import { AnalyticsPage } from '@/pages/AnalyticsPage'
import { HistoryPage } from '@/pages/HistoryPage'
import { IntegrationsPage } from '@/pages/IntegrationsPage'
import { OrdersPage } from '@/pages/OrdersPage'
import { ConfigPage } from '@/pages/ConfigPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { Skeleton } from '@/components/ui/Skeleton'
import { PERMISSIONS } from '@/lib/permissions'
import { NotificationProvider } from '@/context/NotificationContext'

function ProtectedRoutes() {
  const { token, ready } = useAuth()

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <div className="w-full max-w-md space-y-3">
          <Skeleton className="h-12" />
          <Skeleton className="h-40" />
          <Skeleton className="h-24" />
        </div>
      </div>
    )
  }

  if (!token) return <LoginPage />

  return (
    <NotificationProvider>
      <Routes>
        <Route element={<AppShell />}>
        <Route index element={<PermissionRoute permission={PERMISSIONS.VIEW_TODAY}><TodayPage /></PermissionRoute>} />
        <Route path="messages" element={<PermissionRoute permission={PERMISSIONS.VIEW_MESSAGES}><MessagesPage /></PermissionRoute>} />
        <Route path="agenda" element={<PermissionRoute permission={PERMISSIONS.VIEW_AGENDA}><AgendaPage /></PermissionRoute>} />
        <Route path="patients" element={<PermissionRoute permission={PERMISSIONS.VIEW_PATIENTS}><PatientsPage /></PermissionRoute>} />
        <Route path="patients/:id" element={<PermissionRoute permission={PERMISSIONS.VIEW_PATIENTS}><PatientDetailPage /></PermissionRoute>} />
        <Route path="relances" element={<PermissionRoute permission={PERMISSIONS.VIEW_FOLLOWUPS}><FollowUpsPage /></PermissionRoute>} />
        <Route path="assistant" element={<PermissionRoute permission={PERMISSIONS.VIEW_ASSISTANT}><AssistantPage /></PermissionRoute>} />
        <Route path="analyses" element={<PermissionRoute permission={PERMISSIONS.VIEW_ANALYTICS}><AnalyticsPage /></PermissionRoute>} />
        <Route path="historique" element={<PermissionRoute permission={PERMISSIONS.VIEW_HISTORY}><HistoryPage /></PermissionRoute>} />
        <Route path="integrations" element={<PermissionRoute permission={PERMISSIONS.VIEW_INTEGRATIONS}><IntegrationsPage /></PermissionRoute>} />
        <Route path="parametres" element={<PermissionRoute permission={PERMISSIONS.VIEW_SETTINGS}><SettingsPage /></PermissionRoute>} />
        <Route path="commandes" element={<OrdersPage />} />
        <Route path="config" element={<ConfigPage />} />
        <Route path="dashboard" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
    </NotificationProvider>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <ProtectedRoutes />
    </AuthProvider>
  )
}
