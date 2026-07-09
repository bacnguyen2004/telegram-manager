import type { CSSProperties } from 'react'
import type { DialogItem } from '../../../types/api'
import { avatarHue, dialogInitials } from '../../../utils/avatar'
import {
  FILTER_OPTIONS,
  type KindFilter,
  kindBadgeClass,
  kindLabel,
} from '../helpers'

type FiltersProps = {
  search: string
  unreadOnly: boolean
  filter: KindFilter
  filterCounts: Record<KindFilter, number>
  unreadDialogCount: number
  onSearchChange: (value: string) => void
  onUnreadOnlyToggle: () => void
  onFilterChange: (filter: KindFilter) => void
}

/** Search + kind/unread filters for the left dialog list. */
export function DialogListFilters({
  search,
  unreadOnly,
  filter,
  filterCounts,
  unreadDialogCount,
  onSearchChange,
  onUnreadOnlyToggle,
  onFilterChange,
}: FiltersProps) {
  return (
    <div className="dialogs-toolbar">
      <div className="dialogs-search-wrap">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
          <path
            d="M20 20l-3-3"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
        <input
          type="search"
          className="dialogs-search"
          placeholder="Tìm theo tên, username…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
      <div className="dialogs-filters">
        <button
          type="button"
          className={`dialogs-filter-btn dialogs-filter-btn--unread${unreadOnly ? ' dialogs-filter-btn--active' : ''}`}
          onClick={onUnreadOnlyToggle}
          title="Chỉ hiện chat chưa đọc"
        >
          Chưa đọc
          <span className="dialogs-filter-count">{unreadDialogCount}</span>
        </button>
        {FILTER_OPTIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`dialogs-filter-btn${filter === item.id ? ' dialogs-filter-btn--active' : ''}`}
            onClick={() => onFilterChange(item.id)}
          >
            {item.label}
            <span className="dialogs-filter-count">{filterCounts[item.id]}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

type ListProps = {
  filteredDialogs: DialogItem[]
  selectedId: string | null
  onSelectDialog: (dialog: DialogItem) => void
}

export function DialogListItems({
  filteredDialogs,
  selectedId,
  onSelectDialog,
}: ListProps) {
  return (
    <>
      <ul className="dialogs-list">
        {filteredDialogs.map((dialog) => (
          <li key={dialog.id}>
            <button
              type="button"
              className={`dialog-item${selectedId === dialog.id ? ' dialog-item--active' : ''}${dialog.unread_count > 0 ? ' dialog-item--unread' : ''}`}
              onClick={() => onSelectDialog(dialog)}
            >
              <div
                className="dialog-avatar"
                style={{ '--avatar-hue': avatarHue(dialog.title) } as CSSProperties}
                aria-hidden
              >
                {dialogInitials(dialog.title)}
              </div>
              <div className="dialog-item-body">
                <div className="dialog-item-top">
                  <span className="dialog-item-title">{dialog.title}</span>
                  <span className="dialog-item-top-end">
                    {dialog.pinned && (
                      <span className="dialog-flag" title="Đã ghim">
                        📌
                      </span>
                    )}
                    {dialog.muted && (
                      <span className="dialog-flag" title="Đã tắt tiếng">
                        🔇
                      </span>
                    )}
                    {dialog.date && <span className="dialog-date">{dialog.date}</span>}
                  </span>
                </div>
                <div className="dialog-item-meta">
                  <span className={kindBadgeClass(dialog.kind)}>{kindLabel(dialog.kind)}</span>
                </div>
                <div className="dialog-item-bottom">
                  <p className="dialog-preview">
                    {dialog.last_message || 'Không có tin nhắn'}
                  </p>
                  {dialog.unread_count > 0 ? (
                    <span className="dialog-unread">{dialog.unread_count}</span>
                  ) : null}
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>
      {filteredDialogs.length === 0 && (
        <div className="dialogs-empty">
          <p className="muted">Không có chat khớp bộ lọc.</p>
        </div>
      )}
    </>
  )
}
