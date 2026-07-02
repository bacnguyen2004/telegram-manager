import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import './RosterPage.css'
import { api } from '../api/client'
import { Alert } from '../components/Alert'
import { Pagination } from '../components/Pagination'
import { StatusBadge } from '../components/StatusBadge'
import type { RosterRowItem } from '../types/api'
import { formatDate, formatRelativeDate } from '../utils/format'
import { formatUsername } from '../utils/sessionDisplay'
import {
  buildRosterCsv,
  getMergedCellValue,
  getMergedRowFields,
  parseRosterCsvForApi,
  rosterDataToStore,
  rowMatchesFillFilter,
  rowMatchesRosterSearch,
  setCellValue,
  type RosterColumn,
  type RosterFillFilter,
  type RosterStore,
} from '../utils/rosterStorage'

type FixedSortKey = 'phone' | 'name' | 'username' | 'status' | 'synced'
type SortKey = FixedSortKey | string
type SortDir = 'asc' | 'desc'

interface RosterDisplayRow {
  phone: string
  name: string
  username: string
  status: string
  synced: string
}

const FIXED_COLUMNS: { key: FixedSortKey; label: string; className: string }[] = [
  { key: 'phone', label: 'Số ĐT', className: 'roster-col--fixed roster-col--phone' },
  { key: 'name', label: 'Tên', className: 'roster-col--fixed' },
  { key: 'username', label: 'Username', className: 'roster-col--fixed' },
  { key: 'status', label: 'Trạng thái', className: 'roster-col--fixed' },
  { key: 'synced', label: 'Kiểm tra', className: 'roster-col--fixed' },
]

const PATCH_DEBOUNCE_MS = 600
const DEFAULT_PAGE_SIZE = 20
const COLUMN_LABEL_MAX = 128
const COLUMN_SUGGESTIONS = [
  'Discord',
  'WhatsApp',
  'MEXC UID',
  'Bybit UID',
  'Binance email',
  'Ghi chú',
] as const

type RosterColumnModalMode = 'add' | 'rename'

function RosterCopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.75" />
      <path
        d="M7 15H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"
        stroke="currentColor"
        strokeWidth="1.75"
      />
    </svg>
  )
}

function RosterCheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 12.5 9.5 17 19 7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function RosterChatIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M7 18.5 5 20V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9.5L7 18.5Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function RosterProfileIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="8" r="3.25" stroke="currentColor" strokeWidth="1.75" />
      <path
        d="M5.5 19c.9-3.1 3.4-5 6.5-5s5.6 1.9 6.5 5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  )
}

function RosterColumnIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4" y="5" width="16" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.75" />
      <path d="M9 5v14M15 5v14M4 11h16M4 15h16" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  )
}

function RosterSearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.75" />
      <path d="M16 16 20 20" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  )
}

function RosterPlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 6v12M6 12h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function RosterEditIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 17.5V20h2.5L17 9.5 14.5 7 4 17.5Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <path d="m13.5 8.5 2 2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  )
}

function RosterTrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 7h14M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7m2 0-.6 11.2c0 .99-.8 1.8-1.8 1.8H9.4c-1 0-1.8-.81-1.8-1.8L7 7"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

interface RosterColumnModalProps {
  mode: RosterColumnModalMode
  label: string
  originalLabel?: string
  submitDisabled: boolean
  onLabelChange: (value: string) => void
  onSubmit: () => void
  onClose: () => void
}

