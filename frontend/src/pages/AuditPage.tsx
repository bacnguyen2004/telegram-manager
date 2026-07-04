import { useCallback, useEffect, useMemo, useState } from 'react'
import './AuditPage.css'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { Alert } from '../components/Alert'
import { Pagination } from '../components/Pagination'
import { PhoneSelect } from '../components/PhoneSelect'
import { useSessionAccounts } from '../hooks/useSessionAccounts'
import type { AuditLogItem, MetadataOverviewData } from '../types/api'
import {
  AUDIT_CATEGORY_OPTIONS,
  AUDIT_STATUS_OPTIONS,
  auditActionCategory,
  auditActionLabel,
  auditActionToneClass,
  auditStatusClass,
  auditStatusLabel,
  parseAuditDetail,
  type AuditCategory,
  type AuditStatusFilter,
} from '../utils/auditLabels'
import { formatDate, formatRelativeDate } from '../utils/format'

const PAGE_SIZE = 20

const CATEGORY_SHORT: Record<AuditCategory, string> = {
  all: 'Tất cả',
  auth: 'Auth',
  sessions: 'Session',
  groups: 'Nhóm',
}

function categoryFromParam(value: string | null): AuditCategory {
  const match = AUDIT_CATEGORY_OPTIONS.find((item) => item.id === value)
  return match?.id ?? 'all'
}

function statusFromParam(value: string | null): AuditStatusFilter {
  const match = AUDIT_STATUS_OPTIONS.find((item) => item.id === value)
  return match?.id ?? 'all'
}

function AuditDetailCell({ detail }: { detail: string | null }) {
  const fields = parseAuditDetail(detail)
  if (fields.length === 0) return <span className="muted">—</span>

  return (
    <div className="audit-detail-chips">
      {fields.map((field) => (
        <span key={field.key} className="audit-detail-chip" title={`${field.key}: ${field.value}`}>
          <span className="audit-detail-chip-label">{field.label}</span>
          <span className="audit-detail-chip-value">{field.value}</span>
        </span>
      ))}
    </div>
  )
}

