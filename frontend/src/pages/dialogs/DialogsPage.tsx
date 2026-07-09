import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './DialogsPage.css'
import { useSearchParams } from 'react-router-dom'
import { api } from '../../api/client'
import { Alert } from '../../components/Alert'
import { ForwardMessageModal } from '../../components/ForwardMessageModal'
import { JumpToMessageModal } from '../../components/JumpToMessageModal'
import { MediaGalleryModal } from '../../components/MediaGalleryModal'
import { MessageContextMenu, type MessageContextMenuState } from '../../components/MessageContextMenu'
import { MessageSelectionBar } from '../../components/MessageSelectionBar'
import { DialogsAccountSelect } from '../../components/DialogsAccountSelect'
import { useSessionAccounts } from '../../hooks/useSessionAccounts'
import { PinnedMessagesBar } from '../../components/PinnedMessagesBar'
import { PinnedMessagesPanel } from '../../components/PinnedMessagesPanel'
import type {
  DialogCounts,
  DialogItem,
  DialogMessageItem,
  DialogReactionsPolicy,
} from '../../types/api'
import { avatarHue, dialogInitials } from '../../utils/avatar'
import { clearDraft, loadDraft, saveDraft } from '../../utils/dialogDraftStorage'
import { mergeDialogsWithReadState, saveReadState } from '../../utils/dialogReadStorage'
import {
  applyDeletedMessage,
  applyEditedMessage,
  applyMessageReactions,
  inferHasMoreOlder,
  isStaleMessagesRequest,
  mergeNewMessages,
  mergeSearchMessageResults,
  messageCopyText,
  PINNED_MESSAGES_PAGE_SIZE,
  planPartialMarkRead,
} from '../../utils/dialogMessages'
import {
  detectChatMediaKind,
  validateChatMediaFile,
  type ChatMediaKind,
} from '../../utils/chatMedia'
import { canReactWith, reactionsHint } from '../../utils/reactions'
import { buildChatTimeline } from '../../utils/chatTimeline'
import {
  useDialogMessageStream,
  type DialogPreviewPatch,
} from '../../hooks/useDialogMessageStream'

