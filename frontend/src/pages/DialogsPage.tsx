import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/client'
import { Alert } from '../components/Alert'
import { MessageReactionBar } from '../components/MessageReactionBar'
import { MessageText } from '../components/MessageText'
import { Pagination } from '../components/Pagination'
import { PhoneSelect } from '../components/PhoneSelect'
import { usePagination } from '../hooks/usePagination'
import type {
  DialogCounts,
  DialogItem,
  DialogMessageItem,
  DialogReactionsPolicy,
} from '../types/api'
import { avatarHue, dialogInitials, mediaTypeLabel } from '../utils/avatar'
import { mergeDialogsWithReadState, saveReadState } from '../utils/dialogReadStorage'
import { inferHasMoreOlder, isStaleMessagesRequest } from '../utils/dialogMessages'
import { canReactWith, reactionsHint } from '../utils/reactions'

type KindFilter = 'all' | 'private' | 'bot' | 'group' | 'channel'

const FILTER_OPTIONS: { id: KindFilter; label: string }[] = [
  { id: 'all', label: 'Tất cả' },
  { id: 'private', label: 'Private' },
  { id: 'bot', label: 'Bot' },
  { id: 'group', label: 'Group' },
  { id: 'channel', label: 'Channel' },
]

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

export function DialogsPage() {
  const [phone, setPhone] = useState('')
  const [dialogs, setDialogs] = useState<DialogItem[]>([])
  const [counts, setCounts] = useState<DialogCounts | null>(null)
  const [selected, setSelected] = useState<DialogItem | null>(null)
  const [messages, setMessages] = useState<DialogMessageItem[]>([])
  const [messagesTitle, setMessagesTitle] = useState('')
  const [filter, setFilter] = useState<KindFilter>('all')
  const [search, setSearch] = useState('')
  const [draftText, setDraftText] = useState('')
  const [replyTo, setReplyTo] = useState<DialogMessageItem | null>(null)
  const [loadingDialogs, setLoadingDialogs] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [hasMoreOlder, setHasMoreOlder] = useState(false)
  const [sending, setSending] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [reactingId, setReactingId] = useState<number | null>(null)
  const [reactionsPolicy, setReactionsPolicy] = useState<DialogReactionsPolicy | null>(
    null,
  )
  const [selectedImage, setSelectedImage] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const imageInputRef = useRef<HTMLInputElement>(null)
  const messagesScrollRef = useRef<HTMLDivElement>(null)
  const messageRefs = useRef<Map<number, HTMLLIElement>>(new Map())
  const scrollIntentRef = useRef<'last-read' | 'latest' | null>(null)
  const openingUnreadRef = useRef(0)
  const openingReadMaxIdRef = useRef(0)
  const prevLoadingMessagesRef = useRef(false)
  const markReadTimerRef = useRef<number | null>(null)
  const markPartialTimerRef = useRef<number | null>(null)
  const markingReadRef = useRef(false)
  const loadingOlderRef = useRef(false)
  const selectedDialogIdRef = useRef<string | null>(null)
  const messagesRequestSeqRef = useRef(0)
  const [showJumpBtn, setShowJumpBtn] = useState(false)
  const [pendingUnread, setPendingUnread] = useState(0)
  const [loadedPhotoIds, setLoadedPhotoIds] = useState<Set<number>>(() => new Set())

  const SCROLL_BOTTOM_THRESHOLD = 56
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
      if (filter !== 'all' && dialog.kind !== filter) return false
      if (!q) return true
      return (
        dialog.title.toLowerCase().includes(q) ||
        dialog.username.toLowerCase().includes(q) ||
        dialog.last_message.toLowerCase().includes(q)
      )
    })
  }, [dialogs, filter, search])

  const reactionPolicyHint = useMemo(
    () => reactionsHint(reactionsPolicy),
    [reactionsPolicy],
  )

  const {
    items: pagedDialogs,
    page: dialogPage,
    setPage: setDialogPage,
    totalPages: dialogTotalPages,
    from: dialogFrom,
    to: dialogTo,
    pageSize: dialogPageSize,
    setPageSize: setDialogPageSize,
  } = usePagination(filteredDialogs, 20)

  const isAtBottom = useCallback(() => {
    const el = messagesScrollRef.current
    if (!el) return true
    return el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_BOTTOM_THRESHOLD
  }, [])

  const scrollToLatest = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = messagesScrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior })
    if (behavior === 'auto') {
      setShowJumpBtn(false)
      setPendingUnread(0)
    }
  }, [])

  const scrollMessageToBottomOfView = useCallback(
    (target: HTMLElement, behavior: ScrollBehavior) => {
      const container = messagesScrollRef.current
      if (!container) return
      const top =
        target.getBoundingClientRect().top -
        container.getBoundingClientRect().top +
        container.scrollTop
      const scrollTop = top + target.offsetHeight - container.clientHeight + 24
      container.scrollTo({ top: Math.max(0, scrollTop), behavior })
    },
    [],
  )

  const resolveLastReadMessageId = useCallback(
    (unreadCount: number, readMaxId: number): number | null => {
      if (messages.length === 0) return null

      if (readMaxId > 0) {
        let lastRead: DialogMessageItem | null = null
        for (const msg of messages) {
          if (msg.id <= readMaxId) lastRead = msg
          else break
        }
        if (lastRead) return lastRead.id
      }

      if (unreadCount > 0) {
        const lastReadIndex = Math.max(0, messages.length - unreadCount - 1)
        return messages[lastReadIndex]?.id ?? null
      }

      return null
    },
    [messages],
  )

  const scrollToLastRead = useCallback(
    (unreadCount: number, readMaxId: number) => {
      const container = messagesScrollRef.current
      if (!container || messages.length === 0) return

      if (unreadCount <= 0 && readMaxId <= 0) {
        scrollToLatest('auto')
        return
      }

      const targetId = resolveLastReadMessageId(unreadCount, readMaxId)
      if (!targetId) {
        scrollToLatest('auto')
        return
      }

      const tryScroll = (attempt = 0) => {
        const target = messageRefs.current.get(targetId)
        if (!target) {
          if (attempt < 20) {
            requestAnimationFrame(() => tryScroll(attempt + 1))
          }
          return
        }
        scrollMessageToBottomOfView(target, 'auto')
        if (unreadCount > 0) {
          setShowJumpBtn(true)
          setPendingUnread(unreadCount)
        }
      }

      tryScroll()
    },
    [messages, resolveLastReadMessageId, scrollMessageToBottomOfView, scrollToLatest],
  )

  const syncUnreadBadge = useCallback((remaining: number) => {
    if (!selected) return
    const patch = (dialog: DialogItem): DialogItem =>
      dialog.id === selected.id ? { ...dialog, unread_count: remaining } : dialog

    setDialogs((prev) => prev.map(patch))
    setSelected((prev) => (prev ? patch(prev) : prev))
    if (remaining <= 0) openingUnreadRef.current = 0
  }, [selected])

  const applyDialogReadState = useCallback(
    (dialogId: string, readMaxId: number, unreadCount = 0) => {
      const patch = (dialog: DialogItem): DialogItem =>
        dialog.id === dialogId
          ? { ...dialog, unread_count: unreadCount, read_inbox_max_id: readMaxId }
          : dialog

      setDialogs((prev) => prev.map(patch))
      setSelected((prev) => (prev?.id === dialogId ? patch(prev) : prev))
      openingReadMaxIdRef.current = readMaxId
      if (unreadCount <= 0) {
        openingUnreadRef.current = 0
        if (phone) saveReadState(phone, dialogId, readMaxId)
      }
    },
    [phone],
  )

  const commitMarkRead = useCallback(
    async (dialogId: string, maxId: number) => {
      if (!phone || !dialogId || maxId <= 0) return

      if (markPartialTimerRef.current) {
        window.clearTimeout(markPartialTimerRef.current)
        markPartialTimerRef.current = null
      }
      if (markReadTimerRef.current) {
        window.clearTimeout(markReadTimerRef.current)
        markReadTimerRef.current = null
      }

      applyDialogReadState(dialogId, maxId, 0)
      setPendingUnread(0)

      try {
        const res = await api.markDialogRead(phone, dialogId, maxId)
        if (!res.success || !res.data || res.data.status === 'error') return

        const readMaxId = res.data.read_inbox_max_id || maxId
        const unreadCount = res.data.unread_count ?? 0
        applyDialogReadState(dialogId, readMaxId, unreadCount)
        if (unreadCount <= 0) saveReadState(phone, dialogId, readMaxId)
      } catch {
        // UI đã optimistic; localStorage vẫn giữ trạng thái đã đọc
      }
    },
    [phone, applyDialogReadState],
  )

  const getScrollUnreadState = useCallback(() => {
    const container = messagesScrollRef.current
    if (!container || messages.length === 0) {
      return { remaining: 0, maxVisibleId: openingReadMaxIdRef.current }
    }

    const containerRect = container.getBoundingClientRect()
    const readBaseline = openingReadMaxIdRef.current
    let maxVisibleId = readBaseline

    for (const msg of messages) {
      const el = messageRefs.current.get(msg.id)
      if (!el) continue
      const rect = el.getBoundingClientRect()
      if (rect.bottom > containerRect.top + 8 && rect.top < containerRect.bottom - 8) {
        if (msg.id > maxVisibleId) maxVisibleId = msg.id
      }
    }

    let remainingInLoaded = 0
    for (const msg of messages) {
      if (msg.id > maxVisibleId) remainingInLoaded++
    }

    const openingUnread = openingUnreadRef.current
    const loadedUnread = messages.filter((msg) => msg.id > readBaseline).length

    let remaining = remainingInLoaded
    if (openingUnread > loadedUnread) {
      const readInSession = loadedUnread - remainingInLoaded
      remaining = Math.max(0, openingUnread - readInSession)
    } else if (openingUnread > 0) {
      remaining = Math.min(remaining, openingUnread)
    }

    return { remaining, maxVisibleId }
  }, [messages])

  const markAsRead = useCallback(
    async (maxId?: number) => {
      const dialogId = selectedDialogIdRef.current
      if (!phone || !dialogId) return

      const latestId = messages[messages.length - 1]?.id
      if (!latestId) return

      const targetId = maxId && maxId > 0 ? maxId : latestId
      const unread = selected?.unread_count ?? openingUnreadRef.current
      const readMaxId = selected?.read_inbox_max_id ?? openingReadMaxIdRef.current
      if (unread <= 0 && readMaxId >= targetId) return

      await commitMarkRead(dialogId, targetId)
    },
    [phone, selected, messages, commitMarkRead],
  )

  const markPartialReadDebounced = useCallback(
    (maxId: number) => {
      if (!phone || !selected || maxId <= openingReadMaxIdRef.current) return
      if (markPartialTimerRef.current) window.clearTimeout(markPartialTimerRef.current)
      markPartialTimerRef.current = window.setTimeout(() => {
        void (async () => {
          if (markingReadRef.current) return
          markingReadRef.current = true
          try {
            const res = await api.markDialogRead(phone, selected.id, maxId)
            if (res.success && res.data?.status === 'success') {
              const readMaxId = res.data.read_inbox_max_id || maxId
              openingReadMaxIdRef.current = readMaxId
              setDialogs((prev) =>
                prev.map((dialog) =>
                  dialog.id === selected.id
                    ? { ...dialog, read_inbox_max_id: readMaxId }
                    : dialog,
                ),
              )
              setSelected((prev) =>
                prev?.id === selected.id
                  ? { ...prev, read_inbox_max_id: readMaxId }
                  : prev,
              )
            }
          } catch {
            // Giữ optimistic badge; thử lại khi cuộn tiếp
          } finally {
            markingReadRef.current = false
          }
        })()
      }, 600)
    },
    [phone, selected],
  )

  const markAsReadDebounced = useCallback(() => {
    if (markReadTimerRef.current) window.clearTimeout(markReadTimerRef.current)
    markReadTimerRef.current = window.setTimeout(() => {
      void markAsRead()
    }, 400)
  }, [markAsRead])

  const updateJumpButton = useCallback(() => {
    const atBottom = isAtBottom()
    setShowJumpBtn(!atBottom)

    if (!selected || messages.length === 0) return

    if (atBottom) {
      const latestId = messages[messages.length - 1]?.id ?? 0
      if (latestId > 0) applyDialogReadState(selected.id, latestId, 0)
      setPendingUnread(0)
      markAsReadDebounced()
      return
    }

    const { remaining, maxVisibleId } = getScrollUnreadState()
    setPendingUnread(remaining)
    syncUnreadBadge(remaining)
    if (maxVisibleId > openingReadMaxIdRef.current) {
      markPartialReadDebounced(maxVisibleId)
    }
  }, [
    isAtBottom,
    selected,
    messages,
    applyDialogReadState,
    syncUnreadBadge,
    getScrollUnreadState,
    markAsReadDebounced,
    markPartialReadDebounced,
  ])

  const isMessagesRequestStale = useCallback(
    (requestSeq: number, dialogId: string) =>
      isStaleMessagesRequest(
        requestSeq,
        dialogId,
        messagesRequestSeqRef.current,
        selectedDialogIdRef.current,
      ),
    [],
  )

  const loadOlderMessages = useCallback(async () => {
    if (!phone || !selected || messages.length === 0 || !hasMoreOlder) return
    if (loadingOlderRef.current || loadingMessages) return

    const dialogId = selected.id
    const requestSeq = messagesRequestSeqRef.current
    const offsetId = messages[0]?.id
    if (!offsetId) return

    const container = messagesScrollRef.current
    const prevScrollHeight = container?.scrollHeight ?? 0
    const prevScrollTop = container?.scrollTop ?? 0

    loadingOlderRef.current = true
    setLoadingOlder(true)
    try {
      const res = await api.getDialogMessages(
        phone,
        dialogId,
        MESSAGES_OLDER_LIMIT,
        offsetId,
      )
      if (isMessagesRequestStale(requestSeq, dialogId)) return

      if (!res.success || !res.data) {
        setError(res.error ?? 'Không tải được tin cũ hơn')
        return
      }
      if (res.data.status === 'error') {
        setError(res.data.message)
        return
      }

      const older = res.data.messages
      if (older.length === 0) {
        setHasMoreOlder(false)
        return
      }

      setHasMoreOlder(
        inferHasMoreOlder(
          older.length,
          MESSAGES_OLDER_LIMIT,
          res.data.has_more_older,
        ),
      )

      setMessages((prev) => {
        const existingIds = new Set(prev.map((msg) => msg.id))
        const uniqueOlder = older.filter((msg) => !existingIds.has(msg.id))
        return [...uniqueOlder, ...prev]
      })
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!container || isMessagesRequestStale(requestSeq, dialogId)) return
          container.scrollTop =
            prevScrollTop + (container.scrollHeight - prevScrollHeight)
        })
      })
    } catch (err) {
      if (!isMessagesRequestStale(requestSeq, dialogId)) {
        setError(err instanceof Error ? err.message : 'Không kết nối được API.')
      }
    } finally {
      if (!isMessagesRequestStale(requestSeq, dialogId)) {
        setLoadingOlder(false)
        loadingOlderRef.current = false
      }
    }
  }, [
    phone,
    selected,
    messages,
    hasMoreOlder,
    loadingMessages,
    isMessagesRequestStale,
  ])

  const handleMessagesScroll = useCallback(() => {
    updateJumpButton()

    const container = messagesScrollRef.current
    if (
      !container ||
      loadingOlderRef.current ||
      loadingMessages ||
      !hasMoreOlder ||
      !selected
    ) {
      return
    }
    if (container.scrollTop > SCROLL_TOP_THRESHOLD) return
    void loadOlderMessages()
  }, [
    updateJumpButton,
    loadingMessages,
    hasMoreOlder,
    selected,
    loadOlderMessages,
  ])

  const handleJumpToLatest = () => {
    const latestId = messages[messages.length - 1]?.id ?? 0
    scrollToLatest('smooth')
    if (selected && latestId > 0) {
      applyDialogReadState(selected.id, latestId, 0)
    }
    setPendingUnread(0)
    void markAsRead(latestId)
    window.setTimeout(updateJumpButton, 350)
  }

  function resetAlerts() {
    setError('')
    setSuccess('')
  }

  function clearSelectedImage() {
    if (imagePreview) URL.revokeObjectURL(imagePreview)
    setSelectedImage(null)
    setImagePreview(null)
    if (imageInputRef.current) imageInputRef.current.value = ''
  }

  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview)
    }
  }, [imagePreview])

  useEffect(() => {
    return () => {
      if (markReadTimerRef.current) window.clearTimeout(markReadTimerRef.current)
      if (markPartialTimerRef.current) window.clearTimeout(markPartialTimerRef.current)
    }
  }, [])

  useEffect(() => {
    const justFinished = prevLoadingMessagesRef.current && !loadingMessages
    prevLoadingMessagesRef.current = loadingMessages

    if (!justFinished || !selected || messages.length === 0) return

    const intent = scrollIntentRef.current ?? 'last-read'
    scrollIntentRef.current = null

    window.setTimeout(() => {
      if (intent === 'latest') {
        scrollToLatest('auto')
      } else {
        scrollToLastRead(openingUnreadRef.current, openingReadMaxIdRef.current)
      }
      window.setTimeout(updateJumpButton, 100)
    }, 80)
  }, [loadingMessages, messages.length, selected, scrollToLastRead, scrollToLatest, updateJumpButton])

  function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('Chỉ chọn file ảnh (JPEG, PNG, WebP, GIF).')
      clearSelectedImage()
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('Ảnh tối đa 10MB.')
      clearSelectedImage()
      return
    }
    resetAlerts()
    if (imagePreview) URL.revokeObjectURL(imagePreview)
    setSelectedImage(file)
    setImagePreview(URL.createObjectURL(file))
  }

  async function handleLoadDialogs(e: React.FormEvent) {
    e.preventDefault()
    setLoadingDialogs(true)
    resetAlerts()
    setDialogs([])
    setCounts(null)
    setSelected(null)
    selectedDialogIdRef.current = null
    messagesRequestSeqRef.current += 1
    setMessages([])
    setMessagesTitle('')
    setReactionsPolicy(null)
    setReplyTo(null)
    setLoadedPhotoIds(new Set())
    try {
      const res = await api.listDialogs(phone)
      if (!res.success || !res.data) {
        setError(res.error ?? 'Không tải được danh sách chat')
        return
      }
      if (res.data.status === 'error') {
        setError(res.data.message)
        return
      }
      setDialogs(mergeDialogsWithReadState(phone, res.data.dialogs))
      setCounts(res.data.counts)
      setSuccess(`Tải ${res.data.total} chat`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không kết nối được API.')
    } finally {
      setLoadingDialogs(false)
    }
  }

  async function loadMessages(dialog: DialogItem, showLoading = true) {
    if (!phone) return false

    const dialogId = dialog.id
    const requestSeq = messagesRequestSeqRef.current

    if (showLoading) {
      setLoadingMessages(true)
      setMessages([])
      setHasMoreOlder(false)
    }
    try {
      const res = await api.getDialogMessages(
        phone,
        dialogId,
        MESSAGES_INITIAL_LIMIT,
      )
      if (requestSeq !== messagesRequestSeqRef.current || dialogId !== selectedDialogIdRef.current) {
        return false
      }

      if (!res.success || !res.data) {
        setError(res.error ?? 'Không tải được tin nhắn')
        return false
      }
      if (res.data.status === 'error') {
        setError(res.data.message)
        return false
      }
      setMessages(res.data.messages)
      setReactionsPolicy(res.data.reactions_policy ?? null)
      setHasMoreOlder(
        inferHasMoreOlder(
          res.data.messages.length,
          MESSAGES_INITIAL_LIMIT,
          res.data.has_more_older,
        ),
      )
      setMessagesTitle(res.data.title || dialog.title)
      return true
    } catch (err) {
      if (requestSeq === messagesRequestSeqRef.current && dialogId === selectedDialogIdRef.current) {
        setError(err instanceof Error ? err.message : 'Không kết nối được API.')
      }
      return false
    } finally {
      if (
        showLoading &&
        requestSeq === messagesRequestSeqRef.current &&
        dialogId === selectedDialogIdRef.current
      ) {
        setLoadingMessages(false)
      }
    }
  }

  async function handleSelectDialog(dialog: DialogItem) {
    const prevDialogId = selectedDialogIdRef.current
    const prevLatestId = messages[messages.length - 1]?.id ?? 0
    const prevHadUnread =
      (selected?.unread_count ?? 0) > 0 || openingUnreadRef.current > 0

    if (
      phone &&
      prevDialogId &&
      prevDialogId !== dialog.id &&
      prevLatestId > 0 &&
      prevHadUnread &&
      pendingUnread <= 0
    ) {
      void commitMarkRead(prevDialogId, prevLatestId)
    }

    const fresh = dialogs.find((item) => item.id === dialog.id) ?? dialog
    selectedDialogIdRef.current = fresh.id
    messagesRequestSeqRef.current += 1
    setSelected(fresh)
    setDraftText('')
    setReplyTo(null)
    clearSelectedImage()
    resetAlerts()
    setShowJumpBtn(false)
    setHasMoreOlder(false)
    setLoadingOlder(false)
    loadingOlderRef.current = false
    openingUnreadRef.current = fresh.unread_count
    openingReadMaxIdRef.current = fresh.read_inbox_max_id ?? 0
    setPendingUnread(fresh.unread_count)
    scrollIntentRef.current = fresh.unread_count > 0 ? 'last-read' : 'latest'
    setMessagesTitle(fresh.title)
    setReactionsPolicy(null)
    messageRefs.current.clear()
    setLoadedPhotoIds(new Set())
    await loadMessages(fresh)
  }

  function revealPhoto(messageId: number) {
    setLoadedPhotoIds((prev) => new Set(prev).add(messageId))
  }

  async function handleSendReaction(msg: DialogMessageItem, emoji: string) {
    if (!phone || !selected) return

    const isChosen = (msg.reactions ?? []).some(
      (reaction) => reaction.chosen && reaction.emoji === emoji,
    )
    if (!canReactWith(reactionsPolicy, emoji, isChosen)) {
      setError(reactionPolicyHint ?? 'Group này không cho phép emoji này')
      return
    }

    setReactingId(msg.id)
    resetAlerts()
    try {
      const res = await api.sendReaction(phone, selected.id, msg.id, emoji)
      if (!res.success || !res.data) {
        setError(res.error ?? 'Thả reaction thất bại')
        return
      }
      if (res.data.status === 'error') {
        setError(res.data.message)
        return
      }
      setSuccess(res.data.message)
      await loadMessages(selected, false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không kết nối được API.')
    } finally {
      setReactingId(null)
    }
  }

  async function handleDeleteMessage(msg: DialogMessageItem) {
    if (!phone || !selected) return
    const confirmed = window.confirm(`Xóa tin nhắn #${msg.id}?`)
    if (!confirmed) return

    setDeletingId(msg.id)
    resetAlerts()
    try {
      const res = await api.deleteMessage(phone, selected.id, msg.id)
      if (!res.success || !res.data) {
        setError(res.error ?? 'Xóa tin thất bại')
        return
      }
      if (res.data.status === 'error') {
        setError(res.data.message)
        return
      }
      if (replyTo?.id === msg.id) setReplyTo(null)
      setSuccess(res.data.message)
      await loadMessages(selected, false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không kết nối được API.')
    } finally {
      setDeletingId(null)
    }
  }

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault()
    if (!phone || !selected) return
    const text = draftText.trim()
    if (!text && !selectedImage) return

    setSending(true)
    resetAlerts()
    try {
      const res = selectedImage
        ? await api.sendMedia(
            phone,
            selected.id,
            selectedImage,
            text || undefined,
            replyTo?.id,
          )
        : replyTo
          ? await api.replyMessage(phone, selected.id, replyTo.id, text)
          : await api.sendMessage(phone, selected.id, text)
      if (!res.success || !res.data) {
        setError(
          res.error ??
            (selectedImage
              ? 'Gửi ảnh thất bại'
              : replyTo
                ? 'Trả lời thất bại'
                : 'Gửi tin thất bại'),
        )
        return
      }
      if (res.data.status === 'error') {
        setError(res.data.message)
        return
      }
      setDraftText('')
      setReplyTo(null)
      clearSelectedImage()
      setSuccess(res.data.message)
      scrollIntentRef.current = 'latest'
      await loadMessages(selected, false)
      window.setTimeout(() => scrollToLatest('smooth'), 100)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không kết nối được API.')
    } finally {
      setSending(false)
    }
  }

  const chatActive = dialogs.length > 0

  return (
    <div className={`page page--dialogs${chatActive ? ' page--dialogs-active' : ''}`}>
      <section className="dialogs-session-card">
        <form
          className="dialogs-load-bar"
          onSubmit={(e) => void handleLoadDialogs(e)}
        >
          <PhoneSelect value={phone} onChange={setPhone} allowManual={false} />
          <button
            type="submit"
            className="btn btn--primary"
            disabled={loadingDialogs || !phone}
          >
            {loadingDialogs ? 'Đang tải…' : 'Tải chat'}
          </button>
        </form>
        {counts && (
          <div className="dialog-stat-chips">
            <span className={countChipClass('private')}>Private {counts.private}</span>
            <span className={countChipClass('bot')}>Bot {counts.bot}</span>
            <span className={countChipClass('group')}>Group {counts.group}</span>
            <span className={countChipClass('channel')}>Channel {counts.channel}</span>
          </div>
        )}
      </section>

      <Alert type="error" message={error} />
      <Alert type="success" message={success} />

      {!chatActive && (
        <section className="dialogs-empty-hero">
          <ChatEmptyIcon />
          <h2>Bắt đầu trò chuyện</h2>
          <p className="muted">
            Chọn session và bấm <strong>Tải chat</strong> để mở danh sách hội thoại.
          </p>
        </section>
      )}

      {chatActive && (
        <section className="dialogs-layout dialogs-workspace">
          <div className="dialogs-list-panel">
            <div className="dialogs-list-head">
              <div>
                <h2>Hội thoại</h2>
                <p className="dialogs-list-sub">
                  {filteredDialogs.length} / {dialogs.length} chat
                </p>
              </div>
            </div>

            <div className="dialogs-toolbar">
              <div className="dialogs-search-wrap">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
                  <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                  <path d="M20 20l-3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <input
                  type="search"
                  className="dialogs-search"
                  placeholder="Tìm theo tên, username…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="dialogs-filters">
                {FILTER_OPTIONS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`dialogs-filter-btn${filter === item.id ? ' dialogs-filter-btn--active' : ''}`}
                    onClick={() => setFilter(item.id)}
                  >
                    {item.label}
                    <span className="dialogs-filter-count">{filterCounts[item.id]}</span>
                  </button>
                ))}
              </div>
            </div>

            <ul className="dialogs-list">
              {pagedDialogs.map((dialog) => (
                <li key={dialog.id}>
                  <button
                    type="button"
                    className={`dialog-item${selected?.id === dialog.id ? ' dialog-item--active' : ''}${dialog.unread_count > 0 ? ' dialog-item--unread' : ''}`}
                    onClick={() => void handleSelectDialog(dialog)}
                  >
                    <div
                      className="dialog-avatar"
                      style={{ '--avatar-hue': avatarHue(dialog.title) } as React.CSSProperties}
                      aria-hidden
                    >
                      {dialogInitials(dialog.title)}
                    </div>
                    <div className="dialog-item-body">
                      <div className="dialog-item-top">
                        <span className="dialog-item-title">{dialog.title}</span>
                        <span className="dialog-item-top-end">
                          {dialog.pinned && (
                            <span className="dialog-flag" title="Đã ghim">📌</span>
                          )}
                          {dialog.muted && (
                            <span className="dialog-flag" title="Đã tắt tiếng">🔇</span>
                          )}
                          {dialog.date && (
                            <span className="dialog-date">{dialog.date}</span>
                          )}
                        </span>
                      </div>
                      <div className="dialog-item-bottom">
                        <p className="dialog-preview">
                          {dialog.last_message || 'Không có tin nhắn'}
                        </p>
                        {dialog.unread_count > 0 && (
                          <span className="dialog-unread">{dialog.unread_count}</span>
                        )}
                      </div>
                      <span className={kindBadgeClass(dialog.kind)}>
                        {kindLabel(dialog.kind)}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>

            {filteredDialogs.length === 0 && (
              <p className="muted dialogs-empty">Không có chat khớp bộ lọc.</p>
            )}

            {filteredDialogs.length > 0 && (
              <Pagination
                className="pagination--compact"
                page={dialogPage}
                totalPages={dialogTotalPages}
                total={filteredDialogs.length}
                from={dialogFrom}
                to={dialogTo}
                onPageChange={setDialogPage}
                pageSize={dialogPageSize}
                pageSizeOptions={[20, 40, 60]}
                onPageSizeChange={setDialogPageSize}
              />
            )}
          </div>

          <div className="dialogs-messages-panel">
            {selected ? (
              <div className="chat-header">
                <div
                  className="dialog-avatar dialog-avatar--lg"
                  style={
                    { '--avatar-hue': avatarHue(messagesTitle || selected.title) } as React.CSSProperties
                  }
                  aria-hidden
                >
                  {dialogInitials(messagesTitle || selected.title)}
                </div>
                <div className="chat-header-text">
                  <h2>{messagesTitle || selected.title}</h2>
                  <p className="chat-header-meta">
                    <span className={kindBadgeClass(selected.kind)}>
                      {kindLabel(selected.kind)}
                    </span>
                    {selected.username && (
                      <span className="chat-header-username">@{selected.username}</span>
                    )}
                    {!loadingMessages && messages.length > 0 && (
                      <span className="chat-header-count">
                        {messages.length} tin
                        {hasMoreOlder ? ' · còn tin cũ hơn' : ''}
                      </span>
                    )}
                  </p>
                </div>
                {selected.link && (
                  <a
                    className="chat-header-link btn btn--sm btn--ghost"
                    href={selected.link}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Mở Telegram
                  </a>
                )}
              </div>
            ) : (
              <div className="chat-header chat-header--empty">
                <h2>Tin nhắn</h2>
                <p className="chat-header-meta">Chọn hội thoại bên trái</p>
              </div>
            )}

            <div className="chat-body">
              {!selected && (
                <div className="empty-state empty-state--chat">
                  <ChatEmptyIcon />
                  <p>Chọn một cuộc trò chuyện để xem tin nhắn</p>
                </div>
              )}

              {selected && loadingMessages && (
                <div className="chat-loading">
                  <span className="spinner spinner--accent" aria-hidden />
                  <p>Đang tải tin nhắn…</p>
                </div>
              )}

              {selected && !loadingMessages && messages.length === 0 && (
                <div className="empty-state empty-state--chat">
                  <ChatEmptyIcon />
                  <p>Chưa có tin nhắn trong hội thoại này</p>
                </div>
              )}

              {selected && !loadingMessages && messages.length > 0 && (
                <>
                  {hasMoreOlder && (
                    <button
                      type="button"
                      className="chat-load-older-fab"
                      onClick={() => void loadOlderMessages()}
                      disabled={loadingOlder}
                      title="Tải tin nhắn cũ hơn"
                      aria-label="Tải tin nhắn cũ hơn"
                    >
                      {loadingOlder ? (
                        <span className="spinner spinner--accent" aria-hidden />
                      ) : (
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
                          <path
                            d="M12 19V5m0 0-6 6m6-6 6 6"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                      <span>{loadingOlder ? 'Đang tải…' : 'Tải tin cũ hơn'}</span>
                    </button>
                  )}
                  <div
                    ref={messagesScrollRef}
                    className="chat-messages-area"
                    onScroll={handleMessagesScroll}
                  >
                    <ul className="messages-list">
                    {messages.map((msg) => {
                      const isPhoto =
                        msg.has_photo ||
                        msg.content_type === 'photo' ||
                        (msg.has_media && msg.text === '[photo]')
                      const displayText =
                        isPhoto && (msg.text === '[photo]' || !msg.text) ? '' : msg.text
                      return (
                        <li
                          key={msg.id}
                          ref={(el) => {
                            if (el) messageRefs.current.set(msg.id, el)
                            else messageRefs.current.delete(msg.id)
                          }}
                          className={`message-row${msg.outgoing ? ' message-row--out' : ''}`}
                        >
                          <div
                            className={`message-bubble${isPhoto ? ' message-bubble--media' : ''}`}
                          >
                            <div className="message-head">
                              {!msg.outgoing && (
                                <span className="message-sender">
                                  {msg.sender_name || '—'}
                                </span>
                              )}
                              {msg.outgoing && (
                                <span className="message-you">Bạn</span>
                              )}
                              <span className="message-date">{msg.date}</span>
                            </div>
                            {isPhoto && selected && (
                              loadedPhotoIds.has(msg.id) ? (
                                <img
                                  className="message-photo"
                                  src={api.messagePhotoUrl(phone, selected.id, msg.id)}
                                  alt="Ảnh"
                                  onLoad={() => {
                                    if (isAtBottom()) scrollToLatest('auto')
                                  }}
                                />
                              ) : (
                                <button
                                  type="button"
                                  className="message-photo-trigger"
                                  onClick={() => revealPhoto(msg.id)}
                                >
                                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
                                    <rect x="4" y="5" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
                                    <circle cx="9" cy="10" r="1.5" fill="currentColor" />
                                    <path
                                      d="M4 16l4.5-4.5 3 3 5-5 3.5 3.5"
                                      stroke="currentColor"
                                      strokeWidth="1.8"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                  <span>Xem ảnh</span>
                                </button>
                              )
                            )}
                            {displayText ? (
                              <MessageText text={displayText} />
                            ) : (
                              !isPhoto && <p className="message-text message-text--empty">—</p>
                            )}
                            {msg.has_media && !isPhoto && (
                              <span className={`media-chip media-chip--${msg.content_type}`}>
                                {mediaTypeLabel(msg.content_type)}
                              </span>
                            )}
                            <MessageReactionBar
                              msg={msg}
                              reactionsPolicy={reactionsPolicy}
                              reactingId={reactingId}
                              sending={sending}
                              onReact={handleSendReaction}
                            />
                            <div className="message-actions">
                              <button
                                type="button"
                                className="btn btn--sm btn--ghost message-reply-btn"
                                onClick={() => {
                                  setReplyTo(msg)
                                  setDraftText('')
                                  resetAlerts()
                                }}
                              >
                                Trả lời
                              </button>
                              {msg.outgoing && (
                                <button
                                  type="button"
                                  className="btn btn--sm btn--danger message-reply-btn"
                                  disabled={deletingId === msg.id || sending}
                                  onClick={() => void handleDeleteMessage(msg)}
                                >
                                  {deletingId === msg.id ? '…' : 'Xóa'}
                                </button>
                              )}
                            </div>
                          </div>
                        </li>
                      )
                    })}
                    </ul>
                  </div>

                  {showJumpBtn && (
                    <button
                      type="button"
                      className={`chat-jump-btn${pendingUnread > 0 ? ' chat-jump-btn--pulse' : ''}`}
                      onClick={handleJumpToLatest}
                      title={
                        pendingUnread > 0
                          ? `${pendingUnread} tin chưa đọc`
                          : 'Tới tin nhắn mới nhất'
                      }
                      aria-label="Tới tin nhắn mới nhất"
                    >
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
                        <path
                          d="M12 5v14m0 0-6-6m6 6-6 6"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      {pendingUnread > 0 && (
                        <span className="chat-jump-badge">
                          {pendingUnread > 99 ? '99+' : pendingUnread}
                        </span>
                      )}
                    </button>
                  )}
                </>
              )}
            </div>

            {selected && (
              <form className="message-compose" onSubmit={(e) => void handleSendMessage(e)}>
                {replyTo && (
                  <div className="reply-preview">
                    <div>
                      <p className="reply-preview-label">
                        Trả lời #{replyTo.id} —{' '}
                        {replyTo.outgoing ? 'Bạn' : replyTo.sender_name || '—'}
                      </p>
                      <p className="reply-preview-text muted">
                        {(replyTo.text || '[media]').slice(0, 120)}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn btn--sm btn--ghost"
                      onClick={() => setReplyTo(null)}
                    >
                      Hủy
                    </button>
                  </div>
                )}
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="message-image-input"
                  onChange={handleImageSelect}
                  disabled={sending || loadingMessages}
                />
                {selectedImage && imagePreview && (
                  <div className="message-image-preview">
                    <img src={imagePreview} alt={selectedImage.name} />
                    <div className="message-image-preview-meta">
                      <span className="muted">{selectedImage.name}</span>
                      <button
                        type="button"
                        className="btn btn--sm btn--ghost"
                        onClick={clearSelectedImage}
                        disabled={sending}
                      >
                        Bỏ ảnh
                      </button>
                    </div>
                  </div>
                )}
                <div className="message-compose-box">
                  <button
                    type="button"
                    className="btn btn--icon btn--ghost message-compose-attach"
                    title="Chọn ảnh"
                    onClick={() => imageInputRef.current?.click()}
                    disabled={sending || loadingMessages}
                  >
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
                      <rect x="4" y="5" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
                      <circle cx="9" cy="10" r="1.5" fill="currentColor" />
                      <path d="M4 16l4.5-4.5 3 3 5-5 3.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <textarea
                    className="message-compose-input"
                    rows={1}
                    placeholder={
                      selectedImage
                        ? 'Thêm caption (tùy chọn)…'
                        : replyTo
                          ? 'Viết câu trả lời…'
                          : 'Nhập tin nhắn…'
                    }
                    value={draftText}
                    onChange={(e) => setDraftText(e.target.value)}
                    disabled={sending || loadingMessages}
                    maxLength={selectedImage ? 1024 : 4096}
                  />
                  <button
                    type="submit"
                    className="btn btn--primary btn--send"
                    disabled={
                      sending ||
                      loadingMessages ||
                      (!draftText.trim() && !selectedImage)
                    }
                    title="Gửi"
                  >
                    {sending ? (
                      <span className="spinner" />
                    ) : (
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
                        <path
                          d="M5 12h12m0 0-5-5m5 5-5 5"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </button>
                </div>
                <p className="message-compose-meta muted">
                  {selectedImage
                    ? `${draftText.length}/1024 · ảnh đã chọn`
                    : `${draftText.length}/4096`}
                </p>
              </form>
            )}
          </div>
        </section>
      )}
    </div>
  )
}