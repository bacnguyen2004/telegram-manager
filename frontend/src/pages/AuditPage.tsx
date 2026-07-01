import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { Alert } from '../components/Alert'
import { Pagination } from '../components/Pagination'
import { PhoneSelect } from '../components/PhoneSelect'
import type { AuditLogItem, MetadataOverviewData } from '../types/api'
import { auditActionLabel, auditStatusClass } from '../utils/auditLabels'
import { formatDate } from '../utils/format'

const PAGE_SIZE = 20

function parseDetail(detail: string | null): string {
  if (!detail) return '—'
  try {
    const parsed = JSON.parse(detail) as Record<string, unknown>
    return Object.entries(parsed)
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join(' · ')
  } catch {
    return detail
  }
}

export function AuditPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialPhone = searchParams.get('phone') ?? ''

  const [phoneFilter, setPhoneFilter] = useState(initialPhone)
  const [overview, setOverview] = useState<MetadataOverviewData | null>(null)
  const [items, setItems] = useState<AuditLogItem[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadOverview = useCallback(async () => {
    try {
      const res = await api.metadataOverview()
      if (res.success && res.data) setOverview(res.data)
    } catch {
      /* optional */
    }
  }, [])

  const loadAudit = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.listAuditLogs(phoneFilter || undefined, PAGE_SIZE, offset)
      if (!res.success || !res.data) {
        setError(res.error ?? 'Không tải được audit log')
        setItems([])
        setTotal(0)
        return
      }
      if (!res.data.database_enabled) {
        setError('Database chưa bật — cấu hình DATABASE_URL trong backend/.env')
        setItems([])
        setTotal(0)
        return
      }
      setItems(res.data.items)
      setTotal(res.data.total)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tải được audit log')
    } finally {
      setLoading(false)
    }
  }, [phoneFilter, offset])

  useEffect(() => {
    void loadOverview()
  }, [loadOverview])

  useEffect(() => {
    void loadAudit()
  }, [loadAudit])

  useEffect(() => {
    const next = phoneFilter.trim()
    if (next) {
      setSearchParams({ phone: next }, { replace: true })
    } else {
      setSearchParams({}, { replace: true })
    }
  }, [phoneFilter, setSearchParams])

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1

  const stats = useMemo(
    () => ({
      sessions: overview?.session_meta_count ?? 0,
      audits: overview?.audit_log_count ?? 0,
      scans: overview?.group_scan_count ?? 0,
    }),
    [overview],
  )

  return (
    <div className="page page--audit">
      <header className="page-header">
        <div>
          <span className="audit-page-kicker">PostgreSQL metadata</span>
          <h1>Nhật ký hoạt động</h1>
          <p className="page-desc">
            Login, join/leave group, quét nhóm — lưu trong <code>audit_logs</code>. Xem chi tiết
            từng acc ở <Link to="/sessions">Sessions</Link>.
          </p>
        </div>
        <button type="button" className="btn btn--ghost" onClick={() => void loadAudit()}>
          Làm mới
        </button>
      </header>

      <Alert type="error" message={error} />

      <section className="stats-grid audit-stats">
        <article className="stat-card">
          <p className="stat-label">Session meta</p>
          <p className="stat-value">{stats.sessions}</p>
        </article>
        <article className="stat-card">
          <p className="stat-label">Audit entries</p>
          <p className="stat-value">{stats.audits}</p>
        </article>
        <article className="stat-card">
          <p className="stat-label">Group scans</p>
          <p className="stat-value">{stats.scans}</p>
        </article>
        <article className="stat-card stat-card--active">
          <p className="stat-label">Đang xem</p>
          <p className="stat-value">{total}</p>
        </article>
      </section>

      <section className="panel audit-panel">
        <div className="panel-head audit-panel-head">
          <h2>Audit log</h2>
          <div className="audit-filters">
            <PhoneSelect
              value={phoneFilter}
              onChange={(value) => {
                setPhoneFilter(value)
                setOffset(0)
              }}
              allowManual
              required={false}
              label="Lọc theo acc"
            />
            {phoneFilter ? (
              <button
                type="button"
                className="btn btn--sm btn--ghost"
                onClick={() => {
                  setPhoneFilter('')
                  setOffset(0)
                }}
              >
                Bỏ lọc
              </button>
            ) : null}
          </div>
        </div>

        {loading ? (
          <div className="empty-state">Đang tải…</div>
        ) : items.length === 0 ? (
          <div className="empty-state">
            <p>Chưa có bản ghi audit.</p>
            <p className="muted">
              Đăng nhập acc, quét nhóm hoặc join/leave — hành động sẽ được ghi tự động khi DB bật.
            </p>
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="data-table data-table--audit">
                <thead>
                  <tr>
                    <th>Thời gian</th>
                    <th>Acc</th>
                    <th>Hành động</th>
                    <th>Trạng thái</th>
                    <th>Chi tiết</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => (
                    <tr key={row.id}>
                      <td className="audit-cell-time">{formatDate(row.created_at)}</td>
                      <td>
                        <Link to={`/audit?phone=${encodeURIComponent(row.phone)}`} className="mono">
                          {row.phone}
                        </Link>
                      </td>
                      <td>
                        <span className="audit-action" title={row.action}>
                          {auditActionLabel(row.action)}
                        </span>
                        {row.resource && row.resource !== row.phone ? (
                          <span className="audit-resource muted">{row.resource}</span>
                        ) : null}
                      </td>
                      <td>
                        <span className={`audit-status ${auditStatusClass(row.status)}`}>
                          {row.status}
                        </span>
                      </td>
                      <td className="audit-cell-detail">{parseDetail(row.detail)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {total > PAGE_SIZE ? (
              <Pagination
                page={currentPage}
                totalPages={pageCount}
                from={offset + 1}
                to={Math.min(offset + PAGE_SIZE, total)}
                total={total}
                onPageChange={(page) => setOffset((page - 1) * PAGE_SIZE)}
              />
            ) : null}
          </>
        )}
      </section>
    </div>
  )
}