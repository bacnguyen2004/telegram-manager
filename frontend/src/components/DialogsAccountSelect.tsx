import { useEffect, useMemo, useRef, useState } from 'react'
import './DialogsAccountSelect.css'
import { SessionAvatar } from './SessionAvatar'
import { StatusBadge } from './StatusBadge'
import type { SessionMetaOverviewItem } from '../types/api'
import {
  ACCOUNT_STATUS_FILTER_OPTIONS,
  type AccountStatusFilter,
  computeAccountFilterCounts,
  filterAccountPhones,
  resolveAccountPickerLabels,
  resolveAccountStatus,
} from '../utils/accountPicker'
import { resolveSessionName } from '../utils/sessionDisplay'

interface DialogsAccountSelectProps {
  value: string
  onChange: (phone: string) => void
  sessions: string[]
  getMeta: (phone: string) => SessionMetaOverviewItem | undefined
  loading?: boolean
  disabled?: boolean
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="M20 20l-3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`dlg-acc-select-chevron${open ? ' dlg-acc-select-chevron--open' : ''}`}
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export function DialogsAccountSelect({
  value,
  onChange,
  sessions,
  getMeta,
  loading = false,
  disabled = false,
}: DialogsAccountSelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<AccountStatusFilter>('all')
  const rootRef = useRef<HTMLDivElement>(null)

  const selectedMeta = value ? getMeta(value) : undefined
  const selectedLabels = value
    ? resolveAccountPickerLabels(value, selectedMeta)
    : { primary: 'Chọn tài khoản', secondary: null as string | null }

  const filterCounts = useMemo(
    () => computeAccountFilterCounts(sessions, search, getMeta),
    [sessions, search, getMeta],
  )

  const filteredPhones = useMemo(
    () => filterAccountPhones(sessions, search, statusFilter, getMeta),
    [sessions, search, statusFilter, getMeta],
  )

  const hasFilters = Boolean(search.trim()) || statusFilter !== 'all'

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  function clearFilters() {
    setSearch('')
    setStatusFilter('all')
  }

  function pickPhone(phone: string) {
    onChange(phone)
    setOpen(false)
  }

  const controlDisabled = disabled || loading

  if (loading) {
    return (
      <div className="dlg-acc-select dlg-acc-select--loading">
        <span className="dlg-acc-select-label">Tài khoản</span>
        <p className="dlg-acc-select-loading muted">Đang tải danh sách session…</p>
      </div>
    )
  }

  if (sessions.length === 0) {
    return (
      <div className="dlg-acc-select dlg-acc-select--empty">
        <span className="dlg-acc-select-label">Tài khoản</span>
        <p className="dlg-acc-select-empty muted">
          Chưa có session. Hãy <strong>Đăng nhập</strong> hoặc <strong>Đăng ký</strong> trước.
        </p>
      </div>
    )
  }

  const selectedAvatarLabel = resolveSessionName(selectedMeta) || selectedLabels.primary

  return (
    <div
      className={`dlg-acc-select${open ? ' dlg-acc-select--open' : ''}`}
      ref={rootRef}
    >
      <span className="dlg-acc-select-label">Tài khoản</span>
      <div className="dlg-acc-select-control">
        <button
          type="button"
          className={`dlg-acc-select-trigger${value ? ' dlg-acc-select-trigger--selected' : ''}`}
          onClick={() => setOpen((current) => !current)}
          disabled={controlDisabled}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          {value ? (
            <>
              <SessionAvatar
                phone={value}
                label={selectedAvatarLabel}
                hasAvatar={selectedMeta?.has_avatar}
                avatarUpdatedAt={selectedMeta?.avatar_updated_at}
                size="sm"
              />
              <span className="dlg-acc-select-copy">
                <span className="dlg-acc-select-name">{selectedLabels.primary}</span>
                {selectedLabels.secondary ? (
                  <span className="dlg-acc-select-meta">{selectedLabels.secondary}</span>
                ) : null}
              </span>
              {resolveAccountStatus(selectedMeta) ? (
                <StatusBadge status={resolveAccountStatus(selectedMeta)!} />
              ) : null}
            </>
          ) : (
            <span className="dlg-acc-select-placeholder">Chọn tài khoản để xem chat…</span>
          )}
          <ChevronIcon open={open} />
        </button>

        {open ? (
          <div className="dlg-acc-select-menu" role="presentation">
            <div className="dlg-acc-select-tools">
              <label className="dlg-acc-select-search">
                <SearchIcon />
                <input
                  type="search"
                  placeholder="Tìm tên, username, SĐT…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  autoFocus
                />
              </label>
              <div className="dlg-acc-select-filters" role="group" aria-label="Lọc trạng thái">
                {ACCOUNT_STATUS_FILTER_OPTIONS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`dlg-acc-select-filter${statusFilter === item.id ? ' dlg-acc-select-filter--active' : ''}`}
                    onClick={() => setStatusFilter(item.id)}
                  >
                    {item.label}
                    <span className="dlg-acc-select-filter-count">{filterCounts[item.id]}</span>
                  </button>
                ))}
              </div>
              {hasFilters ? (
                <button
                  type="button"
                  className="dlg-acc-select-clear"
                  onClick={clearFilters}
                >
                  Xóa bộ lọc
                </button>
              ) : null}
            </div>

            <ul className="dlg-acc-select-list" role="listbox" aria-label="Danh sách tài khoản">
              {filteredPhones.length === 0 ? (
                <li className="dlg-acc-select-empty-item muted">Không có acc khớp bộ lọc</li>
              ) : (
                filteredPhones.map((phone) => {
                  const meta = getMeta(phone)
                  const labels = resolveAccountPickerLabels(phone, meta)
                  const status = resolveAccountStatus(meta)
                  const avatarLabel = resolveSessionName(meta) || labels.primary
                  const selected = value === phone

                  return (
                    <li key={phone} role="option" aria-selected={selected}>
                      <button
                        type="button"
                        className={`dlg-acc-select-item${selected ? ' dlg-acc-select-item--selected' : ''}`}
                        onClick={() => pickPhone(phone)}
                      >
                        <SessionAvatar
                          phone={phone}
                          label={avatarLabel}
                          hasAvatar={meta?.has_avatar}
                          avatarUpdatedAt={meta?.avatar_updated_at}
                          size="sm"
                        />
                        <span className="dlg-acc-select-item-copy">
                          <span className="dlg-acc-select-item-name">{labels.primary}</span>
                          {labels.secondary ? (
                            <span className="dlg-acc-select-item-meta">{labels.secondary}</span>
                          ) : null}
                        </span>
                        {status ? <StatusBadge status={status} /> : null}
                      </button>
                    </li>
                  )
                })
              )}
            </ul>

            <div className="dlg-acc-select-foot muted">
              {filteredPhones.length} / {sessions.length} acc hiển thị
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}