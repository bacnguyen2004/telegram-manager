import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { Alert } from '../components/Alert'
import { StatusBadge } from '../components/StatusBadge'
import type { HealthData } from '../types/api'

const apiMap = [
  { group: 'Health', items: [{ method: 'GET', path: '/api/health', page: '/health' }] },
  {
    group: 'Sessions',
    items: [
      { method: 'GET', path: '/api/sessions', page: '/sessions' },
      { method: 'POST', path: '/api/sessions/check', page: '/sessions' },
      { method: 'GET', path: '/api/sessions/{phone}', page: '/sessions' },
      { method: 'DELETE', path: '/api/sessions/{phone}', page: '/sessions' },
      { method: 'GET', path: '/api/sessions/{phone}/me', page: '/sessions' },
    ],
  },
  {
    group: 'Groups',
    items: [
      { method: 'POST', path: '/api/groups/join', page: '/groups' },
      { method: 'POST', path: '/api/groups/leave', page: '/groups' },
      { method: 'POST', path: '/api/groups/leave-all', page: '/groups' },
      { method: 'GET', path: '/api/groups/{phone}', page: '/groups' },
    ],
  },
  {
    group: 'Dialogs',
    items: [
      { method: 'GET', path: '/api/dialogs/{phone}', page: '/dialogs' },
      { method: 'GET', path: '/api/dialogs/{phone}/messages', page: '/dialogs' },
      { method: 'GET', path: '/api/dialogs/{phone}/messages/{id}/photo', page: '/dialogs' },
      { method: 'POST', path: '/api/messages/send', page: '/dialogs' },
      { method: 'POST', path: '/api/messages/reply', page: '/dialogs' },
      { method: 'POST', path: '/api/messages/send-media', page: '/dialogs' },
      { method: 'DELETE', path: '/api/messages/{id}', page: '/dialogs' },
    ],
  },
  {
    group: 'Auth',
    items: [
      { method: 'POST', path: '/api/auth/send-code', page: '/auth' },
      { method: 'POST', path: '/api/auth/login', page: '/auth' },
      { method: 'POST', path: '/api/auth/register', page: '/auth' },
      { method: 'GET', path: '/api/auth/login-code/{phone}', page: null },
      { method: 'PUT', path: '/api/auth/2fa', page: '/security' },
      { method: 'PUT', path: '/api/auth/privacy', page: '/security' },
    ],
  },
] as const

const quickLinks = [
  {
    to: '/dialogs',
    label: 'Dialogs',
    desc: 'Chat, gửi ảnh, trả lời tin',
    accent: 'cyan',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
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
    to: '/sessions',
    label: 'Sessions',
    desc: 'Kiểm tra & quản lý .session',
    accent: 'violet',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
        <rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" strokeWidth="1.8" />
        <path d="M8 12h8M12 8v8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    to: '/groups',
    label: 'Groups',
    desc: 'Join, leave, danh sách nhóm',
    accent: 'amber',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
        <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="17" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.8" />
        <path d="M3 19c0-3 3-5 6-5s6 2 6 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    to: '/auth',
    label: 'Tài khoản',
    desc: 'OTP, 2FA, đăng ký session',
    accent: 'rose',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
        <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
]

function StatIconBackend() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
      <rect x="3" y="4" width="18" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <rect x="3" y="14" width="18" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="7" cy="7" r="1" fill="currentColor" />
      <circle cx="7" cy="17" r="1" fill="currentColor" />
    </svg>
  )
}

function StatIconSessions() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
      <path
        d="M7 4h10v16H7z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M10 8h4M10 12h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function StatIconTelegram() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
      <path
        d="M12 2L3 7v10l9 5 9-5V7l-9-5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function StatIconApi() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
      <path d="M4 7h16M4 12h16M4 17h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

