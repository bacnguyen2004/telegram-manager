import type { DialogCounts, DialogItem } from '../../types/api'

export type KindFilter = 'all' | 'private' | 'bot' | 'group' | 'channel'

export const FILTER_OPTIONS: { id: KindFilter; label: string }[] = [
  { id: 'all', label: 'Tất cả' },
  { id: 'private', label: 'Private' },
  { id: 'bot', label: 'Bot' },
  { id: 'group', label: 'Group' },
  { id: 'channel', label: 'Channel' },
]

export const DIALOGS_FETCH_LIMIT = 500
export const SCROLL_BOTTOM_THRESHOLD = 56
export const SCROLL_TOP_THRESHOLD = 72
export const MESSAGES_INITIAL_LIMIT = 100
export const MESSAGES_OLDER_LIMIT = 50

export function dialogsLoadSuccessMessage(
  total: number,
  limit = DIALOGS_FETCH_LIMIT,
): string {
  if (total >= limit) {
    return `Tải ${total} chat (tối đa ${limit}/lần — chat cũ hơn có thể chưa hiện)`
  }
  return `Tải ${total} chat`
}

export function kindLabel(kind: string): string {
  const map: Record<string, string> = {
    private: 'Private',
    bot: 'Bot',
    group: 'Group',
    channel: 'Channel',
    chat: 'Chat',
  }
  return map[kind] ?? kind
}

export function kindBadgeClass(kind: string): string {
  const map: Record<string, string> = {
    private: 'dialog-kind dialog-kind--private',
    bot: 'dialog-kind dialog-kind--bot',
    group: 'dialog-kind dialog-kind--group',
    channel: 'dialog-kind dialog-kind--channel',
  }
  return map[kind] ?? 'dialog-kind'
}

export function countChipClass(kind: keyof DialogCounts | 'all'): string {
  const map: Record<string, string> = {
    all: 'chip chip--all',
    private: 'chip chip--private',
    bot: 'chip chip--bot',
    group: 'chip chip--group',
    channel: 'chip chip--channel',
  }
  return map[kind] ?? 'chip'
}

export function ChatEmptyIcon() {
  return (
    <svg className="chat-empty-icon" viewBox="0 0 80 80" fill="none" aria-hidden>
      <circle cx="40" cy="40" r="38" stroke="currentColor" strokeWidth="1.5" opacity="0.2" />
      <path
        d="M24 32c0-6.627 7.163-12 16-12s16 5.373 16 12v2c0 6.627-7.163 12-16 12-1.86 0-3.64-.27-5.26-.77L24 62l2.74-8.23C25.27 51.64 24 49.9 24 48v-2Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function computeFilterCounts(
  dialogs: { kind: string }[],
): Record<KindFilter, number> {
  const tallies: Record<KindFilter, number> = {
    all: dialogs.length,
    private: 0,
    bot: 0,
    group: 0,
    channel: 0,
  }
  for (const dialog of dialogs) {
    if (dialog.kind in tallies) tallies[dialog.kind as KindFilter] += 1
  }
  return tallies
}

export function filterDialogs(
  dialogs: DialogItem[],
  filter: KindFilter,
  search: string,
  unreadOnly: boolean,
): DialogItem[] {
  const q = search.trim().toLowerCase()
  return dialogs.filter((dialog) => {
    if (unreadOnly && dialog.unread_count <= 0) return false
    if (filter !== 'all' && dialog.kind !== filter) return false
    if (!q) return true
    return (
      dialog.title.toLowerCase().includes(q) ||
      dialog.username.toLowerCase().includes(q) ||
      dialog.last_message.toLowerCase().includes(q)
    )
  })
}
