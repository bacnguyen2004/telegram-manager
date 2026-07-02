import { useEffect, useMemo, useState } from 'react'
import './AccountPickerPanel.css'
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

export interface AccountPickerToolbarPill {
  label: string
  onClick: () => void
  disabled?: boolean
  muted?: boolean
}

export interface AccountPickerFilterState {
  filteredCount: number
  totalCount: number
  hasFilters: boolean
}

export interface AccountPickerPanelProps {
  className?: string
  title: string
  meta?: string
  badgeCount?: number
  sessions: string[]
  loading?: boolean
  getMeta: (phone: string) => SessionMetaOverviewItem | undefined
  selectionMode: 'single' | 'multiple'
  selectedPhone?: string
  onSelectedPhoneChange?: (phone: string) => void
  selectedPhones?: Set<string>
  onSelectedPhonesChange?: (phones: Set<string>) => void
  disabled?: boolean
  busy?: boolean
  footerSelectedSuffix?: string
  showSelectionToolbar?: boolean
  showSelectActivePill?: boolean
  hasStatusData?: boolean
  showClearFiltersInToolbar?: boolean
  toolbarPills?: AccountPickerToolbarPill[]
  notes?: React.ReactNode
  panelFoot?: React.ReactNode
  bodyBordered?: boolean
  onFiltersChange?: (state: AccountPickerFilterState) => void
}

function AccountPickerSearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="M20 20L16.5 16.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export function AccountPickerPanel({
  className,
  title,
  meta,
  badgeCount = 0,
  sessions,
  loading = false,
  getMeta,
  selectionMode,
  selectedPhone = '',
  onSelectedPhoneChange,
  selectedPhones,
  onSelectedPhonesChange,
  disabled = false,
  busy = false,
  footerSelectedSuffix = 'acc đã chọn',
  showSelectionToolbar,
  showSelectActivePill = false,
  hasStatusData = true,
  showClearFiltersInToolbar = false,
  toolbarPills = [],
  notes,
  panelFoot,
  bodyBordered = true,
  onFiltersChange,
}: AccountPickerPanelProps) {
  const [accountSearch, setAccountSearch] = useState('')
  const [accountStatusFilter, setAccountStatusFilter] = useState<AccountStatusFilter>('all')

  const accountFilterCounts = useMemo(
    () => computeAccountFilterCounts(sessions, accountSearch, getMeta),
    [sessions, accountSearch, getMeta],
  )

  const filteredPhones = useMemo(
    () => filterAccountPhones(sessions, accountSearch, accountStatusFilter, getMeta),
    [sessions, accountSearch, accountStatusFilter, getMeta],
  )

  const hasAccountFilters =
    Boolean(accountSearch.trim()) || accountStatusFilter !== 'all'

  useEffect(() => {
    onFiltersChange?.({
      filteredCount: filteredPhones.length,
      totalCount: sessions.length,
      hasFilters: hasAccountFilters,
    })
  }, [filteredPhones.length, sessions.length, hasAccountFilters, onFiltersChange])

  const activeVisibleCount = useMemo(
    () =>
      filteredPhones.filter((phone) => resolveAccountStatus(getMeta(phone)) === 'active').length,
    [filteredPhones, getMeta],
  )

  const selectionToolbar =
    showSelectionToolbar ?? selectionMode === 'multiple'

  function clearAccountFilters() {
    setAccountSearch('')
    setAccountStatusFilter('all')
  }

  function togglePhone(phone: string) {
    if (!onSelectedPhonesChange || !selectedPhones) return
    const next = new Set(selectedPhones)
    if (next.has(phone)) next.delete(phone)
    else next.add(phone)
    onSelectedPhonesChange(next)
  }

  function selectAllVisible() {
    onSelectedPhonesChange?.(new Set(filteredPhones))
  }

  function selectActiveVisible() {
    const active = new Set(
      filteredPhones.filter((phone) => resolveAccountStatus(getMeta(phone)) === 'active'),
    )
    onSelectedPhonesChange?.(active)
  }

  function clearSelection() {
    onSelectedPhonesChange?.(new Set())
  }

  const showTools = !loading && sessions.length > 0

  return (
    <aside className={`panel acc-picker-panel${className ? ` ${className}` : ''}`}>
      <div className="acc-picker-head">
        <div>
          <h2>{title}</h2>
          {meta ? <p className="panel-meta">{meta}</p> : null}
        </div>
        <span className="acc-picker-badge">{badgeCount}</span>
      </div>

      <div className={`acc-picker-body${bodyBordered ? ' acc-picker-body--bordered' : ''}`}>
        {showTools ? (
          <div className="acc-picker-tools">
            <div className="acc-picker-filters">
              <div className="acc-picker-search-wrap">
                <span className="acc-picker-search-icon" aria-hidden>
                  <AccountPickerSearchIcon />
                </span>
                <input
                  type="search"
                  className="acc-picker-search"
                  value={accountSearch}
                  onChange={(e) => setAccountSearch(e.target.value)}
                  placeholder="Tìm SĐT, tên, @username…"
                  autoComplete="off"
                  disabled={disabled}
                  aria-label="Tìm tài khoản"
                />
                {accountSearch ? (
                  <button
                    type="button"
                    className="acc-picker-search-clear"
                    aria-label="Xóa tìm kiếm"
                    onClick={() => setAccountSearch('')}
                    disabled={disabled}
                  >
                    ×
                  </button>
                ) : null}
              </div>
              <label className="acc-picker-filter-field">
                <span className="acc-picker-filter-label">Trạng thái</span>
                <select
                  className="acc-picker-filter-select"
                  value={accountStatusFilter}
                  onChange={(e) =>
                    setAccountStatusFilter(e.target.value as AccountStatusFilter)
                  }
                  disabled={disabled}
                  aria-label="Lọc theo trạng thái"
                >
                  {ACCOUNT_STATUS_FILTER_OPTIONS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label} ({accountFilterCounts[item.id]})
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {selectionToolbar ? (
              <div className="acc-picker-toolbar">
                <button
                  type="button"
                  className="acc-picker-pill"
                  onClick={selectAllVisible}
                  disabled={disabled || filteredPhones.length === 0}
                >
                  Chọn hiển thị
                </button>
                {showSelectActivePill ? (
                  <button
                    type="button"
                    className="acc-picker-pill"
                    onClick={selectActiveVisible}
                    disabled={disabled || !hasStatusData || activeVisibleCount === 0}
                  >
                    Live
                  </button>
                ) : null}
                <button
                  type="button"
                  className="acc-picker-pill"
                  onClick={clearSelection}
                  disabled={disabled || (selectedPhones?.size ?? 0) === 0}
                >
                  Bỏ chọn
                </button>
                {showClearFiltersInToolbar && hasAccountFilters ? (
                  <button
                    type="button"
                    className="acc-picker-pill acc-picker-pill--muted"
                    onClick={clearAccountFilters}
                    disabled={disabled}
                  >
                    Xóa lọc
                  </button>
                ) : null}
                {toolbarPills.map((pill) => (
                  <button
                    key={pill.label}
                    type="button"
                    className={`acc-picker-pill${pill.muted ? ' acc-picker-pill--muted' : ''}`}
                    onClick={pill.onClick}
                    disabled={disabled || pill.disabled}
                  >
                    {pill.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <ul className="acc-picker-list" role="listbox" aria-label="Danh sách tài khoản">
          {loading ? (
            <li className="acc-picker-empty">Đang tải sessions…</li>
          ) : sessions.length === 0 ? (
            <li className="acc-picker-empty">
              <p>Chưa có session</p>
              <p className="acc-picker-empty-hint muted">Thêm acc ở Sessions trước.</p>
            </li>
          ) : filteredPhones.length === 0 ? (
            <li className="acc-picker-empty">
              <p>Không có acc khớp bộ lọc</p>
              {hasAccountFilters ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={clearAccountFilters}
                >
                  Xóa bộ lọc
                </button>
              ) : null}
            </li>
          ) : (
            filteredPhones.map((phone) => {
              const meta = getMeta(phone)
              const labels = resolveAccountPickerLabels(phone, meta)
              const status = resolveAccountStatus(meta)
              const avatarLabel = resolveSessionName(meta) || labels.primary
              const selected =
                selectionMode === 'multiple'
                  ? Boolean(selectedPhones?.has(phone))
                  : selectedPhone === phone

              if (selectionMode === 'multiple') {
                return (
                  <li key={phone} role="option" aria-selected={selected}>
                    <label
                      className={`acc-picker-item${selected ? ' acc-picker-item--selected' : ''}`}
                    >
                      <input
                        type="checkbox"
                        className="acc-picker-input"
                        checked={selected}
                        onChange={() => togglePhone(phone)}
                        disabled={disabled}
                      />
                      <span
                        className={`acc-picker-indicator acc-picker-indicator--check${selected ? ' acc-picker-indicator--on' : ''}`}
                        aria-hidden
                      />
                      <SessionAvatar
                        phone={phone}
                        label={avatarLabel}
                        hasAvatar={meta?.has_avatar}
                        avatarUpdatedAt={meta?.avatar_updated_at}
                        size="sm"
                      />
                      <span className="acc-picker-main">
                        <span className="acc-picker-primary">{labels.primary}</span>
                        {labels.secondary ? (
                          <span className="acc-picker-secondary muted">{labels.secondary}</span>
                        ) : null}
                      </span>
                      {status ? (
                        <StatusBadge status={status} />
                      ) : (
                        <span className="acc-picker-muted">—</span>
                      )}
                    </label>
                  </li>
                )
              }

              return (
                <li key={phone} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={`acc-picker-item acc-picker-item--single${selected ? ' acc-picker-item--selected' : ''}`}
                    onClick={() => onSelectedPhoneChange?.(phone)}
                    disabled={disabled}
                  >
                    <span
                      className={`acc-picker-indicator acc-picker-indicator--radio${selected ? ' acc-picker-indicator--on' : ''}`}
                      aria-hidden
                    />
                    <SessionAvatar
                      phone={phone}
                      label={avatarLabel}
                      hasAvatar={meta?.has_avatar}
                      avatarUpdatedAt={meta?.avatar_updated_at}
                      size="sm"
                    />
                    <span className="acc-picker-main">
                      <span className="acc-picker-primary">{labels.primary}</span>
                      {labels.secondary ? (
                        <span className="acc-picker-secondary muted">{labels.secondary}</span>
                      ) : null}
                    </span>
                    {status ? (
                      <StatusBadge status={status} />
                    ) : (
                      <span className="acc-picker-muted">—</span>
                    )}
                  </button>
                </li>
              )
            })
          )}
        </ul>

        {sessions.length > 0 ? (
          <div className="acc-picker-foot">
            <span>
              <strong>{badgeCount}</strong> {footerSelectedSuffix}
            </span>
            {busy ? <span className="acc-picker-foot-live">Đang chạy…</span> : null}
          </div>
        ) : null}
      </div>

      {notes ? <div className="acc-picker-notes">{notes}</div> : null}
      {panelFoot ? <div className="acc-picker-panel-foot muted">{panelFoot}</div> : null}
    </aside>
  )
}