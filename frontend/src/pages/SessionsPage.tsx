import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './SessionsPage.css'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { AddAccountModal } from '../components/AddAccountModal'
import { Alert } from '../components/Alert'
import { ConfirmModal } from '../components/ConfirmModal'
import { Pagination } from '../components/Pagination'
import { SessionAvatar } from '../components/SessionAvatar'
import { SessionDetailModal } from '../components/SessionDetailModal'
import { StatusBadge } from '../components/StatusBadge'
import { usePagination } from '../hooks/usePagination'
import type {
  CheckSessionItem,
  SessionDetailData,
  SessionMeData,
  SessionMetaOverviewItem,
} from '../types/api'
import { formatDate, formatRelativeDate } from '../utils/format'
import {
  buildMetaByPhone,
  formatUsername,
  getMetaForPhone,
  phoneLookupKeys,
} from '../utils/sessionDisplay'

type SessionDisplaySource = 'check' | 'db' | null
type SessionStatusFilter = 'all' | 'active' | 'unauthorized' | 'error' | 'unchecked'
type SessionSortKey = 'phone' | 'name' | 'status' | 'checked'
type SessionSortDir = 'asc' | 'desc'

const STATUS_FILTER_OPTIONS: { id: SessionStatusFilter; label: string }[] = [
  { id: 'all', label: 'Tất cả' },
  { id: 'active', label: 'Active' },
  { id: 'unauthorized', label: 'Unauthorized' },
  { id: 'error', label: 'Lỗi' },
  { id: 'unchecked', label: 'Chưa check' },
]

const SORT_DROPDOWN_OPTIONS: { value: `${SessionSortKey}:${SessionSortDir}`; label: string }[] = [
  { value: 'checked:desc', label: 'Kiểm tra — mới nhất' },
  { value: 'checked:asc', label: 'Kiểm tra — cũ nhất' },
  { value: 'phone:asc', label: 'Số ĐT — A→Z' },
  { value: 'phone:desc', label: 'Số ĐT — Z→A' },
  { value: 'name:asc', label: 'Tên — A→Z' },
  { value: 'name:desc', label: 'Tên — Z→A' },
  { value: 'status:asc', label: 'Trạng thái — A→Z' },
  { value: 'status:desc', label: 'Trạng thái — Z→A' },
]

const STATUS_SORT_ORDER: Record<string, number> = {
  active: 0,
  unauthorized: 1,
  error: 2,
  '': 3,
}

interface SessionDisplayInfo {
  status: string | null
  username: string | null
  syncedAt: string | null
  source: SessionDisplaySource
}

function resolveSyncedAt(
  checked: CheckSessionItem | undefined,
  meta: SessionMetaOverviewItem | undefined,
): string | null {
  return checked?.last_synced_at ?? meta?.last_synced_at ?? meta?.imported_at ?? null
}

function resolveSessionDisplay(
  checked: CheckSessionItem | undefined,
  meta: SessionMetaOverviewItem | undefined,
): SessionDisplayInfo {
  const syncedAt = resolveSyncedAt(checked, meta)
  if (checked) {
    return {
      status: checked.status,
      username: checked.username,
      syncedAt,
      source: 'check',
    }
  }
  if (meta?.status && meta.status !== 'unknown') {
    return {
      status: meta.status,
      username: meta.username,
      syncedAt,
      source: 'db',
    }
  }
  return {
    status: null,
    username: meta?.username ?? null,
    syncedAt,
    source: syncedAt ? 'db' : null,
  }
}

function resolveAccountLabel(
  meta: SessionMetaOverviewItem | undefined,
  display: SessionDisplayInfo,
): { primary: string; secondary: string | null } {
  const displayName = meta?.display_name?.trim() || null
  const username = formatUsername(display.username)
  if (displayName && username) {
    return { primary: displayName, secondary: username }
  }
  if (displayName) return { primary: displayName, secondary: null }
  if (username) return { primary: username, secondary: null }
  return { primary: '—', secondary: null }
}

