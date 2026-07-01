import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { Alert } from '../components/Alert'
import { Pagination } from '../components/Pagination'
import { StatusBadge } from '../components/StatusBadge'
import { usePagination } from '../hooks/usePagination'
import type {
  CheckSessionItem,
  SessionDetailData,
  SessionMeData,
  SessionMetaOverviewItem,
} from '../types/api'
import { auditActionLabel } from '../utils/auditLabels'
import { formatBytes, formatDate } from '../utils/format'

function calcStats(results: CheckSessionItem[]) {
  return {
    active: results.filter((item) => item.status === 'active').length,
    unauthorized: results.filter((item) => item.status === 'unauthorized').length,
    error: results.filter((item) => item.status === 'error').length,
  }
}

export function SessionsPage() {
  const [sessions, setSessions] = useState<string[]>([])
  const [total, setTotal] = useState(0)
  const [checkResults, setCheckResults] = useState<CheckSessionItem[]>([])
  const [stats, setStats] = useState({ active: 0, unauthorized: 0, error: 0 })
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)
  const [checkingPhone, setCheckingPhone] = useState<string | null>(null)
  const [deletingPhone, setDeletingPhone] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null)
  const [detailData, setDetailData] = useState<SessionDetailData | null>(null)
  const [meData, setMeData] = useState<SessionMeData | null>(null)
  const [modalLoading, setModalLoading] = useState(false)
  const [metaByPhone, setMetaByPhone] = useState<Map<string, SessionMetaOverviewItem>>(
    new Map(),
  )

  const loadMetadata = useCallback(async () => {
    try {
      const res = await api.listSessionMetaOverview()
      if (!res.success || !res.data?.database_enabled) {
        setMetaByPhone(new Map())
        return
      }
      setMetaByPhone(new Map(res.data.items.map((item) => [item.phone, item])))
    } catch {
      setMetaByPhone(new Map())
    }
  }, [])

  const loadSessions = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.listSessions()
      if (!res.success || !res.data) {
        setError(res.error ?? 'Không tải được danh sách session')
        return
      }
      setSessions(res.data.sessions)
      setTotal(res.data.total)
    } catch {
      setError('Không kết nối được API. Kiểm tra backend đang chạy port 8001.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSessions()
    void loadMetadata()
  }, [loadSessions, loadMetadata])

  async function handleCheckAll() {
    setChecking(true)
    setError('')
    setSuccess('')
    try {
      const res = await api.checkSessions()
      if (!res.success || !res.data) {
        setError(res.error ?? 'Kiểm tra session thất bại')
        return
      }
      setCheckResults(res.data.sessions)
      setStats({
        active: res.data.active,
        unauthorized: res.data.unauthorized,
        error: res.data.error,
      })
      void loadMetadata()
    } catch {
      setError('Không kết nối được API khi kiểm tra session.')
    } finally {
      setChecking(false)
    }
  }

  async function handleCheckOne(phone: string) {
    setCheckingPhone(phone)
    setError('')
    try {
      const res = await api.checkSessions([phone])
      if (!res.success || !res.data) {
        setError(res.error ?? 'Kiểm tra session thất bại')
        return
      }
      const item = res.data.sessions[0]
      if (!item) return
      setCheckResults((prev) => {
        const next = [...prev.filter((row) => row.phone !== phone), item]
        setStats(calcStats(next))
        return next
      })
    } catch {
      setError('Không kết nối được API khi kiểm tra session.')
    } finally {
      setCheckingPhone(null)
    }
  }

  async function handleViewDetail(phone: string) {
    setSelectedPhone(phone)
    setDetailData(null)
    setMeData(null)
    setModalLoading(true)
    try {
      const [detailRes, meRes] = await Promise.all([
        api.getSession(phone),
        api.getSessionMe(phone),
      ])

      if (detailRes.success && detailRes.data) {
        setDetailData(detailRes.data)
      } else {
        setDetailData({
          status: 'not_found',
          phone,
          exists: false,
          session_file: '',
          size_bytes: null,
          modified_at: null,
          has_journal: false,
          message: detailRes.error ?? 'Không lấy được thông tin file',
          db_metadata: null,
        })
      }

      if (meRes.success && meRes.data) {
        setMeData(meRes.data)
      } else {
        setMeData({
          status: 'error',
          phone,
          me_id: null,
          first_name: null,
          last_name: null,
          username: null,
          message: meRes.error ?? 'Không lấy được thông tin tài khoản',
        })
      }
    } catch {
      setError('Lỗi kết nối API khi tải chi tiết.')
    } finally {
      setModalLoading(false)
    }
  }

  async function handleDelete(phone: string) {
    const confirmed = window.confirm(
      `Xóa session ${phone}?\n\nFile .session và pending_auth sẽ bị xóa vĩnh viễn.`,
    )
    if (!confirmed) return

    setDeletingPhone(phone)
    setError('')
    setSuccess('')
    try {
      const res = await api.deleteSession(phone)
      if (!res.success || !res.data) {
        setError(res.error ?? 'Xóa session thất bại')
        return
      }
      if (res.data.status === 'error') {
        setError(res.data.message)
        return
      }

      setSuccess(res.data.message)
      setSessions((prev) => prev.filter((item) => item !== phone))
      setTotal((prev) => Math.max(0, prev - 1))
      setCheckResults((prev) => prev.filter((item) => item.phone !== phone))
      if (selectedPhone === phone) {
        closeModal()
      }
    } catch {
      setError('Không kết nối được API khi xóa session.')
    } finally {
      setDeletingPhone(null)
    }
  }

  function closeModal() {
    setSelectedPhone(null)
    setDetailData(null)
    setMeData(null)
  }

  const resultByPhone = new Map(checkResults.map((item) => [item.phone, item]))
  const {
    items: pagedSessions,
    page,
    setPage,
    totalPages,
    from,
    to,
    pageSize,
    setPageSize,
  } = usePagination(sessions, 10)

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Sessions</h1>
          <p className="page-desc">
            Quản lý file <code>.session</code> Telegram trên server
          </p>
        </div>
        <div className="header-actions">
          <button type="button" className="btn btn--ghost" onClick={() => void loadSessions()}>
            Làm mới
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={checking || loading}
            onClick={() => void handleCheckAll()}
          >
            {checking ? 'Đang kiểm tra…' : 'Kiểm tra tất cả'}
          </button>
        </div>
      </header>

      <Alert type="error" message={error} />
      <Alert type="success" message={success} />

      <section className="stats-grid">
        <article className="stat-card">
          <p className="stat-label">Tổng session</p>
          <p className="stat-value">{loading ? '—' : total}</p>
        </article>
        <article className="stat-card stat-card--active">
          <p className="stat-label">Active</p>
          <p className="stat-value">{checkResults.length ? stats.active : '—'}</p>
        </article>
        <article className="stat-card stat-card--warn">
          <p className="stat-label">Unauthorized</p>
          <p className="stat-value">{checkResults.length ? stats.unauthorized : '—'}</p>
        </article>
        <article className="stat-card stat-card--error">
          <p className="stat-label">Lỗi</p>
          <p className="stat-value">{checkResults.length ? stats.error : '—'}</p>
        </article>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Danh sách</h2>
          {!loading && <span className="panel-meta">{sessions.length} session</span>}
        </div>

        {loading ? (
          <div className="empty-state">Đang tải…</div>
        ) : sessions.length === 0 ? (
          <div className="empty-state">
            <p>Chưa có session nào.</p>
            <p>
              Vào <strong>Đăng nhập</strong> để tạo file <code>.session</code>.
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Số điện thoại</th>
                  <th>Trạng thái</th>
                  <th>Username</th>
                  <th>Nhóm / kênh</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pagedSessions.map((phone) => {
                  const checked = resultByPhone.get(phone)
                  const meta = metaByPhone.get(phone)
                  const scan = meta?.last_group_scan
                  const isDeleting = deletingPhone === phone
                  const isChecking = checkingPhone === phone
                  return (
                    <tr key={phone}>
                      <td>
                        <span className="phone">{phone}</span>
                      </td>
                      <td>
                        {checked ? (
                          <StatusBadge status={checked.status} />
                        ) : (
                          <span className="muted">Chưa kiểm tra</span>
                        )}
                      </td>
                      <td>{checked?.username ?? meta?.username ?? '—'}</td>
                      <td>
                        {scan ? (
                          <span className="session-scan-summary" title={formatDate(scan.scanned_at)}>
                            {scan.group_count} nhóm · {scan.channel_count} kênh
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="cell-actions">
                        <button
                          type="button"
                          className="btn btn--sm btn--ghost"
                          disabled={isChecking}
                          onClick={() => void handleCheckOne(phone)}
                        >
                          {isChecking ? '…' : 'Check'}
                        </button>
                        <button
                          type="button"
                          className="btn btn--sm btn--ghost"
                          onClick={() => void handleViewDetail(phone)}
                        >
                          Chi tiết
                        </button>
                        <button
                          type="button"
                          className="btn btn--sm btn--danger"
                          disabled={isDeleting}
                          onClick={() => void handleDelete(phone)}
                        >
                          {isDeleting ? 'Đang xóa…' : 'Xóa'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && sessions.length > 0 && (
          <Pagination
            page={page}
            totalPages={totalPages}
            total={sessions.length}
            from={from}
            to={to}
            onPageChange={setPage}
            pageSize={pageSize}
            pageSizeOptions={[10, 20, 50]}
            onPageSizeChange={setPageSize}
          />
        )}
      </section>

      {selectedPhone && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>{selectedPhone}</h3>
              <button type="button" className="btn btn--icon" onClick={closeModal}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              {modalLoading ? (
                <p className="muted">Đang tải…</p>
              ) : (
                <>
                  <h4 className="modal-section-title">File session</h4>
                  {detailData && (
                    <>
                      <div className="detail-row">
                        <span>Tồn tại</span>
                        <strong>{detailData.exists ? 'Có' : 'Không'}</strong>
                      </div>
                      <div className="detail-row">
                        <span>Kích thước</span>
                        <strong>{formatBytes(detailData.size_bytes)}</strong>
                      </div>
                      <div className="detail-row">
                        <span>Sửa lần cuối</span>
                        <strong>{formatDate(detailData.modified_at)}</strong>
                      </div>
                      <div className="detail-row">
                        <span>Journal file</span>
                        <strong>{detailData.has_journal ? 'Có' : 'Không'}</strong>
                      </div>
                      {detailData.session_file && (
                        <p className="detail-message">
                          <code className="session-path">{detailData.session_file}</code>
                        </p>
                      )}
                    </>
                  )}

                  <h4 className="modal-section-title">Metadata DB</h4>
                  {detailData?.db_metadata ? (
                    <>
                      <div className="detail-row">
                        <span>Nguồn</span>
                        <strong>{detailData.db_metadata.source}</strong>
                      </div>
                      <div className="detail-row">
                        <span>Trạng thái DB</span>
                        <StatusBadge status={detailData.db_metadata.status} />
                      </div>
                      <div className="detail-row">
                        <span>Import lúc</span>
                        <strong>{formatDate(detailData.db_metadata.imported_at)}</strong>
                      </div>
                      <div className="detail-row">
                        <span>Sync lần cuối</span>
                        <strong>{formatDate(detailData.db_metadata.last_synced_at)}</strong>
                      </div>
                      {detailData.db_metadata.last_error && (
                        <p className="detail-message">{detailData.db_metadata.last_error}</p>
                      )}
                      {detailData.db_metadata.last_group_scan ? (
                        <>
                          <h4 className="modal-section-title">Quét nhóm gần nhất</h4>
                          <div className="detail-row">
                            <span>Tổng</span>
                            <strong>{detailData.db_metadata.last_group_scan.total}</strong>
                          </div>
                          <div className="detail-row">
                            <span>Nhóm / kênh</span>
                            <strong>
                              {detailData.db_metadata.last_group_scan.group_count} /{' '}
                              {detailData.db_metadata.last_group_scan.channel_count}
                            </strong>
                          </div>
                          <div className="detail-row">
                            <span>Lúc</span>
                            <strong>
                              {formatDate(detailData.db_metadata.last_group_scan.scanned_at)}
                            </strong>
                          </div>
                        </>
                      ) : null}
                      {detailData.db_metadata.recent_audit.length > 0 ? (
                        <>
                          <h4 className="modal-section-title">Audit gần đây</h4>
                          <ul className="session-audit-list">
                            {detailData.db_metadata.recent_audit.map((item) => (
                              <li key={`${item.action}-${item.created_at}`}>
                                <span className="session-audit-action">
                                  {auditActionLabel(item.action)}
                                </span>
                                <span className="muted">{formatDate(item.created_at)}</span>
                              </li>
                            ))}
                          </ul>
                          {selectedPhone ? (
                            <Link
                              to={`/audit?phone=${encodeURIComponent(selectedPhone)}`}
                              className="session-audit-link"
                            >
                              Xem toàn bộ audit →
                            </Link>
                          ) : null}
                        </>
                      ) : null}
                    </>
                  ) : (
                    <p className="muted">
                      Chưa có metadata — bấm <strong>Kiểm tra tất cả</strong> để sync DB.
                    </p>
                  )}

                  <h4 className="modal-section-title">Tài khoản Telegram</h4>
                  {meData && (
                    <>
                      <div className="detail-row">
                        <span>Trạng thái</span>
                        <StatusBadge status={meData.status} />
                      </div>
                      <div className="detail-row">
                        <span>Telegram ID</span>
                        <strong>{meData.me_id ?? '—'}</strong>
                      </div>
                      <div className="detail-row">
                        <span>Họ tên</span>
                        <strong>
                          {[meData.first_name, meData.last_name].filter(Boolean).join(' ') || '—'}
                        </strong>
                      </div>
                      <div className="detail-row">
                        <span>Username</span>
                        <strong>{meData.username ? `@${meData.username}` : '—'}</strong>
                      </div>
                      {meData.message && (
                        <p className="detail-message">{meData.message}</p>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
            {selectedPhone && !modalLoading && (
              <div className="modal-foot">
                <button
                  type="button"
                  className="btn btn--danger"
                  disabled={deletingPhone === selectedPhone}
                  onClick={() => void handleDelete(selectedPhone)}
                >
                  {deletingPhone === selectedPhone ? 'Đang xóa…' : 'Xóa session'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}