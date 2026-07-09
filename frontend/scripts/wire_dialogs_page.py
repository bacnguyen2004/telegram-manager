"""Wire extracted components/hooks into pages/dialogs/DialogsPage.tsx."""
from __future__ import annotations

from pathlib import Path

PATH = Path(__file__).resolve().parents[1] / "src" / "pages" / "dialogs" / "DialogsPage.tsx"
text = PATH.read_text(encoding="utf-8")

# --- 1) Replace pure helpers with imports ---
old_helpers = """type KindFilter = 'all' | 'private' | 'bot' | 'group' | 'channel'

const FILTER_OPTIONS: { id: KindFilter; label: string }[] = [
  { id: 'all', label: 'Tất cả' },
  { id: 'private', label: 'Private' },
  { id: 'bot', label: 'Bot' },
  { id: 'group', label: 'Group' },
  { id: 'channel', label: 'Channel' },
]

const DIALOGS_FETCH_LIMIT = 500

function dialogsLoadSuccessMessage(total: number, limit = DIALOGS_FETCH_LIMIT): string {
  if (total >= limit) {
    return `Tải ${total} chat (tối đa ${limit}/lần — chat cũ hơn có thể chưa hiện)`
  }
  return `Tải ${total} chat`
}

function kindLabel(kind: string): string {
  const map: Record<string, string> = {
    private: 'Private',
    bot: 'Bot',
    group: 'Group',
    channel: 'Channel',
    chat: 'Chat',
  }
  return map[kind] ?? kind
}

function kindBadgeClass(kind: string): string {
  const map: Record<string, string> = {
    private: 'dialog-kind dialog-kind--private',
    bot: 'dialog-kind dialog-kind--bot',
    group: 'dialog-kind dialog-kind--group',
    channel: 'dialog-kind dialog-kind--channel',
  }
  return map[kind] ?? 'dialog-kind'
}

function countChipClass(kind: keyof DialogCounts | 'all'): string {
  const map: Record<string, string> = {
    all: 'chip chip--all',
    private: 'chip chip--private',
    bot: 'chip chip--bot',
    group: 'chip chip--group',
    channel: 'chip chip--channel',
  }
  return map[kind] ?? 'chip'
}

function ChatEmptyIcon() {
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
"""

new_helpers = """import {
  ChatEmptyIcon,
  DIALOGS_FETCH_LIMIT,
  MESSAGES_INITIAL_LIMIT,
  MESSAGES_OLDER_LIMIT,
  SCROLL_BOTTOM_THRESHOLD,
  SCROLL_TOP_THRESHOLD,
  computeFilterCounts,
  countChipClass,
  dialogsLoadSuccessMessage,
  filterDialogs,
  type KindFilter,
} from './helpers'
import {
  DialogListFilters,
  DialogListItems,
} from './components/DialogListPanel'
import { ComposerBar } from './components/ComposerBar'
import { MessageThread } from './components/MessageThread'
import { useDialogAlerts } from './hooks/useDialogAlerts'
import { useDialogSelection } from './hooks/useDialogSelection'
"""

if old_helpers not in text:
    raise SystemExit("helpers block not found")
text = text.replace(old_helpers, new_helpers, 1)

# Remove unused Message* imports that move into MessageThread (keep some for types)
# Keep MessageContextMenu, MessageSelectionBar, etc.

# --- 2) Use selection + alerts hooks early in component ---
old_state_chunk = """  const [forwardMessage, setForwardMessage] = useState<DialogMessageItem | null>(null)
  const [forwardMessages, setForwardMessages] = useState<DialogMessageItem[]>([])
  const [forwarding, setForwarding] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<number>>(
    () => new Set(),
  )
  const [editingMessage, setEditingMessage] = useState<DialogMessageItem | null>(null)
"""

new_state_chunk = """  const [forwardMessage, setForwardMessage] = useState<DialogMessageItem | null>(null)
  const [forwardMessages, setForwardMessages] = useState<DialogMessageItem[]>([])
  const [forwarding, setForwarding] = useState(false)
  const {
    selectMode,
    selectedMessageIds,
    setSelectedMessageIds,
    enterSelectMode: enterSelectModeBase,
    exitSelectionMode,
    toggleMessageSelection,
  } = useDialogSelection()
  const [editingMessage, setEditingMessage] = useState<DialogMessageItem | null>(null)
"""

if old_state_chunk not in text:
    raise SystemExit("selection state block not found")
text = text.replace(old_state_chunk, new_state_chunk, 1)

old_alerts = """  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
"""
new_alerts = """  const { error, success, setError, setSuccess, resetAlerts } = useDialogAlerts()
"""
if old_alerts not in text:
    raise SystemExit("alerts block not found")
text = text.replace(old_alerts, new_alerts, 1)

# Constants already defined later - remove duplicates if present
old_consts = """  const SCROLL_BOTTOM_THRESHOLD = 56
  const SCROLL_TOP_THRESHOLD = 72
  const MESSAGES_INITIAL_LIMIT = 100
  const MESSAGES_OLDER_LIMIT = 50

  const filterCounts = useMemo(() => {
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
  }, [dialogs])

  const filteredDialogs = useMemo(() => {
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
  }, [dialogs, filter, search, unreadOnly])
"""

new_consts = """  const filterCounts = useMemo(() => computeFilterCounts(dialogs), [dialogs])

  const filteredDialogs = useMemo(
    () => filterDialogs(dialogs, filter, search, unreadOnly),
    [dialogs, filter, search, unreadOnly],
  )
"""
if old_consts not in text:
    raise SystemExit("filter memos not found")
text = text.replace(old_consts, new_consts, 1)

# Remove local resetAlerts function
old_reset = """  function resetAlerts() {
    setError('')
    setSuccess('')
  }

"""
if old_reset in text:
    text = text.replace(old_reset, "", 1)

# Replace enter/exit selection local defs
old_exit = """  const exitSelectionMode = useCallback(() => {
    setSelectMode(false)
    setSelectedMessageIds(new Set())
  }, [])

  const enterSelectMode = useCallback((initialMessageId?: number) => {
    setSelectMode(true)
    setSelectedMessageIds(
      initialMessageId ? new Set([initialMessageId]) : new Set(),
    )
    setForwardMessage(null)
    setForwardMessages([])
    resetAlerts()
  }, [])
"""
new_exit = """  const enterSelectMode = useCallback((initialMessageId?: number) => {
    setForwardMessage(null)
    setForwardMessages([])
    resetAlerts()
    enterSelectModeBase(initialMessageId)
  }, [enterSelectModeBase, resetAlerts])
"""
if old_exit not in text:
    raise SystemExit("enter/exit selection not found")
text = text.replace(old_exit, new_exit, 1)

# Remove toggleMessageSelection if defined locally
import re
text = re.sub(
    r"\n  const toggleMessageSelection = useCallback\(\(messageId: number\) => \{.*?\n  \}, \[\]\)\n",
    "\n",
    text,
    count=1,
    flags=re.S,
)

PATH.write_text(text, encoding="utf-8")
print("wired core hooks/helpers into DialogsPage")
print("lines", text.count("\n") + 1)