function sessionMatchesFilter(
  filter: SessionStatusFilter,
  checked: CheckSessionItem | undefined,
  meta: SessionMetaOverviewItem | undefined,
): boolean {
  if (filter === 'all') return true
  const { status } = resolveSessionDisplay(checked, meta)
  if (filter === 'unchecked') return !status
  return status === filter
}

function accountSortName(
  meta: SessionMetaOverviewItem | undefined,
  display: SessionDisplayInfo,
): string {
  const label = resolveAccountLabel(meta, display)
  if (label.primary !== '—') return label.primary.toLowerCase()
  return label.secondary?.toLowerCase() ?? ''
}

function sessionAvatarLabel(
  meta: SessionMetaOverviewItem | undefined,
  display: SessionDisplayInfo,
): string {
  const name = meta?.display_name?.trim()
  if (name) return name
  const username = display.username?.replace(/^@/, '').trim()
  if (username) return username
  return ''
}

function sortSessions(
  phones: string[],
  sortKey: SessionSortKey,
  sortDir: SessionSortDir,
  resultByPhone: Map<string, CheckSessionItem>,
  metaByPhone: Map<string, SessionMetaOverviewItem>,
): string[] {
  const dir = sortDir === 'asc' ? 1 : -1
  return [...phones].sort((a, b) => {
    const metaA = getMetaForPhone(a, metaByPhone)
    const metaB = getMetaForPhone(b, metaByPhone)
    const checkedA = resultByPhone.get(a)
    const checkedB = resultByPhone.get(b)
    const displayA = resolveSessionDisplay(checkedA, metaA)
    const displayB = resolveSessionDisplay(checkedB, metaB)

    let cmp = 0
    if (sortKey === 'phone') {
      cmp = a.localeCompare(b, 'vi')
    } else if (sortKey === 'name') {
      cmp = accountSortName(metaA, displayA).localeCompare(accountSortName(metaB, displayB), 'vi')
    } else if (sortKey === 'status') {
      const orderA = STATUS_SORT_ORDER[displayA.status ?? ''] ?? 3
      const orderB = STATUS_SORT_ORDER[displayB.status ?? ''] ?? 3
      cmp = orderA - orderB
    } else {
      const timeA = displayA.syncedAt ? new Date(displayA.syncedAt).getTime() : 0
      const timeB = displayB.syncedAt ? new Date(displayB.syncedAt).getTime() : 0
      cmp = timeA - timeB
    }
    if (cmp === 0) cmp = a.localeCompare(b, 'vi')
    return cmp * dir
  })
}

function sessionMatchesSearch(
  phone: string,
  query: string,
  checked: CheckSessionItem | undefined,
  meta: SessionMetaOverviewItem | undefined,
): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const fields = [
    phone,
    checked?.username ?? '',
    meta?.username ?? '',
    meta?.display_name ?? '',
  ]
  return fields.some((field) => field.toLowerCase().includes(q))
}

function formatLastChecked(display: SessionDisplayInfo): { label: string; title?: string } {
  if (display.syncedAt) {
    return {
      label: formatRelativeDate(display.syncedAt),
      title: formatDate(display.syncedAt),
    }
  }
  if (display.source === 'check') {
    return { label: 'Vừa xong', title: 'Vừa kiểm tra trong phiên này' }
  }
  return { label: '—' }
}

function patchMetaAfterCheck(
  prev: Map<string, SessionMetaOverviewItem>,
  item: CheckSessionItem,
): Map<string, SessionMetaOverviewItem> {
  if (!item.last_synced_at) return prev
  const next = new Map(prev)
  const existing = getMetaForPhone(item.phone, prev)
  const updated: SessionMetaOverviewItem = {
    phone: item.phone,
    username: item.username ?? existing?.username ?? null,
    display_name: existing?.display_name ?? null,
    status: item.status,
    source: existing?.source ?? 'imported',
    imported_at: existing?.imported_at ?? item.last_synced_at,
    last_synced_at: item.last_synced_at,
    last_group_scan: existing?.last_group_scan ?? null,
    has_avatar: existing?.has_avatar ?? false,
    avatar_updated_at: existing?.avatar_updated_at ?? null,
  }
  for (const key of phoneLookupKeys(item.phone)) {
    next.set(key, updated)
  }
  return next
}

