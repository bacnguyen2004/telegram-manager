import type { RefObject } from 'react'
import { api } from '../../../api/client'
import { MessageMediaBlock } from '../../../components/MessageMediaBlock'
import { MessagePollBlock } from '../../../components/MessagePollBlock'
import { MessageReactionBar } from '../../../components/MessageReactionBar'
import { MessageReplyQuote } from '../../../components/MessageReplyQuote'
import { MessageText } from '../../../components/MessageText'
import type {
  DialogMessageItem,
  DialogReactionsPolicy,
} from '../../../types/api'
import { mediaTypeLabel } from '../../../utils/avatar'
import type { ChatTimelineItem } from '../../../utils/chatTimeline'
import { resolveReplyQuote } from '../../../utils/dialogMessages'
import { ChatEmptyIcon } from '../helpers'

type Props = {
  phone: string
  peerId: string
  selected: boolean
  loadingMessages: boolean
  loadingOlder: boolean
  messagesEmpty: boolean
  hasPinned: boolean
  selectMode: boolean
  messageSearch: string
  displayedEmpty: boolean
  chatTimeline: ChatTimelineItem[]
  messages: DialogMessageItem[]
  reactionsPolicy: DialogReactionsPolicy | null
  reactingId: number | null
  sending: boolean
  deletingId: number | null
  pinningId: number | null
  forwarding: boolean
  canPinMessages: boolean
  loadedPhotoIds: Set<number>
  loadedMediaIds: Set<number>
  selectedMessageIds: Set<number>
  showJumpBtn: boolean
  pendingUnread: number
  messagesScrollRef: RefObject<HTMLDivElement | null>
  loadOlderSentinelRef: RefObject<HTMLDivElement | null>
  messageRefs: RefObject<Map<number, HTMLLIElement>>
  onScroll: () => void
  onJumpToLatest: () => void
  onToggleSelect: (id: number) => void
  onRevealPhoto: (id: number) => void
  onRevealMedia: (id: number) => void
  onReact: (msg: DialogMessageItem, emoji: string) => void
  onReply: (msg: DialogMessageItem) => void
  onCopy: (msg: DialogMessageItem) => void
  onEdit: (msg: DialogMessageItem) => void
  onForward: (msg: DialogMessageItem) => void
  onPin: (msg: DialogMessageItem, unpin: boolean) => void
  onDelete: (msg: DialogMessageItem) => void
  onContextMenu: (event: React.MouseEvent, msg: DialogMessageItem) => void
  onScrollToMessageId: (messageId: number) => void
  canEditMessage: (msg: DialogMessageItem) => boolean
  isAtBottom: () => boolean
  scrollToLatest: (behavior?: ScrollBehavior) => void
}