export function AuditPage() {
  const accounts = useSessionAccounts()
  const [searchParams, setSearchParams] = useSearchParams()
  const initialPhone = searchParams.get('phone') ?? ''
  const initialCategory = categoryFromParam(searchParams.get('category'))
  const initialStatus = statusFromParam(searchParams.get('status'))

  const [phoneFilter, setPhoneFilter] = useState(initialPhone)
  const [categoryFilter, setCategoryFilter] = useState<AuditCategory>(initialCategory)
  const [statusFilter, setStatusFilter] = useState<AuditStatusFilter>(initialStatus)
  const [overview, setOverview] = useState<MetadataOverviewData | null>(null)
  const [items, setItems] = useState<AuditLogItem[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const actionPrefix = useMemo(() => {
    const option = AUDIT_CATEGORY_OPTIONS.find((item) => item.id === categoryFilter)
    return option?.prefix
  }, [categoryFilter])

  const statusValue = useMemo(() => {
    const option = AUDIT_STATUS_OPTIONS.find((item) => item.id === statusFilter)
    return option?.value
  }, [statusFilter])

  const hasActiveFilters = Boolean(phoneFilter || categoryFilter !== 'all' || statusFilter !== 'all')

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
      const res = await api.listAuditLogs({
        phone: phoneFilter || undefined,
        actionPrefix,
        status: statusValue,
        limit: PAGE_SIZE,
        offset,
      })
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
  }, [phoneFilter, actionPrefix, statusValue, offset])

  useEffect(() => {
    void loadOverview()
  }, [loadOverview])

  useEffect(() => {
    void loadAudit()
  }, [loadAudit])

  useEffect(() => {
    const next: Record<string, string> = {}
    const phone = phoneFilter.trim()
    if (phone) next.phone = phone
    if (categoryFilter !== 'all') next.category = categoryFilter
    if (statusFilter !== 'all') next.status = statusFilter
    setSearchParams(next, { replace: true })
  }, [phoneFilter, categoryFilter, statusFilter, setSearchParams])

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

  const recentAudit = overview?.recent_audit ?? []
  const showRecent = !hasActiveFilters && recentAudit.length > 0

  function resetFilters() {
    setPhoneFilter('')
    setCategoryFilter('all')
    setStatusFilter('all')
    setOffset(0)
  }

  function setCategory(next: AuditCategory) {
    setCategoryFilter(next)
    setOffset(0)
  }

  function setStatus(next: AuditStatusFilter) {
    setStatusFilter(next)
    setOffset(0)
  }

  return (
    <div className="page page--audit">
      <header className="page-header audit-page-header">
        <div>
          <h1>Nhật ký hoạt động</h1>
          <p className="page-desc">
            Login, session, join/leave và quét nhóm — ghi vào PostgreSQL khi bật database.
          </p>
        </div>
        <div className="audit-page-actions">
          <Link to="/sessions" className="btn btn--ghost btn--sm">
            Sessions
          </Link>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              void loadOverview()
              void loadAudit()
            }}
            disabled={loading}
          >
            {loading ? 'Đang tải…' : 'Làm mới'}
          </button>
        </div>
      </header>

      <Alert type="error" message={error} onDismiss={() => setError('')} />

      <section className="stats-grid audit-stats">
        <article className="stat-card audit-stat-card">
          <p className="stat-label">Session DB</p>
          <p className="stat-value">{stats.sessions}</p>
          <p className="audit-stat-foot">Metadata</p>
        </article>
        <article className="stat-card audit-stat-card audit-stat-card--accent">
          <p className="stat-label">Tổng audit</p>
          <p className="stat-value">{stats.audits}</p>
          <p className="audit-stat-foot">Mọi hành động</p>
        </article>
        <article className="stat-card audit-stat-card audit-stat-card--success">
          <p className="stat-label">Quét nhóm</p>
          <p className="stat-value">{stats.scans}</p>
          <p className="audit-stat-foot">Group scan</p>
        </article>
        <article className="stat-card audit-stat-card">
          <p className="stat-label">Kết quả lọc</p>
          <p className="stat-value">{loading ? '—' : total}</p>
          <p className="audit-stat-foot">{hasActiveFilters ? 'Đang lọc' : 'Hiện tại'}</p>
        </article>
      </section>

      {showRecent ? (
        <section className="panel audit-recent-strip">
          <div className="audit-recent-strip-head">
            <span className="audit-recent-strip-title">Gần đây</span>
            <span className="audit-recent-strip-meta muted">{recentAudit.length} mục</span>
          </div>
          <div className="audit-recent-strip-scroll">
            {recentAudit.map((row) => (
              <button
                key={row.id}
                type="button"
                className={`audit-recent-chip audit-recent-chip--${auditActionCategory(row.action)}`}
                onClick={() => {
                  setPhoneFilter(row.phone)
                  setOffset(0)
                }}
                title={formatDate(row.created_at)}
              >
                <span className="audit-recent-chip-action">{auditActionLabel(row.action)}</span>
                <span className="audit-recent-chip-meta">
                  {row.phone} · {formatRelativeDate(row.created_at)}
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="panel audit-panel">
        <div className="audit-panel-head">
          <div>
            <h2>Danh sách hoạt động</h2>
            <p className="panel-meta">
              {hasActiveFilters
                ? `${total} bản ghi khớp bộ lọc`
                : `${total} bản ghi — mới nhất trước`}
            </p>
          </div>
          {!loading && total > 0 ? <span className="audit-count-badge">{total}</span> : null}
        </div>

        <div className="audit-toolbar">
          <div className="audit-toolbar-account">
            <PhoneSelect
              value={phoneFilter}
              onChange={(value) => {
                setPhoneFilter(value)
                setOffset(0)
              }}
              allowManual
              required={false}
              label="Tài khoản"
              sessions={accounts.sessions}
              metaByPhone={accounts.metaByPhone}
              loading={accounts.loading}
            />
          </div>

          <div className="audit-toolbar-filters">
            <div className="audit-filter-group">
              <span className="audit-filter-label">Loại</span>
              <div className="audit-filter-pills" role="group" aria-label="Loại hành động">
                {AUDIT_CATEGORY_OPTIONS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`audit-filter-pill audit-filter-pill--${item.id}${categoryFilter === item.id ? ' audit-filter-pill--active' : ''}`}
                    onClick={() => setCategory(item.id)}
                  >
                    {CATEGORY_SHORT[item.id]}
                  </button>
                ))}
              </div>
            </div>
            <div className="audit-filter-group">
              <span className="audit-filter-label">Trạng thái</span>
              <div className="audit-filter-pills" role="group" aria-label="Trạng thái">
                {AUDIT_STATUS_OPTIONS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`audit-filter-pill${statusFilter === item.id ? ' audit-filter-pill--active' : ''}`}
                    onClick={() => setStatus(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            {hasActiveFilters ? (
              <button type="button" className="btn btn--ghost btn--sm audit-clear-btn" onClick={resetFilters}>
                Xóa lọc
              </button>
            ) : null}
          </div>
        </div>

        {loading ? (
          <div className="audit-state">Đang tải…</div>
        ) : items.length === 0 ? (
          <div className="audit-state audit-state--empty">
            <p>{hasActiveFilters ? 'Không có bản ghi khớp bộ lọc.' : 'Chưa có bản ghi audit.'}</p>
            <p className="muted">
              {hasActiveFilters
                ? 'Thử bỏ bớt bộ lọc hoặc chọn acc khác.'
                : 'Thao tác trên acc sẽ được ghi khi PostgreSQL bật.'}
            </p>
            {hasActiveFilters ? (
              <button type="button" className="btn btn--ghost btn--sm" onClick={resetFilters}>
                Xóa tất cả lọc
              </button>
            ) : (
              <Link to="/sessions?add=1" className="btn btn--primary btn--sm">
                Thêm tài khoản
              </Link>
            )}
          </div>
        ) : (
          <>
            <div className="table-wrap audit-table-wrap">
              <table className="data-table audit-table">
                <thead>
                  <tr>
                    <th>Thời gian</th>
                    <th>Tài khoản</th>
                    <th>Hành động</th>
                    <th>Trạng thái</th>
                    <th>Chi tiết</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => {
                    const category = auditActionCategory(row.action)
                    const statusKey = auditStatusClass(row.status).replace('audit-status--', '')
                    return (
                      <tr
                        key={row.id}
                        className={`audit-row audit-row--${category} audit-row--status-${statusKey}`}
                      >
                        <td className="audit-cell-time">
                          <time dateTime={row.created_at} title={formatDate(row.created_at)}>
                            {formatRelativeDate(row.created_at)}
                          </time>
                        </td>
                        <td>
                          <Link
                            to={`/audit?phone=${encodeURIComponent(row.phone)}`}
                            className="phone audit-phone-link"
                          >
                            {row.phone}
                          </Link>
                        </td>
                        <td className="audit-cell-action">
                          <span
                            className={`audit-action-tag ${auditActionToneClass(row.action)}`}
                            title={row.action}
                          >
                            {auditActionLabel(row.action)}
                          </span>
                          {row.resource && row.resource !== row.phone ? (
                            <span className="audit-resource muted">{row.resource}</span>
                          ) : null}
                        </td>
                        <td>
                          <span className={`audit-status ${auditStatusClass(row.status)}`}>
                            {auditStatusLabel(row.status)}
                          </span>
                        </td>
                        <td className="audit-cell-detail">
                          <AuditDetailCell detail={row.detail} />
                        </td>
                      </tr>
                    )
                  })}
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