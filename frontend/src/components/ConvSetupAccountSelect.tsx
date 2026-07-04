import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'
import './ConvSetupAccountSelect.css'
import { SessionAvatar } from './SessionAvatar'
import type { SessionMetaOverviewItem } from '../types/api'
import { accountMatchesSearch, resolveAccountPickerLabels } from '../utils/accountPicker'
import { resolveSessionName } from '../utils/sessionDisplay'

interface ConvSetupAccountSelectProps {
  value: string
  onChange: (phone: string) => void
  options: string[]
  getMeta: (phone: string) => SessionMetaOverviewItem | undefined
  disabled?: boolean
  placeholder?: string
}

const SEARCH_MIN_OPTIONS = 5
const MENU_MIN_WIDTH = 280
const VIEWPORT_PAD = 8
const MENU_GAP = 4

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="M20 20l-3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`conv-setup-acc__chevron${open ? ' conv-setup-acc__chevron--open' : ''}`}
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function computeMenuStyle(trigger: HTMLElement, showSearch: boolean): CSSProperties {
  const rect = trigger.getBoundingClientRect()
  const width = Math.max(rect.width, MENU_MIN_WIDTH)
  const left = Math.min(
    Math.max(VIEWPORT_PAD, rect.left),
    window.innerWidth - width - VIEWPORT_PAD,
  )
  const chrome = (showSearch ? 52 : 0) + 28
  const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_PAD
  const spaceAbove = rect.top - VIEWPORT_PAD
  const openUp = spaceBelow < 180 && spaceAbove > spaceBelow
  const maxHeight = Math.min(360, Math.max(140, (openUp ? spaceAbove : spaceBelow) - MENU_GAP - chrome))

  if (openUp) {
    return {
      position: 'fixed',
      left,
      bottom: window.innerHeight - rect.top + MENU_GAP,
      top: 'auto',
      width,
      maxHeight,
      zIndex: 320,
    }
  }

  return {
    position: 'fixed',
    top: rect.bottom + MENU_GAP,
    left,
    width,
    maxHeight,
    zIndex: 320,
  }
}

export function ConvSetupAccountSelect({
  value,
  onChange,
  options,
  getMeta,
  disabled = false,
  placeholder = 'Chọn account…',
}: ConvSetupAccountSelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({})
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const showSearch = options.length >= SEARCH_MIN_OPTIONS
  const filteredOptions = useMemo(
    () =>
      showSearch && search.trim()
        ? options.filter((phone) => accountMatchesSearch(phone, search, getMeta(phone)))
        : options,
    [options, search, showSearch, getMeta],
  )

  const selectedMeta = value ? getMeta(value) : undefined
  const selectedLabels = value
    ? resolveAccountPickerLabels(value, selectedMeta)
    : { primary: placeholder, secondary: null as string | null }
  const selectedAvatarLabel = resolveSessionName(selectedMeta) || selectedLabels.primary

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return

    const updatePosition = () => {
      if (!triggerRef.current) return
      setMenuStyle(computeMenuStyle(triggerRef.current, showSearch))
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, showSearch])

  useEffect(() => {
    if (!open) {
      setSearch('')
      return
    }

    if (showSearch) {
      searchRef.current?.focus()
    }

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
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
  }, [open, showSearch])

  function pickPhone(phone: string) {
    onChange(phone)
    setOpen(false)
  }

  function toggleOpen() {
    setOpen((current) => !current)
  }

  const menu = open ? (
    <div
      ref={menuRef}
      className="conv-setup-acc__menu conv-setup-acc__menu--floating"
      style={menuStyle}
    >
      {showSearch ? (
        <div className="conv-setup-acc__tools">
          <label className="conv-setup-acc__search">
            <SearchIcon />
            <input
              ref={searchRef}
              type="search"
              placeholder="Tìm tên, username, SĐT…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </label>
        </div>
      ) : null}

      <ul
        className="conv-setup-acc__list"
        role="listbox"
        aria-label="Chọn account"
        onWheel={(e) => e.stopPropagation()}
      >
        <li role="option" aria-selected={!value}>
          <button
            type="button"
            className={`conv-setup-acc__item${!value ? ' conv-setup-acc__item--selected' : ''}`}
            onClick={() => pickPhone('')}
          >
            <span className="conv-setup-acc__empty-dot" aria-hidden />
            <span className="conv-setup-acc__item-copy">
              <span className="conv-setup-acc__item-name">{placeholder}</span>
            </span>
          </button>
        </li>
        {options.length === 0 ? (
          <li className="conv-setup-acc__empty muted">Không còn account khả dụng</li>
        ) : filteredOptions.length === 0 ? (
          <li className="conv-setup-acc__empty muted">Không có acc khớp tìm kiếm</li>
        ) : (
          filteredOptions.map((phone) => {
            const meta = getMeta(phone)
            const labels = resolveAccountPickerLabels(phone, meta)
            const avatarLabel = resolveSessionName(meta) || labels.primary
            const selected = value === phone

            return (
              <li key={phone} role="option" aria-selected={selected}>
                <button
                  type="button"
                  className={`conv-setup-acc__item${selected ? ' conv-setup-acc__item--selected' : ''}`}
                  onClick={() => pickPhone(phone)}
                >
                  <SessionAvatar
                    phone={phone}
                    label={avatarLabel}
                    hasAvatar={meta?.has_avatar}
                    avatarUpdatedAt={meta?.avatar_updated_at}
                    size="sm"
                  />
                  <span className="conv-setup-acc__item-copy">
                    <span className="conv-setup-acc__item-name">{labels.primary}</span>
                    {labels.secondary ? (
                      <span className="conv-setup-acc__item-meta">{labels.secondary}</span>
                    ) : null}
                  </span>
                </button>
              </li>
            )
          })
        )}
      </ul>

      {showSearch ? (
        <p className="conv-setup-acc__foot muted">
          {filteredOptions.length} / {options.length} acc
        </p>
      ) : null}
    </div>
  ) : null

  return (
    <div
      className={`conv-setup-acc${open ? ' conv-setup-acc--open' : ''}${value ? ' conv-setup-acc--selected' : ''}`}
      ref={rootRef}
    >
      <button
        ref={triggerRef}
        type="button"
        className="conv-setup-acc__trigger"
        onClick={toggleOpen}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={value ? `Account: ${selectedLabels.primary}` : placeholder}
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
            <span className="conv-setup-acc__copy">
              <span className="conv-setup-acc__name">{selectedLabels.primary}</span>
              {selectedLabels.secondary ? (
                <span className="conv-setup-acc__meta">{selectedLabels.secondary}</span>
              ) : null}
            </span>
          </>
        ) : (
          <span className="conv-setup-acc__placeholder">{placeholder}</span>
        )}
        <ChevronIcon open={open} />
      </button>

      {menu ? createPortal(menu, document.body) : null}
    </div>
  )
}