import {
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
  kindBadgeClass,
  kindLabel,
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

export function DialogsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const accounts = useSessionAccounts()
  const [phone, setPhone] = useState(() => searchParams.get('phone')?.trim() ?? '')
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
  const [selectedMedia, setSelectedMedia] = useState<File | null>(null)
  const [selectedMediaKind, setSelectedMediaKind] = useState<ChatMediaKind | null>(null)
  const [mediaPreview, setMediaPreview] = useState<string | null>(null)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [messageSearch, setMessageSearch] = useState('')
  const [messageSearchIndex, setMessageSearchIndex] = useState(0)
  const [forwardMessage, setForwardMessage] = useState<DialogMessageItem | null>(null)
  const [forwardMessages, setForwardMessages] = useState<DialogMessageItem[]>([])
  const [forwarding, setForwarding] = useState(false)
  const {
    selectMode,
    selectedMessageIds,
    enterSelectMode: enterSelectModeBase,
    exitSelectionMode,
    toggleMessageSelection,
  } = useDialogSelection()
  const [editingMessage, setEditingMessage] = useState<DialogMessageItem | null>(null)
  const [showJumpModal, setShowJumpModal] = useState(false)
  const [jumpingMessages, setJumpingMessages] = useState(false)
  const [refreshingDialogs, setRefreshingDialogs] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [pinningId, setPinningId] = useState<number | null>(null)
  const [showGallery, setShowGallery] = useState(false)
  const [pinnedMessages, setPinnedMessages] = useState<DialogMessageItem[]>([])
  const [pinnedIndex, setPinnedIndex] = useState(0)
  const [showPinnedBar, setShowPinnedBar] = useState(true)
  const [showPinnedList, setShowPinnedList] = useState(false)
  const [hasMorePinned, setHasMorePinned] = useState(false)
  const [loadingMorePinned, setLoadingMorePinned] = useState(false)
  const [jumpingToPinnedId, setJumpingToPinnedId] = useState<number | null>(null)
  const [messageMenu, setMessageMenu] = useState<MessageContextMenuState | null>(null)
  const messagesSnapshotRef = useRef<DialogMessageItem[]>([])
  const hasMoreOlderSnapshotRef = useRef(false)
  const { error, success, setError, setSuccess, resetAlerts } = useDialogAlerts()
  const imageInputRef = useRef<HTMLInputElement>(null)
  const messageSearchInputRef = useRef<HTMLInputElement>(null)
  const composeInputRef = useRef<HTMLTextAreaElement>(null)
  const draftSaveTimerRef = useRef<number | null>(null)
  const messagesScrollRef = useRef<HTMLDivElement>(null)
  const loadOlderSentinelRef = useRef<HTMLDivElement>(null)
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
  const [loadedMediaIds, setLoadedMediaIds] = useState<Set<number>>(() => new Set())
  const [unreadDividerAfterId, setUnreadDividerAfterId] = useState<number | null>(null)
  const [streamMinId, setStreamMinId] = useState(0)
  const [serverSearchResults, setServerSearchResults] = useState<DialogMessageItem[]>([])
  const [serverSearchLoading, setServerSearchLoading] = useState(false)
  const isAtBottomRef = useRef(true)

  useEffect(() => {
    messagesSnapshotRef.current = messages
  }, [messages])

  useEffect(() => {
    hasMoreOlderSnapshotRef.current = hasMoreOlder
  }, [hasMoreOlder])

  const filterCounts = useMemo(() => computeFilterCounts(dialogs), [dialogs])

  const filteredDialogs = useMemo(
    () => filterDialogs(dialogs, filter, search, unreadOnly),
    [dialogs, filter, search, unreadOnly],
  )

  const unreadDialogCount = useMemo(
    () => dialogs.filter((dialog) => dialog.unread_count > 0).length,
    [dialogs],
  )

  const messageSearchMatches = useMemo(() => {
    const q = messageSearch.trim().toLowerCase()
    if (!q) return messages
    const local = messages.filter((msg) => {
      const haystack = [
        msg.text,
        msg.sender_name,
        msg.content_type,
        String(msg.id),
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
    if (serverSearchResults.length > 0) {
      return mergeSearchMessageResults(serverSearchResults, local)
    }
    return local
  }, [messages, messageSearch, serverSearchResults])

  const displayedMessages = messageSearch.trim() ? messageSearchMatches : messages

  const chatTimeline = useMemo(() => {
    if (messageSearch.trim()) {
      return displayedMessages.map((msg) => ({
        type: 'message' as const,
        key: `msg-${msg.id}`,
        msg,
      }))
    }
    return buildChatTimeline(displayedMessages, unreadDividerAfterId)
  }, [displayedMessages, messageSearch, unreadDividerAfterId])

  const canPinMessages = selected?.kind === 'group' || selected?.kind === 'channel'
  const showPinnedMessages = canPinMessages && showPinnedBar && pinnedMessages.length > 0

  const reactionPolicyHint = useMemo(
    () => reactionsHint(reactionsPolicy),
    [reactionsPolicy],
  )

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

  const scrollMessageToCenterOfView = useCallback(
    (target: HTMLElement, behavior: ScrollBehavior = 'smooth') => {
      const container = messagesScrollRef.current
      if (!container) return false
      const top =
        target.getBoundingClientRect().top -
        container.getBoundingClientRect().top +
        container.scrollTop
      const scrollTop = top - (container.clientHeight - target.offsetHeight) / 2
      container.scrollTo({ top: Math.max(0, scrollTop), behavior })
      return true
    },
    [],
  )

  const highlightMessageRow = useCallback((target: HTMLElement) => {
    target.classList.add('message-row--highlight')
    window.setTimeout(() => target.classList.remove('message-row--highlight'), 1600)
  }, [])

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

  const applyPartialMarkRead = useCallback(
    (dialogId: string, plan: NonNullable<ReturnType<typeof planPartialMarkRead>>) => {
      openingReadMaxIdRef.current = plan.maxId
      openingUnreadRef.current = plan.remainingUnread
      applyDialogReadState(dialogId, plan.maxId, plan.remainingUnread)
      setPendingUnread(plan.remainingUnread)
      if (plan.remainingUnread <= 0 && phone) {
        saveReadState(phone, dialogId, plan.maxId)
      }
    },
    [phone, applyDialogReadState],
  )

  const commitMarkRead = useCallback(
    async (dialogId: string, explicitMaxId?: number) => {
      const readBaseline = openingReadMaxIdRef.current
      const openingUnread = openingUnreadRef.current
      const plan = planPartialMarkRead(
        messages,
        readBaseline,
        openingUnread,
        explicitMaxId,
      )
      if (!phone || !dialogId || !plan || plan.maxId <= 0) return

      if (markPartialTimerRef.current) {
        window.clearTimeout(markPartialTimerRef.current)
        markPartialTimerRef.current = null
      }
      if (markReadTimerRef.current) {
        window.clearTimeout(markReadTimerRef.current)
        markReadTimerRef.current = null
      }

      applyPartialMarkRead(dialogId, plan)

      if (!plan.syncToServer) return

      try {
        const res = await api.markDialogRead(phone, dialogId, plan.maxId)
        if (!res.success || !res.data || res.data.status === 'error') return

        const readMaxId = res.data.read_inbox_max_id || plan.maxId
        const unreadCount = res.data.unread_count ?? 0
        openingReadMaxIdRef.current = readMaxId
        openingUnreadRef.current = unreadCount
        applyDialogReadState(dialogId, readMaxId, unreadCount)
        setPendingUnread(unreadCount)
        if (unreadCount <= 0) saveReadState(phone, dialogId, readMaxId)
      } catch {
        // UI đã optimistic; localStorage vẫn giữ trạng thái đã đọc
      }
    },
    [phone, messages, applyPartialMarkRead, applyDialogReadState],
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

      const readMaxId = selected?.read_inbox_max_id ?? openingReadMaxIdRef.current
      const unread = selected?.unread_count ?? openingUnreadRef.current
      const plan = planPartialMarkRead(messages, readMaxId, unread, maxId)
      if (!plan) return
      if (unread <= 0 && readMaxId >= plan.maxId) return

      await commitMarkRead(dialogId, maxId)
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
    isAtBottomRef.current = atBottom
    setShowJumpBtn(!atBottom)

    if (!selected || messages.length === 0) return

    if (atBottom) {
      const readBaseline = openingReadMaxIdRef.current
      const openingUnread = openingUnreadRef.current
      const plan = planPartialMarkRead(messages, readBaseline, openingUnread)
      if (plan && plan.maxId > 0) {
        applyPartialMarkRead(selected.id, plan)
        if (plan.syncToServer) markAsReadDebounced()
      }
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
    applyPartialMarkRead,
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
    if (loadingOlderRef.current || loadingMessages || messageSearch.trim()) return

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

      const existingIds = new Set(messages.map((msg) => msg.id))
      const uniqueOlder = older.filter((msg) => !existingIds.has(msg.id))
      if (uniqueOlder.length === 0) {
        setHasMoreOlder(false)
        hasMoreOlderSnapshotRef.current = false
        return
      }

      setMessages((prev) => {
        const ids = new Set(prev.map((msg) => msg.id))
        const freshOlder = older.filter((msg) => !ids.has(msg.id))
        const merged = [...freshOlder, ...prev]
        messagesSnapshotRef.current = merged
        return merged
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
        const container = messagesScrollRef.current
        if (
          container &&
          hasMoreOlderSnapshotRef.current &&
          container.scrollTop <= SCROLL_TOP_THRESHOLD &&
          !messageSearch.trim()
        ) {
          window.requestAnimationFrame(() => {
            void loadOlderMessages()
          })
        }
      }
    }
  }, [
    phone,
    selected,
    messages,
    hasMoreOlder,
    loadingMessages,
    messageSearch,
    isMessagesRequestStale,
  ])

  const handleMessagesScroll = useCallback(() => {
    updateJumpButton()
  }, [updateJumpButton])

  useEffect(() => {
    const root = messagesScrollRef.current
    const sentinel = loadOlderSentinelRef.current
    if (
      !root ||
      !sentinel ||
      !selected ||
      !hasMoreOlder ||
      loadingMessages ||
      messageSearch.trim()
    ) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || loadingOlderRef.current) return
        void loadOlderMessages()
      },
      { root, threshold: 0, rootMargin: '96px 0px 0px 0px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [
    selected?.id,
    hasMoreOlder,
    loadingMessages,
    messageSearch,
    loadOlderMessages,
  ])

  const handleJumpToLatest = () => {
    scrollToLatest('smooth')
    if (selected) {
      void commitMarkRead(selected.id)
    }
    window.setTimeout(updateJumpButton, 350)
  }

  function resetDialogsView() {
    setDialogs([])
    setCounts(null)
    setSelected(null)
    selectedDialogIdRef.current = null
    messagesRequestSeqRef.current += 1
    setMessages([])
    setMessagesTitle('')
    setReactionsPolicy(null)
    setReplyTo(null)
    setSearch('')
    setFilter('all')
    setUnreadOnly(false)
    setUnreadDividerAfterId(null)
    setStreamMinId(0)
    setServerSearchResults([])
    setLoadedPhotoIds(new Set())
    resetAlerts()
  }

  const loadDialogs = useCallback(async (targetPhone: string) => {
    const activePhone = targetPhone.trim()
    if (!activePhone) return

    setLoadingDialogs(true)
    resetDialogsView()
    try {
      const res = await api.listDialogs(activePhone, DIALOGS_FETCH_LIMIT)
      if (!res.success || !res.data) {
        setError(res.error ?? 'Không tải được danh sách chat')
        return
      }
      if (res.data.status === 'error') {
        setError(res.data.message)
        return
      }
      setDialogs(mergeDialogsWithReadState(activePhone, res.data.dialogs))
      setCounts(res.data.counts)
      setSuccess(
        dialogsLoadSuccessMessage(res.data.total, res.data.limit ?? DIALOGS_FETCH_LIMIT),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không kết nối được API.')
    } finally {
      setLoadingDialogs(false)
    }
  }, [])

  const handlePhoneChange = useCallback((next: string) => {
    if (next === phone) return
    setPhone(next)
    resetDialogsView()
  }, [phone])

  useEffect(() => {
    const phoneParam = searchParams.get('phone')?.trim() ?? ''
    if (!phoneParam) return
    if (accounts.loading) return

    if (!accounts.sessions.includes(phoneParam)) {
      setError(`Không tìm thấy session ${phoneParam}`)
      return
    }

    setPhone((current) => (current === phoneParam ? current : phoneParam))
  }, [searchParams, accounts.loading, accounts.sessions])

  function clearSelectedMedia() {
    if (mediaPreview) URL.revokeObjectURL(mediaPreview)
    setSelectedMedia(null)
    setSelectedMediaKind(null)
    setMediaPreview(null)
    if (imageInputRef.current) imageInputRef.current.value = ''
  }

  useEffect(() => {
    return () => {
      if (mediaPreview) URL.revokeObjectURL(mediaPreview)
    }
  }, [mediaPreview])

  useEffect(() => {
    setMessageSearchIndex(0)
  }, [messageSearch, selected?.id])

  useEffect(() => {
    if (!phone || !selected) return
    if (draftSaveTimerRef.current) window.clearTimeout(draftSaveTimerRef.current)
    draftSaveTimerRef.current = window.setTimeout(() => {
      saveDraft(phone, selected.id, draftText)
    }, 400)
    return () => {
      if (draftSaveTimerRef.current) window.clearTimeout(draftSaveTimerRef.current)
    }
  }, [phone, selected, draftText])

  const refreshDialogsList = useCallback(async (quiet = false) => {
    if (!phone) return
    if (!quiet) setRefreshingDialogs(true)
    try {
      const res = await api.listDialogs(phone, DIALOGS_FETCH_LIMIT)
      if (!res.success || !res.data || res.data.status === 'error') return
      const merged = mergeDialogsWithReadState(phone, res.data.dialogs)
      setDialogs(merged)
      setCounts(res.data.counts)
      setSelected((prev) => {
        if (!prev) return prev
        return merged.find((item) => item.id === prev.id) ?? prev
      })
    } catch {
      if (!quiet) setError('Không làm mới được danh sách chat')
    } finally {
      if (!quiet) setRefreshingDialogs(false)
    }
  }, [phone])

  useEffect(() => {
    if (!phone || dialogs.length === 0) return
    const timer = window.setInterval(() => {
      void refreshDialogsList(true)
    }, 30000)
    return () => window.clearInterval(timer)
  }, [phone, dialogs.length, refreshDialogsList])

  const handleStreamMessages = useCallback(
    (incoming: DialogMessageItem[], preview: DialogPreviewPatch | null) => {
      const dialogId = selectedDialogIdRef.current
      const requestSeq = messagesRequestSeqRef.current
      if (!dialogId) return

      const wasAtBottom = isAtBottomRef.current
      setMessages((prev) => {
        const merged = mergeNewMessages(prev, incoming)
        messagesSnapshotRef.current = merged
        return merged
      })

      const incomingUnread = incoming.filter((msg) => !msg.outgoing).length
      if (preview) {
        const isOpenChat = preview.peer_id === dialogId
        const patchDialog = (dialog: DialogItem): DialogItem => {
          if (dialog.id !== preview.peer_id) return dialog
          const nextUnread =
            isOpenChat && wasAtBottom ? 0 : dialog.unread_count + incomingUnread
          return {
            ...dialog,
            last_message: preview.last_message || dialog.last_message,
            last_message_id: preview.last_message_id ?? dialog.last_message_id,
            date: preview.date || dialog.date,
            unread_count: nextUnread,
          }
        }
        setDialogs((prev) => prev.map(patchDialog))
        setSelected((prev) => (prev?.id === preview.peer_id ? patchDialog(prev) : prev))
      }

      if (wasAtBottom) {
        window.requestAnimationFrame(() => scrollToLatest('auto'))
      } else if (incomingUnread > 0) {
        setShowJumpBtn(true)
        setPendingUnread((prev) => prev + incomingUnread)
      }

      if (requestSeq !== messagesRequestSeqRef.current) return
    },
    [scrollToLatest],
  )

  const handleStreamResync = useCallback(
    (cursor: number) => {
      if (!selected) return
      if (cursor > 0) {
        setStreamMinId(cursor)
      }
      void loadMessages(selected, false)
    },
    [selected],
  )

  const handleStreamEdited = useCallback((edited: DialogMessageItem) => {
    setMessages((prev) => {
      const next = applyEditedMessage(prev, edited)
      messagesSnapshotRef.current = next
      return next
    })
  }, [])

  const handleStreamDeleted = useCallback((messageId: number) => {
    setMessages((prev) => {
      const next = applyDeletedMessage(prev, messageId)
      messagesSnapshotRef.current = next
      return next
    })
  }, [])

  const handleStreamReaction = useCallback(
    (messageId: number, reactions: DialogMessageItem['reactions']) => {
      setMessages((prev) => {
        const next = applyMessageReactions(prev, messageId, reactions)
        messagesSnapshotRef.current = next
        return next
      })
    },
    [],
  )

  const handleStreamRead = useCallback(
    (maxId: number, unreadCount: number) => {
      const dialogId = selectedDialogIdRef.current
      if (!dialogId) return
      const patchDialog = (dialog: DialogItem): DialogItem => {
        if (dialog.id !== dialogId) return dialog
        return { ...dialog, unread_count: unreadCount }
      }
      setDialogs((prev) => prev.map(patchDialog))
      setSelected((prev) => (prev?.id === dialogId ? patchDialog(prev) : prev))
      if (maxId > 0) {
        setStreamMinId((prev) => (prev > 0 ? Math.max(prev, maxId) : prev))
      }
    },
    [],
  )

  useDialogMessageStream({
    phone,
    peerId: selected?.id ?? '',
    minId: streamMinId,
    enabled: Boolean(
      phone &&
        selected &&
        streamMinId > 0 &&
        !loadingMessages &&
        !selectMode &&
        !messageSearch.trim(),
    ),
    onMessages: handleStreamMessages,
    onResyncRequired: handleStreamResync,
    onMessageEdited: handleStreamEdited,
    onMessageDeleted: handleStreamDeleted,
    onReaction: handleStreamReaction,
    onRead: handleStreamRead,
  })

  useEffect(() => {
    if (!selected || messages.length === 0) {
      setStreamMinId(0)
      return
    }
    setStreamMinId((prev) =>
      prev > 0 ? prev : messages[messages.length - 1].id,
    )
  }, [selected?.id, messages])

  useEffect(() => {
    const q = messageSearch.trim()
    if (q.length < 2 || !phone || !selected) {
      setServerSearchResults([])
      setServerSearchLoading(false)
      return
    }

    setServerSearchLoading(true)
    const dialogId = selected.id
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await api.searchDialogMessages(phone, dialogId, q)
          if (dialogId !== selectedDialogIdRef.current) return
          if (res.success && res.data?.status === 'success') {
            setServerSearchResults(res.data.messages)
          } else {
            setServerSearchResults([])
          }
        } catch {
          setServerSearchResults([])
        } finally {
          setServerSearchLoading(false)
        }
      })()
    }, 400)

    return () => window.clearTimeout(timer)
  }, [messageSearch, phone, selected?.id])

  const enterSelectMode = useCallback((initialMessageId?: number) => {
    setForwardMessage(null)
    setForwardMessages([])
    resetAlerts()
    enterSelectModeBase(initialMessageId)
  }, [enterSelectModeBase, resetAlerts])

  const canEditMessage = useCallback((msg: DialogMessageItem) => {
    if (!msg.outgoing) return false
    const text = messageCopyText(msg)
    return text.length > 0
  }, [])

  const startEditMessage = useCallback((msg: DialogMessageItem) => {
    if (!canEditMessage(msg)) return
    setEditingMessage(msg)
    setReplyTo(null)
    setDraftText(messageCopyText(msg))
    clearSelectedMedia()
    resetAlerts()
    window.setTimeout(() => composeInputRef.current?.focus(), 0)
  }, [canEditMessage])

  const cancelEdit = useCallback(() => {
    setEditingMessage(null)
    if (phone && selected) {
      setDraftText(loadDraft(phone, selected.id))
    } else {
      setDraftText('')
    }
  }, [phone, selected])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const tag = target?.tagName?.toLowerCase()
      const inField = tag === 'input' || tag === 'textarea' || target?.isContentEditable

      if (event.key === 'Escape') {
        if (messageMenu) {
          setMessageMenu(null)
          event.preventDefault()
          return
        }
        if (showJumpModal) {
          setShowJumpModal(false)
          event.preventDefault()
          return
        }
        if (selectMode) {
          exitSelectionMode()
          event.preventDefault()
          return
        }
        if (editingMessage) {
          cancelEdit()
          event.preventDefault()
          return
        }
        if (replyTo) {
          setReplyTo(null)
          event.preventDefault()
        }
        return
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        if (selected && messages.length > 0) {
          event.preventDefault()
          messageSearchInputRef.current?.focus()
        }
        return
      }

      if (
        event.key === 'ArrowUp' &&
        inField &&
        target === composeInputRef.current &&
        !replyTo &&
        !selectedMedia &&
        !editingMessage &&
        !draftText.trim()
      ) {
        const lastOutgoing = [...messages].reverse().find((msg) => canEditMessage(msg))
        if (lastOutgoing) {
          event.preventDefault()
          startEditMessage(lastOutgoing)
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    messageMenu,
    showJumpModal,
    selectMode,
    editingMessage,
    replyTo,
    selected,
    messages,
    draftText,
    selectedMedia,
    exitSelectionMode,
    cancelEdit,
    canEditMessage,
    startEditMessage,
  ])

  useEffect(() => {
    return () => {
      if (markReadTimerRef.current) window.clearTimeout(markReadTimerRef.current)
      if (markPartialTimerRef.current) window.clearTimeout(markPartialTimerRef.current)
      if (draftSaveTimerRef.current) window.clearTimeout(draftSaveTimerRef.current)
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

  function applySelectedMediaFile(file: File) {
    const validationError = validateChatMediaFile(file)
    if (validationError) {
      setError(validationError)
      clearSelectedMedia()
      return false
    }
    const kind = detectChatMediaKind(file)
    if (!kind) {
      setError('Không nhận dạng được loại file.')
      clearSelectedMedia()
      return false
    }
    resetAlerts()
    if (mediaPreview) URL.revokeObjectURL(mediaPreview)
    setSelectedMedia(file)
    setSelectedMediaKind(kind)
    setMediaPreview(kind === 'image' ? URL.createObjectURL(file) : null)
    return true
  }

  function normalizePastedFile(file: File, mimeType: string): File {
    const type = (mimeType || file.type || 'image/png').split(';')[0].trim().toLowerCase()
    if (file.name && file.name !== 'image.png' && !file.name.startsWith('blob')) {
      return file
    }
    const ext =
      type === 'image/jpeg'
        ? 'jpg'
        : type === 'image/webp'
          ? 'webp'
          : type === 'image/gif'
            ? 'gif'
            : type === 'video/mp4'
              ? 'mp4'
              : type === 'video/webm'
                ? 'webm'
                : 'png'
    return new File([file], `paste-${Date.now()}.${ext}`, { type })
  }

  function handleMediaSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    applySelectedMediaFile(file)
  }

  function handleComposePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    if (sending || loadingMessages) return

    const items = e.clipboardData?.items
    if (!items?.length) return

    for (const item of items) {
      if (item.kind !== 'file') continue
      const raw = item.getAsFile()
      if (!raw) continue

      const mimeType = (item.type || raw.type || '').split(';')[0].trim().toLowerCase()
      const file = normalizePastedFile(raw, mimeType)
      if (!detectChatMediaKind(file)) continue

      if (editingMessage) {
        e.preventDefault()
        setError('Không sửa tin kèm file mới — chỉ sửa chữ')
        return
      }

      e.preventDefault()
      applySelectedMediaFile(file)
      return
    }
  }

  const waitForScrollToMessage = useCallback(
    (messageId: number, maxAttempts = 80): Promise<boolean> =>
      new Promise((resolve) => {
        const tryScroll = (attempt: number) => {
          const target = messageRefs.current.get(messageId)
          if (target) {
            scrollMessageToCenterOfView(target, 'smooth')
            highlightMessageRow(target)
            resolve(true)
            return
          }
          if (attempt >= maxAttempts) {
            resolve(false)
            return
          }
          window.requestAnimationFrame(() => tryScroll(attempt + 1))
        }
        tryScroll(0)
      }),
    [highlightMessageRow, scrollMessageToCenterOfView],
  )

  const scrollToMessageIdWithRetry = useCallback(
    (messageId: number) => {
      void waitForScrollToMessage(messageId)
    },
    [waitForScrollToMessage],
  )

  function scrollToMessageId(messageId: number) {
    scrollToMessageIdWithRetry(messageId)
  }

  const fetchOlderMessageBatch = useCallback(async (): Promise<DialogMessageItem[]> => {
    if (!phone || !selected) return []
    const dialogId = selected.id
    const requestSeq = messagesRequestSeqRef.current
    const offsetId = messagesSnapshotRef.current[0]?.id
    if (!offsetId) return []

    const res = await api.getDialogMessages(
      phone,
      dialogId,
      MESSAGES_OLDER_LIMIT,
      offsetId,
    )
    if (
      requestSeq !== messagesRequestSeqRef.current ||
      dialogId !== selectedDialogIdRef.current
    ) {
      return []
    }
    if (!res.success || !res.data || res.data.status === 'error') return []

    const older = res.data.messages
    if (older.length === 0) {
      setHasMoreOlder(false)
      hasMoreOlderSnapshotRef.current = false
      return []
    }

    const more = inferHasMoreOlder(
      older.length,
      MESSAGES_OLDER_LIMIT,
      res.data.has_more_older,
    )
    setHasMoreOlder(more)
    hasMoreOlderSnapshotRef.current = more

    setMessages((prev) => {
      const existingIds = new Set(prev.map((msg) => msg.id))
      const uniqueOlder = older.filter((msg) => !existingIds.has(msg.id))
      const merged = [...uniqueOlder, ...prev]
      messagesSnapshotRef.current = merged
      return merged
    })
    return older
  }, [phone, selected])

  const waitForDomPaint = useCallback(
    () =>
      new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => resolve())
        })
      }),
    [],
  )

  const navigateToPinnedMessage = useCallback(
    async (messageId: number) => {
      if (!phone || !selected) return

      const index = pinnedMessages.findIndex((msg) => msg.id === messageId)
      if (index >= 0) setPinnedIndex(index)
      setShowPinnedList(false)
      setMessageSearch('')
      setJumpingToPinnedId(messageId)
      resetAlerts()

      const pinnedMeta = pinnedMessages.find((msg) => msg.id === messageId)

      try {
        for (let attempt = 0; attempt < 50; attempt += 1) {
          const current = messagesSnapshotRef.current
          if (current.some((msg) => msg.id === messageId)) {
            await waitForDomPaint()
            if (await waitForScrollToMessage(messageId)) return
            break
          }

          const oldestId = current[0]?.id
          if (
            oldestId != null &&
            messageId < oldestId &&
            hasMoreOlderSnapshotRef.current
          ) {
            const older = await fetchOlderMessageBatch()
            if (older.length === 0) break
            await waitForDomPaint()
            continue
          }

          if (pinnedMeta) {
            setMessages((prev) => {
              if (prev.some((msg) => msg.id === messageId)) return prev
              const merged = [...prev, pinnedMeta].sort((a, b) => a.id - b.id)
              messagesSnapshotRef.current = merged
              return merged
            })
            await waitForDomPaint()
            if (await waitForScrollToMessage(messageId)) return
            break
          }
          break
        }
        setError('Không tìm thấy tin ghim — thử «Tải tin cũ hơn» rồi chọn lại.')
      } finally {
        setJumpingToPinnedId(null)
      }
    },
    [
      phone,
      selected,
      pinnedMessages,
      fetchOlderMessageBatch,
      waitForDomPaint,
      waitForScrollToMessage,
    ],
  )

  async function goToSearchMatch(direction: 1 | -1) {
    if (messageSearchMatches.length === 0 || !phone || !selected) return
    const nextIndex =
      (messageSearchIndex + direction + messageSearchMatches.length) %
      messageSearchMatches.length
    const target = messageSearchMatches[nextIndex]
    setMessageSearchIndex(nextIndex)

    if (!messagesSnapshotRef.current.some((msg) => msg.id === target.id)) {
      const loaded = await loadMessagesAround(
        selected,
        { aroundId: target.id },
        target.id,
      )
      if (!loaded) {
        setError('Không tải được tin để nhảy tới kết quả tìm kiếm.')
        return
      }
    }
    scrollToMessageId(target.id)
  }

  async function handleLoadDialogs(e: React.FormEvent) {
    e.preventDefault()
    const params = new URLSearchParams(searchParams)
    const trimmed = phone.trim()
    if (trimmed) params.set('phone', trimmed)
    else params.delete('phone')
    setSearchParams(params, { replace: true })
    await loadDialogs(phone)
  }

  const mergePinnedMessages = useCallback(
    (prev: DialogMessageItem[], incoming: DialogMessageItem[]) => {
      const byId = new Map(prev.map((msg) => [msg.id, msg]))
      for (const msg of incoming) byId.set(msg.id, msg)
      return [...byId.values()].sort((a, b) => b.id - a.id)
    },
    [],
  )

  const applyPinnedMessages = useCallback(
    (items: DialogMessageItem[], more = false) => {
      setPinnedMessages(items)
      setPinnedIndex(0)
      setHasMorePinned(more)
      if (items.length > 0) setShowPinnedBar(true)
    },
    [],
  )

  const loadPinnedMessages = useCallback(
    async (dialog: DialogItem) => {
      if (!phone || (dialog.kind !== 'group' && dialog.kind !== 'channel')) {
        return
      }
      const dialogId = dialog.id
      try {
        const res = await api.getPinnedMessages(
          phone,
          dialogId,
          PINNED_MESSAGES_PAGE_SIZE,
        )
        if (dialogId !== selectedDialogIdRef.current) return
        if (!res.success || !res.data || res.data.status === 'error') return
        applyPinnedMessages(
          res.data.messages,
          Boolean(res.data.has_more_pinned),
        )
      } catch {
        /* giữ pinned_messages từ loadMessages nếu API riêng lỗi */
      }
    },
    [phone, applyPinnedMessages],
  )

  const loadMorePinnedMessages = useCallback(async () => {
    if (!phone || !selected || loadingMorePinned || !hasMorePinned) return
    if (selected.kind !== 'group' && selected.kind !== 'channel') return
    if (pinnedMessages.length === 0) return

    const dialogId = selected.id
    const skip = pinnedMessages.length
    setLoadingMorePinned(true)
    try {
      const res = await api.getPinnedMessages(
        phone,
        dialogId,
        PINNED_MESSAGES_PAGE_SIZE,
        skip,
      )
      if (dialogId !== selectedDialogIdRef.current) return
      const data = res.data
      if (!res.success || !data || data.status === 'error') return
      if (data.messages.length === 0) {
        setHasMorePinned(false)
        return
      }
      setPinnedMessages((prev) => {
        const merged = mergePinnedMessages(prev, data.messages)
        setHasMorePinned(
          merged.length > prev.length && Boolean(data.has_more_pinned),
        )
        return merged
      })
    } catch {
      setError('Không tải thêm tin ghim được.')
    } finally {
      setLoadingMorePinned(false)
    }
  }, [
    phone,
    selected,
    pinnedMessages,
    hasMorePinned,
    loadingMorePinned,
    mergePinnedMessages,
  ])

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
      if (
        showLoading &&
        (dialog.kind === 'group' || dialog.kind === 'channel')
      ) {
        applyPinnedMessages(res.data.pinned_messages ?? [], false)
      }
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

    if (phone && prevDialogId && prevDialogId !== dialog.id) {
      saveDraft(phone, prevDialogId, draftText)
    }

    if (
      phone &&
      prevDialogId &&
      prevDialogId !== dialog.id &&
      prevLatestId > 0 &&
      prevHadUnread &&
      pendingUnread <= 0
    ) {
      void commitMarkRead(prevDialogId, prevLatestId > 0 ? prevLatestId : undefined)
    }

    const fresh = dialogs.find((item) => item.id === dialog.id) ?? dialog
    selectedDialogIdRef.current = fresh.id
    messagesRequestSeqRef.current += 1
    setSelected(fresh)
    setDraftText(phone ? loadDraft(phone, fresh.id) : '')
    setEditingMessage(null)
    setReplyTo(null)
    clearSelectedMedia()
    setMessageSearch('')
    setServerSearchResults([])
    setServerSearchLoading(false)
    setStreamMinId(0)
    const readMax = fresh.read_inbox_max_id ?? 0
    setUnreadDividerAfterId(
      readMax > 0 && fresh.unread_count > 0 ? readMax : null,
    )
    exitSelectionMode()
    setForwardMessage(null)
    setForwardMessages([])
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
    setLoadedMediaIds(new Set())
    setPinnedMessages([])
    setPinnedIndex(0)
    setHasMorePinned(false)
    setShowPinnedList(false)
    const loaded = await loadMessages(fresh)
    if (loaded) void loadPinnedMessages(fresh)
  }

  function revealPhoto(messageId: number) {
    setLoadedPhotoIds((prev) => new Set(prev).add(messageId))
  }

  function revealMedia(messageId: number) {
    setLoadedMediaIds((prev) => new Set(prev).add(messageId))
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

  async function handleCopyMessage(msg: DialogMessageItem) {
    const text = messageCopyText(msg)
    if (!text) {
      setError('Tin này không có chữ để copy')
      setSuccess('')
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      resetAlerts()
      setSuccess('Đã copy tin nhắn')
    } catch {
      setError('Không copy được')
      setSuccess('')
    }
  }

  function openMessageMenu(event: React.MouseEvent, msg: DialogMessageItem) {
    event.preventDefault()
    setMessageMenu({ x: event.clientX, y: event.clientY, msg })
  }

  function handleReplyToMessage(msg: DialogMessageItem) {
    setReplyTo(msg)
    setDraftText('')
    resetAlerts()
  }

  async function handleForwardSend(targets: DialogItem[]) {
    if (!phone || !selected || targets.length === 0) return
    const bulkIds = [...forwardMessages]
      .sort((a, b) => a.id - b.id)
      .map((msg) => msg.id)
    const single = forwardMessage
    if (bulkIds.length === 0 && !single) return

    setForwarding(true)
    resetAlerts()
    let ok = 0
    let fail = 0
    try {
      for (const target of targets) {
        const res =
          bulkIds.length > 0
            ? await api.forwardMessages(phone, selected.id, target.id, bulkIds)
            : await api.forwardMessage(phone, selected.id, target.id, single!.id)
        if (res.success && res.data && res.data.status === 'success') ok += 1
        else fail += 1
      }
      if (ok === 0) {
        setError('Forward thất bại')
        return
      }
      setSuccess(
        fail > 0
          ? `Đã forward tới ${ok} chat, ${fail} chat lỗi`
          : `Đã forward tới ${ok} chat`,
      )
      setForwardMessage(null)
      setForwardMessages([])
      exitSelectionMode()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không kết nối được API.')
    } finally {
      setForwarding(false)
    }
  }

  function openBulkForward() {
    const items = messages.filter((msg) => selectedMessageIds.has(msg.id))
    if (items.length === 0) return
    setForwardMessages(items)
    setForwardMessage(null)
  }

  async function handleBulkDelete() {
    if (!phone || !selected || selectedMessageIds.size === 0) return
    const ids = [...selectedMessageIds]
    const deletable = messages.filter(
      (msg) => ids.includes(msg.id) && msg.outgoing,
    )
    if (deletable.length === 0) {
      setError('Chỉ xóa được tin do bạn gửi')
      return
    }
    const confirmed = window.confirm(`Xóa ${deletable.length} tin đã chọn?`)
    if (!confirmed) return

    setBulkDeleting(true)
    resetAlerts()
    try {
      const res = await api.deleteMessages(
        phone,
        selected.id,
        deletable.map((msg) => msg.id),
      )
      if (!res.success || !res.data) {
        setError(res.error ?? 'Xóa tin thất bại')
        return
      }
      if (res.data.status === 'error') {
        setError(res.data.message)
        return
      }
      if (replyTo && deletable.some((msg) => msg.id === replyTo.id)) setReplyTo(null)
      setSuccess(res.data.message)
      exitSelectionMode()
      await loadMessages(selected, false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không kết nối được API.')
    } finally {
      setBulkDeleting(false)
    }
  }

  async function loadMessagesAround(
    dialog: DialogItem,
    options: { aroundId?: number; offsetDate?: string },
    scrollToId?: number,
  ) {
    if (!phone) return false
    const dialogId = dialog.id
    const requestSeq = messagesRequestSeqRef.current
    setJumpingMessages(true)
    try {
      const res = await api.getDialogMessages(
        phone,
        dialogId,
        MESSAGES_INITIAL_LIMIT,
        0,
        options,
      )
      if (
        requestSeq !== messagesRequestSeqRef.current ||
        dialogId !== selectedDialogIdRef.current
      ) {
        return false
      }
      if (!res.success || !res.data || res.data.status === 'error') {
        setError(res.error ?? res.data?.message ?? 'Không tải được tin')
        return false
      }
      setMessages(res.data.messages)
      messagesSnapshotRef.current = res.data.messages
      setHasMoreOlder(
        inferHasMoreOlder(
          res.data.messages.length,
          MESSAGES_INITIAL_LIMIT,
          res.data.has_more_older,
        ),
      )
      hasMoreOlderSnapshotRef.current = inferHasMoreOlder(
        res.data.messages.length,
        MESSAGES_INITIAL_LIMIT,
        res.data.has_more_older,
      )
      setMessagesTitle(res.data.title || dialog.title)
      if (scrollToId) {
        await waitForDomPaint()
        await waitForScrollToMessage(scrollToId)
      }
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không kết nối được API.')
      return false
    } finally {
      setJumpingMessages(false)
    }
  }

  async function handleJumpToMessageId(messageId: number) {
    if (!selected || messageId < 1) return
    setShowJumpModal(false)
    if (messages.some((msg) => msg.id === messageId)) {
      await waitForScrollToMessage(messageId)
      return
    }
    const loaded = await loadMessagesAround(selected, { aroundId: messageId }, messageId)
    if (!loaded) {
      await navigateToPinnedMessage(messageId)
    }
  }

  async function handleJumpToDate(date: string) {
    if (!selected) return
    setShowJumpModal(false)
    const loaded = await loadMessagesAround(selected, { offsetDate: date })
    if (loaded) {
      window.setTimeout(() => scrollToLatest('auto'), 120)
    }
  }

  async function handlePinMessage(msg: DialogMessageItem, unpin = false) {
    if (!phone || !selected) return
    setPinningId(msg.id)
    resetAlerts()
    try {
      const res = await api.pinMessage(phone, selected.id, msg.id, unpin)
      if (!res.success || !res.data) {
        setError(res.error ?? 'Ghim tin thất bại')
        return
      }
      if (res.data.status === 'error') {
        setError(res.data.message)
        return
      }
      setSuccess(res.data.message)
      await loadMessages(selected, false)
      void loadPinnedMessages(selected)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không kết nối được API.')
    } finally {
      setPinningId(null)
    }
  }

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault()
    if (!phone || !selected) return
    const text = draftText.trim()
    if (!text && !selectedMedia) return
    if (editingMessage && selectedMedia) {
      setError('Không sửa tin kèm file mới — chỉ sửa chữ')
      return
    }

    const wasEditing = editingMessage
    setSending(true)
    resetAlerts()
    try {
      const res = wasEditing
        ? await api.editMessage(phone, selected.id, wasEditing.id, text)
        : selectedMedia
          ? await api.sendMedia(
              phone,
              selected.id,
              selectedMedia,
              text || undefined,
              replyTo?.id,
            )
          : replyTo
            ? await api.replyMessage(phone, selected.id, replyTo.id, text)
            : await api.sendMessage(phone, selected.id, text)
      if (!res.success || !res.data) {
        setError(
          res.error ??
            (selectedMedia
              ? 'Gửi media thất bại'
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
      clearDraft(phone, selected.id)
      setEditingMessage(null)
      setReplyTo(null)
      clearSelectedMedia()
      setSuccess(res.data.message)
      scrollIntentRef.current = wasEditing ? null : 'latest'
      await loadMessages(selected, false)
      if (!wasEditing) {
        window.setTimeout(() => scrollToLatest('smooth'), 100)
      }
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
          className="dialogs-session-toolbar"
          onSubmit={(e) => void handleLoadDialogs(e)}
        >
          <DialogsAccountSelect
            value={phone}
            onChange={handlePhoneChange}
            sessions={accounts.sessions}
            getMeta={accounts.getMeta}
            loading={accounts.loading}
            disabled={loadingDialogs}
          />
          <button
            type="submit"
            className="btn btn--primary dialogs-load-btn"
            disabled={loadingDialogs || !phone}
          >
            {loadingDialogs ? 'Đang tải…' : 'Tải chat'}
          </button>
        </form>
        {counts ? (
          <div className="dialog-stat-chips">
            <span className={countChipClass('private')}>Private {counts.private}</span>
            <span className={countChipClass('bot')}>Bot {counts.bot}</span>
            <span className={countChipClass('group')}>Group {counts.group}</span>
            <span className={countChipClass('channel')}>Channel {counts.channel}</span>
          </div>
        ) : null}
      </section>

      <Alert type="error" message={error} />
      <Alert type="success" message={success} />

      {!chatActive && (
        <section className="dialogs-empty-hero">
          <ChatEmptyIcon />
          <h2>Bắt đầu trò chuyện</h2>
          <p className="muted">
            Chọn tài khoản và bấm <strong>Tải chat</strong> để mở danh sách hội thoại.
          </p>
        </section>
      )}

      {chatActive && (
        <section className="dialogs-layout dialogs-workspace">
          <div className="dialogs-list-panel">
            <div className="dialogs-list-head">
              <div className="dialogs-list-head-main">
                <span className="dialogs-panel-kicker">Danh sách</span>
                <h2>Hội thoại</h2>
                <p className="dialogs-list-sub">
                  {filteredDialogs.length} / {dialogs.length} chat
                </p>
              </div>
              <button
                type="button"
                className="dialogs-refresh-btn"
                disabled={refreshingDialogs || !phone}
                onClick={() => void refreshDialogsList()}
                title="Làm mới danh sách chat"
                aria-label="Làm mới danh sách chat"
              >
                {refreshingDialogs ? (
                  <span className="spinner dialogs-refresh-spinner" aria-hidden />
                ) : (
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
                    <path
                      d="M20 12a8 8 0 1 1-2.34-5.66M20 4v6h-6"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </button>
            </div>

            <DialogListFilters
              search={search}
              unreadOnly={unreadOnly}
              filter={filter}
              filterCounts={filterCounts}
              unreadDialogCount={unreadDialogCount}
              onSearchChange={setSearch}
              onUnreadOnlyToggle={() => setUnreadOnly((value) => !value)}
              onFilterChange={setFilter}
            />
            <DialogListItems
              filteredDialogs={filteredDialogs}
              selectedId={selected?.id ?? null}
              onSelectDialog={(dialog) => void handleSelectDialog(dialog)}
            />
          </div>

          <div className="dialogs-messages-panel">
            {selected ? (
              <>
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
                <div className="chat-header-actions">
                  {canPinMessages && pinnedMessages.length > 0 && !showPinnedBar ? (
                    <button
                      type="button"
                      className="btn btn--sm btn--ghost chat-pinned-reopen"
                      onClick={() => {
                        setShowPinnedBar(true)
                        setShowPinnedList(true)
                      }}
                      title={`${pinnedMessages.length} tin ghim — xem danh sách`}
                    >
                      📌 {pinnedMessages.length}
                    </button>
                  ) : null}
                  {canPinMessages && pinnedMessages.length > 0 && showPinnedBar ? (
                    <button
                      type="button"
                      className="btn btn--sm btn--ghost"
                      onClick={() => setShowPinnedList(true)}
                      title="Danh sách tin ghim"
                    >
                      Ghim
                    </button>
                  ) : null}
                  {messages.length > 0 ? (
                    <>
                      <button
                        type="button"
                        className={`btn btn--sm btn--ghost${selectMode ? ' dialogs-filter-btn--active' : ''}`}
                        onClick={() => {
                          if (selectMode) exitSelectionMode()
                          else enterSelectMode()
                        }}
                        title="Chọn nhiều tin"
                      >
                        {selectMode ? 'Hủy chọn' : 'Chọn'}
                      </button>
                      <button
                        type="button"
                        className="btn btn--sm btn--ghost"
                        onClick={() => setShowJumpModal(true)}
                        title="Nhảy tới tin #id hoặc ngày"
                      >
                        Nhảy tới
                      </button>
                      <button
                        type="button"
                        className="btn btn--sm btn--ghost"
                        onClick={() => setShowGallery(true)}
                        title="Xem ảnh/video đã tải"
                      >
                        Gallery
                      </button>
                    </>
                  ) : null}
                  {selected.link ? (
                    <a
                      className="chat-header-link btn btn--sm btn--ghost"
                      href={selected.link}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Mở Telegram
                    </a>
                  ) : null}
                </div>
              </div>
              {selected && !loadingMessages && messages.length > 0 ? (
                <div className="chat-search-bar">
                  <input
                    ref={messageSearchInputRef}
                    type="search"
                    className="chat-search-input"
                    placeholder="Tìm trong chat… (Ctrl+F, ≥2 ký tự)"
                    value={messageSearch}
                    onChange={(e) => setMessageSearch(e.target.value)}
                  />
                  {messageSearch.trim() ? (
                    <div className="chat-search-nav">
                      <span className="muted">
                        {serverSearchLoading
                          ? 'Đang tìm trên Telegram…'
                          : messageSearchMatches.length === 0
                            ? '0 kết quả'
                            : `${messageSearchIndex + 1}/${messageSearchMatches.length}${serverSearchResults.length > 0 ? ' · TG' : ''}`}
                      </span>
                      <button
                        type="button"
                        className="btn btn--sm btn--ghost"
                        disabled={messageSearchMatches.length === 0}
                        onClick={() => goToSearchMatch(-1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="btn btn--sm btn--ghost"
                        disabled={messageSearchMatches.length === 0}
                        onClick={() => goToSearchMatch(1)}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="btn btn--sm btn--ghost"
                        onClick={() => setMessageSearch('')}
                      >
                        ×
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              </>
            ) : (
              <div className="chat-header chat-header--empty">
                <h2>Tin nhắn</h2>
                <p className="chat-header-meta">Chọn hội thoại bên trái</p>
              </div>
            )}

            {selected && showPinnedMessages ? (
              <PinnedMessagesBar
                messages={pinnedMessages}
                activeIndex={pinnedIndex}
                listOpen={showPinnedList}
                navigating={jumpingToPinnedId != null}
                onSelect={(messageId) => void navigateToPinnedMessage(messageId)}
                onOpenList={() => setShowPinnedList((open) => !open)}
                onClose={() => {
                  setShowPinnedBar(false)
                  setShowPinnedList(false)
                }}
              />
            ) : null}

            {selected && showPinnedList && pinnedMessages.length > 0 ? (
              <PinnedMessagesPanel
                messages={pinnedMessages}
                loading={jumpingToPinnedId != null}
                hasMore={hasMorePinned}
                loadingMore={loadingMorePinned}
                onLoadMore={() => void loadMorePinnedMessages()}
                onSelect={(messageId) => void navigateToPinnedMessage(messageId)}
                onClose={() => setShowPinnedList(false)}
              />
            ) : null}

            <MessageThread
              phone={phone}
              peerId={selected?.id ?? ''}
              selected={Boolean(selected)}
              loadingMessages={loadingMessages}
              loadingOlder={loadingOlder}
              messagesEmpty={messages.length === 0}
              hasPinned={pinnedMessages.length > 0}
              selectMode={selectMode}
              messageSearch={messageSearch}
              displayedEmpty={displayedMessages.length === 0}
              chatTimeline={chatTimeline}
              messages={messages}
              reactionsPolicy={reactionsPolicy}
              reactingId={reactingId}
              sending={sending}
              deletingId={deletingId}
              pinningId={pinningId}
              forwarding={forwarding}
              canPinMessages={canPinMessages}
              loadedPhotoIds={loadedPhotoIds}
              loadedMediaIds={loadedMediaIds}
              selectedMessageIds={selectedMessageIds}
              showJumpBtn={showJumpBtn}
              pendingUnread={pendingUnread}
              messagesScrollRef={messagesScrollRef}
              loadOlderSentinelRef={loadOlderSentinelRef}
              messageRefs={messageRefs}
              onScroll={handleMessagesScroll}
              onJumpToLatest={handleJumpToLatest}
              onToggleSelect={toggleMessageSelection}
              onRevealPhoto={revealPhoto}
              onRevealMedia={revealMedia}
              onReact={(msg, emoji) => void handleSendReaction(msg, emoji)}
              onReply={handleReplyToMessage}
              onCopy={(msg) => void handleCopyMessage(msg)}
              onEdit={startEditMessage}
              onForward={setForwardMessage}
              onPin={(msg, unpin) => void handlePinMessage(msg, unpin)}
              onDelete={(msg) => void handleDeleteMessage(msg)}
              onContextMenu={openMessageMenu}
              onScrollToMessageId={scrollToMessageId}
              canEditMessage={canEditMessage}
              isAtBottom={isAtBottom}
              scrollToLatest={scrollToLatest}
            />

            {selected && selectMode ? (
              <MessageSelectionBar
                count={selectedMessageIds.size}
                forwarding={forwarding}
                deleting={bulkDeleting}
                canDelete={messages.some(
                  (msg) => selectedMessageIds.has(msg.id) && msg.outgoing,
                )}
                onForward={openBulkForward}
                onDelete={() => void handleBulkDelete()}
                onCancel={exitSelectionMode}
              />
            ) : null}

            {selected && !selectMode && (
              <ComposerBar
                draftText={draftText}
                replyTo={replyTo}
                editingMessage={editingMessage}
                selectedMedia={selectedMedia}
                selectedMediaKind={selectedMediaKind}
                mediaPreview={mediaPreview}
                sending={sending}
                loadingMessages={loadingMessages}
                imageInputRef={imageInputRef}
                composeInputRef={composeInputRef}
                onDraftChange={setDraftText}
                onCancelReply={() => setReplyTo(null)}
                onCancelEdit={cancelEdit}
                onClearMedia={clearSelectedMedia}
                onMediaSelect={handleMediaSelect}
                onPaste={(e) => handleComposePaste(e)}
                onSubmit={(e) => void handleSendMessage(e)}
              />
            )}

          </div>
        </section>
      )}

      <MediaGalleryModal
        open={showGallery && Boolean(selected && phone)}
        phone={phone}
        peerId={selected?.id ?? ''}
        messages={messages}
        loadedPhotoIds={loadedPhotoIds}
        onClose={() => setShowGallery(false)}
        onRevealPhoto={revealPhoto}
      />

      <ForwardMessageModal
        open={Boolean(forwardMessage) || forwardMessages.length > 0}
        message={forwardMessage}
        messages={forwardMessages}
        dialogs={dialogs}
        currentDialogId={selected?.id ?? null}
        loading={forwarding}
        onClose={() => {
          setForwardMessage(null)
          setForwardMessages([])
        }}
        onSend={(targets) => void handleForwardSend(targets)}
        onEnterSelectMode={() => {
          setForwardMessage(null)
          setForwardMessages([])
          enterSelectMode()
        }}
      />

      <JumpToMessageModal
        open={showJumpModal}
        loading={jumpingMessages}
        onClose={() => setShowJumpModal(false)}
        onJumpToId={(messageId) => void handleJumpToMessageId(messageId)}
        onJumpToDate={(date) => void handleJumpToDate(date)}
      />

      {messageMenu ? (
        <MessageContextMenu
          menu={messageMenu}
          canPin={canPinMessages}
          forwarding={forwarding}
          pinningId={pinningId}
          deletingId={deletingId}
          sending={sending}
          onCopy={(msg) => void handleCopyMessage(msg)}
          onReply={handleReplyToMessage}
          onEdit={(msg) => {
            if (canEditMessage(msg)) startEditMessage(msg)
          }}
          onForward={setForwardMessage}
          onSelect={(msg) => enterSelectMode(msg.id)}
          onPin={(msg) => void handlePinMessage(msg, Boolean(msg.pinned))}
          onDelete={(msg) => void handleDeleteMessage(msg)}
          onClose={() => setMessageMenu(null)}
        />
      ) : null}

    </div>
  )
}