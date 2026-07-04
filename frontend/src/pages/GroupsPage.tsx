import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './GroupsPage.css'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { AccountPickerPanel, type AccountPickerFilterState } from '../components/AccountPickerPanel'
import { Alert } from '../components/Alert'
import { Pagination } from '../components/Pagination'
import { usePagination } from '../hooks/usePagination'
import { useSessionAccounts } from '../hooks/useSessionAccounts'
import type { GroupItem, GroupScanItem } from '../types/api'
import { formatDate } from '../utils/format'

type KindFilter = 'all' | 'group' | 'channel'
type VisibilityFilter = 'all' | 'public' | 'private'
type SortKey = 'title' | 'type'
type SortDir = 'asc' | 'desc'

type ScanSnapshot = {
  phone: string
  total: number
  group_count: number
  channel_count: number
  scanned_at: string | null
}

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
  const [searchParams, setSearchParams] = useSearchParams()
  const accounts = useSessionAccounts()
  const [phone, setPhone] = useState(() => searchParams.get('phone') ?? '')
  const [groups, setGroups] = useState<GroupItem[]>([])
  const [loadedPhone, setLoadedPhone] = useState('')
  const loadGenRef = useRef(0)
  const phoneAutoLoadRef = useRef('')
  const [filter, setFilter] = useState<KindFilter>('all')
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>('all')
  const [search, setSearch] = useState('')
  const [leaveTarget, setLeaveTarget] = useState<GroupItem | null>(null)
  const [leaveAllConfirm, setLeaveAllConfirm] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('title')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [loading, setLoading] = useState(false)
  const [loadingSnapshot, setLoadingSnapshot] = useState(false)
  const [lastScannedAt, setLastScannedAt] = useState<string | null>(null)
  const [scanSnapshot, setScanSnapshot] = useState<ScanSnapshot | null>(null)
  const [leavingId, setLeavingId] = useState<number | null>(null)
  const [leaveAllLoading, setLeaveAllLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [scanHistory, setScanHistory] = useState<GroupScanItem[]>([])
  const [scanHistoryLoading, setScanHistoryLoading] = useState(false)
  const [accountFilterState, setAccountFilterState] = useState<AccountPickerFilterState>({
    filteredCount: 0,
    totalCount: 0,
    hasFilters: false,
  })

  const hasStatusData = accounts.metaByPhone.size > 0

  const accountPickerMeta = useMemo(() => {
    if (accounts.loading || accounts.sessions.length === 0) return 'Chọn tài khoản'
    if (phone) return accounts.getPickerLabel(phone)
    if (accountFilterState.hasFilters) {
      return `${accountFilterState.filteredCount}/${accounts.sessions.length} hiển thị`
    }
    return `${accounts.sessions.length} acc`
  }, [accounts, phone, accountFilterState])

  const activeGroups = loadedPhone === phone ? groups : []
  const activeSnapshot = scanSnapshot?.phone === phone ? scanSnapshot : null

  const filterCounts = useMemo(() => {
    let group = 0
    let channel = 0
    let publicCount = 0
    let privateCount = 0
    for (const item of activeGroups) {
      if (item.is_channel) channel += 1
      else group += 1
      if (isGroupPublic(item)) publicCount += 1
      else privateCount += 1
    }
    return { all: activeGroups.length, group, channel, public: publicCount, private: privateCount }
  }, [activeGroups])

  const visibilityCounts = useMemo(() => {
    const inKind = activeGroups.filter((group) => matchesKindFilter(group, filter))
    return {
      all: inKind.length,
      public: inKind.filter(isGroupPublic).length,
      private: inKind.filter((group) => !isGroupPublic(group)).length,
    }
  }, [activeGroups, filter])

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase()
    const matched = activeGroups.filter((group) => {
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
  }, [activeGroups, filter, visibilityFilter, search, sortKey, sortDir])

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

  const hasListData = activeGroups.length > 0
  const hasSnapshot = Boolean(activeSnapshot)
  const actionBusy = leavingId !== null || leaveAllLoading

  const displayStats = useMemo(() => {
    if (hasListData) {
      return {
        total: activeGroups.length,
        group: filterCounts.group,
        channel: filterCounts.channel,
        public: filterCounts.public,
        private: filterCounts.private,
        fromList: true as const,
      }
    }
    if (activeSnapshot) {
      return {
        total: activeSnapshot.total,
        group: activeSnapshot.group_count,
        channel: activeSnapshot.channel_count,
        public: null,
        private: null,
        fromList: false as const,
      }
    }
    return {
      total: 0,
      group: 0,
      channel: 0,
      public: 0,
      private: 0,
      fromList: true as const,
    }
  }, [hasListData, activeGroups.length, filterCounts, activeSnapshot])

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
  }, [phone, activeGroups.length])

  function resetAlerts() {
    setError('')
    setSuccess('')
  }

  function resetViewForPhone() {
    setGroups([])
    setLoadedPhone('')
    setScanSnapshot(null)
    setLastScannedAt(null)
    setSearch('')
    setFilter('all')
    setVisibilityFilter('all')
    setLeaveTarget(null)
    setLeaveAllConfirm(false)
    resetAlerts()
  }

  function snapshotFromScan(targetPhone: string, scan: GroupScanItem): ScanSnapshot {
    return {
      phone: targetPhone,
      total: scan.total,
      group_count: scan.group_count,
      channel_count: scan.channel_count,
      scanned_at: scan.scanned_at,
    }
  }

  async function refreshScanHistory(targetPhone: string, gen: number) {
    const scanRes = await api.listGroupScans(targetPhone, 5)
    if (gen !== loadGenRef.current) return []
    if (scanRes.success && scanRes.data?.database_enabled) {
      setScanHistory(scanRes.data.items)
      return scanRes.data.items
    }
    setScanHistory([])
    return []
  }

  const loadLatestScanForPhone = useCallback(async (targetPhone: string) => {
    if (!targetPhone) return

    const gen = ++loadGenRef.current
    setLoadingSnapshot(true)
    resetAlerts()
    setGroups([])
    setLoadedPhone('')
    setScanSnapshot(null)
    setLastScannedAt(null)

    try {
      const items = await refreshScanHistory(targetPhone, gen)
      if (gen !== loadGenRef.current) return
      const latest = items[0]
      if (latest) {
        setScanSnapshot(snapshotFromScan(targetPhone, latest))
        setLastScannedAt(latest.scanned_at)
      }
    } catch {
      if (gen === loadGenRef.current) {
        setError('Không kết nối được API.')
      }
    } finally {
      if (gen === loadGenRef.current) {
        setLoadingSnapshot(false)
      }
    }
  }, [])

  const scanGroupsForPhone = useCallback(async (targetPhone: string) => {
    if (!targetPhone) return

    const gen = ++loadGenRef.current
    setLoading(true)
    resetAlerts()
    setGroups([])
    setLoadedPhone('')
    setScanSnapshot(null)
    setLastScannedAt(null)

    try {
      const res = await api.listGroups(targetPhone)
      if (gen !== loadGenRef.current) return
      if (!res.success || !res.data) {
        setError(res.error ?? 'Không tải được danh sách nhóm')
        return
      }
      if (res.data.status === 'error') {
        setError(res.data.message)
        return
      }
      setGroups(res.data.groups)
      setLoadedPhone(targetPhone)
      setSuccess(`Quét xong — ${res.data.total} mục`)
      const items = await refreshScanHistory(targetPhone, gen)
      if (gen !== loadGenRef.current) return
      const latest = items[0]
      if (latest) {
        setScanSnapshot(snapshotFromScan(targetPhone, latest))
        setLastScannedAt(latest.scanned_at)
      }
    } catch {
      if (gen === loadGenRef.current) {
        setError('Không kết nối được API.')
      }
    } finally {
      if (gen === loadGenRef.current) {
        setLoading(false)
      }
    }
  }, [])

  const handlePhoneChange = useCallback(
    (next: string) => {
      if (next === phone) return

      loadGenRef.current += 1
      setLoading(false)
      setLoadingSnapshot(false)
      resetViewForPhone()
      setPhone(next)

      const params = new URLSearchParams(searchParams)
      const trimmed = next.trim()
      if (trimmed) params.set('phone', trimmed)
      else params.delete('phone')
      setSearchParams(params, { replace: true })

      phoneAutoLoadRef.current = trimmed
      if (trimmed) {
        void loadLatestScanForPhone(trimmed)
      } else {
        setScanHistory([])
      }
    },
    [phone, searchParams, setSearchParams, loadLatestScanForPhone],
  )

  useEffect(() => {
    const phoneParam = searchParams.get('phone')?.trim() ?? ''
    if (!phoneParam || accounts.loading) return
    if (phoneAutoLoadRef.current === phoneParam) return

    phoneAutoLoadRef.current = phoneParam
    setPhone((current) => (current === phoneParam ? current : phoneParam))
    loadGenRef.current += 1
    resetViewForPhone()
    void loadLatestScanForPhone(phoneParam)
  }, [searchParams, accounts.loading, loadLatestScanForPhone])

  function applySortOption(value: string) {
    const [key, dir] = value.split(':') as [SortKey, SortDir]
    setSortKey(key)
    setSortDir(dir)
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
    phoneAutoLoadRef.current = phone
    await scanGroupsForPhone(phone)
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
      setGroups((prev) =>
        loadedPhone === phone ? prev.filter((item) => item.id !== group.id) : prev,
      )
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
      setLoadedPhone('')
      setLeaveAllConfirm(false)
    } catch {
      setError('Không kết nối được API.')
    } finally {
      setLeaveAllLoading(false)
    }
  }

  return (
    <div className="page page--groups">
      <Alert type="error" message={error} />
      <Alert type="success" message={success} />

      <div className="groups-workspace">
        <div className="groups-workspace-top">
          <AccountPickerPanel
            className="groups-accounts-panel"
            title="Tài khoản"
            meta={accountPickerMeta}
            badgeCount={phone ? 1 : 0}
            sessions={accounts.sessions}
            loading={accounts.loading}
            getMeta={accounts.getMeta}
            selectionMode="single"
            selectedPhone={phone}
            onSelectedPhoneChange={handlePhoneChange}
            disabled={loading || loadingSnapshot || actionBusy}
            busy={loading || loadingSnapshot || actionBusy}
            hasStatusData={hasStatusData}
            showClearFiltersInToolbar
            onFiltersChange={setAccountFilterState}
            panelFoot={
              <>
                Join nhiều acc → <Link to="/tasks">Tác vụ</Link>.
              </>
            }
          />

          <section className="panel groups-main-panel">
            <header className="groups-main-head">
              <div className="groups-main-head-main">
                <span className="groups-main-kicker">Membership</span>
                <h2>Nhóm &amp; Kênh</h2>
                <p className="groups-main-desc muted">
                {hasListData
                  ? `${filteredGroups.length} / ${activeGroups.length} mục hiển thị${
                      lastScannedAt ? ` · quét ${formatDate(lastScannedAt)}` : ''
                    }`
                  : hasSnapshot && activeSnapshot
                    ? `${activeSnapshot.total} mục (lần quét ${formatDate(activeSnapshot.scanned_at ?? '')}) — bấm Quét lại để xem chi tiết`
                    : phone
                      ? loadingSnapshot
                        ? 'Đang tải lần quét gần nhất…'
                        : 'Chưa có lần quét — bấm Quét danh sách từ Telegram'
                      : 'Chọn tài khoản bên trái để bắt đầu'}
                </p>
              </div>
              <div className="groups-main-head-side">
                {hasSnapshot || hasListData ? (
                  <div className="groups-main-stats" aria-label="Thống kê">
                    <div className="groups-main-stat groups-main-stat--total">
                      <span className="groups-main-stat-value">
                        {loading || loadingSnapshot ? '—' : displayStats.total}
                      </span>
                      <span className="groups-main-stat-label">Tổng</span>
                    </div>
                    <div className="groups-main-stat groups-main-stat--groups">
                      <span className="groups-main-stat-value">
                        {loading || loadingSnapshot ? '—' : displayStats.group}
                      </span>
                      <span className="groups-main-stat-label">Nhóm</span>
                    </div>
                    <div className="groups-main-stat groups-main-stat--channels">
                      <span className="groups-main-stat-value">
                        {loading || loadingSnapshot ? '—' : displayStats.channel}
                      </span>
                      <span className="groups-main-stat-label">Kênh</span>
                    </div>
                    <div className="groups-main-stat groups-main-stat--public">
                      <span className="groups-main-stat-value">
                        {loading || loadingSnapshot || !displayStats.fromList
                          ? '—'
                          : displayStats.public}
                      </span>
                      <span className="groups-main-stat-label">Public</span>
                    </div>
                    <div className="groups-main-stat">
                      <span className="groups-main-stat-value">
                        {loading || loadingSnapshot || !displayStats.fromList
                          ? '—'
                          : displayStats.private}
                      </span>
                      <span className="groups-main-stat-label">Riêng</span>
                    </div>
                  </div>
                ) : null}
                {phone ? (
                  <form
                    className="groups-scan-form"
                    onSubmit={(e) => void handleLoadGroups(e)}
                  >
                    <button
                      type="submit"
                      className="btn btn--primary groups-scan-cta"
                      disabled={loading || loadingSnapshot || !phone}
                    >
                      {loading
                        ? 'Đang quét…'
                        : hasListData || hasSnapshot
                          ? 'Quét lại'
                          : 'Quét danh sách'}
                    </button>
                  </form>
                ) : null}
              </div>
            </header>

            {phone ? (
              <div className="groups-main-controls">
                <div className="groups-controls-meta">
                  <div className="groups-controls-meta-block">
                    <span className="groups-controls-label">Lịch sử quét</span>
                    {scanHistoryLoading ? (
                      <span className="groups-controls-muted">Đang tải…</span>
                    ) : scanHistory.length === 0 ? (
                      <span className="groups-controls-muted">Chưa có bản ghi DB</span>
                    ) : (
                      <ul className="groups-history-chips">
                        {scanHistory.map((scan) => (
                          <li key={scan.id} className="groups-history-chip">
                            <span className="groups-history-chip-count">
                              {scan.group_count}G · {scan.channel_count}K
                            </span>
                            <span className="groups-history-chip-date">
                              {formatDate(scan.scanned_at)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <label className="groups-filter-field groups-filter-field--inline">
                    <span className="groups-controls-label">Sắp xếp</span>
                    <select
                      className="groups-filter-select"
                      value={`${sortKey}:${sortDir}`}
                      onChange={(e) => applySortOption(e.target.value)}
                    >
                      <option value="title:asc">Tên A→Z</option>
                      <option value="title:desc">Tên Z→A</option>
                      <option value="type:asc">Nhóm trước</option>
                      <option value="type:desc">Kênh trước</option>
                    </select>
                  </label>
                  <Link
                    to={`/audit?phone=${encodeURIComponent(phone)}`}
                    className="groups-audit-btn"
                  >
                    Audit
                  </Link>
                </div>

                <div className="groups-controls-toolbar">
                  {hasListData ? (
                    <label className="groups-search-wrap">
                      <span className="groups-search-icon" aria-hidden>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                          <path
                            d="M20 20L16.5 16.5"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                          />
                        </svg>
                      </span>
                      <input
                        type="search"
                        className="groups-list-search"
                        placeholder="Tìm tên, @username, ID…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </label>
                  ) : (
                    <p className="groups-toolbar-hint muted">
                      {hasSnapshot && activeSnapshot
                        ? `DB: ${activeSnapshot.group_count} nhóm · ${activeSnapshot.channel_count} kênh — quét lại để xem chi tiết.`
                        : 'Quét danh sách để tải nhóm/kênh đã join.'}
                    </p>
                  )}

                  {hasListData ? (
                    <div className="groups-filter-strip">
                      <label className="groups-filter-field groups-filter-field--inline">
                        <span className="groups-filter-group-label">Loại</span>
                        <select
                          className="groups-filter-select"
                          value={filter}
                          onChange={(e) => setFilter(e.target.value as KindFilter)}
                        >
                          {KIND_FILTER_OPTIONS.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.label} ({filterCounts[item.id]})
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="groups-filter-field groups-filter-field--inline">
                        <span className="groups-filter-group-label">Hiển thị</span>
                        <select
                          className="groups-filter-select"
                          value={visibilityFilter}
                          onChange={(e) =>
                            setVisibilityFilter(e.target.value as VisibilityFilter)
                          }
                        >
                          {VISIBILITY_FILTER_OPTIONS.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.label} ({visibilityCounts[item.id]})
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  ) : null}

                  <button
                    type="button"
                    className="btn btn--danger btn--sm groups-leave-all-btn"
                    disabled={actionBusy || !hasListData}
                    onClick={() => setLeaveAllConfirm(true)}
                  >
                    Rời toàn bộ
                  </button>
                </div>
              </div>
            ) : null}

            <div className="groups-main-body">
            {loadingSnapshot ? (
              <div className="groups-list-state">
                <span className="groups-loading-dot" aria-hidden />
                <p>Đang tải lần quét gần nhất…</p>
              </div>
            ) : null}

            {loading ? (
              <div className="groups-list-state">
                <span className="groups-loading-dot" aria-hidden />
                <p>Đang quét từ Telegram…</p>
              </div>
            ) : null}

            {!hasListData && !loading && !loadingSnapshot ? (
              <div className="groups-list-state">
                <div className="groups-empty-card">
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
                  <h3>{hasSnapshot ? 'Thống kê lần quét gần nhất' : 'Chưa có lần quét'}</h3>
                  <p className="muted">
                    {hasSnapshot && activeSnapshot
                      ? `${activeSnapshot.total} mục · ${activeSnapshot.group_count} nhóm · ${activeSnapshot.channel_count} kênh${
                          activeSnapshot.scanned_at
                            ? ` · ${formatDate(activeSnapshot.scanned_at)}`
                            : ''
                        }. Bấm Quét lại để xem từng nhóm.`
                      : phone
                        ? 'Acc này chưa có bản ghi quét trong DB.'
                        : 'Chọn tài khoản bên trái để xem thống kê.'}
                  </p>
                  {phone ? (
                    <button
                      type="button"
                      className="btn btn--primary"
                      disabled={loading || loadingSnapshot}
                      onClick={() => void handleLoadGroups()}
                    >
                      {hasSnapshot ? 'Quét lại' : 'Quét danh sách'}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {hasListData && filteredGroups.length === 0 && !loading ? (
              <div className="groups-list-state groups-list-state--compact">
                <h3>Không khớp bộ lọc</h3>
                <p className="muted">Thử từ khóa hoặc loại khác.</p>
              </div>
            ) : null}

            {hasListData && pagedGroups.length > 0 ? (
              <ul className="groups-list groups-list--cards">
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

            {hasListData && pagedGroups.length > 0 ? (
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
                {activeGroups.length > 0 ? ` (${activeGroups.length} mục đang hiển thị)` : ''} của
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