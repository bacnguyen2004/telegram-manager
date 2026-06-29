import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/client'
import { Alert } from '../components/Alert'
import { MessageText } from '../components/MessageText'
import { Pagination } from '../components/Pagination'
import { PhoneSelect } from '../components/PhoneSelect'
import { usePagination } from '../hooks/usePagination'
import type { DialogCounts, DialogItem, DialogMessageItem } from '../types/api'
import { avatarHue, dialogInitials, mediaTypeLabel } from '../utils/avatar'

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
  const [sending, setSending] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)
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
  const [showJumpBtn, setShowJumpBtn] = useState(false)
  const [pendingUnread, setPendingUnread] = useState(0)

  const SCROLL_BOTTOM_THRESHOLD = 56

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

  const updateJumpButton = useCallback(() => {
    const atBottom = isAtBottom()
    setShowJumpBtn(!atBottom)
    if (atBottom) setPendingUnread(0)
  }, [isAtBottom])

  const handleJumpToLatest = () => {
    scrollToLatest('smooth')
    setPendingUnread(0)
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
    setMessages([])
    setMessagesTitle('')
    setReplyTo(null)
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
      setDialogs(res.data.dialogs)
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
    if (showLoading) {
      setLoadingMessages(true)
      setMessages([])
    }
    try {
      const res = await api.getDialogMessages(phone, dialog.id, 100)
      if (!res.success || !res.data) {
        setError(res.error ?? 'Không tải được tin nhắn')
        return false
      }
      if (res.data.status === 'error') {
        setError(res.data.message)
        return false
      }
      setMessages(res.data.messages)
      setMessagesTitle(res.data.title || dialog.title)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không kết nối được API.')
      return false
    } finally {
      if (showLoading) setLoadingMessages(false)
    }
  }

  async function handleSelectDialog(dialog: DialogItem) {
    setSelected(dialog)
    setDraftText('')
    setReplyTo(null)
    clearSelectedImage()
    resetAlerts()
    setShowJumpBtn(false)
    openingUnreadRef.current = dialog.unread_count
    openingReadMaxIdRef.current = dialog.read_inbox_max_id ?? 0
    setPendingUnread(dialog.unread_count)
    scrollIntentRef.current = 'last-read'
    setMessagesTitle(dialog.title)
    messageRefs.current.clear()
    await loadMessages(dialog)
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
                  <div
                    ref={messagesScrollRef}
                    className="chat-messages-area"
                    onScroll={updateJumpButton}
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
                              <img
                                className="message-photo"
                                src={api.messagePhotoUrl(phone, selected.id, msg.id)}
                                alt="Ảnh"
                                loading="lazy"
                                onLoad={() => {
                                  if (isAtBottom()) scrollToLatest('auto')
                                }}
                              />
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