import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import './ProxyPage.css'
import { api } from '../api/client'
import { Alert } from '../components/Alert'
import { ConfirmModal } from '../components/ConfirmModal'
import { SessionAvatar } from '../components/SessionAvatar'
import { StatusBadge } from '../components/StatusBadge'
import { useSessionAccounts } from '../hooks/useSessionAccounts'
import type { ProxyItem, SessionMetaOverviewItem } from '../types/api'
import {
  ACCOUNT_STATUS_FILTER_OPTIONS,
  accountMatchesSearch,
  accountMatchesStatusFilter,
  resolveAccountPickerLabels,
  resolveAccountStatus,
  type AccountStatusFilter,
} from '../utils/accountPicker'
import { resolveSessionName } from '../utils/sessionDisplay'

type ProxyLinkFilter = 'all' | 'proxied' | 'unproxied' | `proxy:${number}`

type ProxyFormState = {
  name: string
  proxy_type: string
  host: string
  port: string
  username: string
  password: string
  secret: string
  enabled: boolean
}

const EMPTY_FORM: ProxyFormState = {
  name: '',
  proxy_type: 'socks5',
  host: '',
  port: '1080',
  username: '',
  password: '',
  secret: '',
  enabled: true,
}

type AccountRow = {
  phone: string
  meta: SessionMetaOverviewItem | undefined
  labels: { primary: string; secondary: string | null }
  avatarLabel: string
  status: string | null
  proxyId: number | null
  proxy: ProxyItem | null
}

function typeLabel(type: string): string {
  if (type === 'socks5') return 'SOCKS5'
  if (type === 'http') return 'HTTP'
  if (type === 'mtproto') return 'MTProto'
  return type.toUpperCase()
}

function statusLabel(status: string | null | undefined): string {
  if (status === 'ok') return 'OK'
  if (status === 'fail') return 'Lỗi'
  return '—'
}

/** Parse lines: host:port | host:port:user:pass | type|host|port|user|pass */
export function parseProxyImportLines(raw: string): {
  items: Array<{
    name: string
    proxy_type: string
    host: string
    port: number
    username?: string
    password?: string
  }>
  errors: string[]
} {
  const items: Array<{
    name: string
    proxy_type: string
    host: string
    port: number
    username?: string
    password?: string
  }> = []
  const errors: string[] = []
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))

  lines.forEach((line, index) => {
    let proxy_type = 'socks5'
    let host = ''
    let port = 0
    let username: string | undefined
    let password: string | undefined

    if (line.includes('|')) {
      const parts = line.split('|').map((p) => p.trim())
      if (parts.length < 3) {
        errors.push(`Dòng ${index + 1}: thiếu type|host|port`)
        return
      }
      proxy_type = (parts[0] || 'socks5').toLowerCase()
      host = parts[1] || ''
      port = Number(parts[2])
      username = parts[3] || undefined
      password = parts[4] || undefined
    } else {
      const parts = line.split(':').map((p) => p.trim())
      if (parts.length < 2) {
        errors.push(`Dòng ${index + 1}: cần host:port`)
        return
      }
      host = parts[0] || ''
      port = Number(parts[1])
      if (parts.length >= 4) {
        username = parts[2] || undefined
        password = parts.slice(3).join(':') || undefined
      } else if (parts.length === 3) {
        username = parts[2] || undefined
      }
    }

    if (!host || !Number.isFinite(port) || port < 1 || port > 65535) {
      errors.push(`Dòng ${index + 1}: host/port không hợp lệ`)
      return
    }
    if (!['socks5', 'http', 'mtproto'].includes(proxy_type)) {
      proxy_type = 'socks5'
    }
    items.push({
      name: `${host}:${port}`,
      proxy_type,
      host,
      port,
      username,
      password,
    })
  })

  return { items, errors }
}

