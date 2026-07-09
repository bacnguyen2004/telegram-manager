import type { ReactNode } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { API_ENDPOINT_COUNT, PAGE_LABELS } from '../utils/apiMap'
import { ErrorBoundary } from './ErrorBoundary'
import { HealthBadge } from './HealthBadge'
import { ThemeToggle } from './ThemeToggle'
import './Layout.css'

type NavAccent =
  | 'cyan'
  | 'violet'
  | 'slate'
  | 'amber'
  | 'emerald'
  | 'indigo'
  | 'rose'
  | 'teal'

type NavItem = {
  to: string
  label: string
  end: boolean
  accent: NavAccent
  icon: ReactNode
}

const navSections: { label: string; items: NavItem[] }[] = [
  {
    label: 'Quản lý',
    items: [
      {
        to: '/',
        label: 'Tổng quan',
        end: true,
        accent: 'cyan',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" aria-hidden>
            <rect x="3" y="3" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.8" />
            <rect x="13" y="3" width="8" height="5" rx="2" stroke="currentColor" strokeWidth="1.8" />
            <rect x="13" y="10" width="8" height="11" rx="2" stroke="currentColor" strokeWidth="1.8" />
            <rect x="3" y="13" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.8" />
          </svg>
        ),
      },
      {
        to: '/sessions',
        label: 'Tài khoản',
        end: false,
        accent: 'violet',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" aria-hidden>
            <rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" strokeWidth="1.8" />
            <path d="M8 12h8M12 8v8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        ),
      },
      {
        to: '/roster',
        label: 'Sổ tài khoản',
        end: false,
        accent: 'slate',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" aria-hidden>
            <rect x="4" y="5" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
            <path d="M8 9h8M8 13h8M8 17h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        ),
      },
      {
        to: '/proxy',
        label: 'Proxy',
        end: false,
        accent: 'teal',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M4 12h4l2-6 4 12 2-6h4"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ),
      },
      {
        to: '/groups',
        label: 'Nhóm & kênh',
        end: false,
        accent: 'amber',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.8" />
            <circle cx="17" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.8" />
            <path d="M3 19c0-3 3-5 6-5s6 2 6 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        ),
      },
      {
        to: '/dialogs',
        label: 'Tin nhắn',
        end: false,
        accent: 'cyan',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5Z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
          </svg>
        ),
      },
      {
        to: '/tasks',
        label: 'Tác vụ hàng loạt',
        end: false,
        accent: 'emerald',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M4 7h9M4 12h16M4 17h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <circle cx="19" cy="7" r="2" stroke="currentColor" strokeWidth="1.8" />
          </svg>
        ),
      },
      {
        to: '/conversation',
        label: 'Hội thoại tự nhiên',
        end: false,
        accent: 'indigo',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M8 10h8M8 14h5M6 4h12a2 2 0 0 1 2 2v11l-3-2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
          </svg>
        ),
      },
    ],
  },
  {
    label: 'Cài đặt',
    items: [
      {
        to: '/security',
        label: 'Bảo mật',
        end: false,
        accent: 'rose',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M12 3l8 4v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V7l8-4Z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
            <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        ),
      },
    ],
  },
  {
    label: 'Hệ thống',
    items: [
      {
        to: '/audit',
        label: 'Nhật ký hoạt động',
        end: false,
        accent: 'teal',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"
              stroke="currentColor"
              strokeWidth="1.8"
            />
            <rect x="9" y="3" width="6" height="4" rx="1" stroke="currentColor" strokeWidth="1.8" />
            <path d="M9 12h6M9 16h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        ),
      },
      {
        to: '/health',
        label: 'Trạng thái API',
        end: false,
        accent: 'amber',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" aria-hidden>
            <rect x="3" y="4" width="18" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
            <rect x="3" y="14" width="18" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
            <circle cx="7" cy="7" r="1" fill="currentColor" />
            <circle cx="7" cy="17" r="1" fill="currentColor" />
          </svg>
        ),
      },
    ],
  },
]

function pageTitle(pathname: string): string {
  if (PAGE_LABELS[pathname]) return PAGE_LABELS[pathname]
  const base = `/${pathname.split('/').filter(Boolean)[0] ?? ''}`
  return PAGE_LABELS[base] ?? 'Telegram Manager'
}

export function Layout() {
  const { pathname } = useLocation()

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-inner">
          <div className="sidebar-brand">
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
            <div className="brand-copy">
              <p className="brand-title">Telegram Manager</p>
              <p className="brand-sub">Bảng điều khiển API</p>
              <span className="brand-pill">{API_ENDPOINT_COUNT} endpoint</span>
            </div>
          </div>

          <nav className="sidebar-nav" aria-label="Điều hướng chính">
            {navSections.map((section) => (
              <div key={section.label} className="nav-section">
                <p className="nav-section-label">{section.label}</p>
                {section.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    title={item.label}
                    className={({ isActive }) =>
                      `nav-link nav-link--${item.accent}${isActive ? ' nav-link--active' : ''}`
                    }
                  >
                    <span className="nav-link-icon">{item.icon}</span>
                    <span className="nav-link-text">{item.label}</span>
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>

          <div className="sidebar-foot">
            <div className="sidebar-foot-card">
              <div className="sidebar-foot-row">
                <p className="sidebar-foot-theme-label">Giao diện</p>
                <ThemeToggle compact />
              </div>
              <HealthBadge />
              <p className="sidebar-foot-hint">
                <span className="sidebar-foot-hint-dot" aria-hidden />
                API tại <span className="mono">127.0.0.1:8001</span>
              </p>
            </div>
          </div>
        </div>
      </aside>

      <div className="main-wrap">
        <header className="topbar">
          <p className="topbar-title">{pageTitle(pathname)}</p>
          <div className="topbar-actions">
            <ThemeToggle />
            <div className="topbar-pill">{API_ENDPOINT_COUNT} API</div>
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