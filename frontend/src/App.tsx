import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { DashboardPage } from './pages/DashboardPage'
import { GroupsPage } from './pages/GroupsPage'
import { HealthPage } from './pages/HealthPage'
import { LoginCodePage } from './pages/LoginCodePage'
import { LoginPage } from './pages/LoginPage'
import { RegisterPage } from './pages/RegisterPage'
import { SecurityPage } from './pages/SecurityPage'
import { SendCodePage } from './pages/SendCodePage'
import { SessionsPage } from './pages/SessionsPage'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="sessions" element={<SessionsPage />} />
          <Route path="groups" element={<GroupsPage />} />
          <Route path="health" element={<HealthPage />} />
          <Route path="send-code" element={<SendCodePage />} />
          <Route path="login" element={<LoginPage />} />
          <Route path="register" element={<RegisterPage />} />
          <Route path="login-code" element={<LoginCodePage />} />
          <Route path="security" element={<SecurityPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App