export function ProxyPage() {
  const {
    sessions,
    loading: accountsLoading,
    reload: reloadAccounts,
    getMeta,
  } = useSessionAccounts()

  const [proxies, setProxies] = useState<ProxyItem[]>([])
  const [assignmentMap, setAssignmentMap] = useState<Record<string, number>>({})
  const [databaseEnabled, setDatabaseEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [statusFilter, setStatusFilter] = useState<AccountStatusFilter>('all')
  const [proxyFilter, setProxyFilter] = useState<ProxyLinkFilter>('all')
  const [search, setSearch] = useState('')
  const [selectedPhones, setSelectedPhones] = useState<Set<string>>(() => new Set())
  const [activePhone, setActivePhone] = useState<string | null>(null)

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerProxyId, setDrawerProxyId] = useState<string>('')
  const [checkingPhone, setCheckingPhone] = useState<string | null>(null)
  const [checkingProxyId, setCheckingProxyId] = useState<number | null>(null)
  const [testingAllProxies, setTestingAllProxies] = useState(false)

  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [form, setForm] = useState<ProxyFormState>(EMPTY_FORM)
  const [importText, setImportText] = useState('')
  const [deleteProxyId, setDeleteProxyId] = useState<number | null>(null)
  const [bulkProxyId, setBulkProxyId] = useState('')
  /** same = mọi acc 1 proxy; distribute = chia đều pool (round-robin) */
  const [bulkMode, setBulkMode] = useState<'same' | 'distribute'>('distribute')

  const proxyById = useMemo(() => {
    const map = new Map<number, ProxyItem>()
    for (const p of proxies) map.set(p.id, p)
    return map
  }, [proxies])

  const rows: AccountRow[] = useMemo(() => {
    return sessions.map((phone) => {
      const meta = getMeta(phone)
      const labels = resolveAccountPickerLabels(phone, meta)
      const avatarLabel = resolveSessionName(meta) || labels.primary
      const proxyId = assignmentMap[phone] ?? null
      const proxy = proxyId != null ? proxyById.get(proxyId) ?? null : null
      return {
        phone,
        meta,
        labels,
        avatarLabel,
        status: resolveAccountStatus(meta),
        proxyId,
        proxy,
      }
    })
  }, [sessions, assignmentMap, proxyById, getMeta])

  const counts = useMemo(() => {
    let proxied = 0
    let unproxied = 0
    let live = 0
    for (const row of rows) {
      if (row.proxyId != null) proxied += 1
      else unproxied += 1
      if (row.status === 'active') live += 1
    }
    return { total: rows.length, proxied, unproxied, live, proxies: proxies.length }
  }, [rows, proxies.length])

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (!accountMatchesSearch(row.phone, search, row.meta)) return false
      if (!accountMatchesStatusFilter(statusFilter, row.meta)) return false
      if (proxyFilter === 'proxied' && row.proxyId == null) return false
      if (proxyFilter === 'unproxied' && row.proxyId != null) return false
      if (proxyFilter.startsWith('proxy:')) {
        const id = Number(proxyFilter.slice(6))
        if (row.proxyId !== id) return false
      }
      return true
    })
  }, [rows, search, statusFilter, proxyFilter])

  const importPreview = useMemo(
    () => (importOpen ? parseProxyImportLines(importText) : { items: [], errors: [] }),
    [importOpen, importText],
  )

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [listRes, assignRes] = await Promise.all([
        api.listProxies(),
        api.listProxyAssignments(),
        reloadAccounts(),
      ])
      if (!listRes.success || !listRes.data) {
        setError(listRes.error ?? 'Không tải được proxy')
        setProxies([])
      } else {
        setDatabaseEnabled(listRes.data.database_enabled)
        setProxies(listRes.data.proxies)
      }
      const map: Record<string, number> = {}
      if (assignRes.success && assignRes.data) {
        for (const row of assignRes.data.assignments) {
          if (row.proxy_id != null) map[row.phone] = row.proxy_id
        }
      }
      setAssignmentMap(map)
    } catch {
      setError('Không kết nối được API.')
    } finally {
      setLoading(false)
    }
  }, [reloadAccounts])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  function openDrawer(phone: string) {
    setActivePhone(phone)
    setDrawerProxyId(assignmentMap[phone] != null ? String(assignmentMap[phone]) : '')
    setDrawerOpen(true)
    setError('')
    setSuccess('')
  }

  function ensureBulkProxyDefault() {
    // Auto-pick first enabled proxy so "Gán" is not stuck disabled
    if (!bulkProxyId && proxies.some((p) => p.enabled)) {
      const first = proxies.find((p) => p.enabled)
      if (first) setBulkProxyId(String(first.id))
    }
  }

  function toggleSelect(phone: string) {
    setSelectedPhones((prev) => {
      const next = new Set(prev)
      if (next.has(phone)) next.delete(phone)
      else next.add(phone)
      return next
    })
    ensureBulkProxyDefault()
  }

  const allVisibleSelected =
    filteredRows.length > 0 && filteredRows.every((r) => selectedPhones.has(r.phone))
  const someVisibleSelected =
    filteredRows.some((r) => selectedPhones.has(r.phone)) && !allVisibleSelected

  function toggleSelectAllVisible() {
    setSelectedPhones((prev) => {
      const next = new Set(prev)
      if (allVisibleSelected) {
        for (const r of filteredRows) next.delete(r.phone)
      } else {
        for (const r of filteredRows) next.add(r.phone)
      }
      return next
    })
    ensureBulkProxyDefault()
  }

  async function handleAssignSelected(proxyId: number | null) {
    const phones = [...selectedPhones]
    if (!phones.length) {
      setError('Tick chọn account ở cột trái trước')
      return
    }
    if (proxyId != null && !Number.isFinite(proxyId)) {
      setError('Chọn proxy trong dropdown rồi bấm Gán')
      return
    }
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      const res = await api.assignProxyBulk(phones, proxyId, { mode: 'same' })
      if (!res.success) {
        setError(
          res.error ??
            (proxyId == null
              ? 'Gỡ proxy thất bại — kiểm tra database đã bật chưa'
              : 'Gán proxy thất bại — kiểm tra database đã bật chưa'),
        )
        return
      }
      const updated = res.data?.updated ?? phones.length
      const proxyName =
        proxyId != null ? proxies.find((p) => p.id === proxyId)?.name : null
      setSuccess(
        proxyId == null
          ? `Đã gỡ proxy cho ${updated} account`
          : `Đã gán “${proxyName || 'proxy'}” cho ${updated} account`,
      )
      setSelectedPhones(new Set())
      await loadAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không kết nối được API.')
    } finally {
      setBusy(false)
    }
  }

  /** Chia đều proxy pool cho các acc đã chọn (round-robin). */
  async function handleDistributeSelected() {
    const phones = [...selectedPhones]
    if (!phones.length) {
      setError('Tick chọn account trước khi chia proxy')
      return
    }
    if (bulkProxyOptions.length === 0) {
      setError('Pool chưa có proxy đang bật — thêm proxy trước')
      return
    }
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      const res = await api.assignProxyBulk(phones, null, {
        mode: 'round_robin',
        proxyIds: bulkProxyOptions.map((p) => p.id),
      })
      if (!res.success) {
        setError(res.error ?? 'Chia proxy thất bại — kiểm tra database đã bật chưa')
        return
      }
      const updated = res.data?.updated ?? phones.length
      const proxyCount = res.data?.proxy_count ?? bulkProxyOptions.length
      setSuccess(
        `Đã chia đều ${proxyCount} proxy cho ${updated} account (mỗi acc 1 proxy, luân phiên)`,
      )
      setSelectedPhones(new Set())
      await loadAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không kết nối được API.')
    } finally {
      setBusy(false)
    }
  }

  function selectUnproxiedVisible() {
    const next = new Set<string>()
    for (const r of filteredRows) {
      if (r.proxyId == null) next.add(r.phone)
    }
    setSelectedPhones(next)
    setBulkMode('distribute')
    ensureBulkProxyDefault()
    if (next.size === 0) {
      setError('Không có account “chưa gắn” trong danh sách đang lọc')
    } else {
      setError('')
      setSuccess(`Đã chọn ${next.size} account chưa gắn proxy`)
    }
  }

  async function handleDrawerSave() {
    if (!activePhone) return
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      const proxyId = drawerProxyId ? Number(drawerProxyId) : null
      const res = await api.assignProxy(activePhone, proxyId)
      if (!res.success) {
        setError(res.error ?? 'Không lưu được gán proxy')
        return
      }
      setSuccess(
        proxyId == null
          ? `Đã gỡ proxy cho ${activePhone}`
          : `Đã gán proxy cho ${activePhone}`,
      )
      await loadAll()
    } catch {
      setError('Không kết nối được API.')
    } finally {
      setBusy(false)
    }
  }

  async function handleCheckForPhone(phone: string) {
    const proxyId = assignmentMap[phone]
    if (proxyId == null) {
      setError('Account này chưa gắn proxy để test')
      return
    }
    setCheckingPhone(phone)
    setError('')
    setSuccess('')
    try {
      const res = await api.checkProxy(proxyId)
      if (!res.success || !res.data) {
        setError(res.error ?? 'Test thất bại')
        return
      }
      if (res.data.status === 'ok') setSuccess(`${phone}: ${res.data.message}`)
      else setError(`${phone}: ${res.data.message}`)
      await loadAll()
    } catch {
      setError('Không kết nối được API.')
    } finally {
      setCheckingPhone(null)
    }
  }

  async function handleCheckProxy(proxyId: number, label?: string) {
    const name =
      label || proxies.find((p) => p.id === proxyId)?.name || `proxy #${proxyId}`
    setCheckingProxyId(proxyId)
    setError('')
    setSuccess('')
    try {
      const res = await api.checkProxy(proxyId)
      if (!res.success || !res.data) {
        setError(res.error ?? `Test “${name}” thất bại`)
        return
      }
      if (res.data.status === 'ok') {
        setSuccess(`OK · ${name}: ${res.data.message}`)
      } else {
        setError(`Lỗi · ${name}: ${res.data.message}`)
      }
      await loadAll()
    } catch {
      setError(`Không test được “${name}”.`)
    } finally {
      setCheckingProxyId(null)
    }
  }

  async function handleTestAllProxies() {
    const targets = proxies.filter((p) => p.enabled)
    if (!targets.length) {
      setError('Không có proxy đang bật để test')
      return
    }
    setTestingAllProxies(true)
    setError('')
    setSuccess('')
    let ok = 0
    let fail = 0
    try {
      for (const p of targets) {
        setCheckingProxyId(p.id)
        try {
          const res = await api.checkProxy(p.id)
          if (res.success && res.data?.status === 'ok') ok += 1
          else fail += 1
        } catch {
          fail += 1
        }
      }
      const summary = `Test xong pool: ${ok} OK · ${fail} lỗi (trên ${targets.length} proxy)`
      if (fail > 0 && ok === 0) setError(summary)
      else setSuccess(summary)
      await loadAll()
    } catch {
      setError('Không test được pool proxy.')
    } finally {
      setCheckingProxyId(null)
      setTestingAllProxies(false)
    }
  }

  async function handleCreateProxy() {
    const port = Number(form.port)
    if (!form.name.trim() || !form.host.trim() || !Number.isFinite(port)) {
      setError('Điền tên, host và port hợp lệ')
      return
    }
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      const res = await api.createProxy({
        name: form.name.trim(),
        proxy_type: form.proxy_type,
        host: form.host.trim(),
        port,
        username: form.username.trim() || null,
        password: form.password || null,
        secret: form.secret.trim() || null,
        enabled: form.enabled,
      })
      if (!res.success || !res.data) {
        setError(res.error ?? 'Tạo proxy thất bại')
        return
      }
      setSuccess(`Đã thêm proxy “${res.data.name}”`)
      setAddOpen(false)
      setForm(EMPTY_FORM)
      await loadAll()
    } catch {
      setError('Không kết nối được API.')
    } finally {
      setBusy(false)
    }
  }

  async function handleImportList() {
    const { items, errors } = parseProxyImportLines(importText)
    if (errors.length) {
      setError(errors.slice(0, 3).join(' · '))
      return
    }
    if (!items.length) {
      setError('Dán ít nhất một dòng proxy (host:port hoặc host:port:user:pass)')
      return
    }
    setBusy(true)
    setError('')
    setSuccess('')
    let ok = 0
    let fail = 0
    try {
      for (const item of items) {
        const res = await api.createProxy({
          name: item.name,
          proxy_type: item.proxy_type,
          host: item.host,
          port: item.port,
          username: item.username || null,
          password: item.password || null,
          enabled: true,
        })
        if (res.success) ok += 1
        else fail += 1
      }
      setSuccess(`Import xong: ${ok} thành công${fail ? `, ${fail} lỗi` : ''}`)
      setImportOpen(false)
      setImportText('')
      await loadAll()
    } catch {
      setError('Không kết nối được API.')
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteProxy() {
    if (deleteProxyId == null) return
    setBusy(true)
    try {
      const res = await api.deleteProxy(deleteProxyId)
      if (!res.success) {
        setError(res.error ?? 'Xóa thất bại')
        return
      }
      setSuccess('Đã xóa proxy')
      setDeleteProxyId(null)
      await loadAll()
    } catch {
      setError('Không kết nối được API.')
    } finally {
      setBusy(false)
    }
  }

  const activeRow = activePhone ? rows.find((r) => r.phone === activePhone) : null
  const bulkProxyOptions = proxies.filter((p) => p.enabled)
  const tableBusy = loading || accountsLoading
  const coveragePct =
    counts.total > 0 ? Math.round((counts.proxied / counts.total) * 100) : 0
  const hasActiveFilters =
    statusFilter !== 'all' || proxyFilter !== 'all' || search.trim().length > 0
  const unproxiedVisible = useMemo(
    () => filteredRows.filter((r) => r.proxyId == null).length,
    [filteredRows],
  )
  const distributePreview = useMemo(() => {
    const nAcc = selectedPhones.size
    const nProxy = bulkProxyOptions.length
    if (!nAcc || !nProxy) return null
    const base = Math.floor(nAcc / nProxy)
    const rem = nAcc % nProxy
    if (nAcc <= nProxy) {
      return `${nAcc} acc → ${nAcc} proxy (mỗi acc 1 proxy khác nhau)`
    }
    return `${nAcc} acc ÷ ${nProxy} proxy → ~${base}${rem ? `–${base + 1}` : ''} acc/proxy (luân phiên)`
  }, [selectedPhones.size, bulkProxyOptions.length])

  return (
    <div className="page page--proxy">
      <section className="panel proxy-shell">
        <header className="proxy-panel-head">
          <div className="proxy-panel-intro">
            <div className="proxy-panel-title-row">
              <span className="proxy-panel-icon" aria-hidden>
                <svg viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.8" />
                  <path
                    d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6.2 6.2l1.6 1.6M16.2 16.2l1.6 1.6M16.2 6.2l-1.6 1.6M6.2 16.2l1.6-1.6"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
              <div className="proxy-panel-copy">
                <div className="proxy-panel-badges">
                  <span className="proxy-panel-pill">SOCKS5</span>
                  <span className="proxy-panel-pill">HTTP</span>
                  <span className="proxy-panel-pill">MTProto</span>
                </div>
                <h1>Proxy</h1>
                <p className="page-desc">
                  Gán proxy cho session Telegram — từng account hoặc chia đều từ pool. Test kết nối
                  trước khi chạy task. Danh sách account lấy từ{' '}
                  <Link to="/sessions">Tài khoản</Link>.
                </p>
              </div>
            </div>
          </div>
          <div className="proxy-panel-actions">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={loading || busy}
              onClick={() => void loadAll()}
            >
              {loading ? 'Đang tải…' : 'Làm mới'}
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={!databaseEnabled}
              onClick={() => {
                setImportText('')
                setImportOpen(true)
              }}
            >
              Import list
            </button>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={!databaseEnabled}
              onClick={() => {
                setForm(EMPTY_FORM)
                setAddOpen(true)
              }}
            >
              + Thêm proxy
            </button>
          </div>
        </header>

        <div className="proxy-panel-stats" aria-label="Tóm tắt proxy">
          <article className="proxy-panel-stat proxy-panel-stat--total">
            <p className="proxy-panel-stat-label">Account</p>
            <p className="proxy-panel-stat-value">{tableBusy ? '—' : counts.total}</p>
            <p className="proxy-panel-stat-foot">Trên disk</p>
          </article>
          <article className="proxy-panel-stat proxy-panel-stat--live">
            <p className="proxy-panel-stat-label">Live</p>
            <p className="proxy-panel-stat-value">{tableBusy ? '—' : counts.live}</p>
            <p className="proxy-panel-stat-foot">Session active</p>
          </article>
          <article className="proxy-panel-stat proxy-panel-stat--proxied">
            <p className="proxy-panel-stat-label">Đã gắn proxy</p>
            <p className="proxy-panel-stat-value">{tableBusy ? '—' : counts.proxied}</p>
            <p className="proxy-panel-stat-foot">{coveragePct}% coverage</p>
          </article>
          <article className="proxy-panel-stat proxy-panel-stat--bare">
            <p className="proxy-panel-stat-label">Chưa gắn</p>
            <p className="proxy-panel-stat-value">{tableBusy ? '—' : counts.unproxied}</p>
            <p className="proxy-panel-stat-foot">Kết nối direct</p>
          </article>
          <article className="proxy-panel-stat proxy-panel-stat--pool">
            <p className="proxy-panel-stat-label">Pool</p>
            <p className="proxy-panel-stat-value">{loading ? '—' : counts.proxies}</p>
            <p className="proxy-panel-stat-foot">{bulkProxyOptions.length} đang bật</p>
          </article>
        </div>

        <div className="proxy-alerts">
          <Alert type="error" message={error} compact />
          <Alert type="success" message={success} compact />
          {!databaseEnabled && (
            <Alert
              type="error"
              compact
              message="Database chưa bật — cấu hình DATABASE_URL để dùng proxy."
            />
          )}
        </div>

        {/* ── Split body ───────────────────────────────────────── */}
        <div className="proxy-split">
      <section className="proxy-workspace">
        <div className="proxy-workspace-head">
          <div className="proxy-workspace-title">
            <h2>Accounts</h2>
            <span className="proxy-pill-count">
              {filteredRows.length}
              <em>/{counts.total}</em>
            </span>
          </div>

          <div className="proxy-filters">
            <select
              className="proxy-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as AccountStatusFilter)}
              aria-label="Lọc theo trạng thái account"
            >
              {ACCOUNT_STATUS_FILTER_OPTIONS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>

            <select
              className="proxy-select"
              value={proxyFilter}
              onChange={(e) => setProxyFilter(e.target.value as ProxyLinkFilter)}
              aria-label="Lọc theo proxy"
            >
              <option value="all">Proxy · tất cả</option>
              <option value="unproxied">Chưa proxy ({counts.unproxied})</option>
              <option value="proxied">Đã proxy ({counts.proxied})</option>
              {proxies.map((p) => (
                <option key={p.id} value={`proxy:${p.id}`}>
                  {p.name} · {p.assigned_count}
                </option>
              ))}
            </select>

            <div className="proxy-search">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden>
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                <path d="M20 20l-3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <input
                type="search"
                placeholder="Tìm phone, tên, proxy…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {hasActiveFilters && (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => {
                  setStatusFilter('all')
                  setProxyFilter('all')
                  setSearch('')
                }}
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Bulk assign bar */}
        <div
          className={`proxy-bulk${selectedPhones.size > 0 ? ' proxy-bulk--active' : ''}`}
        >
          {selectedPhones.size > 0 ? (
            <div className="proxy-bulk-active-wrap">
              <div className="proxy-bulk-info">
                <span className="proxy-bulk-badge" aria-live="polite">
                  {selectedPhones.size}
                </span>
                <div className="proxy-bulk-copy">
                  <strong>Gán hàng loạt</strong>
                  <span>
                    {bulkMode === 'distribute'
                      ? distributePreview ||
                        'Chia đều proxy trong pool — mỗi account một proxy (luân phiên)'
                      : 'Mọi account đã chọn dùng chung 1 proxy'}
                  </span>
                </div>
                <button
                  type="button"
                  className="proxy-bulk-clear"
                  onClick={() => setSelectedPhones(new Set())}
                >
                  Bỏ chọn
                </button>
              </div>

              <div className="proxy-bulk-mode" role="tablist" aria-label="Chế độ gán">
                <button
                  type="button"
                  role="tab"
                  aria-selected={bulkMode === 'distribute'}
                  className={`proxy-bulk-mode-btn${bulkMode === 'distribute' ? ' proxy-bulk-mode-btn--on' : ''}`}
                  onClick={() => setBulkMode('distribute')}
                >
                  Chia đều
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={bulkMode === 'same'}
                  className={`proxy-bulk-mode-btn${bulkMode === 'same' ? ' proxy-bulk-mode-btn--on' : ''}`}
                  onClick={() => setBulkMode('same')}
                >
                  Cùng 1 proxy
                </button>
              </div>

              <div className="proxy-bulk-controls">
                {bulkMode === 'same' ? (
                  <>
                    <select
                      className="proxy-select proxy-select--bulk"
                      value={bulkProxyId}
                      onChange={(e) => setBulkProxyId(e.target.value)}
                      aria-label="Proxy để gán cho account đã chọn"
                    >
                      <option value="">— Chọn proxy —</option>
                      {bulkProxyOptions.length === 0 ? (
                        <option value="" disabled>
                          Chưa có proxy — bấm “+ Thêm proxy”
                        </option>
                      ) : (
                        bulkProxyOptions.map((p) => (
                          <option key={p.id} value={String(p.id)}>
                            {p.name} · {p.host}:{p.port}
                          </option>
                        ))
                      )}
                    </select>
                    <button
                      type="button"
                      className="btn btn--primary btn--sm"
                      disabled={busy || bulkProxyOptions.length === 0}
                      title={
                        !bulkProxyId
                          ? 'Chọn proxy trong dropdown trước'
                          : `Gán cùng 1 proxy cho ${selectedPhones.size} account`
                      }
                      onClick={() => {
                        if (!bulkProxyId) {
                          setError('Chọn proxy trong dropdown rồi bấm Gán')
                          return
                        }
                        void handleAssignSelected(Number(bulkProxyId))
                      }}
                    >
                      {busy ? 'Đang gán…' : `Gán · ${selectedPhones.size}`}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    disabled={busy || bulkProxyOptions.length === 0}
                    title={
                      bulkProxyOptions.length === 0
                        ? 'Cần ít nhất 1 proxy đang bật trong pool'
                        : `Chia ${bulkProxyOptions.length} proxy cho ${selectedPhones.size} account`
                    }
                    onClick={() => void handleDistributeSelected()}
                  >
                    {busy
                      ? 'Đang chia…'
                      : `Chia đều · ${selectedPhones.size} acc × ${bulkProxyOptions.length} proxy`}
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={busy}
                  onClick={() => void handleAssignSelected(null)}
                >
                  Gỡ proxy
                </button>
              </div>
            </div>
          ) : (
            <div className="proxy-bulk-idle">
              <p className="proxy-bulk-hint">
                <span className="proxy-bulk-hint-icon" aria-hidden>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none">
                    <path
                      d="M4 7h16M4 12h10M4 17h13"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                    />
                    <circle cx="18" cy="12" r="2.2" stroke="currentColor" strokeWidth="1.7" />
                  </svg>
                </span>
                <span>
                  <strong>Chia đều:</strong> tick nhiều acc → mỗi acc 1 proxy khác nhau từ pool ·{' '}
                  <strong>Cùng 1 proxy:</strong> nhiều acc dùng chung · 1 dòng = drawer
                </span>
              </p>
              {unproxiedVisible > 0 && (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm proxy-bulk-quick"
                  disabled={busy || bulkProxyOptions.length === 0}
                  onClick={selectUnproxiedVisible}
                >
                  Chọn {unproxiedVisible} chưa gắn
                </button>
              )}
            </div>
          )}
        </div>

        <div className="proxy-table-wrap">
          {tableBusy ? (
            <div className="proxy-state">
              <span className="spinner" aria-hidden />
              <span>Đang tải danh sách account…</span>
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="proxy-state proxy-state--empty">
              <div className="proxy-empty-icon" aria-hidden>
                <svg viewBox="0 0 24 24" width="32" height="32" fill="none">
                  <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.6" />
                  <path
                    d="M20 20l-3-3"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
              <p>
                {sessions.length === 0
                  ? 'Chưa có session trên disk.'
                  : 'Không có account khớp bộ lọc.'}
              </p>
              {hasActiveFilters && sessions.length > 0 && (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => {
                    setStatusFilter('all')
                    setProxyFilter('all')
                    setSearch('')
                  }}
                >
                  Xóa bộ lọc
                </button>
              )}
            </div>
          ) : (
            <table className="proxy-table">
              <thead>
                <tr>
                  <th className="proxy-th-check">
                    <button
                      type="button"
                      className={[
                        'proxy-check',
                        allVisibleSelected ? 'proxy-check--on' : '',
                        someVisibleSelected ? 'proxy-check--mixed' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onClick={toggleSelectAllVisible}
                      aria-label={
                        allVisibleSelected
                          ? 'Bỏ chọn tất cả đang hiển thị'
                          : 'Chọn tất cả đang hiển thị'
                      }
                      aria-pressed={allVisibleSelected}
                    />
                  </th>
                  <th>Account</th>
                  <th>Status</th>
                  <th>Proxy</th>
                  <th>Check</th>
                  <th className="proxy-th-actions" />
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const selected = selectedPhones.has(row.phone)
                  const active = activePhone === row.phone && drawerOpen
                  return (
                    <tr
                      key={row.phone}
                      className={[
                        selected ? 'proxy-tr--selected' : '',
                        active ? 'proxy-tr--active' : '',
                        row.proxyId == null ? 'proxy-tr--bare' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <td className="proxy-td-check">
                        <button
                          type="button"
                          className={`proxy-check${selected ? ' proxy-check--on' : ''}`}
                          onClick={() => toggleSelect(row.phone)}
                          aria-label={
                            selected ? `Bỏ chọn ${row.phone}` : `Chọn ${row.phone}`
                          }
                          aria-pressed={selected}
                        />
                      </td>
                      <td
                        className="proxy-td-account"
                        onClick={() => openDrawer(row.phone)}
                      >
                        <div className="proxy-acc-cell">
                          <SessionAvatar
                            phone={row.phone}
                            label={row.avatarLabel}
                            hasAvatar={row.meta?.has_avatar}
                            avatarUpdatedAt={row.meta?.avatar_updated_at}
                            size="sm"
                          />
                          <div className="proxy-acc-text">
                            <div className="proxy-acc-name">{row.labels.primary}</div>
                            <div className="proxy-acc-phone">
                              {row.labels.secondary || row.phone}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td onClick={() => openDrawer(row.phone)}>
                        {row.status ? (
                          <StatusBadge status={row.status} />
                        ) : (
                          <span className="badge badge--default">unknown</span>
                        )}
                      </td>
                      <td onClick={() => openDrawer(row.phone)}>
                        {row.proxy ? (
                          <div className="proxy-cell">
                            <div className="proxy-cell-top">
                              <span className="proxy-name-pill">{row.proxy.name}</span>
                              <span
                                className={`proxy-type-badge proxy-type-badge--${row.proxy.proxy_type}`}
                              >
                                {typeLabel(row.proxy.proxy_type)}
                              </span>
                            </div>
                            <code className="proxy-cell-ep">
                              {row.proxy.host}:{row.proxy.port}
                            </code>
                          </div>
                        ) : (
                          <span className="proxy-none">
                            <span className="proxy-none-dot" aria-hidden />
                            Direct
                          </span>
                        )}
                      </td>
                      <td onClick={() => openDrawer(row.phone)}>
                        {row.proxy ? (
                          <span
                            className={`proxy-chip proxy-chip--${row.proxy.last_check_status || 'unknown'}`}
                          >
                            {statusLabel(row.proxy.last_check_status)}
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="proxy-td-actions">
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => openDrawer(row.phone)}
                        >
                          Gán
                        </button>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          disabled={row.proxyId == null || checkingPhone === row.phone}
                          onClick={() => void handleCheckForPhone(row.phone)}
                        >
                          {checkingPhone === row.phone ? '…' : 'Test'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* ── Pool (right) ─────────────────────────────────────── */}
      <aside className="proxy-pool">
        <div className="proxy-pool-head">
          <div className="proxy-pool-title-row">
            <h2>Pool</h2>
            <span className="proxy-pill-count">{proxies.length}</span>
          </div>
          <div className="proxy-pool-head-actions">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={
                !databaseEnabled ||
                busy ||
                testingAllProxies ||
                checkingProxyId != null ||
                bulkProxyOptions.length === 0
              }
              title="Test lần lượt mọi proxy đang bật"
              onClick={() => void handleTestAllProxies()}
            >
              {testingAllProxies ? '…' : 'Test all'}
            </button>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={!databaseEnabled}
              onClick={() => {
                setForm(EMPTY_FORM)
                setAddOpen(true)
              }}
            >
              +
            </button>
          </div>
        </div>

        {proxies.length > 0 && (
          <div className="proxy-pool-summary" aria-label="Tóm tắt pool">
            <span>
              <b>{bulkProxyOptions.length}</b> bật
            </span>
            <span>
              <b>{proxies.reduce((n, p) => n + (p.assigned_count || 0), 0)}</b> gán
            </span>
            <span>
              <b>{proxies.filter((p) => p.last_check_status === 'ok').length}</b> OK
            </span>
          </div>
        )}

        <div className="proxy-pool-body">
          {proxies.length === 0 ? (
            <div className="proxy-pool-empty">
              <div className="proxy-pool-empty-icon" aria-hidden>
                <svg viewBox="0 0 24 24" width="28" height="28" fill="none">
                  <ellipse
                    cx="12"
                    cy="7"
                    rx="6.5"
                    ry="2.3"
                    stroke="currentColor"
                    strokeWidth="1.6"
                  />
                  <path
                    d="M5.5 7v4.5c0 1.3 2.9 2.3 6.5 2.3s6.5-1 6.5-2.3V7"
                    stroke="currentColor"
                    strokeWidth="1.6"
                  />
                  <path
                    d="M5.5 11.5V16c0 1.3 2.9 2.3 6.5 2.3s6.5-1 6.5-2.3v-4.5"
                    stroke="currentColor"
                    strokeWidth="1.6"
                  />
                </svg>
              </div>
              <strong>Pool trống</strong>
              <p className="muted">Thêm proxy thủ công hoặc import danh sách</p>
              <div className="proxy-pool-empty-actions">
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  disabled={!databaseEnabled}
                  onClick={() => {
                    setForm(EMPTY_FORM)
                    setAddOpen(true)
                  }}
                >
                  + Thêm proxy
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={!databaseEnabled}
                  onClick={() => {
                    setImportText('')
                    setImportOpen(true)
                  }}
                >
                  Import list
                </button>
              </div>
            </div>
          ) : (
            <div className="proxy-pool-list">
              {proxies.map((p) => {
                const isChecking = checkingProxyId === p.id
                return (
                <article
                  key={p.id}
                  className={[
                    'proxy-pool-card',
                    `proxy-pool-card--${p.proxy_type}`,
                    !p.enabled ? 'proxy-pool-card--off' : '',
                    p.last_check_status === 'ok' ? 'proxy-pool-card--ok' : '',
                    p.last_check_status === 'fail' ? 'proxy-pool-card--fail' : '',
                    isChecking ? 'proxy-pool-card--checking' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <div className="proxy-pool-card-accent" aria-hidden />
                  <div className="proxy-pool-card-top">
                    <div className="proxy-pool-card-identity">
                      <span
                        className={`proxy-pool-type-icon proxy-pool-type-icon--${p.proxy_type}`}
                        aria-hidden
                      >
                        {p.proxy_type === 'http' ? 'H' : p.proxy_type === 'mtproto' ? 'M' : 'S'}
                      </span>
                      <div className="proxy-pool-card-text">
                        <div className="proxy-pool-card-title">
                          <strong title={p.name}>{p.name}</strong>
                          {!p.enabled && <span className="proxy-off-tag">Tắt</span>}
                        </div>
                        <span className="proxy-pool-type-label">
                          {typeLabel(p.proxy_type)}
                        </span>
                      </div>
                    </div>
                    <span
                      className={`proxy-chip proxy-chip--${isChecking ? 'unknown' : p.last_check_status || 'unknown'}`}
                      title={p.last_check_message || undefined}
                    >
                      {isChecking ? '…' : statusLabel(p.last_check_status)}
                    </span>
                  </div>

                  <div className="proxy-pool-endpoint-row">
                    <svg
                      className="proxy-pool-endpoint-icon"
                      viewBox="0 0 24 24"
                      width="14"
                      height="14"
                      fill="none"
                      aria-hidden
                    >
                      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.7" />
                      <path
                        d="M4 12h16M12 4c2.2 2.4 3.3 5 3.3 8s-1.1 5.6-3.3 8c-2.2-2.4-3.3-5-3.3-8s1.1-5.6 3.3-8Z"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      />
                    </svg>
                    <code className="proxy-pool-endpoint">
                      {p.host}:{p.port}
                    </code>
                  </div>

                  {p.last_check_message ? (
                    <p
                      className={`proxy-pool-check-msg proxy-pool-check-msg--${p.last_check_status || 'unknown'}`}
                      title={p.last_check_message}
                    >
                      {p.last_check_message}
                    </p>
                  ) : null}

                  <div className="proxy-pool-card-meta">
                    <span className="proxy-pool-acc-count">
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden>
                        <circle cx="9" cy="8" r="2.8" stroke="currentColor" strokeWidth="1.6" />
                        <path
                          d="M4 17.5c0-2.3 2-4.2 5-4.2s5 1.9 5 4.2"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                        />
                        <circle cx="17" cy="9" r="2" stroke="currentColor" strokeWidth="1.6" />
                      </svg>
                      <strong>{p.assigned_count}</strong>
                      <span>acc</span>
                    </span>
                    <div className="proxy-pool-card-actions">
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm proxy-pool-test-btn"
                        disabled={
                          busy ||
                          testingAllProxies ||
                          checkingProxyId != null ||
                          !p.enabled
                        }
                        title={
                          !p.enabled
                            ? 'Proxy đang tắt — bật trước khi test'
                            : `Test kết nối ${p.name}`
                        }
                        onClick={() => void handleCheckProxy(p.id, p.name)}
                      >
                        {isChecking ? (
                          <>
                            <span className="spinner spinner--sm" aria-hidden />
                            Đang test…
                          </>
                        ) : (
                          <>
                            <svg
                              viewBox="0 0 24 24"
                              width="14"
                              height="14"
                              fill="none"
                              aria-hidden
                            >
                              <path
                                d="M13 3L5.5 13.5H12l-1 7.5L19.5 10H13L13 3Z"
                                stroke="currentColor"
                                strokeWidth="1.7"
                                strokeLinejoin="round"
                              />
                            </svg>
                            Test
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        className="proxy-pool-icon-btn proxy-pool-icon-btn--danger"
                        title="Xóa proxy"
                        aria-label={`Xóa ${p.name}`}
                        disabled={busy || testingAllProxies || isChecking}
                        onClick={() => setDeleteProxyId(p.id)}
                      >
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden>
                          <path
                            d="M5 7h14M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7m-7 0 0.7 11.2A1.5 1.5 0 0 0 10.2 20h3.6a1.5 1.5 0 0 0 1.5-1.4L16 7"
                            stroke="currentColor"
                            strokeWidth="1.7"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>
                </article>
                )
              })}
            </div>
          )}
        </div>
      </aside>
        </div>
      </section>

      {/* ── Drawer ───────────────────────────────────────────── */}
      {drawerOpen && activePhone && (
        <div className="proxy-drawer-backdrop" onClick={() => setDrawerOpen(false)}>
          <aside
            className="proxy-drawer"
            role="dialog"
            aria-label={`Proxy cho ${activePhone}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="proxy-drawer-head">
              <div className="proxy-drawer-identity">
                <SessionAvatar
                  phone={activePhone}
                  label={activeRow?.avatarLabel || activePhone}
                  hasAvatar={activeRow?.meta?.has_avatar}
                  avatarUpdatedAt={activeRow?.meta?.avatar_updated_at}
                  size="md"
                />
                <div>
                  <p className="proxy-hero-eyebrow">Account</p>
                  <h2>{activeRow?.labels.primary || activePhone}</h2>
                  <p className="proxy-acc-phone">{activePhone}</p>
                  {activeRow?.status ? (
                    <div className="proxy-drawer-status">
                      <StatusBadge status={activeRow.status} />
                    </div>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                className="btn btn--ghost btn--sm proxy-drawer-close"
                onClick={() => setDrawerOpen(false)}
                aria-label="Đóng"
              >
                ✕
              </button>
            </div>

            <div className="proxy-drawer-body">
              <section className="proxy-drawer-section">
                <p className="proxy-drawer-label">Proxy hiện tại</p>
                {activeRow?.proxy ? (
                  <div className="proxy-drawer-current">
                    <div className="proxy-drawer-current-row">
                      <strong>{activeRow.proxy.name}</strong>
                      <span
                        className={`proxy-chip proxy-chip--${activeRow.proxy.last_check_status || 'unknown'}`}
                      >
                        {statusLabel(activeRow.proxy.last_check_status)}
                      </span>
                    </div>
                    <span className="proxy-drawer-endpoint">
                      <span
                        className={`proxy-type-badge proxy-type-badge--${activeRow.proxy.proxy_type}`}
                      >
                        {typeLabel(activeRow.proxy.proxy_type)}
                      </span>
                      <code>
                        {activeRow.proxy.host}:{activeRow.proxy.port}
                      </code>
                    </span>
                    {activeRow.proxy.last_check_message ? (
                      <span className="muted proxy-drawer-msg">
                        {activeRow.proxy.last_check_message}
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <p className="proxy-none-block">Chưa gắn proxy — kết nối direct.</p>
                )}
              </section>

              <section className="proxy-drawer-section">
                <label className="proxy-field">
                  <span className="proxy-label">Gán proxy</span>
                  <select
                    value={drawerProxyId}
                    onChange={(e) => setDrawerProxyId(e.target.value)}
                  >
                    <option value="">— Direct (không proxy) —</option>
                    {proxies.map((p) => (
                      <option
                        key={p.id}
                        value={p.id}
                        disabled={!p.enabled && p.id !== activeRow?.proxyId}
                      >
                        {p.name} · {p.host}:{p.port}
                        {!p.enabled ? ' (tắt)' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              </section>

              <div className="proxy-drawer-actions">
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={busy || !databaseEnabled}
                  onClick={() => void handleDrawerSave()}
                >
                  {busy ? 'Đang lưu…' : 'Lưu gán'}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={!activeRow?.proxyId || checkingPhone === activePhone}
                  onClick={() => void handleCheckForPhone(activePhone)}
                >
                  {checkingPhone === activePhone ? 'Đang test…' : 'Test proxy'}
                </button>
                {activeRow?.proxyId != null && (
                  <button
                    type="button"
                    className="btn btn--ghost"
                    disabled={busy}
                    onClick={() => {
                      setDrawerProxyId('')
                      void (async () => {
                        setBusy(true)
                        try {
                          await api.assignProxy(activePhone, null)
                          setSuccess(`Đã gỡ proxy cho ${activePhone}`)
                          await loadAll()
                        } catch {
                          setError('Không gỡ được proxy')
                        } finally {
                          setBusy(false)
                        }
                      })()
                    }}
                  >
                    Gỡ proxy
                  </button>
                )}
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* ── Modals ───────────────────────────────────────────── */}
      {addOpen && (
        <div className="proxy-modal-backdrop" onClick={() => !busy && setAddOpen(false)}>
          <div className="proxy-modal" role="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="proxy-modal-head">
              <div>
                <p className="proxy-hero-eyebrow">Pool</p>
                <h2>Thêm proxy</h2>
              </div>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setAddOpen(false)}
              >
                Đóng
              </button>
            </div>
            <div className="proxy-modal-body">
              <label className="proxy-field">
                <span className="proxy-label">Tên</span>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="SG-1"
                />
              </label>
              <label className="proxy-field">
                <span className="proxy-label">Loại</span>
                <select
                  value={form.proxy_type}
                  onChange={(e) => setForm((f) => ({ ...f, proxy_type: e.target.value }))}
                >
                  <option value="socks5">SOCKS5</option>
                  <option value="http">HTTP</option>
                  <option value="mtproto">MTProto</option>
                </select>
              </label>
              <div className="proxy-field-row">
                <label className="proxy-field">
                  <span className="proxy-label">Host</span>
                  <input
                    value={form.host}
                    onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
                    placeholder="1.2.3.4"
                  />
                </label>
                <label className="proxy-field proxy-field--port">
                  <span className="proxy-label">Port</span>
                  <input
                    value={form.port}
                    onChange={(e) => setForm((f) => ({ ...f, port: e.target.value }))}
                  />
                </label>
              </div>
              <div className="proxy-field-row proxy-field-row--auth">
                <label className="proxy-field">
                  <span className="proxy-label">User</span>
                  <input
                    value={form.username}
                    onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                  />
                </label>
                <label className="proxy-field">
                  <span className="proxy-label">Password</span>
                  <input
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                    autoComplete="new-password"
                  />
                </label>
              </div>
              {form.proxy_type === 'mtproto' && (
                <label className="proxy-field">
                  <span className="proxy-label">Secret</span>
                  <input
                    value={form.secret}
                    onChange={(e) => setForm((f) => ({ ...f, secret: e.target.value }))}
                  />
                </label>
              )}
            </div>
            <div className="proxy-modal-foot">
              <button type="button" className="btn btn--ghost" onClick={() => setAddOpen(false)}>
                Huỷ
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy}
                onClick={() => void handleCreateProxy()}
              >
                {busy ? 'Đang tạo…' : 'Tạo proxy'}
              </button>
            </div>
          </div>
        </div>
      )}

      {importOpen && (
        <div className="proxy-modal-backdrop" onClick={() => !busy && setImportOpen(false)}>
          <div
            className="proxy-modal proxy-modal--wide"
            role="dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="proxy-modal-head">
              <div>
                <p className="proxy-hero-eyebrow">Import</p>
                <h2>Thêm danh sách proxy</h2>
              </div>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setImportOpen(false)}
              >
                Đóng
              </button>
            </div>
            <div className="proxy-modal-body">
              <p className="muted proxy-import-hint">
                Mỗi dòng một proxy. Hỗ trợ:
                <br />
                <code>host:port</code> · <code>host:port:user:pass</code> ·{' '}
                <code>socks5|host|port|user|pass</code>
              </p>
              <textarea
                className="proxy-import-area"
                rows={10}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder={'1.2.3.4:1080\n5.6.7.8:1080:user:pass\nsocks5|9.9.9.9|1080'}
              />
              {importText.trim() && (
                <p className="proxy-import-preview">
                  Parse được <strong>{importPreview.items.length}</strong> proxy
                  {importPreview.errors.length
                    ? ` · ${importPreview.errors.length} dòng lỗi`
                    : ''}
                </p>
              )}
            </div>
            <div className="proxy-modal-foot">
              <button type="button" className="btn btn--ghost" onClick={() => setImportOpen(false)}>
                Huỷ
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy || !importText.trim()}
                onClick={() => void handleImportList()}
              >
                {busy ? 'Đang import…' : 'Import vào pool'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={deleteProxyId != null}
        title="Xóa proxy?"
        description="Account đang gắn proxy này sẽ về direct."
        confirmLabel="Xóa"
        variant="danger"
        loading={busy}
        onCancel={() => setDeleteProxyId(null)}
        onConfirm={() => void handleDeleteProxy()}
      />
    </div>
  )
}
