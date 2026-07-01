import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { HealthBadge } from './HealthBadge'
import { ThemeToggle } from './ThemeToggle'

const navSections = [
  {
    label: 'Quản lý',
    items: [
      { to: '/', label: 'Tổng quan', end: true },
      { to: '/sessions', label: 'Sessions', end: false },
      { to: '/groups', label: 'Groups', end: false },
      { to: '/dialogs', label: 'Dialogs', end: false },
      { to: '/tasks', label: 'Tasks', end: false },
    ],
  },
  {
    label: 'Xác thực',
    items: [
      { to: '/auth', label: 'Tài khoản', end: false },
      { to: '/security', label: 'Bảo mật', end: false },
    ],
  },
  {
    label: 'Hệ thống',
    items: [{ to: '/health', label: 'Health', end: false }],
  },
]

function pageTitle(pathname: string): string {
  const map: Record<string, string> = {
    '/': 'Tổng quan',
    '/sessions': 'Sessions',
    '/groups': 'Groups',
    '/dialogs': 'Dialogs',
    '/tasks': 'Tasks',
    '/health': 'Health',
    '/auth': 'Tài khoản',
    '/security': 'Bảo mật',
  }
  return map[pathname] ?? 'Telegram Manager'
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
            <div className="topbar-pill">23 endpoints</div>
          </div>
        </header>
        <main className="main">
          <Outlet />
        </main>
      </div>
    </div>
  )
}