export function MessageThread({
  phone,
  peerId,
  selected,
  loadingMessages,
  loadingOlder,
  messagesEmpty,
  hasPinned,
  selectMode,
  messageSearch,
  displayedEmpty,
  chatTimeline,
  messages,
  reactionsPolicy,
  reactingId,
  sending,
  deletingId,
  pinningId,
  forwarding,
  canPinMessages,
  loadedPhotoIds,
  loadedMediaIds,
  selectedMessageIds,
  showJumpBtn,
  pendingUnread,
  messagesScrollRef,
  loadOlderSentinelRef,
  messageRefs,
  onScroll,
  onJumpToLatest,
  onToggleSelect,
  onRevealPhoto,
  onRevealMedia,
  onReact,
  onReply,
  onCopy,
  onEdit,
  onForward,
  onPin,
  onDelete,
  onContextMenu,
  onScrollToMessageId,
  canEditMessage,
  isAtBottom,
  scrollToLatest,
}: Props) {
  return (
    <div className="chat-body">
      {!selected && (
        <div className="empty-state empty-state--chat empty-state--chat-pick">
          <ChatEmptyIcon />
          <h3 className="empty-state-title">Tin nhắn</h3>
          <p>Chọn một hội thoại bên trái để bắt đầu đọc và trả lời.</p>
        </div>
      )}

      {selected && loadingMessages && (
        <div className="chat-loading">
          <span className="spinner spinner--accent" aria-hidden />
          <p>Đang tải tin nhắn…</p>
        </div>
      )}

      {selected && !loadingMessages && messagesEmpty && !hasPinned && (
        <div className="empty-state empty-state--chat">
          <ChatEmptyIcon />
          <p>Chưa có tin nhắn trong hội thoại này</p>
        </div>
      )}

      {selected && !loadingMessages && (!messagesEmpty || hasPinned) && (
        <>
          <div
            ref={messagesScrollRef}
            className="chat-messages-area"
            onScroll={onScroll}
          >
            <div
              ref={loadOlderSentinelRef}
              className="chat-load-older-sentinel"
              aria-hidden
            />
            {loadingOlder ? (
              <div className="chat-load-older-status" role="status">
                <span className="spinner spinner--accent" aria-hidden />
                <span>Đang tải tin cũ hơn…</span>
              </div>
            ) : null}
            {selectMode ? (
              <div className="chat-select-banner">
                Chế độ chọn — bấm tin hoặc tick ☐ để chọn nhiều tin
              </div>
            ) : null}
            {messageSearch.trim() && displayedEmpty ? (
              <div className="empty-state empty-state--chat-search">
                <p>Không tìm thấy tin khớp “{messageSearch.trim()}”.</p>
              </div>
            ) : null}
            <ul className="messages-list">
              {chatTimeline.map((item) => {
                if (item.type === 'date') {
                  return (
                    <li key={item.key} className="chat-date-divider" aria-label={item.label}>
                      <span>{item.label}</span>
                    </li>
                  )
                }
                if (item.type === 'unread') {
                  return (
                    <li key={item.key} className="chat-unread-divider" aria-label="Tin mới">
                      <span>Tin mới</span>
                    </li>
                  )
                }

                const msg = item.msg
                const isPhoto = Boolean(msg.has_photo)
                const isPoll = Boolean(msg.is_poll) || msg.content_type === 'poll'
                const isRenderableMedia =
                  msg.has_media &&
                  !isPhoto &&
                  !isPoll &&
                  ['video', 'audio', 'document', 'sticker'].includes(msg.content_type)
                const displayText = isPoll ? '' : msg.text
                const replyQuote = resolveReplyQuote(msg, messages)
                const isSelected = selectedMessageIds.has(msg.id)

                return (
                  <li
                    key={msg.id}
                    ref={(el) => {
                      if (el) messageRefs.current.set(msg.id, el)
                      else messageRefs.current.delete(msg.id)
                    }}
                    className={`message-row${msg.outgoing ? ' message-row--out' : ' message-row--in'}${isSelected ? ' message-row--selected' : ''}`}
                    onContextMenu={(event) => onContextMenu(event, msg)}
                  >
                    {selectMode ? (
                      <label className="message-select-tick">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => onToggleSelect(msg.id)}
                        />
                      </label>
                    ) : null}
                    <div
                      className={`message-bubble${isPhoto || isRenderableMedia ? ' message-bubble--media' : ''}${isPoll ? ' message-bubble--poll' : ''}${selectMode ? ' message-bubble--selectable' : ''}`}
                      onClick={() => {
                        if (selectMode) onToggleSelect(msg.id)
                      }}
                    >
                      {replyQuote ? (
                        <MessageReplyQuote quote={replyQuote} onJumpTo={onScrollToMessageId} />
                      ) : null}
                      <div className="message-head">
                        {!msg.outgoing && (
                          <span className="message-sender">{msg.sender_name || '—'}</span>
                        )}
                        {msg.outgoing && <span className="message-you">Bạn</span>}
                        <span className="message-head-end">
                          {msg.pinned ? (
                            <span className="message-pinned-badge" title="Tin đã ghim">
                              📌
                            </span>
                          ) : null}
                          {msg.edited ? (
                            <span
                              className="message-edited-badge"
                              title={msg.edited_date || 'Đã sửa'}
                            >
                              đã sửa
                            </span>
                          ) : null}
                          <span className="message-date">{msg.date}</span>
                        </span>
                      </div>
                      {isPhoto && (
                        selectMode ? (
                          <span className="message-photo-placeholder muted">📷 Ảnh</span>
                        ) : loadedPhotoIds.has(msg.id) ? (
                          <img
                            className="message-photo"
                            src={api.messagePhotoUrl(phone, peerId, msg.id)}
                            alt="Ảnh"
                            onLoad={() => {
                              if (isAtBottom()) scrollToLatest('auto')
                            }}
                          />
                        ) : (
                          <button
                            type="button"
                            className="message-photo-trigger"
                            onClick={() => onRevealPhoto(msg.id)}
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
                      {isPoll ? (
                        <MessagePollBlock
                          phone={phone}
                          peerId={peerId}
                          messageId={msg.id}
                          question={msg.text}
                          disabled={selectMode || sending}
                        />
                      ) : null}
                      {displayText ? (
                        <MessageText text={displayText} />
                      ) : !isPhoto && !isPoll && !isRenderableMedia ? (
                        <p className="message-text message-text--empty">—</p>
                      ) : null}
                      {isRenderableMedia ? (
                        <MessageMediaBlock
                          phone={phone}
                          peerId={peerId}
                          messageId={msg.id}
                          contentType={msg.content_type}
                          fileName={msg.media_file_name}
                          revealed={loadedMediaIds.has(msg.id)}
                          selectMode={selectMode}
                          onReveal={onRevealMedia}
                          onLoaded={() => {
                            if (isAtBottom()) scrollToLatest('auto')
                          }}
                        />
                      ) : null}
                      {msg.has_media && !isPhoto && !isPoll && !isRenderableMedia ? (
                        <span className={`media-chip media-chip--${msg.content_type}`}>
                          {mediaTypeLabel(msg.content_type)}
                        </span>
                      ) : null}
                      {!selectMode ? (
                        <MessageReactionBar
                          msg={msg}
                          reactionsPolicy={reactionsPolicy}
                          reactingId={reactingId}
                          sending={sending}
                          onReact={onReact}
                        />
                      ) : null}
                      {!selectMode ? (
                        <div
                          className="message-actions"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <button
                            type="button"
                            className="btn btn--sm btn--ghost message-reply-btn"
                            onClick={() => onReply(msg)}
                          >
                            Trả lời
                          </button>
                          <button
                            type="button"
                            className="btn btn--sm btn--ghost message-reply-btn"
                            onClick={() => void onCopy(msg)}
                          >
                            Sao chép
                          </button>
                          {canEditMessage(msg) ? (
                            <button
                              type="button"
                              className="btn btn--sm btn--ghost message-reply-btn"
                              onClick={() => onEdit(msg)}
                            >
                              Sửa
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="btn btn--sm btn--ghost message-reply-btn"
                            disabled={forwarding}
                            onClick={() => onForward(msg)}
                          >
                            Forward
                          </button>
                          {canPinMessages ? (
                            <button
                              type="button"
                              className="btn btn--sm btn--ghost message-reply-btn"
                              disabled={pinningId === msg.id || sending}
                              onClick={() => void onPin(msg, Boolean(msg.pinned))}
                            >
                              {pinningId === msg.id ? '…' : msg.pinned ? 'Bỏ ghim' : 'Ghim'}
                            </button>
                          ) : null}
                          {msg.outgoing && (
                            <button
                              type="button"
                              className="btn btn--sm btn--danger message-reply-btn"
                              disabled={deletingId === msg.id || sending}
                              onClick={() => void onDelete(msg)}
                            >
                              {deletingId === msg.id ? '…' : 'Xóa'}
                            </button>
                          )}
                        </div>
                      ) : null}
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
              onClick={onJumpToLatest}
              title={
                pendingUnread > 0
                  ? `${pendingUnread} tin chưa đọc`
                  : 'Tới tin nhắn mới nhất'
              }
              aria-label="Tới tin nhắn mới nhất"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
                <path
                  d="M12 5v14m0 0-6-6m6 6 6-6"
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
  )
}
