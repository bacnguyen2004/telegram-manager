import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { Alert } from '../components/Alert'
import { Pagination } from '../components/Pagination'
import { PhoneSelect } from '../components/PhoneSelect'
import { usePagination } from '../hooks/usePagination'
import type { GroupItem, GroupScanItem } from '../types/api'
import { formatDate } from '../utils/format'

type KindFilter = 'all' | 'group' | 'channel'
type VisibilityFilter = 'all' | 'public' | 'private'
type SortKey = 'title' | 'type'
type SortDir = 'asc' | 'desc'

const KIND_FILTER_OPTIONS: { id: KindFilter; label: string }[] = [
  { id: 'all', label: 'Tất cả' },
  { id: 'group', label: 'Nhóm' },
  { id: 'channel', label: 'Kênh' },
]

const VISIBILITY_FILTER_OPTIONS: { id: VisibilityFilter; label: string }[] = [
  { id: 'all', label: 'Tất cả' },
  { id: 'public', label: 'Công khai' },
  { id: 'private', label: 'Riêng tư' },
]

function isGroupPublic(group: GroupItem): boolean {
  return Boolean(group.username?.trim())
}

function matchesKindFilter(group: GroupItem, kind: KindFilter): boolean {
  if (kind === 'all') return true
  if (kind === 'group') return !group.is_channel
  return group.is_channel
}

function matchesVisibilityFilter(
  group: GroupItem,
  visibility: VisibilityFilter,
): boolean {
  if (visibility === 'all') return true
  if (visibility === 'public') return isGroupPublic(group)
  return !isGroupPublic(group)
}

function groupRef(group: GroupItem): string {
  return group.link || (group.username ? `@${group.username}` : String(group.id))
}

function groupInitial(title: string): string {
  const trimmed = title.trim()
  return trimmed ? trimmed.charAt(0).toUpperCase() : '?'
}

function sortGroups(
  items: GroupItem[],
  key: SortKey,
  dir: SortDir,
): GroupItem[] {
  const sorted = [...items].sort((a, b) => {
    if (key === 'title') return a.title.localeCompare(b.title, 'vi')
    const typeA = a.is_channel ? 1 : 0
    const typeB = b.is_channel ? 1 : 0
    return typeA - typeB
  })
  return dir === 'desc' ? sorted.reverse() : sorted
}

