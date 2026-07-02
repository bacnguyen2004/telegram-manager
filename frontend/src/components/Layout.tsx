import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { ErrorBoundary } from './ErrorBoundary'
import { HealthBadge } from './HealthBadge'
import { ThemeToggle } from './ThemeToggle'

const navSections = [
  {
    label: 'Quản lý',
    items: [
      { to: '/', label: 'Tổng quan', end: true },
      { to: '/sessions', label: 'Sessions', end: false },
      { to: '/roster', label: 'Sổ acc', end: false },
      { to: '/groups', label: 'Groups', end: false },
      { to: '/dialogs', label: 'Dialogs', end: false },
      { to: '/tasks', label: 'Tasks', end: false },
      { to: '/conversation', label: 'Hội thoại', end: false },
    ],
  },
  {
    label: 'Xác thực',
    items: [{ to: '/security', label: 'Bảo mật', end: false }],
  },
  {
    label: 'Hệ thống',
    items: [
      { to: '/audit', label: 'Audit', end: false },
      { to: '/health', label: 'Health', end: false },
    ],
  },
]

function pageTitle(pathname: string): string {
  const map: Record<string, string> = {
    '/': 'Tổng quan',
    '/sessions': 'Sessions',
    '/roster': 'Sổ acc',
    '/groups': 'Groups',
    '/dialogs': 'Dialogs',
    '/tasks': 'Tasks',
    '/conversation': 'Hội thoại',
    '/audit': 'Audit log',
    '/health': 'Health',
    '/auth': 'Thêm tài khoản',
    '/security': 'Bảo mật',
  }
  if (map[pathname]) return map[pathname]
  const base = `/${pathname.split('/').filter(Boolean)[0] ?? ''}`
  return map[base] ?? 'Telegram Manager'
}

export function Layout() {
  const { pathname } = useLocation()

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M12 2L3 7v10l9 5 9-5V7l-9-5Z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <path
                d="M8 12l3 3 5-6"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div>
            <p className="brand-title">Telegram Manager</p>
            <p className="brand-sub">API Dashboard</p>
          </div>
        </div>

        <nav className="nav">
          {navSections.map((section) => (
            <div key={section.label} className="nav-section">
              <p className="nav-section-label">{section.label}</p>
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `nav-link${isActive ? ' nav-link--active' : ''}`
                  }
                >
                  <span className="nav-link-text">{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="sidebar-foot-theme">
            <ThemeToggle compact />
          </div>
          <HealthBadge />
          <p className="sidebar-foot-hint">
            <span className="mono">127.0.0.1:8001</span>
          </p>
        </div>
      </aside>

      <div className="main-wrap">
        <header className="topbar">
          <p className="topbar-title">{pageTitle(pathname)}</p>
          <div className="topbar-actions">
            <ThemeToggle />
            <div className="topbar-pill">31 endpoints</div>
          </div>
        </header>
        <main className="main">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  )
}