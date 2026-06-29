import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { ThemeProvider } from './context/ThemeContext'
import { AuthPage } from './pages/AuthPage'
import { DashboardPage } from './pages/DashboardPage'
import { DialogsPage } from './pages/DialogsPage'
import { GroupsPage } from './pages/GroupsPage'
import { HealthPage } from './pages/HealthPage'
import { SecurityPage } from './pages/SecurityPage'
import { SessionsPage } from './pages/SessionsPage'

function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<DashboardPage />} />
            <Route path="sessions" element={<SessionsPage />} />
            <Route path="groups" element={<GroupsPage />} />
            <Route path="dialogs" element={<DialogsPage />} />
            <Route path="health" element={<HealthPage />} />
            <Route path="auth" element={<AuthPage />} />
            <Route path="security" element={<SecurityPage />} />
            <Route path="login" element={<Navigate to="/auth" replace />} />
            <Route path="register" element={<Navigate to="/auth?mode=register" replace />} />
            <Route path="send-code" element={<Navigate to="/auth" replace />} />
            <Route path="login-code" element={<Navigate to="/" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  )
}

export default App