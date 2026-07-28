import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/context/AuthContext'
import { AppShell } from '@/components/layout/AppShell'
import { LoginPage } from '@/pages/LoginPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { OrdersPage } from '@/pages/OrdersPage'
import { ConfigPage } from '@/pages/ConfigPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { Skeleton } from '@/components/ui/Skeleton'

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
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<DashboardPage />} />
        <Route path="commandes" element={<OrdersPage />} />
        <Route path="config" element={<ConfigPage />} />
        <Route path="parametres" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <ProtectedRoutes />
    </AuthProvider>
  )
}