function RosterColumnModal({
  mode,
  label,
  originalLabel,
  submitDisabled,
  onLabelChange,
  onSubmit,
  onClose,
}: RosterColumnModalProps) {
  const trimmed = label.trim()
  const isAdd = mode === 'add'

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (submitDisabled) return
    onSubmit()
  }

  return createPortal(
    <div className="roster-col-modal-backdrop" onClick={onClose}>
      <div
        className="roster-col-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="roster-col-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="roster-col-modal-close"
          aria-label="Đóng"
          onClick={onClose}
        >
          ×
        </button>

        <div className="roster-col-modal-icon" aria-hidden>
          <RosterColumnIcon />
        </div>

        <h3 id="roster-col-modal-title" className="roster-col-modal-title">
          {isAdd ? 'Thêm cột mới' : 'Đổi tên cột'}
        </h3>
        <p className="roster-col-modal-desc">
          {isAdd
            ? 'Cột xuất hiện ngay trên bảng — dùng lưu UID sàn, Discord, ghi chú…'
            : (
              <>
                Đổi tên hiển thị cột <strong>{originalLabel}</strong>. Dữ liệu các ô giữ nguyên.
              </>
            )}
        </p>

        <form className="roster-col-modal-form" onSubmit={handleSubmit}>
          <label className="roster-col-modal-field" htmlFor="roster-col-modal-input">
            <div className="roster-col-modal-field-head">
              <span className="roster-col-modal-field-label">Tên cột</span>
              <span
                className={`roster-col-modal-field-hint${trimmed.length >= COLUMN_LABEL_MAX - 8 ? ' roster-col-modal-field-hint--warn' : ''}`}
              >
                {trimmed.length}/{COLUMN_LABEL_MAX}
              </span>
            </div>
            <div className="roster-col-modal-input-wrap">
              <span className="roster-col-modal-input-icon" aria-hidden>
                <RosterColumnIcon />
              </span>
              <input
                id="roster-col-modal-input"
                className="roster-col-modal-input"
                type="text"
                autoFocus
                value={label}
                maxLength={COLUMN_LABEL_MAX}
                placeholder={isAdd ? 'VD: Discord, MEXC UID…' : 'Nhập tên mới'}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => onLabelChange(event.target.value)}
              />
              {trimmed ? (
                <button
                  type="button"
                  className="roster-col-modal-input-clear"
                  aria-label="Xóa tên cột"
                  onClick={() => onLabelChange('')}
                >
                  ×
                </button>
              ) : null}
            </div>
            {!isAdd && originalLabel ? (
              <p className="roster-col-modal-current">
                Hiện tại: <strong>{originalLabel}</strong>
              </p>
            ) : null}
          </label>

          {isAdd ? (
            <div className="roster-col-suggestions">
              <span className="roster-col-suggestions-label">Gợi ý nhanh</span>
              <div className="roster-col-suggestions-list">
                {COLUMN_SUGGESTIONS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={`roster-col-suggestion${trimmed === item ? ' roster-col-suggestion--active' : ''}`}
                    onClick={() => onLabelChange(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="roster-col-modal-actions">
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              Huỷ
            </button>
            <button type="submit" className="btn btn--primary" disabled={submitDisabled}>
              {isAdd ? 'Thêm cột' : 'Lưu tên'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, 'vi', { sensitivity: 'base', numeric: true })
}

function sortIndicator(active: boolean, dir: SortDir): string {
  if (!active) return '↕'
  return dir === 'asc' ? '↑' : '↓'
}

function toDisplayRow(row: RosterRowItem): RosterDisplayRow {
  const name = row.display_name?.trim() || '—'
  const username = formatUsername(row.username) ?? '—'
  const status = row.status && row.status !== 'unknown' ? row.status : '—'
  const synced = row.last_synced_at ?? row.imported_at ?? ''
  return { phone: row.phone, name, username, status, synced }
}

export function RosterPage() {
  const [store, setStore] = useState<RosterStore>({ columns: [], rows: {} })
  const [sheetRows, setSheetRows] = useState<RosterRowItem[]>([])
  const [databaseEnabled, setDatabaseEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [fillFilter, setFillFilter] = useState<RosterFillFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('phone')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [success, setSuccess] = useState('')
  const [error, setError] = useState('')
  const [addColumnOpen, setAddColumnOpen] = useState(false)
  const [renameColumn, setRenameColumn] = useState<RosterColumn | null>(null)
  const [newColumnLabel, setNewColumnLabel] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [copiedPhone, setCopiedPhone] = useState<string | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const patchTimersRef = useRef<Map<string, number>>(new Map())

  const loadRoster = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.getRoster()
      if (!res.success || !res.data) {
        setError(res.error ?? 'Không tải được sổ acc')
        setSheetRows([])
        setStore({ columns: [], rows: {} })
        return
      }
      setDatabaseEnabled(res.data.database_enabled)
      if (!res.data.database_enabled) {
        setError('Database chưa bật — cấu hình DATABASE_URL trong backend/.env')
        setSheetRows([])
        setStore({ columns: [], rows: {} })
        return
      }
      setSheetRows(res.data.rows ?? [])
      setStore(rosterDataToStore(res.data.columns, res.data.rows))
      setPage(1)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tải được sổ acc')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadRoster()
  }, [loadRoster])

  useEffect(() => {
    if (!success) return
    const timer = window.setTimeout(() => setSuccess(''), 4000)
    return () => window.clearTimeout(timer)
  }, [success])

  useEffect(() => {
    if (!copiedPhone) return
    const timer = window.setTimeout(() => setCopiedPhone(null), 2000)
    return () => window.clearTimeout(timer)
  }, [copiedPhone])

  useEffect(() => {
    return () => {
      for (const timer of patchTimersRef.current.values()) {
        window.clearTimeout(timer)
      }
      patchTimersRef.current.clear()
    }
  }, [])

  const sheetRowsByPhone = useMemo(
    () => new Map(sheetRows.map((row) => [row.phone, row])),
    [sheetRows],
  )

  const tableRows = useMemo<RosterDisplayRow[]>(() => {
    return sheetRows.map(toDisplayRow)
  }, [sheetRows])

  const filteredRows = useMemo(() => {
    return tableRows.filter((row) => {
      const apiFields = sheetRowsByPhone.get(row.phone)?.custom_fields

      if (
        !rowMatchesFillFilter(store, row.phone, store.columns, fillFilter, 'all', apiFields)
      ) {
        return false
      }

      return rowMatchesRosterSearch(
        store,
        row.phone,
        store.columns,
        search,
        'all',
        {
          phone: row.phone,
          name: row.name,
          username: row.username,
          status: row.status,
        },
        apiFields,
      )
    })
  }, [tableRows, search, fillFilter, store, sheetRowsByPhone])

  const sortedRows = useMemo(() => {
    const rows = [...filteredRows]
    rows.sort((a, b) => {
      let left = ''
      let right = ''

      if (sortKey === 'phone') {
        left = a.phone
        right = b.phone
      } else if (sortKey === 'name') {
        left = a.name
        right = b.name
      } else if (sortKey === 'username') {
        left = a.username
        right = b.username
      } else if (sortKey === 'status') {
        left = a.status
        right = b.status
      } else if (sortKey === 'synced') {
        left = a.synced
        right = b.synced
      } else {
        left = getMergedCellValue(
          store,
          a.phone,
          sortKey,
          sheetRowsByPhone.get(a.phone)?.custom_fields,
        )
        right = getMergedCellValue(
          store,
          b.phone,
          sortKey,
          sheetRowsByPhone.get(b.phone)?.custom_fields,
        )
      }

      const cmp = compareText(left, right)
      return sortDir === 'asc' ? cmp : -cmp
    })
    return rows
  }, [filteredRows, sortKey, sortDir, store, sheetRowsByPhone])

  const filledCellCount = useMemo(() => {
    let count = 0
    for (const row of sheetRows) {
      const merged = getMergedRowFields(store, row.phone, row.custom_fields)
      count += Object.values(merged).filter((value) => value.trim()).length
    }
    return count
  }, [store, sheetRows])

  const filterCounts = useMemo(() => {
    let filled = 0
    let empty = 0
    for (const row of tableRows) {
      const apiFields = sheetRowsByPhone.get(row.phone)?.custom_fields
      if (
        rowMatchesFillFilter(store, row.phone, store.columns, 'filled', 'all', apiFields)
      ) {
        filled += 1
      } else {
        empty += 1
      }
    }
    return { all: tableRows.length, filled, empty }
  }, [tableRows, store, sheetRowsByPhone])

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize))

  const pagedRows = useMemo(() => {
    const safePage = Math.min(page, totalPages)
    const start = (safePage - 1) * pageSize
    return sortedRows.slice(start, start + pageSize)
  }, [sortedRows, page, pageSize, totalPages])

  const pageFrom = sortedRows.length === 0 ? 0 : (Math.min(page, totalPages) - 1) * pageSize + 1
  const pageTo = Math.min(sortedRows.length, Math.min(page, totalPages) * pageSize)

  useEffect(() => {
    setPage(1)
  }, [search, fillFilter, pageSize])

  const copyPhone = useCallback(async (phone: string) => {
    try {
      await navigator.clipboard.writeText(phone)
      setCopiedPhone(phone)
    } catch {
      setError('Không copy được số điện thoại')
    }
  }, [])

  const schedulePatch = useCallback((phone: string, columnKey: string, value: string) => {
    const timerKey = `${phone}:${columnKey}`
    const existing = patchTimersRef.current.get(timerKey)
    if (existing) window.clearTimeout(existing)

    const timer = window.setTimeout(() => {
      patchTimersRef.current.delete(timerKey)
      setSaving(true)
      void api
        .patchRosterRow(phone, { [columnKey]: value })
        .then((res) => {
          if (!res.success) {
            setError(res.error ?? 'Không lưu được ô')
          }
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : 'Không lưu được ô')
        })
        .finally(() => setSaving(false))
    }, PATCH_DEBOUNCE_MS)

    patchTimersRef.current.set(timerKey, timer)
  }, [])

  const handleSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))
        return prev
      }
      setSortDir('asc')
      return key
    })
  }, [])

  const handleCellChange = useCallback((phone: string, columnKey: string, value: string) => {
    setStore((prev) => setCellValue(prev, phone, columnKey, value))
  }, [])

  const handleCellBlur = useCallback(
    (phone: string, columnKey: string, value: string) => {
      schedulePatch(phone, columnKey, value)
    },
    [schedulePatch],
  )

  const handleAddColumn = useCallback(async () => {
    const label = newColumnLabel.trim()
    if (!label) return
    setError('')
    try {
      const res = await api.createRosterColumn(label)
      if (!res.success || !res.data) {
        setError(res.error ?? 'Không thêm được cột')
        return
      }
      setStore((prev) => ({
        ...prev,
        columns: [
          ...prev.columns,
          { key: res.data!.column_key, label: res.data!.label },
        ],
      }))
      setNewColumnLabel('')
      setAddColumnOpen(false)
      setSuccess(`Đã thêm cột "${label}"`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thêm được cột')
    }
  }, [newColumnLabel])

  const columnModalMode: RosterColumnModalMode | null = addColumnOpen
    ? 'add'
    : renameColumn
      ? 'rename'
      : null

  function closeColumnModal() {
    setAddColumnOpen(false)
    setRenameColumn(null)
    setNewColumnLabel('')
  }

  function openAddColumnModal() {
    setRenameColumn(null)
    setNewColumnLabel('')
    setAddColumnOpen(true)
  }

  function openRenameColumnModal(column: RosterColumn) {
    setAddColumnOpen(false)
    setRenameColumn(column)
    setNewColumnLabel(column.label)
  }

  const handleRenameColumn = useCallback(async () => {
    if (!renameColumn) return
    const label = newColumnLabel.trim()
    if (!label || label === renameColumn.label) {
      setRenameColumn(null)
      setNewColumnLabel('')
      return
    }
    setError('')
    try {
      const res = await api.renameRosterColumn(renameColumn.key, label)
      if (!res.success || !res.data) {
        setError(res.error ?? 'Không đổi tên được cột')
        return
      }
      setStore((prev) => ({
        ...prev,
        columns: prev.columns.map((col) =>
          col.key === renameColumn.key ? { ...col, label: res.data!.label } : col,
        ),
      }))
      setRenameColumn(null)
      setNewColumnLabel('')
      setSuccess(`Đã đổi tên cột thành "${label}"`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không đổi tên được cột')
    }
  }, [renameColumn, newColumnLabel])

  const handleRemoveColumn = useCallback(
    async (column: RosterColumn) => {
      const confirmed = window.confirm(
        `Xóa cột "${column.label}"?\n\nDữ liệu trong cột này sẽ mất trên toàn bộ acc.`,
      )
      if (!confirmed) return
      setError('')
      try {
        const res = await api.deleteRosterColumn(column.key)
        if (!res.success) {
          setError(res.error ?? 'Không xóa được cột')
          return
        }
        setStore((prev) => ({
          columns: prev.columns.filter((col) => col.key !== column.key),
          rows: Object.fromEntries(
            Object.entries(prev.rows).map(([phone, row]) => {
              if (!(column.key in row)) return [phone, row]
              const next = { ...row }
              delete next[column.key]
              return [phone, next]
            }),
          ),
        }))
        if (sortKey === column.key) setSortKey('phone')
        setSuccess(`Đã xóa cột "${column.label}"`)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Không xóa được cột')
      }
    },
    [sortKey],
  )

  const handleExport = useCallback(() => {
    const csv = buildRosterCsv(
      store,
      tableRows.map((row) => ({
        phone: row.phone,
        name: row.name === '—' ? '' : row.name,
        username: row.username === '—' ? '' : row.username,
        status: row.status === '—' ? '' : row.status,
        synced: row.synced ? formatDate(row.synced) : '',
      })),
    )
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `roster-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
    setSuccess('Đã tải CSV')
  }, [store, tableRows])

  const handleImportFile = useCallback(
    async (file: File) => {
      setError('')
      try {
        const text = await file.text()
        const knownPhones = new Set(sheetRows.map((row) => row.phone))
        const payload = parseRosterCsvForApi(store, text, knownPhones)
        const res = await api.importRoster(payload)
        if (!res.success || !res.data) {
          setError(res.error ?? 'Import thất bại')
          return
        }
        await loadRoster()
        setSuccess(
          `Import xong — ${res.data.updated_phones} dòng, ${res.data.new_columns} cột mới`,
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Không đọc được file CSV')
      }
    },
    [store, sheetRows, loadRoster],
  )

  return (
    <div className="page page--roster">
      <header className="page-header">
        <div>
          <span className="roster-page-kicker">Bảng nội bộ</span>
          <h1>Sổ acc</h1>
          <p className="page-desc">
            Bảng kiểu Excel — map Telegram với BTSE, Binance, Discord… Cột Telegram từ{' '}
            <Link to="/sessions">Sessions</Link>; cột tùy chỉnh lưu trong database.
          </p>
          <div className="roster-shortcut-hints" aria-label="Lối tắt">
            <span className="roster-shortcut-hint">
              <RosterCopyIcon /> Copy SĐT
            </span>
            <span className="roster-shortcut-hint roster-shortcut-hint--chat">
              <RosterChatIcon /> Chat → Dialogs
            </span>
            <span className="roster-shortcut-hint roster-shortcut-hint--profile">
              <RosterProfileIcon /> Hồ sơ → Telegram ID
            </span>
          </div>
        </div>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => void loadRoster()}
          disabled={loading}
        >
          Làm mới
        </button>
      </header>

      <Alert type="error" message={error} />
      <Alert type="success" message={success} />

      <section className="stats-grid">
        <article className="stat-card">
          <p className="stat-label">Session</p>
          <p className="stat-value">{sheetRows.length}</p>
        </article>
        <article className="stat-card">
          <p className="stat-label">Cột tùy chỉnh</p>
          <p className="stat-value">{store.columns.length}</p>
        </article>
        <article className="stat-card stat-card--active">
          <p className="stat-label">Ô đã điền</p>
          <p className="stat-value">{filledCellCount}</p>
        </article>
        <article className="stat-card">
          <p className="stat-label">Hiển thị</p>
          <p className="stat-value">{sortedRows.length}</p>
        </article>
      </section>

      <section className="panel roster-sheet-panel">
        <div className="roster-toolbar roster-toolbar--sheet">
          <div className="roster-toolbar-left">
            <button
              type="button"
              className="roster-add-col-btn"
              onClick={openAddColumnModal}
              disabled={!databaseEnabled || loading}
            >
              <span className="roster-add-col-btn-icon" aria-hidden>
                <RosterPlusIcon />
              </span>
              <span>Thêm cột</span>
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={handleExport}>
              Export CSV
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => importInputRef.current?.click()}
              disabled={!databaseEnabled || loading}
            >
              Import CSV
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) void handleImportFile(file)
              }}
            />
          </div>
        </div>

        <div className="roster-search-bar">
          <div className="roster-search-wrap">
            <span className="roster-search-icon" aria-hidden>
              <RosterSearchIcon />
            </span>
            <input
              type="search"
              className="roster-search-input"
              placeholder="Tìm SĐT, tên, @username, UID sàn…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Tìm trong sổ acc"
            />
            {search ? (
              <button
                type="button"
                className="roster-search-clear"
                aria-label="Xóa từ khóa tìm"
                onClick={() => setSearch('')}
              >
                ×
              </button>
            ) : null}
          </div>

          <label className="roster-filter-field">
            <span className="roster-filter-label">Dữ liệu</span>
            <select
              className="roster-filter-select"
              value={fillFilter}
              onChange={(event) => setFillFilter(event.target.value as RosterFillFilter)}
              aria-label="Lọc dòng đã nhập"
            >
              <option value="all">Tất cả ({filterCounts.all})</option>
              <option value="filled">Đã nhập ({filterCounts.filled})</option>
              <option value="empty">Chưa nhập ({filterCounts.empty})</option>
            </select>
          </label>
        </div>

        <div className="roster-sheet-wrap">
          {loading ? (
            <div className="roster-empty">Đang tải sổ acc…</div>
          ) : sortedRows.length === 0 ? (
            <div className="roster-empty">
              {sheetRows.length === 0
                ? 'Chưa có session — thêm ở Sessions hoặc Tài khoản.'
                : 'Không có dòng khớp bộ lọc hiện tại.'}
            </div>
          ) : pagedRows.length === 0 ? (
            <div className="roster-empty">Không có dòng trên trang này.</div>
          ) : (
            <table className="roster-sheet">
              <thead>
                <tr>
                  {FIXED_COLUMNS.map((col) => (
                    <th key={col.key} className={col.className}>
                      <button
                        type="button"
                        className={`roster-th-btn${sortKey === col.key ? ' roster-th-btn--active' : ''}`}
                        onClick={() => handleSort(col.key)}
                      >
                        <span className="roster-th-label">{col.label}</span>
                        <span className="roster-th-sort">
                          {sortIndicator(sortKey === col.key, sortDir)}
                        </span>
                      </button>
                    </th>
                  ))}
                  <th className="roster-col--actions">
                    <div className="roster-th-static">
                      <span className="roster-th-label">Lối tắt</span>
                    </div>
                  </th>
                  {store.columns.map((col) => (
                    <th key={col.key} className="roster-col--custom">
                      <div className="roster-custom-th">
                        <button
                          type="button"
                          className={`roster-th-btn roster-custom-th-sort${sortKey === col.key ? ' roster-th-btn--active' : ''}`}
                          onClick={() => handleSort(col.key)}
                        >
                          <span className="roster-th-label">{col.label}</span>
                          <span className="roster-th-sort">
                            {sortIndicator(sortKey === col.key, sortDir)}
                          </span>
                        </button>
                        <div className="roster-custom-th-menu">
                          <button
                            type="button"
                            className="roster-th-menu-btn"
                            title={`Đổi tên cột ${col.label}`}
                            aria-label={`Đổi tên cột ${col.label}`}
                            onClick={() => openRenameColumnModal(col)}
                            disabled={!databaseEnabled}
                          >
                            <RosterEditIcon />
                          </button>
                          <button
                            type="button"
                            className="roster-th-menu-btn roster-th-menu-btn--danger"
                            title={`Xóa cột ${col.label}`}
                            aria-label={`Xóa cột ${col.label}`}
                            onClick={() => void handleRemoveColumn(col)}
                            disabled={!databaseEnabled}
                          >
                            <RosterTrashIcon />
                          </button>
                        </div>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pagedRows.map((row) => (
                  <tr key={row.phone}>
                    <td className="roster-col--phone">
                      <div className="roster-phone-cell">
                        <span className="roster-phone-value mono">{row.phone}</span>
                        <button
                          type="button"
                          className={`roster-copy-btn${copiedPhone === row.phone ? ' roster-copy-btn--done' : ''}`}
                          title={copiedPhone === row.phone ? 'Đã copy' : 'Copy SĐT'}
                          aria-label={
                            copiedPhone === row.phone
                              ? `Đã copy ${row.phone}`
                              : `Copy ${row.phone}`
                          }
                          onClick={() => void copyPhone(row.phone)}
                        >
                          {copiedPhone === row.phone ? <RosterCheckIcon /> : <RosterCopyIcon />}
                        </button>
                      </div>
                    </td>
                    <td>
                      <div className="roster-cell-fixed" title={row.name}>
                        {row.name}
                      </div>
                    </td>
                    <td>
                      <div className="roster-cell-fixed roster-cell-fixed--muted">
                        {row.username}
                      </div>
                    </td>
                    <td>
                      <div className="roster-cell-fixed">
                        {row.status !== '—' ? <StatusBadge status={row.status} /> : '—'}
                      </div>
                    </td>
                    <td>
                      <div
                        className="roster-cell-fixed roster-cell-fixed--muted"
                        title={row.synced ? formatDate(row.synced) : undefined}
                      >
                        {row.synced ? formatRelativeDate(row.synced) : '—'}
                      </div>
                    </td>
                    <td className="roster-col--actions">
                      <div className="roster-row-actions">
                        <Link
                          to={`/dialogs?phone=${encodeURIComponent(row.phone)}`}
                          className="roster-quick-btn roster-quick-btn--chat"
                          title="Mở Dialogs với acc này"
                        >
                          <span className="roster-quick-btn-icon">
                            <RosterChatIcon />
                          </span>
                          <span>Chat</span>
                        </Link>
                        <Link
                          to={`/sessions?phone=${encodeURIComponent(row.phone)}`}
                          className="roster-quick-btn roster-quick-btn--profile"
                          title="Chi tiết — Telegram ID"
                        >
                          <span className="roster-quick-btn-icon">
                            <RosterProfileIcon />
                          </span>
                          <span>Hồ sơ</span>
                        </Link>
                      </div>
                    </td>
                    {store.columns.map((col) => (
                      <td key={`${row.phone}-${col.key}`} className="roster-col--custom">
                        <input
                          type="text"
                          className="roster-cell-input"
                          value={getMergedCellValue(
                            store,
                            row.phone,
                            col.key,
                            sheetRowsByPhone.get(row.phone)?.custom_fields,
                          )}
                          placeholder="—"
                          disabled={!databaseEnabled}
                          onChange={(event) =>
                            handleCellChange(row.phone, col.key, event.target.value)
                          }
                          onBlur={(event) =>
                            handleCellBlur(row.phone, col.key, event.target.value)
                          }
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="roster-foot">
          <span className="roster-local-pill">
            {databaseEnabled ? 'Lưu database' : 'Database tắt'}
            {saving ? ' · đang lưu…' : ''}
          </span>
          <Pagination
            page={Math.min(page, totalPages)}
            totalPages={totalPages}
            total={sortedRows.length}
            from={pageFrom}
            to={pageTo}
            pageSize={pageSize}
            pageSizeOptions={[10, 20, 50, 100]}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
          <span>Copy SĐT · Chat/Hồ sơ ở cột Lối tắt · Sửa ô blur để lưu</span>
        </div>
      </section>

      {columnModalMode ? (
        <RosterColumnModal
          mode={columnModalMode}
          label={newColumnLabel}
          originalLabel={renameColumn?.label}
          submitDisabled={
            !newColumnLabel.trim() ||
            (columnModalMode === 'rename' &&
              newColumnLabel.trim() === renameColumn?.label)
          }
          onLabelChange={setNewColumnLabel}
          onSubmit={() => {
            if (columnModalMode === 'add') void handleAddColumn()
            else void handleRenameColumn()
          }}
          onClose={closeColumnModal}
        />
      ) : null}
    </div>
  )
}