function sortCheckLogItems(items: CheckSessionItem[]): CheckSessionItem[] {
  return [...items].sort((a, b) => {
    const orderA = STATUS_SORT_ORDER[a.status] ?? 3
    const orderB = STATUS_SORT_ORDER[b.status] ?? 3
    if (orderA !== orderB) return orderA - orderB
    return a.phone.localeCompare(b.phone, 'vi')
  })
}

function calcCheckLogStats(items: CheckSessionItem[]) {
  let active = 0
  let unauthorized = 0
  let error = 0
  for (const item of items) {
    if (item.status === 'active') active += 1
    else if (item.status === 'unauthorized') unauthorized += 1
    else if (item.status === 'error') error += 1
  }
  return { active, unauthorized, error, total: items.length }
}

function calcStats(
  phones: string[],
  resultByPhone: Map<string, CheckSessionItem>,
  metaByPhone: Map<string, SessionMetaOverviewItem>,
) {
  let active = 0
  let unauthorized = 0
  let error = 0
  for (const phone of phones) {
    const { status } = resolveSessionDisplay(
      resultByPhone.get(phone),
      getMetaForPhone(phone, metaByPhone),
    )
    if (status === 'active') active += 1
    else if (status === 'unauthorized') unauthorized += 1
    else if (status === 'error') error += 1
  }
  return { active, unauthorized, error }
}

