import { useEffect, useMemo, useRef, useState, type UIEvent } from 'react'
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
  /** Hide “Chọn hiển thị” bulk action (useful when maxSelection is small). */
  showSelectAllPill?: boolean
  hasStatusData?: boolean
  showClearFiltersInToolbar?: boolean
  toolbarPills?: AccountPickerToolbarPill[]
  notes?: React.ReactNode
  panelFoot?: React.ReactNode
  bodyBordered?: boolean
  onFiltersChange?: (state: AccountPickerFilterState) => void
  /** Cap multi-select size (e.g. campaign cast max 8). */
  maxSelection?: number
  onMaxSelectionReached?: (max: number) => void
  /** Fixed list viewport height in px; defaults to flex fill. */
  listHeight?: number
  /** Hide outer chrome for embedding inside another card. */
  embedded?: boolean
}

const ROW_HEIGHT = 52
const OVERSCAN = 10
const VIRTUALIZE_FROM = 60

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
  showSelectAllPill = true,
  hasStatusData = true,
  showClearFiltersInToolbar = false,
  toolbarPills = [],
  notes,
  panelFoot,
  bodyBordered = true,
  onFiltersChange,
  maxSelection,
  onMaxSelectionReached,
  listHeight,
  embedded = false,
}: AccountPickerPanelProps) {
  const [accountSearch, setAccountSearch] = useState('')
  const [accountStatusFilter, setAccountStatusFilter] = useState<AccountStatusFilter>('all')
  const [showSelectedOnly, setShowSelectedOnly] = useState(false)
  const listRef = useRef<HTMLUListElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(listHeight ?? 360)

  const accountFilterCounts = useMemo(
    () => computeAccountFilterCounts(sessions, accountSearch, getMeta),
    [sessions, accountSearch, getMeta],
  )

  const filteredPhones = useMemo(() => {
    let list = filterAccountPhones(
      sessions,
      accountSearch,
      accountStatusFilter,
      getMeta,
    )
    if (showSelectedOnly && selectionMode === 'multiple' && selectedPhones) {
      list = list.filter((phone) => selectedPhones.has(phone))
    }
    return list
  }, [
    sessions,
    accountSearch,
    accountStatusFilter,
    getMeta,
    showSelectedOnly,
    selectionMode,
    selectedPhones,
  ])

  const hasAccountFilters =
    Boolean(accountSearch.trim()) ||
    accountStatusFilter !== 'all' ||
    showSelectedOnly

  useEffect(() => {
    onFiltersChange?.({
      filteredCount: filteredPhones.length,
      totalCount: sessions.length,
      hasFilters: hasAccountFilters,
    })
  }, [filteredPhones.length, sessions.length, hasAccountFilters, onFiltersChange])

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const measure = () => {
      if (listHeight) {
        setViewportH(listHeight)
        return
      }
      setViewportH(el.clientHeight || 360)
    }
    measure()
    const ro =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [listHeight, loading, sessions.length, filteredPhones.length])

  const activeVisibleCount = useMemo(
    () =>
      filteredPhones.filter((phone) => resolveAccountStatus(getMeta(phone)) === 'active')
        .length,
    [filteredPhones, getMeta],
  )

  const selectionToolbar = showSelectionToolbar ?? selectionMode === 'multiple'
  const useVirtual = filteredPhones.length >= VIRTUALIZE_FROM
  const total = filteredPhones.length
  const start = useVirtual
    ? Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
    : 0
  const end = useVirtual
    ? Math.min(total, Math.ceil((scrollTop + viewportH) / ROW_HEIGHT) + OVERSCAN)
    : total
  const windowPhones = useVirtual ? filteredPhones.slice(start, end) : filteredPhones
  const padTop = useVirtual ? start * ROW_HEIGHT : 0
  const padBottom = useVirtual ? Math.max(0, (total - end) * ROW_HEIGHT) : 0

  function clearAccountFilters() {
    setAccountSearch('')
    setAccountStatusFilter('all')
    setShowSelectedOnly(false)
  }

  function togglePhone(phone: string) {
    if (!onSelectedPhonesChange || !selectedPhones) return
    const next = new Set(selectedPhones)
    if (next.has(phone)) {
      next.delete(phone)
      onSelectedPhonesChange(next)
      return
    }
    if (typeof maxSelection === 'number' && next.size >= maxSelection) {
      onMaxSelectionReached?.(maxSelection)
      return
    }
    next.add(phone)
    onSelectedPhonesChange(next)
  }

  function selectAllVisible() {
    if (!onSelectedPhonesChange) return
    const next = new Set(selectedPhones ?? [])
    const cap =
      typeof maxSelection === 'number' ? maxSelection : Number.POSITIVE_INFINITY
    let hitCap = false
    for (const phone of filteredPhones) {
      if (next.has(phone)) continue
      if (next.size >= cap) {
        hitCap = true
        break
      }
      next.add(phone)
    }
    onSelectedPhonesChange(next)
    if (hitCap && typeof maxSelection === 'number') {
      onMaxSelectionReached?.(maxSelection)
    }
  }

  function selectActiveVisible() {
    if (!onSelectedPhonesChange) return
    const next = new Set(selectedPhones ?? [])
    const cap =
      typeof maxSelection === 'number' ? maxSelection : Number.POSITIVE_INFINITY
    let hitCap = false
    for (const phone of filteredPhones) {
      if (resolveAccountStatus(getMeta(phone)) !== 'active') continue
      if (next.has(phone)) continue
      if (next.size >= cap) {
        hitCap = true
        break
      }
      next.add(phone)
    }
    onSelectedPhonesChange(next)
    if (hitCap && typeof maxSelection === 'number') {
      onMaxSelectionReached?.(maxSelection)
    }
  }

  function clearSelection() {
    onSelectedPhonesChange?.(new Set())
  }

  function onListScroll(e: UIEvent<HTMLUListElement>) {
    setScrollTop(e.currentTarget.scrollTop)
  }

  const showTools = !loading && sessions.length > 0
  const selectedCount =
    selectionMode === 'multiple' ? (selectedPhones?.size ?? 0) : selectedPhone ? 1 : 0

  function renderRow(phone: string) {
    const meta = getMeta(phone)
    const labels = resolveAccountPickerLabels(phone, meta)
    const status = resolveAccountStatus(meta)
    const avatarLabel = resolveSessionName(meta) || labels.primary
    const selected =
      selectionMode === 'multiple'
        ? Boolean(selectedPhones?.has(phone))
        : selectedPhone === phone
    const locked =
      selectionMode === 'multiple' &&
      !selected &&
      typeof maxSelection === 'number' &&
      (selectedPhones?.size ?? 0) >= maxSelection

    if (selectionMode === 'multiple') {
      return (
        <li
          key={phone}
          role="option"
          aria-selected={selected}
          style={useVirtual ? { height: ROW_HEIGHT } : undefined}
          className={useVirtual ? 'acc-picker-row-fixed' : undefined}
        >
          <button
            type="button"
            role="checkbox"
            aria-checked={selected}
            className={`acc-picker-item${selected ? ' acc-picker-item--selected' : ''}${
              locked ? ' acc-picker-item--locked' : ''
            }`}
            onClick={() => togglePhone(phone)}
            disabled={disabled || locked}
            title={locked ? `Tối đa ${maxSelection} acc` : phone}
          >
            <span
              className={`acc-picker-indicator acc-picker-indicator--check${
                selected ? ' acc-picker-indicator--on' : ''
              }`}
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
    }

    return (
      <li
        key={phone}
        role="option"
        aria-selected={selected}
        style={useVirtual ? { height: ROW_HEIGHT } : undefined}
        className={useVirtual ? 'acc-picker-row-fixed' : undefined}
      >
        <button
          type="button"
          role="radio"
          aria-checked={selected}
          className={`acc-picker-item acc-picker-item--single${
            selected ? ' acc-picker-item--selected' : ''
          }`}
          onClick={() => onSelectedPhoneChange?.(phone)}
          disabled={disabled}
        >
          <span
            className={`acc-picker-indicator acc-picker-indicator--radio${
              selected ? ' acc-picker-indicator--on' : ''
            }`}
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
  }

  return (
    <aside
      className={`panel acc-picker-panel${embedded ? ' acc-picker-panel--embedded' : ''}${
        className ? ` ${className}` : ''
      }`}
    >
      {!embedded ? (
        <div className="acc-picker-head">
          <div>
            <h2>{title}</h2>
            {meta ? <p className="panel-meta">{meta}</p> : null}
          </div>
          <span className="acc-picker-badge">{badgeCount}</span>
        </div>
      ) : (
        <div className="acc-picker-head acc-picker-head--embedded">
          <div>
            <h2>{title}</h2>
            {meta ? <p className="panel-meta">{meta}</p> : null}
          </div>
          <span className="acc-picker-badge">
            {typeof maxSelection === 'number'
              ? `${selectedCount}/${maxSelection}`
              : badgeCount}
          </span>
        </div>
      )}

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
                  placeholder="Tìm SĐT, tên, @username… (scale tốt với 1000+ acc)"
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
                {showSelectAllPill && maxSelection == null ? (
                  <button
                    type="button"
                    className="acc-picker-pill"
                    onClick={selectAllVisible}
                    disabled={disabled || filteredPhones.length === 0}
                  >
                    Chọn hiển thị
                  </button>
                ) : null}
                {showSelectAllPill && typeof maxSelection === 'number' ? (
                  <button
                    type="button"
                    className="acc-picker-pill"
                    onClick={selectAllVisible}
                    disabled={
                      disabled ||
                      filteredPhones.length === 0 ||
                      selectedCount >= maxSelection
                    }
                    title={`Thêm tối đa ${maxSelection} acc từ kết quả lọc`}
                  >
                    Thêm từ lọc
                  </button>
                ) : null}
                {showSelectActivePill ? (
                  <button
                    type="button"
                    className="acc-picker-pill"
                    onClick={selectActiveVisible}
                    disabled={
                      disabled ||
                      !hasStatusData ||
                      activeVisibleCount === 0 ||
                      (typeof maxSelection === 'number' &&
                        selectedCount >= maxSelection)
                    }
                  >
                    Live
                  </button>
                ) : null}
                {selectionMode === 'multiple' ? (
                  <label className="acc-picker-selected-only">
                    <input
                      type="checkbox"
                      checked={showSelectedOnly}
                      onChange={(e) => setShowSelectedOnly(e.target.checked)}
                      disabled={disabled || selectedCount === 0}
                    />
                    <span>Đã chọn ({selectedCount})</span>
                  </label>
                ) : null}
                <button
                  type="button"
                  className="acc-picker-pill"
                  onClick={clearSelection}
                  disabled={disabled || selectedCount === 0}
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

            <div className="acc-picker-stats">
              <span>
                Hiện <strong>{filteredPhones.length.toLocaleString()}</strong>
                {' / '}
                {sessions.length.toLocaleString()} session
                {useVirtual ? ' · list ảo' : ''}
              </span>
              {typeof maxSelection === 'number' ? (
                <span className="acc-picker-stats-cap">
                  Cast tối đa {maxSelection}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        <ul
          ref={listRef}
          className="acc-picker-list"
          role="listbox"
          aria-label="Danh sách tài khoản"
          aria-multiselectable={selectionMode === 'multiple'}
          onScroll={useVirtual ? onListScroll : undefined}
          style={listHeight ? { height: listHeight, maxHeight: listHeight } : undefined}
        >
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
            <>
              {padTop > 0 ? (
                <li
                  className="acc-picker-spacer"
                  style={{ height: padTop }}
                  aria-hidden
                />
              ) : null}
              {windowPhones.map((phone) => renderRow(phone))}
              {padBottom > 0 ? (
                <li
                  className="acc-picker-spacer"
                  style={{ height: padBottom }}
                  aria-hidden
                />
              ) : null}
            </>
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