export function DashboardPage() {
  const [health, setHealth] = useState<HealthData | null>(null)
  const [sessionTotal, setSessionTotal] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [apiTab, setApiTab] = useState<(typeof apiMap)[number]['group']>('Dialogs')

  const activeGroup = useMemo(
    () => apiMap.find((g) => g.group === apiTab) ?? apiMap[0],
    [apiTab],
  )

  const totalEndpoints = useMemo(
    () => apiMap.reduce((sum, group) => sum + group.items.length, 0),
    [],
  )

  useEffect(() => {
    void (async () => {
      setLoading(true)
      setError('')
      try {
        const [healthRes, sessionsRes] = await Promise.all([
          api.health(),
          api.listSessions(),
        ])
        if (healthRes.success && healthRes.data) setHealth(healthRes.data)
        if (sessionsRes.success && sessionsRes.data) {
          setSessionTotal(sessionsRes.data.total)
        }
      } catch {
        setError('Không kết nối được backend.')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  return (
    <div className="page page--dashboard">
      <section className="dash-hero">
        <div className="dash-hero-main">
          <div className="dash-hero-badges">
            <span className="dash-pill">FastAPI</span>
            <span className="dash-pill">Telethon</span>
            <span className="dash-pill">React</span>
          </div>
          <h1 className="dash-hero-title">Telegram Manager</h1>
          <p className="dash-hero-desc">
            Quản lý session, nhóm, hội thoại và tin nhắn — giao diện thống nhất
            cho toàn bộ API.
          </p>
          <div className="dash-hero-actions">
            <Link to="/dialogs" className="btn btn--primary">
              Mở Dialogs
            </Link>
            <Link to="/sessions" className="btn btn--glass">
              Sessions
            </Link>
            <a
              href="http://127.0.0.1:8001/docs"
              target="_blank"
              rel="noreferrer"
              className="btn btn--ghost"
            >
              Swagger →
            </a>
          </div>
        </div>
        <aside className="dash-hero-aside">
          <div className="dash-hero-status">
            <span className="dash-hero-status-label">Hệ thống</span>
            {loading ? (
              <span className="muted">Đang kiểm tra…</span>
            ) : health ? (
              <StatusBadge status={health.status} />
            ) : (
              <span className="muted">—</span>
            )}
          </div>
          <p className="dash-hero-aside-meta">
            {health?.telegram_configured
              ? 'Telegram API đã cấu hình'
              : 'Chưa cấu hình Telegram trong .env'}
          </p>
          <p className="dash-hero-aside-meta mono">
            {totalEndpoints} endpoints · port 8001
          </p>
        </aside>
      </section>

      <Alert type="error" message={error} />

      <section className="dash-stats">
        <article className="dash-stat dash-stat--backend">
          <div className="dash-stat-icon">
            <StatIconBackend />
          </div>
          <div className="dash-stat-body">
            <p className="dash-stat-label">Backend</p>
            <p className="dash-stat-value dash-stat-value--sm">
              {loading ? '…' : health ? <StatusBadge status={health.status} /> : '—'}
            </p>
          </div>
        </article>
        <article className="dash-stat dash-stat--sessions">
          <div className="dash-stat-icon">
            <StatIconSessions />
          </div>
          <div className="dash-stat-body">
            <p className="dash-stat-label">Sessions</p>
            <p className="dash-stat-value">
              {loading ? '…' : (sessionTotal ?? '—')}
            </p>
            <Link className="dash-stat-link" to="/sessions">
              Quản lý →
            </Link>
          </div>
        </article>
        <article className="dash-stat dash-stat--telegram">
          <div className="dash-stat-icon">
            <StatIconTelegram />
          </div>
          <div className="dash-stat-body">
            <p className="dash-stat-label">Telegram</p>
            <p className="dash-stat-value dash-stat-value--sm">
              {loading
                ? '…'
                : health
                  ? health.telegram_configured
                    ? 'Configured'
                    : 'Thiếu .env'
                  : '—'}
            </p>
          </div>
        </article>
        <article className="dash-stat dash-stat--api">
          <div className="dash-stat-icon">
            <StatIconApi />
          </div>
          <div className="dash-stat-body">
            <p className="dash-stat-label">Endpoints</p>
            <p className="dash-stat-value">{totalEndpoints}</p>
          </div>
        </article>
      </section>

      <section className="dash-shortcuts">
        <div className="dash-section-head">
          <h2>Lối tắt</h2>
          <p className="muted">Vào nhanh các tính năng chính</p>
        </div>
        <div className="dash-quick-grid">
          {quickLinks.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={`dash-quick-card dash-quick-card--${item.accent}`}
            >
              <span className="dash-quick-icon">{item.icon}</span>
              <div className="dash-quick-text">
                <span className="dash-quick-label">{item.label}</span>
                <span className="dash-quick-desc">{item.desc}</span>
              </div>
              <span className="dash-quick-arrow" aria-hidden>
                →
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="panel panel--elevated dash-api-panel">
        <div className="dash-api-head">
          <div>
            <h2>Bản đồ API</h2>
            <p className="panel-meta">
              {activeGroup.items.length} endpoint · nhóm {apiTab}
            </p>
          </div>
          <span className="dash-api-total mono">{totalEndpoints} total</span>
        </div>

        <div className="api-tabs" role="tablist" aria-label="Nhóm API">
          {apiMap.map((group) => (
            <button
              key={group.group}
              type="button"
              role="tab"
              aria-selected={apiTab === group.group}
              className={`api-tab${apiTab === group.group ? ' api-tab--active' : ''}`}
              onClick={() => setApiTab(group.group)}
            >
              {group.group}
              <span className="api-tab-count">{group.items.length}</span>
            </button>
          ))}
        </div>

        <div className="dash-api-table">
          <table className="data-table data-table--modern">
            <thead>
              <tr>
                <th className="col-method">Method</th>
                <th className="col-endpoint">Endpoint</th>
                <th className="col-page">Trang UI</th>
              </tr>
            </thead>
            <tbody>
              {activeGroup.items.map((item) => (
                <tr key={item.path}>
                  <td className="col-method">
                    <span className={`method method--${item.method.toLowerCase()}`}>
                      {item.method}
                    </span>
                  </td>
                  <td className="col-endpoint">
                    <code className="api-path">{item.path}</code>
                  </td>
                  <td className="col-page">
                    {item.page ? (
                      <Link className="api-page-link" to={item.page}>
                        {item.page}
                      </Link>
                    ) : (
                      <span className="api-page-only">API</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}