export function SessionsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [sessions, setSessions] = useState<string[]>([])
  const [total, setTotal] = useState(0)
  const [checkResults, setCheckResults] = useState<CheckSessionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)
  const [checkingPhone, setCheckingPhone] = useState<string | null>(null)
  const [deletingPhone, setDeletingPhone] = useState<string | null>(null)
  const [deleteConfirmPhone, setDeleteConfirmPhone] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null)
  const [detailData, setDetailData] = useState<SessionDetailData | null>(null)
  const [meData, setMeData] = useState<SessionMeData | null>(null)
  const [modalLoading, setModalLoading] = useState(false)
  const [metaByPhone, setMetaByPhone] = useState<Map<string, SessionMetaOverviewItem>>(
    new Map(),
  )
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<SessionStatusFilter>('all')
  const [sortKey, setSortKey] = useState<SessionSortKey>('checked')
  const [sortDir, setSortDir] = useState<SessionSortDir>('desc')
  const [checkLogVisible, setCheckLogVisible] = useState(false)
  const [lastCheckAt, setLastCheckAt] = useState<string | null>(null)
  const [checkTotal, setCheckTotal] = useState(0)
  const [showAddAccount, setShowAddAccount] = useState(
    () => searchParams.get('add') === '1',
  )
  const checkAbortRef = useRef(false)
  const checkRequestRef = useRef<AbortController | null>(null)
  const urlPhoneDismissedRef = useRef(false)

  const loadMetadata = useCallback(async () => {
    try {
      const res = await api.listSessionMetaOverview()
      if (!res.success || !res.data?.database_enabled) {
        setMetaByPhone(new Map())
        return
      }
      setMetaByPhone(buildMetaByPhone(res.data.items))
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

  useEffect(() => {
    const phoneParam = searchParams.get('phone')?.trim()

    if (!phoneParam) {
      urlPhoneDismissedRef.current = false
      return
    }

    if (urlPhoneDismissedRef.current || loading || selectedPhone === phoneParam) return
    if (sessions.includes(phoneParam)) {
      void handleViewDetail(phoneParam)
    }
  }, [searchParams, sessions, loading, selectedPhone])

  useEffect(() => {
    if (!success) return
    const timer = window.setTimeout(() => setSuccess(''), 4000)
    return () => window.clearTimeout(timer)
  }, [success])

  useEffect(() => {
    const shouldOpen = searchParams.get('add') === '1'
    setShowAddAccount(shouldOpen)
  }, [searchParams])

  function openAddAccount() {
    setShowAddAccount(true)
    const next = new URLSearchParams(searchParams)
    next.set('add', '1')
    setSearchParams(next, { replace: true })
  }

  function closeAddAccount() {
    setShowAddAccount(false)
    const next = new URLSearchParams(searchParams)
    next.delete('add')
    setSearchParams(next, { replace: true })
  }

  function handleAccountAdded(phone: string) {
    void loadSessions()
    void loadMetadata()
    setSuccess(`Đã thêm session ${phone}`)
  }

  function handleStopCheck() {
    checkAbortRef.current = true
    checkRequestRef.current?.abort()
  }

  async function handleCheckAll() {
    const phonesToCheck = [...sessions]
    if (phonesToCheck.length === 0) return

    setChecking(true)
    setCheckLogVisible(true)
    setCheckResults([])
    setLastCheckAt(null)
    setCheckTotal(phonesToCheck.length)
    setError('')
    setSuccess('')
    checkAbortRef.current = false
    checkRequestRef.current = null

    const collected: CheckSessionItem[] = []
    let active = 0
    let unauthorized = 0
    let errorCount = 0
    let stopped = false

    try {
      for (const phone of phonesToCheck) {
        if (checkAbortRef.current) {
          stopped = true
          break
        }

        const controller = new AbortController()
        checkRequestRef.current = controller

        try {
          const res = await api.checkSessions([phone], controller.signal)
          if (checkAbortRef.current) {
            stopped = true
            break
          }
          if (!res.success || !res.data) {
            setError(res.error ?? 'Kiểm tra session thất bại')
            break
          }

          const item = res.data.sessions[0]
          if (!item) continue

          collected.push(item)
          setCheckResults([...collected])
          setMetaByPhone((prev) => patchMetaAfterCheck(prev, item))

          if (item.status === 'active') active += 1
          else if (item.status === 'unauthorized') unauthorized += 1
          else if (item.status === 'error') errorCount += 1
        } catch (err) {
          if (checkAbortRef.current || isAbortError(err)) {
            stopped = true
            break
          }
          throw err
        } finally {
          if (checkRequestRef.current === controller) {
            checkRequestRef.current = null
          }
        }
      }

      if (collected.length > 0) {
        setLastCheckAt(new Date().toISOString())
        void loadMetadata()
      }

      if (stopped) {
        setSuccess(
          collected.length > 0
            ? `Đã dừng — ${collected.length}/${phonesToCheck.length} session đã kiểm tra`
            : 'Đã dừng kiểm tra',
        )
      } else if (collected.length > 0) {
        setSuccess(
          `Kiểm tra xong — ${active} active, ${unauthorized} unauthorized, ${errorCount} lỗi`,
        )
      }
    } catch {
      setError('Không kết nối được API khi kiểm tra session.')
    } finally {
      checkRequestRef.current = null
      setChecking(false)
    }
  }

  function isAbortError(err: unknown): boolean {
    return err instanceof Error && err.name === 'AbortError'
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
      setCheckResults((prev) => [
        ...prev.filter((row) => row.phone !== phone),
        item,
      ])
      setMetaByPhone((prev) => patchMetaAfterCheck(prev, item))
      void loadMetadata()
      if (selectedPhone === phone) {
        const meRes = await api.getSessionMe(phone)
        if (meRes.success && meRes.data) {
          setMeData(meRes.data)
        }
      }
    } catch {
      setError('Không kết nối được API khi kiểm tra session.')
    } finally {
      setCheckingPhone(null)
    }
  }

  async function handleViewDetail(phone: string) {
    urlPhoneDismissedRef.current = false
    setSelectedPhone(phone)
    const next = new URLSearchParams(searchParams)
    next.set('phone', phone)
    setSearchParams(next, { replace: true })
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
          about: '',
          has_avatar: false,
          message: meRes.error ?? 'Không lấy được thông tin tài khoản',
        })
      }
    } catch {
      setError('Lỗi kết nối API khi tải chi tiết.')
    } finally {
      setModalLoading(false)
    }
  }

  async function handleRefreshDetail(phone: string) {
    try {
      const [detailRes, meRes] = await Promise.all([
        api.getSession(phone),
        api.getSessionMe(phone),
      ])
      if (detailRes.success && detailRes.data) {
        setDetailData(detailRes.data)
      }
      if (meRes.success && meRes.data) {
        setMeData(meRes.data)
      }
      void loadMetadata()
    } catch {
      setError('Không tải lại được chi tiết session.')
    }
  }

  function requestDelete(phone: string) {
    setDeleteConfirmPhone(phone)
  }

  async function confirmDelete() {
    const phone = deleteConfirmPhone
    if (!phone) return

    setDeletingPhone(phone)
    setError('')
    setSuccess('')
    try {
      const res = await api.deleteSession(phone)
      if (!res.success || !res.data) {
        setError(res.error ?? 'Xóa khỏi tool thất bại')
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
      setDeleteConfirmPhone(null)
    }
  }

  function closeModal() {
    urlPhoneDismissedRef.current = true
    setSelectedPhone(null)
    setDetailData(null)
    setMeData(null)
    const next = new URLSearchParams(searchParams)
    next.delete('phone')
    setSearchParams(next, { replace: true })
  }

  const resultByPhone = useMemo(
    () => new Map(checkResults.map((item) => [item.phone, item])),
    [checkResults],
  )

  const stats = useMemo(
    () => calcStats(sessions, resultByPhone, metaByPhone),
    [sessions, resultByPhone, metaByPhone],
  )

  const hasStatusData = checkResults.length > 0 || metaByPhone.size > 0

  const searchMatchedSessions = useMemo(
    () =>
      sessions.filter((phone) =>
        sessionMatchesSearch(
          phone,
          search,
          resultByPhone.get(phone),
          getMetaForPhone(phone, metaByPhone),
        ),
      ),
    [sessions, search, resultByPhone, metaByPhone],
  )

  const filterCounts = useMemo(() => {
    const counts: Record<SessionStatusFilter, number> = {
      all: 0,
      active: 0,
      unauthorized: 0,
      error: 0,
      unchecked: 0,
    }
    for (const phone of searchMatchedSessions) {
      counts.all += 1
      const display = resolveSessionDisplay(
        resultByPhone.get(phone),
        getMetaForPhone(phone, metaByPhone),
      )
      if (!display.status) {
        counts.unchecked += 1
        continue
      }
      if (display.status === 'active') counts.active += 1
      else if (display.status === 'unauthorized') counts.unauthorized += 1
      else if (display.status === 'error') counts.error += 1
    }
    return counts
  }, [searchMatchedSessions, resultByPhone, metaByPhone])

  const filteredSessions = useMemo(() => {
    const filtered = searchMatchedSessions.filter((phone) =>
      sessionMatchesFilter(
        statusFilter,
        resultByPhone.get(phone),
        getMetaForPhone(phone, metaByPhone),
      ),
    )
    return sortSessions(filtered, sortKey, sortDir, resultByPhone, metaByPhone)
  }, [
    searchMatchedSessions,
    statusFilter,
    sortKey,
    sortDir,
    resultByPhone,
    metaByPhone,
  ])

  const sortValue = `${sortKey}:${sortDir}` as `${SessionSortKey}:${SessionSortDir}`
  const hasActiveFilters =
    Boolean(search.trim()) ||
    statusFilter !== 'all' ||
    sortKey !== 'checked' ||
    sortDir !== 'desc'

  const checkLogItems = useMemo(() => sortCheckLogItems(checkResults), [checkResults])
  const checkLogStats = useMemo(() => calcCheckLogStats(checkResults), [checkResults])
  const showCheckLog = checkLogVisible && (checking || checkResults.length > 0)

  function handleSortChange(value: string) {
    const [key, dir] = value.split(':') as [SessionSortKey, SessionSortDir]
    setSortKey(key)
    setSortDir(dir)
  }

  function clearFilters() {
    setSearch('')
    setStatusFilter('all')
    setSortKey('checked')
    setSortDir('desc')
  }

  const {
    items: pagedSessions,
    page,
    setPage,
    totalPages,
    from,
    to,
    pageSize,
    setPageSize,
  } = usePagination(filteredSessions, 10)

  return (
    <div className="page page--sessions">
      <header className="page-header sessions-page-header">
        <div>
          <h1>Sessions</h1>
          <p className="page-desc">
            Quản lý file <code>.session</code>, kiểm tra trạng thái và đồng bộ metadata DB.
          </p>
        </div>
        <div className="sessions-page-actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={openAddAccount}
            disabled={checking || showAddAccount}
          >
            Thêm tài khoản
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              void loadSessions()
              void loadMetadata()
            }}
            disabled={loading || checking}
          >
            {loading ? 'Đang tải…' : 'Làm mới'}
          </button>
          {checking ? (
            <>
              <button type="button" className="btn btn--primary" disabled>
                {checkTotal > 0
                  ? `Đang kiểm tra ${checkResults.length}/${checkTotal}…`
                  : 'Đang kiểm tra…'}
              </button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={handleStopCheck}
              >
                Dừng
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn--primary"
              disabled={loading || sessions.length === 0}
              onClick={() => void handleCheckAll()}
            >
              Kiểm tra tất cả
            </button>
          )}
        </div>
      </header>

      <Alert type="error" message={error} />
      <Alert type="success" message={success} />

      <section className="stats-grid sessions-stats">
        <article className="stat-card sessions-stat-card sessions-stat-card--total">
          <p className="stat-label">Tổng session</p>
          <p className="stat-value">{loading ? '—' : total}</p>
          <p className="sessions-stat-foot">Trên disk</p>
        </article>
        <article className="stat-card sessions-stat-card sessions-stat-card--active">
          <p className="stat-label">Active</p>
          <p className="stat-value">{hasStatusData ? stats.active : '—'}</p>
          <p className="sessions-stat-foot">Live</p>
        </article>
        <article className="stat-card sessions-stat-card sessions-stat-card--warn">
          <p className="stat-label">Unauthorized</p>
          <p className="stat-value">{hasStatusData ? stats.unauthorized : '—'}</p>
          <p className="sessions-stat-foot">Hết hạn</p>
        </article>
        <article className="stat-card sessions-stat-card sessions-stat-card--error">
          <p className="stat-label">Lỗi</p>
          <p className="stat-value">{hasStatusData ? stats.error : '—'}</p>
          <p className="sessions-stat-foot">Cần xử lý</p>
        </article>
      </section>

      {showCheckLog ? (
        <section className="panel sessions-check-log">
          <div className="sessions-check-log-head">
            <div>
              <h2>Kết quả kiểm tra</h2>
              <p className="panel-meta">
                {checking
                  ? checkTotal > 0
                    ? `Tiến trình ${checkResults.length}/${checkTotal}`
                    : 'Đang kiểm tra từng session…'
                  : lastCheckAt
                    ? `${checkLogStats.total} session · ${formatDate(lastCheckAt)}`
                    : `${checkLogStats.total} session`}
              </p>
            </div>
            <div className="sessions-check-log-actions">
              {checking ? (
                <button
                  type="button"
                  className="btn btn--danger btn--sm"
                  onClick={handleStopCheck}
                >
                  Dừng
                </button>
              ) : null}
              {!checking && checkResults.length > 0 ? (
                <div className="sessions-check-log-chips">
                  <span className="sessions-check-log-chip sessions-check-log-chip--success">
                    {checkLogStats.active} active
                  </span>
                  {checkLogStats.unauthorized > 0 ? (
                    <span className="sessions-check-log-chip sessions-check-log-chip--warn">
                      {checkLogStats.unauthorized} unauthorized
                    </span>
                  ) : null}
                  {checkLogStats.error > 0 ? (
                    <span className="sessions-check-log-chip sessions-check-log-chip--error">
                      {checkLogStats.error} lỗi
                    </span>
                  ) : null}
                </div>
              ) : null}
              {!checking ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => setCheckLogVisible(false)}
                >
                  Đóng
                </button>
              ) : null}
            </div>
          </div>

          {checking && checkResults.length === 0 ? (
            <div className="sessions-check-log-loading">
              <span className="sessions-check-log-spinner" aria-hidden />
              <span>Đang kết nối Telegram và kiểm tra session…</span>
            </div>
          ) : checkResults.length > 0 ? (
            <div className="table-wrap sessions-check-log-table-wrap">
              <table className="data-table sessions-check-log-table">
                <thead>
                  <tr>
                    <th>Số điện thoại</th>
                    <th>Trạng thái</th>
                    <th>Username</th>
                    <th>Thông báo</th>
                    <th>Thời gian</th>
                  </tr>
                </thead>
                <tbody>
                  {checkLogItems.map((item) => (
                    <tr
                      key={item.phone}
                      className={`sessions-check-log-row sessions-check-log-row--${item.status}`}
                    >
                      <td>
                        <span className="phone">{item.phone}</span>
                      </td>
                      <td>
                        <StatusBadge status={item.status} />
                      </td>
                      <td>{formatUsername(item.username) ?? '—'}</td>
                      <td>
                        <span
                          className={`sessions-check-log-message${item.message ? '' : ' muted'}`}
                          title={item.message ?? undefined}
                        >
                          {item.message?.trim() || '—'}
                        </span>
                      </td>
                      <td>
                        <span className="session-last-checked">
                          {item.last_synced_at
                            ? formatRelativeDate(item.last_synced_at)
                            : '—'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {checking ? (
                <div className="sessions-check-log-progress">
                  <span className="sessions-check-log-spinner" aria-hidden />
                  <span>
                    Đang kiểm tra{' '}
                    {checkTotal > 0
                      ? `${checkResults.length + 1}/${checkTotal}`
                      : 'session tiếp theo'}
                    …
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="panel sessions-panel">
        <div className="sessions-list-head">
          <div>
            <h2>Danh sách account</h2>
            <p className="panel-meta">
              {!loading
                ? hasActiveFilters
                  ? `${filteredSessions.length} / ${sessions.length} session`
                  : `${sessions.length} session`
                : 'Đang tải…'}
            </p>
          </div>
          {!loading && sessions.length > 0 ? (
            <span className="sessions-count-badge">{filteredSessions.length}</span>
          ) : null}
        </div>

        {!loading && sessions.length > 0 ? (
          <div className="sessions-list-toolbar">
            <input
              type="search"
              className="sessions-list-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm số điện thoại, tên hoặc @username…"
              autoComplete="off"
            />

            <div className="sessions-toolbar-filters">
              <label className="sessions-toolbar-field">
                <span className="sessions-toolbar-label">Trạng thái</span>
                <select
                  className="sessions-toolbar-select"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as SessionStatusFilter)}
                  aria-label="Lọc theo trạng thái"
                >
                  {STATUS_FILTER_OPTIONS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label} ({filterCounts[item.id]})
                    </option>
                  ))}
                </select>
              </label>

              <label className="sessions-toolbar-field">
                <span className="sessions-toolbar-label">Sắp xếp</span>
                <select
                  className="sessions-toolbar-select"
                  value={sortValue}
                  onChange={(e) => handleSortChange(e.target.value)}
                  aria-label="Sắp xếp danh sách"
                >
                  {SORT_DROPDOWN_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>

              {hasActiveFilters ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm sessions-clear-filters"
                  onClick={clearFilters}
                >
                  Xóa bộ lọc
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {loading ? (
          <div className="empty-state">Đang tải…</div>
        ) : sessions.length === 0 ? (
          <div className="empty-state sessions-empty-add">
            <p>Chưa có session nào.</p>
            <p>Thêm tài khoản Telegram để tạo file <code>.session</code> đầu tiên.</p>
            {!showAddAccount ? (
              <button type="button" className="btn btn--primary" onClick={openAddAccount}>
                Thêm tài khoản
              </button>
            ) : null}
          </div>
        ) : filteredSessions.length === 0 ? (
          <div className="empty-state sessions-empty-filter">
            <p>Không có session nào khớp bộ lọc hiện tại.</p>
            <button type="button" className="btn btn--ghost btn--sm" onClick={clearFilters}>
              Xóa bộ lọc
            </button>
          </div>
        ) : (
          <div className="table-wrap sessions-table-wrap">
            <table className="data-table sessions-table">
              <thead>
                <tr>
                  <th>Số điện thoại</th>
                  <th>Trạng thái</th>
                  <th>Tên / Username</th>
                  <th>Kiểm tra gần nhất</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pagedSessions.map((phone) => {
                  const checked = resultByPhone.get(phone)
                  const meta = getMetaForPhone(phone, metaByPhone)
                  const display = resolveSessionDisplay(checked, meta)
                  const isDeleting = deletingPhone === phone
                  const isChecking = checkingPhone === phone
                  const lastChecked = formatLastChecked(display)
                  const account = resolveAccountLabel(meta, display)
                  const statusTitle =
                    display.source === 'db'
                      ? 'Trạng thái từ DB'
                      : display.source === 'check'
                        ? 'Vừa kiểm tra'
                        : undefined
                  const rowStatus = display.status ?? 'unchecked'
                  return (
                    <tr
                      key={phone}
                      className={`sessions-row sessions-row--${rowStatus}`}
                    >
                      <td>
                        <div className="sessions-phone-cell">
                          <SessionAvatar
                            phone={phone}
                            label={sessionAvatarLabel(meta, display)}
                            hasAvatar={meta?.has_avatar}
                            avatarUpdatedAt={meta?.avatar_updated_at}
                          />
                          <span className="phone">{phone}</span>
                        </div>
                      </td>
                      <td>
                        {display.status ? (
                          <span className="session-status-cell" title={statusTitle}>
                            <StatusBadge status={display.status} />
                            {display.source === 'db' ? (
                              <span className="session-status-source muted">DB</span>
                            ) : null}
                          </span>
                        ) : (
                          <span className="muted">Chưa kiểm tra</span>
                        )}
                      </td>
                      <td>
                        <div className="session-account-cell">
                          <span className="session-account-primary">{account.primary}</span>
                          {account.secondary ? (
                            <span className="session-account-secondary muted">
                              {account.secondary}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td>
                        <span
                          className={`session-last-checked${lastChecked.label === '—' ? ' muted' : ''}`}
                          title={lastChecked.title}
                        >
                          {lastChecked.label}
                        </span>
                      </td>
                      <td className="cell-actions sessions-actions">
                        <button
                          type="button"
                          className="btn btn--sm btn--ghost"
                          disabled={isChecking || checking}
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
                          className="btn btn--sm btn--danger btn--icon-text"
                          disabled={isDeleting}
                          onClick={() => requestDelete(phone)}
                          title="Xóa khỏi tool"
                        >
                          {isDeleting ? '…' : 'Xóa'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && filteredSessions.length > 0 && (
          <Pagination
            page={page}
            totalPages={totalPages}
            total={filteredSessions.length}
            from={from}
            to={to}
            onPageChange={setPage}
            pageSize={pageSize}
            pageSizeOptions={[10, 20, 50]}
            onPageSizeChange={setPageSize}
          />
        )}
      </section>

      {showAddAccount ? (
        <AddAccountModal onClose={closeAddAccount} onSuccess={handleAccountAdded} />
      ) : null}

      {selectedPhone ? (
        <SessionDetailModal
          phone={selectedPhone}
          loading={modalLoading}
          detailData={detailData}
          meData={meData}
          deleting={deletingPhone === selectedPhone}
          deleteConfirmOpen={deleteConfirmPhone === selectedPhone}
          onClose={closeModal}
          onDelete={requestDelete}
          onRecheck={(phone) => void handleCheckOne(phone)}
          rechecking={checkingPhone === selectedPhone}
          onProfileUpdated={() => void handleRefreshDetail(selectedPhone)}
        />
      ) : null}

      <ConfirmModal
        open={Boolean(deleteConfirmPhone)}
        title="Xóa khỏi tool?"
        description={
          deleteConfirmPhone ? (
            <>
              Account{' '}
              <strong className="confirm-modal-phone">{deleteConfirmPhone}</strong> sẽ bị gỡ
              khỏi tool.
            </>
          ) : null
        }
        details={[
          'File .session và pending_auth trên máy chủ sẽ bị xóa',
          'Không đăng xuất thiết bị trên Telegram',
        ]}
        confirmLabel="Xóa khỏi tool"
        loading={Boolean(deleteConfirmPhone && deletingPhone === deleteConfirmPhone)}
        onConfirm={() => void confirmDelete()}
        onCancel={() => {
          if (deletingPhone) return
          setDeleteConfirmPhone(null)
        }}
      />
    </div>
  )
}