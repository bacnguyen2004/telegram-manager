import { NavLink, Outlet } from 'react-router-dom'
import { HealthBadge } from './HealthBadge'

const navItems = [
  { to: '/', label: 'Tổng quan', icon: '▣', end: true },
  { to: '/sessions', label: 'Sessions', icon: '◉', end: false },
  { to: '/groups', label: 'Groups', icon: '◎', end: false },
  { to: '/dialogs', label: 'Dialogs', icon: '☰', end: false },
  { to: '/health', label: 'Health', icon: '♥', end: false },
  { to: '/send-code', label: 'Gửi OTP', icon: '✉', end: false },
  { to: '/login', label: 'Đăng nhập', icon: '→', end: false },
  { to: '/register', label: 'Đăng ký', icon: '＋', end: false },
  { to: '/login-code', label: 'Đọc OTP', icon: '⌁', end: false },
  { to: '/security', label: 'Bảo mật', icon: '⚿', end: false },
]

export function Layout() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">TG</div>
          <div>
            <p className="brand-title">Telegram Manager</p>
            <p className="brand-sub">FastAPI Dashboard</p>
          </div>
        </div>

        <nav className="nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `nav-link${isActive ? ' nav-link--active' : ''}`
              }
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-foot">
          <HealthBadge />
          <p>Proxy → <code>127.0.0.1:8001</code></p>
        </div>
      </aside>

      <main className="main">
        <Outlet />
      </main>
    </div>
  )
}