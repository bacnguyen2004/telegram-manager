import { useEffect, useState } from 'react'
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
    ],
  },
  {
    group: 'Auth',
    items: [
      { method: 'POST', path: '/api/auth/send-code', page: '/send-code' },
      { method: 'POST', path: '/api/auth/login', page: '/login' },
      { method: 'POST', path: '/api/auth/register', page: '/register' },
      { method: 'GET', path: '/api/auth/login-code/{phone}', page: '/login-code' },
      { method: 'PUT', path: '/api/auth/2fa', page: '/security' },
      { method: 'PUT', path: '/api/auth/privacy', page: '/security' },
    ],
  },
]

export function DashboardPage() {
  const [health, setHealth] = useState<HealthData | null>(null)
  const [sessionTotal, setSessionTotal] = useState<number | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    void (async () => {
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
      }
    })()
  }, [])

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Tổng quan</h1>
          <p className="page-desc">Dashboard — 18 API endpoint</p>
        </div>
      </header>

      <Alert type="error" message={error} />

      <section className="stats-grid">
        <article className="stat-card">
          <p className="stat-label">Backend</p>
          <p className="stat-value stat-value--sm">
            {health ? <StatusBadge status={health.status} /> : '—'}
          </p>
        </article>
        <article className="stat-card">
          <p className="stat-label">Sessions</p>
          <p className="stat-value">{sessionTotal ?? '—'}</p>
        </article>
        <article className="stat-card">
          <p className="stat-label">Telegram config</p>
          <p className="stat-value stat-value--sm">
            {health ? (health.telegram_configured ? 'OK' : 'Thiếu') : '—'}
          </p>
        </article>
        <article className="stat-card">
          <p className="stat-label">API endpoints</p>
          <p className="stat-value">18</p>
        </article>
      </section>

      <section className="panel">
        <h2>Thao tác nhanh</h2>
        <div className="quick-actions">
          <Link to="/sessions" className="btn btn--ghost">Sessions</Link>
          <Link to="/groups" className="btn btn--ghost">Groups</Link>
          <Link to="/dialogs" className="btn btn--ghost">Dialogs</Link>
          <Link to="/login" className="btn btn--ghost">Đăng nhập</Link>
          <Link to="/register" className="btn btn--ghost">Đăng ký</Link>
          <Link to="/send-code" className="btn btn--ghost">Gửi OTP</Link>
          <Link to="/login-code" className="btn btn--ghost">Đọc OTP</Link>
          <Link to="/security" className="btn btn--ghost">Bảo mật</Link>
          <Link to="/health" className="btn btn--ghost">Health</Link>
        </div>
      </section>

      <section className="panel">
        <h2>Bản đồ API → Trang UI</h2>
        {apiMap.map((group) => (
          <div key={group.group} className="api-map-group">
            <h3>{group.group}</h3>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Method</th>
                  <th>Endpoint</th>
                  <th>Trang</th>
                </tr>
              </thead>
              <tbody>
                {group.items.map((item) => (
                  <tr key={item.path}>
                    <td>
                      <span className={`method method--${item.method.toLowerCase()}`}>
                        {item.method}
                      </span>
                    </td>
                    <td>
                      <code>{item.path}</code>
                    </td>
                    <td>
                      <Link to={item.page}>{item.page}</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </section>
    </div>
  )
}