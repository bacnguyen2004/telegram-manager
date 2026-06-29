import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import { Alert } from '../components/Alert'
import { StatusBadge } from '../components/StatusBadge'
import type { HealthData } from '../types/api'

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

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Health</h1>
          <p className="page-desc">
            <code>GET /api/health</code> — kiểm tra server và cấu hình
          </p>
        </div>
        <button type="button" className="btn btn--ghost" onClick={() => void loadHealth()}>
          Làm mới
        </button>
      </header>

      <Alert type="error" message={error} />

      <section className="panel">
        {loading ? (
          <p className="muted">Đang kiểm tra…</p>
        ) : health ? (
          <>
            <div className="detail-row">
              <span>Trạng thái</span>
              <StatusBadge status={health.status} />
            </div>
            <div className="detail-row">
              <span>Ứng dụng</span>
              <strong>{health.app}</strong>
            </div>
            <div className="detail-row">
              <span>Telegram configured</span>
              <strong>{health.telegram_configured ? 'Có' : 'Không'}</strong>
            </div>
            <div className="detail-row">
              <span>Session dir</span>
              <code className="session-path">{health.session_dir}</code>
            </div>
            <div className="detail-row">
              <span>Thư mục tồn tại</span>
              <strong>{health.session_dir_exists ? 'Có' : 'Không'}</strong>
            </div>
            <div className="detail-row">
              <span>Ghi được</span>
              <strong>{health.session_dir_writable ? 'Có' : 'Không'}</strong>
            </div>
            <div className="detail-row">
              <span>Số session</span>
              <strong>{health.session_count}</strong>
            </div>
            {health.message && <p className="detail-message">{health.message}</p>}
          </>
        ) : null}
      </section>
    </div>
  )
}