export function GroupsPage() {
  const [phone, setPhone] = useState('')
  const [groups, setGroups] = useState<GroupItem[]>([])
  const [filter, setFilter] = useState<KindFilter>('all')
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>('all')
  const [search, setSearch] = useState('')
  const [leaveTarget, setLeaveTarget] = useState<GroupItem | null>(null)
  const [leaveAllConfirm, setLeaveAllConfirm] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('title')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [loading, setLoading] = useState(false)
  const [leavingId, setLeavingId] = useState<number | null>(null)
  const [leaveAllLoading, setLeaveAllLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [scanHistory, setScanHistory] = useState<GroupScanItem[]>([])
  const [scanHistoryLoading, setScanHistoryLoading] = useState(false)

  const filterCounts = useMemo(() => {
    let group = 0
    let channel = 0
    let publicCount = 0
    let privateCount = 0
    for (const item of groups) {
      if (item.is_channel) channel += 1
      else group += 1
      if (isGroupPublic(item)) publicCount += 1
      else privateCount += 1
    }
    return { all: groups.length, group, channel, public: publicCount, private: privateCount }
  }, [groups])

  const visibilityCounts = useMemo(() => {
    const inKind = groups.filter((group) => matchesKindFilter(group, filter))
    return {
      all: inKind.length,
      public: inKind.filter(isGroupPublic).length,
      private: inKind.filter((group) => !isGroupPublic(group)).length,
    }
  }, [groups, filter])

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase()
    const matched = groups.filter((group) => {
      if (!matchesKindFilter(group, filter)) return false
      if (!matchesVisibilityFilter(group, visibilityFilter)) return false
      if (!q) return true
      return (
        group.title.toLowerCase().includes(q) ||
        group.username.toLowerCase().includes(q) ||
        group.type.toLowerCase().includes(q) ||
        String(group.id).includes(q)
      )
    })
    return sortGroups(matched, sortKey, sortDir)
  }, [groups, filter, visibilityFilter, search, sortKey, sortDir])

  const {
    items: pagedGroups,
    page,
    setPage,
    totalPages,
    from,
    to,
    pageSize,
    setPageSize,
  } = usePagination(filteredGroups, 20)

  const hasData = groups.length > 0
  const actionBusy = leavingId !== null || leaveAllLoading

  useEffect(() => {
    if (!success) return
    const timer = window.setTimeout(() => setSuccess(''), 3000)
    return () => window.clearTimeout(timer)
  }, [success])

  useEffect(() => {
    if (!phone) {
      setScanHistory([])
      return
    }
    let cancelled = false
    setScanHistoryLoading(true)
    void (async () => {
      try {
        const res = await api.listGroupScans(phone, 5)
        if (cancelled) return
        if (res.success && res.data?.database_enabled) {
          setScanHistory(res.data.items)
        } else {
          setScanHistory([])
        }
      } catch {
        if (!cancelled) setScanHistory([])
      } finally {
        if (!cancelled) setScanHistoryLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [phone, groups.length])

  function resetAlerts() {
    setError('')
    setSuccess('')
  }

  function setSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    setSortDir('asc')
  }

  function sortPillLabel(key: SortKey): string {
    if (key === 'title') {
      if (sortKey !== 'title') return 'Tên A→Z'
      return sortDir === 'asc' ? 'Tên A→Z' : 'Tên Z→A'
    }
    if (sortKey !== 'type') return 'Nhóm trước'
    return sortDir === 'asc' ? 'Nhóm trước' : 'Kênh trước'
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setSuccess('Đã copy')
      setError('')
    } catch {
      setError('Không copy được')
    }
  }

  async function handleLoadGroups(e?: React.FormEvent) {
    e?.preventDefault()
    if (!phone) return
    setLoading(true)
    resetAlerts()
    setGroups([])
    try {
      const res = await api.listGroups(phone)
      if (!res.success || !res.data) {
        setError(res.error ?? 'Không tải được danh sách nhóm')
        return
      }
      if (res.data.status === 'error') {
        setError(res.data.message)
        return
      }
      setGroups(res.data.groups)
      setSuccess(`Quét xong — ${res.data.total} mục`)
      const scanRes = await api.listGroupScans(phone, 5)
      if (scanRes.success && scanRes.data?.database_enabled) {
        setScanHistory(scanRes.data.items)
      }
    } catch {
      setError('Không kết nối được API.')
    } finally {
      setLoading(false)
    }
  }

  function requestLeave(group: GroupItem) {
    if (!phone || actionBusy) return
    setLeaveTarget(group)
  }

  function closeLeaveModal() {
    if (actionBusy) return
    setLeaveTarget(null)
  }

  function closeLeaveAllModal() {
    if (actionBusy) return
    setLeaveAllConfirm(false)
  }

  async function confirmLeave() {
    if (!phone || !leaveTarget) return

    const group = leaveTarget
    setLeavingId(group.id)
    resetAlerts()
    try {
      const res = await api.leaveGroup(phone, groupRef(group))
      if (!res.success || !res.data) {
        setError(res.error ?? 'Rời nhóm thất bại')
        return
      }
      if (res.data.status === 'error') {
        setError(res.data.message)
        return
      }
      setSuccess(res.data.message)
      setGroups((prev) => prev.filter((item) => item.id !== group.id))
      setLeaveTarget(null)
    } catch {
      setError('Không kết nối được API.')
    } finally {
      setLeavingId(null)
    }
  }

  async function confirmLeaveAll() {
    if (!phone) return

    setLeaveAllLoading(true)
    resetAlerts()
    try {
      const res = await api.leaveAllGroups(phone)
      if (!res.success || !res.data) {
        setError(res.error ?? 'Rời tất cả thất bại')
        return
      }
      if (res.data.status === 'error') {
        setError(res.data.message)
        return
      }
      setSuccess(res.data.message)
      setGroups([])
      setLeaveAllConfirm(false)
    } catch {
      setError('Không kết nối được API.')
    } finally {
      setLeaveAllLoading(false)
    }
  }

  return (
    <div className={`page page--groups${hasData ? ' page--groups-active' : ''}`}>
      <header className="page-header groups-page-header">
        <div>
          <span className="groups-page-kicker">Membership</span>
          <h1>Nhóm &amp; Kênh</h1>
          <p className="page-desc">
            Danh sách group/kênh đã join theo từng acc. Join hàng loạt →{' '}
            <Link to="/tasks">Tác vụ</Link>.
          </p>
        </div>
        <div className="groups-header-actions">
          <Link to="/dialogs" className="btn btn--ghost btn--sm">
            Hội thoại
          </Link>
          <Link to="/tasks" className="btn btn--primary btn--sm">
            Tác vụ
          </Link>
        </div>
      </header>

      <section className="stats-grid groups-stats groups-stats--wide">
        <article className="stat-card stat-card--groups">
          <p className="stat-label">Nhóm</p>
          <p className="stat-value">{loading ? '—' : filterCounts.group}</p>
        </article>
        <article className="stat-card stat-card--channels">
          <p className="stat-label">Kênh</p>
          <p className="stat-value">{loading ? '—' : filterCounts.channel}</p>
        </article>
        <article className="stat-card stat-card--public">
          <p className="stat-label">Công khai</p>
          <p className="stat-value">{loading ? '—' : filterCounts.public}</p>
        </article>
        <article className="stat-card">
          <p className="stat-label">Riêng tư</p>
          <p className="stat-value">{loading ? '—' : filterCounts.private}</p>
        </article>
      </section>

      <Alert type="error" message={error} />
      <Alert type="success" message={success} />

      <div className="groups-workspace">
        <aside className="panel groups-control-panel">
          <div className="groups-control-head">
            <h2>Session</h2>
            <p className="panel-meta">{phone || 'Chọn tài khoản'}</p>
          </div>

          <form
            className="groups-control-form"
            onSubmit={(e) => void handleLoadGroups(e)}
          >
            <PhoneSelect value={phone} onChange={setPhone} allowManual={false} />
            <button
              type="submit"
              className="btn btn--primary groups-scan-btn"
              disabled={loading || !phone}
            >
              {loading ? 'Đang quét…' : hasData ? 'Quét lại' : 'Quét danh sách'}
            </button>
          </form>

          {phone ? (
            <div className="groups-scan-history">
              <p className="groups-control-label">Lịch sử quét (DB)</p>
              {scanHistoryLoading ? (
                <p className="muted">Đang tải…</p>
              ) : scanHistory.length === 0 ? (
                <p className="muted">
                  Chưa có bản ghi — bấm <strong>Quét danh sách</strong> để lưu vào DB.
                </p>
              ) : (
                <ul className="groups-scan-history-list">
                  {scanHistory.map((scan) => (
                    <li key={scan.id}>
                      <span>
                        {scan.group_count} nhóm · {scan.channel_count} kênh
                      </span>
                      <span className="muted">{formatDate(scan.scanned_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <Link to={`/audit?phone=${encodeURIComponent(phone)}`} className="groups-audit-link">
                Xem audit acc này →
              </Link>
            </div>
          ) : null}

          <div className="groups-control-section">
            <p className="groups-control-label">Sắp xếp danh sách</p>
            <div className="groups-sort-pills">
              <button
                type="button"
                className={`groups-sort-pill${sortKey === 'title' ? ' groups-sort-pill--active' : ''}`}
                onClick={() => setSort('title')}
                title="Theo tên nhóm/kênh (bảng chữ cái)"
              >
                {sortPillLabel('title')}
              </button>
              <button
                type="button"
                className={`groups-sort-pill${sortKey === 'type' ? ' groups-sort-pill--active' : ''}`}
                onClick={() => setSort('type')}
                title="Gom nhóm hoặc kênh lên đầu — không ẩn mục"
              >
                {sortPillLabel('type')}
              </button>
            </div>
            <p className="groups-sort-hint muted">
              Khác bộ lọc Loại: sắp xếp chỉ đổi thứ tự, không ẩn mục.
            </p>
          </div>

          <p className="groups-control-foot muted">
            Join nhiều acc → <Link to="/tasks">Tác vụ</Link>
          </p>
        </aside>

        <section className="panel groups-list-panel">
          <div className="groups-list-head">
            <div>
              <h2>Đã join</h2>
              <p className="panel-meta">
                {hasData
                  ? `${filteredGroups.length} / ${groups.length} mục`
                  : 'Quét session để tải danh sách'}
              </p>
            </div>
            {hasData ? (
              <span className="groups-count-badge">{groups.length}</span>
            ) : null}
          </div>

          {phone ? (
            <div className="groups-list-toolbar">
              {hasData ? (
                <input
                  type="search"
                  className="groups-list-search"
                  placeholder="Tìm tên, @username, ID…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              ) : null}
              <div className="groups-toolbar-row">
                {hasData ? (
                  <div className="groups-toolbar-filters">
                    <div className="groups-filter-row">
                      <span className="groups-filter-group-label">Loại</span>
                      <div className="groups-filter-pills">
                        {KIND_FILTER_OPTIONS.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            className={`groups-filter-pill${filter === item.id ? ' groups-filter-pill--active' : ''}`}
                            onClick={() => setFilter(item.id)}
                          >
                            {item.label}
                            <span>{filterCounts[item.id]}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="groups-filter-row">
                      <span className="groups-filter-group-label">Công khai</span>
                      <div className="groups-filter-pills">
                        {VISIBILITY_FILTER_OPTIONS.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            className={`groups-filter-pill${visibilityFilter === item.id ? ' groups-filter-pill--active' : ''}`}
                            onClick={() => setVisibilityFilter(item.id)}
                          >
                            {item.label}
                            <span>{visibilityCounts[item.id]}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="groups-toolbar-hint muted">
                    Quét danh sách hoặc rời toàn bộ nhóm/kênh đã join.
                  </p>
                )}
                <button
                  type="button"
                  className="btn btn--danger groups-leave-all-btn"
                  disabled={actionBusy}
                  onClick={() => setLeaveAllConfirm(true)}
                >
                  Rời toàn bộ
                </button>
              </div>
            </div>
          ) : null}

          <div className="groups-list-body">
            {loading ? (
              <div className="groups-list-state">
                <span className="groups-loading-dot" aria-hidden />
                <p>Đang quét từ Telegram…</p>
              </div>
            ) : null}

            {!hasData && !loading ? (
              <div className="groups-list-state">
                <div className="groups-empty-graphic" aria-hidden>
                  <svg viewBox="0 0 80 80" fill="none">
                    <circle cx="28" cy="30" r="10" stroke="currentColor" strokeWidth="2" />
                    <circle cx="52" cy="32" r="8" stroke="currentColor" strokeWidth="2" />
                    <path
                      d="M14 58c0-8 6-14 14-14s14 6 14 14M42 58c0-6 5-10 10-10"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                </div>
                <h3>Chưa có danh sách</h3>
                <p className="muted">Chọn session bên trái và bấm Quét danh sách.</p>
              </div>
            ) : null}

            {hasData && filteredGroups.length === 0 && !loading ? (
              <div className="groups-list-state groups-list-state--compact">
                <h3>Không khớp bộ lọc</h3>
                <p className="muted">Thử từ khóa hoặc loại khác.</p>
              </div>
            ) : null}

            {hasData && pagedGroups.length > 0 ? (
              <ul className="groups-list">
                {pagedGroups.map((group) => {
                  const isLeaving = leavingId === group.id
                  const username = group.username ? `@${group.username}` : ''
                  const isPublic = isGroupPublic(group)
                  return (
                    <li
                      key={group.id}
                      className={`groups-list-item${group.is_channel ? ' groups-list-item--channel' : ' groups-list-item--group'}`}
                    >
                      <div className="groups-list-main">
                        <span
                          className={`groups-list-avatar${group.is_channel ? ' groups-list-avatar--channel' : ''}`}
                          aria-hidden
                        >
                          {groupInitial(group.title)}
                        </span>
                        <div className="groups-list-text">
                          <div className="groups-list-title-row">
                            <span className="groups-list-title">
                              {group.title || '—'}
                            </span>
                            <span
                              className={`groups-type-chip${group.is_channel ? ' groups-type-chip--channel' : ''}`}
                            >
                              {group.is_channel ? 'Kênh' : 'Nhóm'}
                            </span>
                            <span
                              className={`groups-vis-chip${isPublic ? ' groups-vis-chip--public' : ' groups-vis-chip--private'}`}
                            >
                              {isPublic ? 'Công khai' : 'Riêng tư'}
                            </span>
                          </div>
                          <p className="groups-list-meta">
                            {username ? (
                              <button
                                type="button"
                                className="groups-meta-link"
                                onClick={() => void copyText(username)}
                                title="Copy username"
                              >
                                {username}
                              </button>
                            ) : (
                              <span>Chỉ invite</span>
                            )}
                            <span className="groups-meta-sep">·</span>
                            <span>ID {group.id}</span>
                          </p>
                        </div>
                      </div>

                      <div className="groups-list-actions">
                        <Link
                          className="groups-icon-btn"
                          to="/dialogs"
                          title="Hội thoại"
                        >
                          Chat
                        </Link>
                        {group.link ? (
                          <a
                            className="groups-icon-btn"
                            href={group.link}
                            target="_blank"
                            rel="noreferrer"
                            title="Mở Telegram"
                          >
                            TG
                          </a>
                        ) : null}
                        <button
                          type="button"
                          className="groups-icon-btn groups-icon-btn--danger"
                          disabled={isLeaving || actionBusy || !phone}
                          title="Rời nhóm này"
                          onClick={() => requestLeave(group)}
                        >
                          {isLeaving ? '…' : 'Rời'}
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            ) : null}
          </div>

          {hasData && pagedGroups.length > 0 ? (
            <Pagination
              className="pagination--groups"
              page={page}
              totalPages={totalPages}
              total={filteredGroups.length}
              from={from}
              to={to}
              onPageChange={setPage}
              pageSize={pageSize}
              pageSizeOptions={[20, 50, 100]}
              onPageSizeChange={setPageSize}
            />
          ) : null}
        </section>
      </div>

      {leaveTarget ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={closeLeaveModal}
        >
          <div
            className="modal"
            role="dialog"
            aria-labelledby="groups-leave-title"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <h3 id="groups-leave-title">Xác nhận rời nhóm</h3>
              <button
                type="button"
                className="btn btn--icon"
                onClick={closeLeaveModal}
                disabled={actionBusy}
                aria-label="Đóng"
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p className="groups-leave-modal-text">
                Rời <strong>{leaveTarget.title}</strong> khỏi session{' '}
                <strong>{phone}</strong>?
              </p>
              <ul className="groups-leave-modal-meta">
                <li>
                  {leaveTarget.is_channel ? 'Kênh' : 'Nhóm'} ·{' '}
                  {isGroupPublic(leaveTarget) ? 'Công khai' : 'Riêng tư'}
                </li>
                {leaveTarget.username ? <li>@{leaveTarget.username}</li> : null}
                <li>ID {leaveTarget.id}</li>
              </ul>
            </div>
            <div className="modal-foot">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={closeLeaveModal}
                disabled={actionBusy}
              >
                Hủy
              </button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => void confirmLeave()}
                disabled={actionBusy}
              >
                {leavingId !== null ? 'Đang rời…' : 'Rời nhóm'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {leaveAllConfirm ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={closeLeaveAllModal}
        >
          <div
            className="modal"
            role="dialog"
            aria-labelledby="groups-leave-all-title"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <h3 id="groups-leave-all-title">Rời tất cả nhóm &amp; kênh</h3>
              <button
                type="button"
                className="btn btn--icon"
                onClick={closeLeaveAllModal}
                disabled={actionBusy}
                aria-label="Đóng"
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p className="groups-leave-modal-text">
                Rời <strong>toàn bộ nhóm/kênh</strong>
                {groups.length > 0 ? ` (${groups.length} mục đang hiển thị)` : ''} của
                session <strong>{phone}</strong>?
              </p>
              <p className="groups-leave-modal-warn muted">
                Không hoàn tác được. Chỉ áp dụng cho acc đang chọn — rời nhiều acc
                khác nhau dùng <Link to="/tasks">Tác vụ</Link>.
              </p>
            </div>
            <div className="modal-foot">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={closeLeaveAllModal}
                disabled={actionBusy}
              >
                Hủy
              </button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => void confirmLeaveAll()}
                disabled={actionBusy}
              >
                {leaveAllLoading ? 'Đang rời…' : 'Rời toàn bộ'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}