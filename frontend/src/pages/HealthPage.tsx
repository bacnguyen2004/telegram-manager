import { useCallback, useEffect, useState } from 'react'
import './HealthPage.css'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { Alert } from '../components/Alert'
import { StatusBadge } from '../components/StatusBadge'
import type { HealthData } from '../types/api'

function HealthCheckItem({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className={`health-check-item health-check-item--${ok ? 'ok' : 'fail'}`}>
      <span className="health-check-icon" aria-hidden>
        {ok ? '✓' : '✕'}
      </span>
      <span className="health-check-label">{label}</span>
      <span className="health-check-value">{ok ? 'OK' : 'Lỗi'}</span>
    </div>
  )
}

function statusHeadline(status: HealthData['status'] | null): string {
  if (status === 'ok') return 'Backend hoạt động bình thường'
  if (status === 'degraded') return 'Backend đang degraded'
  return 'Chưa có dữ liệu'
}

export function HealthPage() {
  const [health, setHealth] = useState<HealthData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadHealth = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.health()
      if (!res.success || !res.data) {
        setError(res.error ?? 'Không lấy được health')
        setHealth(null)
        return
      }
      setHealth(res.data)
    } catch {
      setError('Không kết nối được API. Kiểm tra backend port 8001.')
      setHealth(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadHealth()
  }, [loadHealth])

  const statusKey = health?.status ?? 'unknown'
  const allStorageOk = Boolean(
    health?.session_dir_exists && health?.session_dir_writable,
  )

  return (
    <div className="page page--health">
      <header className="page-header health-page-header">
        <div>
          <h1>Health</h1>
          <p className="page-desc">
            Kiểm tra server, cấu hình Telegram và thư mục <code>.session</code> —{' '}
            <code>GET /api/health</code>
          </p>
        </div>
        <div className="health-page-actions">
          <Link to="/" className="btn btn--ghost btn--sm">
            Tổng quan
          </Link>
          <button type="button" className="btn btn--ghost" onClick={() => void loadHealth()} disabled={loading}>
            {loading ? 'Đang kiểm tra…' : 'Làm mới'}
          </button>
        </div>
      </header>

      <Alert type="error" message={error} />

      {loading ? (
        <div className="health-state health-state--loading">
          <span className="health-state-spinner" aria-hidden />
          <span>Đang gọi API health…</span>
        </div>
      ) : health ? (
        <>
          <section className={`panel health-status-banner health-status-banner--${statusKey}`}>
            <div className="health-status-banner-main">
              <span className={`health-status-pulse health-status-pulse--${statusKey}`} aria-hidden />
              <div>
                <p className="health-status-kicker">Trạng thái hệ thống</p>
                <h2 className="health-status-title">{statusHeadline(health.status)}</h2>
                {health.message ? (
                  <p className="health-status-message">{health.message}</p>
                ) : (
                  <p className="health-status-message muted">
                    API phản hồi — kiểm tra chi tiết bên dưới.
                  </p>
                )}
              </div>
            </div>
            <div className="health-status-banner-badge">
              <StatusBadge status={health.status} />
            </div>
          </section>

          <section className="stats-grid health-stats">
            <article className="stat-card health-stat-card health-stat-card--sessions">
              <p className="stat-label">Session trên disk</p>
              <p className="stat-value">{health.session_count}</p>
              <p className="health-stat-foot">
                <Link to="/sessions">Xem Sessions →</Link>
              </p>
            </article>
            <article
              className={`stat-card health-stat-card${health.telegram_configured ? ' health-stat-card--ok' : ' health-stat-card--warn'}`}
            >
              <p className="stat-label">Telegram API</p>
              <p className="stat-value">{health.telegram_configured ? '✓' : '✕'}</p>
              <p className="health-stat-foot">
                {health.telegram_configured ? 'Đã cấu hình' : 'Chưa cấu hình'}
              </p>
            </article>
            <article
              className={`stat-card health-stat-card${health.session_dir_exists ? ' health-stat-card--ok' : ' health-stat-card--warn'}`}
            >
              <p className="stat-label">Thư mục session</p>
              <p className="stat-value">{health.session_dir_exists ? '✓' : '✕'}</p>
              <p className="health-stat-foot">
                {health.session_dir_exists ? 'Tồn tại' : 'Không thấy'}
              </p>
            </article>
            <article
              className={`stat-card health-stat-card${health.session_dir_writable ? ' health-stat-card--ok' : ' health-stat-card--warn'}`}
            >
              <p className="stat-label">Ghi file</p>
              <p className="stat-value">{health.session_dir_writable ? '✓' : '✕'}</p>
              <p className="health-stat-foot">
                {health.session_dir_writable ? 'Có quyền ghi' : 'Không ghi được'}
              </p>
            </article>
          </section>

          <div className="health-workspace">
            <section className="panel health-card">
              <div className="health-card-head">
                <h2>Server</h2>
                <p className="panel-meta">Thông tin ứng dụng backend</p>
              </div>
              <dl className="health-dl">
                <div className="health-dl-row">
                  <dt>Ứng dụng</dt>
                  <dd>
                    <strong>{health.app}</strong>
                  </dd>
                </div>
                <div className="health-dl-row">
                  <dt>Endpoint</dt>
                  <dd>
                    <code>GET /api/health</code>
                  </dd>
                </div>
                <div className="health-dl-row">
                  <dt>Trạng thái</dt>
                  <dd>
                    <StatusBadge status={health.status} />
                  </dd>
                </div>
                <div className="health-dl-row">
                  <dt>Host</dt>
                  <dd>
                    <code className="mono">127.0.0.1:8001</code>
                  </dd>
                </div>
              </dl>
            </section>

            <section className="panel health-card">
              <div className="health-card-head">
                <h2>Lưu trữ session</h2>
                <p className="panel-meta">
                  {allStorageOk ? 'Thư mục sẵn sàng' : 'Cần kiểm tra quyền hoặc đường dẫn'}
                </p>
              </div>

              <div className="health-path-block">
                <span className="health-path-label">Session dir</span>
                <code className="health-path-value">{health.session_dir}</code>
              </div>

              <div className="health-check-list">
                <HealthCheckItem ok={health.session_dir_exists} label="Thư mục tồn tại" />
                <HealthCheckItem ok={health.session_dir_writable} label="Có quyền ghi" />
                <HealthCheckItem ok={health.telegram_configured} label="Telegram credentials" />
              </div>
            </section>
          </div>
        </>
      ) : (
        <div className="health-state health-state--empty">
          <span className="health-state-icon" aria-hidden>
            ⚠️
          </span>
          <p>Không lấy được thông tin health.</p>
          <p className="muted">Kiểm tra backend đang chạy tại port 8001.</p>
          <button type="button" className="btn btn--primary btn--sm" onClick={() => void loadHealth()}>
            Thử lại
          </button>
        </div>
      )}
    </div>
  )
}