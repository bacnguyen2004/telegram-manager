import { createBrowserRouter, Navigate } from 'react-router-dom'
import { Layout } from './components/Layout'
import { AuditPage } from './pages/AuditPage'

import { DashboardPage } from './pages/DashboardPage'
import { DialogsPage } from './pages/DialogsPage'
import { GroupsPage } from './pages/GroupsPage'
import { HealthPage } from './pages/HealthPage'
import { SecurityPage } from './pages/SecurityPage'
import { SessionsPage } from './pages/SessionsPage'
import { ConversationPage } from './pages/ConversationPage'
import { TasksPage } from './pages/TasksPage'
import { RosterPage } from './pages/RosterPage'
import { ProxyPage } from './pages/ProxyPage'

export const appRouter = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'sessions', element: <SessionsPage /> },
      { path: 'roster', element: <RosterPage /> },
      { path: 'proxy', element: <ProxyPage /> },
      { path: 'groups', element: <GroupsPage /> },
      { path: 'dialogs', element: <DialogsPage /> },
      { path: 'tasks', element: <TasksPage /> },
      { path: 'conversation', element: <ConversationPage /> },
      { path: 'audit', element: <AuditPage /> },
      { path: 'health', element: <HealthPage /> },
      { path: 'auth', element: <Navigate to="/sessions?add=1" replace /> },
      { path: 'security', element: <SecurityPage /> },
    ],
  },
  { path: '/login', element: <Navigate to="/sessions?add=1" replace /> },
  { path: '/register', element: <Navigate to="/sessions?add=1" replace /> },
  { path: '/send-code', element: <Navigate to="/sessions?add=1" replace /> },
  { path: '/login-code', element: <Navigate to="/" replace /> },
  { path: '*', element: <Navigate to="/" replace /> },
])