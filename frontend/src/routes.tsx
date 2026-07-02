import { createBrowserRouter, Navigate } from 'react-router-dom'
import { Layout } from './components/Layout'
import { AuditPage } from './pages/AuditPage'
import { AuthPage } from './pages/AuthPage'
import { DashboardPage } from './pages/DashboardPage'
import { DialogsPage } from './pages/DialogsPage'
import { GroupsPage } from './pages/GroupsPage'
import { HealthPage } from './pages/HealthPage'
import { SecurityPage } from './pages/SecurityPage'
import { SessionsPage } from './pages/SessionsPage'
import { ConversationPage } from './pages/ConversationPage'
import { TasksPage } from './pages/TasksPage'

export const appRouter = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <DashboardPage /> },
      { path: '/sessions', element: <SessionsPage /> },
      { path: '/groups', element: <GroupsPage /> },
      { path: '/dialogs', element: <DialogsPage /> },
      { path: '/tasks', element: <TasksPage /> },
      { path: '/conversation', element: <ConversationPage /> },
      { path: '/audit', element: <AuditPage /> },
      { path: '/health', element: <HealthPage /> },
      { path: '/auth', element: <AuthPage /> },
      { path: '/security', element: <SecurityPage /> },
    ],
  },
  { path: '/login', element: <Navigate to="/auth" replace /> },
  { path: '/register', element: <Navigate to="/auth" replace /> },
  { path: '/send-code', element: <Navigate to="/auth" replace /> },
  { path: '/login-code', element: <Navigate to="/" replace /> },
  { path: '*', element: <Navigate to="/" replace /> },
])