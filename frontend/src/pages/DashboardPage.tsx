import { useEffect, useMemo, useState } from 'react'
import './DashboardPage.css'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { Alert } from '../components/Alert'
import { StatusBadge } from '../components/StatusBadge'
import type { HealthData, MetadataOverviewData } from '../types/api'
import {
  API_ENDPOINT_COUNT,
  apiMap,
  pageLabel,
  type ApiGroupId,
} from '../utils/apiMap'

const quickLinks = [
  {
    key: 'sessions',
    to: '/sessions',
    label: 'Tài khoản',
    desc: 'Kiểm tra & quản lý file .session',
    accent: 'violet',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
        <rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" strokeWidth="1.8" />
        <path d="M8 12h8M12 8v8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    key: 'roster',
    to: '/roster',
    label: 'Sổ tài khoản',
    desc: 'Bảng tổng hợp acc, cột tùy chỉnh',
    accent: 'slate',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
        <rect x="4" y="5" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
        <path d="M8 9h8M8 13h8M8 17h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    key: 'groups',
    to: '/groups',
    label: 'Nhóm & kênh',
    desc: 'Join, leave, quét danh sách',
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
    key: 'dialogs',
    to: '/dialogs',
    label: 'Tin nhắn',
    desc: 'Đọc chat, gửi ảnh, reply, reaction',
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
    key: 'tasks',
    to: '/tasks',
    label: 'Tác vụ hàng loạt',
    desc: 'Nhiều acc · join · react · reply',
    accent: 'emerald',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
        <path
          d="M4 7h9M4 12h16M4 17h12"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <circle cx="19" cy="7" r="2" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    ),
  },
  {
    key: 'conversation',
    to: '/conversation',
    label: 'Hội thoại tự nhiên',
    desc: 'Kịch bản nhiều vai, delay & typing',
    accent: 'indigo',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
        <path
          d="M8 10h8M8 14h5M6 4h12a2 2 0 0 1 2 2v11l-3-2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    key: 'audit',
    to: '/audit',
    label: 'Nhật ký hoạt động',
    desc: 'Login, nhóm, hội thoại — PostgreSQL',
    accent: 'teal',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
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
    key: 'security',
    to: '/security',
    label: 'Bảo mật',
    desc: 'Đổi 2FA, privacy invite hàng loạt',
    accent: 'rose',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
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
      <path d="M7 4h10v16H7z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M10 8h4M10 12h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function StatIconAudit() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
      <path
        d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path d="M9 12h6M9 16h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
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

function databaseAsideText(health: HealthData | null): string {
  if (!health) return 'Đang kiểm tra database…'
  if (!health.database_enabled) return 'Database tắt — audit/metadata không ghi'
  if (!health.database_ok) return health.database_message || 'Database lỗi kết nối'
  return 'PostgreSQL metadata đang bật'
}

export function DashboardPage() {
  const [health, setHealth] = useState<HealthData | null>(null)
  const [sessionTotal, setSessionTotal] = useState<number | null>(null)
  const [overview, setOverview] = useState<MetadataOverviewData | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [apiTab, setApiTab] = useState<ApiGroupId>('sessions')

  const activeGroup = useMemo(
    () => apiMap.find((group) => group.group === apiTab) ?? apiMap[0],
    [apiTab],
  )

  const auditTotal = useMemo(() => {
    if (!overview?.database_enabled) return null
    return overview.audit_log_count
  }, [overview])

  const auditStatLabel = useMemo(() => {
    if (loading) return '…'
    if (auditTotal !== null) return String(auditTotal)
    if (health && !health.database_enabled) return 'Tắt'
    return '—'
  }, [auditTotal, health, loading])

  const accountCount = useMemo(() => {
    if (sessionTotal !== null) return sessionTotal
    if (health) return health.session_count
    return null
  }, [health, sessionTotal])

  useEffect(() => {
    void (async () => {
      setLoading(true)
      setError('')
      try {
        const [healthRes, sessionsRes, overviewRes] = await Promise.all([
          api.health(),
          api.listSessions(),
          api.metadataOverview(),
        ])
        if (healthRes.success && healthRes.data) setHealth(healthRes.data)
        if (sessionsRes.success && sessionsRes.data) {
          setSessionTotal(sessionsRes.data.total)
        }
        if (overviewRes.success && overviewRes.data) {
          setOverview(overviewRes.data)
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
          <h1 className="dash-hero-title">Tổng quan</h1>
          <p className="dash-hero-desc">
            Quản lý tài khoản Telegram, tin nhắn, nhóm, tác vụ hàng loạt và hội thoại tự nhiên —
            {API_ENDPOINT_COUNT} REST endpoint qua một dashboard.
          </p>
          <div className="dash-hero-actions">
            <Link to="/sessions?add=1" className="btn btn--primary">
              Thêm tài khoản
            </Link>
            <Link to="/dialogs" className="btn btn--glass">
              Tin nhắn
            </Link>
            <Link to="/conversation" className="btn btn--ghost">
              Hội thoại tự nhiên
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
            <span className="dash-hero-status-label">Backend</span>
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
          <p className="dash-hero-aside-meta">{databaseAsideText(health)}</p>
          <p className="dash-hero-aside-meta mono">
            {API_ENDPOINT_COUNT} endpoint · 127.0.0.1:8001
          </p>
        </aside>
      </section>

      <Alert type="error" message={error} onDismiss={() => setError('')} />

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
            <Link className="dash-stat-link" to="/health">
              Chi tiết →
            </Link>
          </div>
        </article>
        <article className="dash-stat dash-stat--sessions">
          <div className="dash-stat-icon">
            <StatIconSessions />
          </div>
          <div className="dash-stat-body">
            <p className="dash-stat-label">Tài khoản</p>
            <p className="dash-stat-value">
              {loading ? '…' : (accountCount ?? '—')}
            </p>
            <Link className="dash-stat-link" to="/sessions">
              Quản lý →
            </Link>
          </div>
        </article>
        <article
          className={`dash-stat dash-stat--audit${auditTotal === null && !loading && health && !health.database_enabled ? ' dash-stat--muted' : ''}`}
        >
          <div className="dash-stat-icon">
            <StatIconAudit />
          </div>
          <div className="dash-stat-body">
            <p className="dash-stat-label">Nhật ký</p>
            <p className="dash-stat-value">{auditStatLabel}</p>
            <Link className="dash-stat-link" to="/audit">
              Xem nhật ký →
            </Link>
          </div>
        </article>
        <article className="dash-stat dash-stat--api">
          <div className="dash-stat-icon">
            <StatIconApi />
          </div>
          <div className="dash-stat-body">
            <p className="dash-stat-label">REST API</p>
            <p className="dash-stat-value">{API_ENDPOINT_COUNT}</p>
            <span className="dash-stat-foot muted">endpoint</span>
          </div>
        </article>
      </section>

      <section className="dash-shortcuts">
        <div className="dash-section-head">
          <h2>Lối tắt</h2>
          <p className="muted">Cùng thứ tự menu — vào nhanh từng trang</p>
        </div>
        <div className="dash-quick-grid">
          {quickLinks.map((item) => (
            <Link
              key={item.key}
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
              {activeGroup.items.length} endpoint · {activeGroup.label}
            </p>
          </div>
          <span className="dash-api-total mono">{API_ENDPOINT_COUNT} endpoint</span>
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
              {group.label}
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
                <tr key={`${item.method}-${item.path}`}>
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
                        {pageLabel(item.page)}
                      </Link>
                    ) : (
                      <span className="api-page-only">Chỉ API</span>
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