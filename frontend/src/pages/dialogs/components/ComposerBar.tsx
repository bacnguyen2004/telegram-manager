import type { FormEvent, RefObject } from 'react'
import type { DialogMessageItem } from '../../../types/api'
import {
  CHAT_MEDIA_ACCEPT,
  chatMediaKindLabel,
  formatFileSize,
  type ChatMediaKind,
} from '../../../utils/chatMedia'

type Props = {
  draftText: string
  replyTo: DialogMessageItem | null
  editingMessage: DialogMessageItem | null
  selectedMedia: File | null
  selectedMediaKind: ChatMediaKind | null
  mediaPreview: string | null
  sending: boolean
  loadingMessages: boolean
  imageInputRef: RefObject<HTMLInputElement | null>
  composeInputRef: RefObject<HTMLTextAreaElement | null>
  onDraftChange: (value: string) => void
  onCancelReply: () => void
  onCancelEdit: () => void
  onClearMedia: () => void
  onMediaSelect: (e: React.ChangeEvent<HTMLInputElement>) => void
  onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void
  onSubmit: (e: FormEvent) => void
}

export function ComposerBar({
  draftText,
  replyTo,
  editingMessage,
  selectedMedia,
  selectedMediaKind,
  mediaPreview,
  sending,
  loadingMessages,
  imageInputRef,
  composeInputRef,
  onDraftChange,
  onCancelReply,
  onCancelEdit,
  onClearMedia,
  onMediaSelect,
  onPaste,
  onSubmit,
}: Props) {
  return (
    <form className="message-compose" onSubmit={onSubmit}>
      {editingMessage ? (
        <div className="reply-preview reply-preview--edit">
          <div>
            <p className="reply-preview-label">Sửa tin #{editingMessage.id}</p>
            <p className="reply-preview-text muted">
              Enter để lưu · Esc để hủy · ↑ khi ô trống để sửa tin gửi gần nhất
            </p>
          </div>
          <button type="button" className="btn btn--sm btn--ghost" onClick={onCancelEdit}>
            Hủy
          </button>
        </div>
      ) : null}
      {replyTo && (
        <div className="reply-preview">
          <div>
            <p className="reply-preview-label">
              Trả lời #{replyTo.id} — {replyTo.outgoing ? 'Bạn' : replyTo.sender_name || '—'}
            </p>
            <p className="reply-preview-text muted">
              {(replyTo.text || '[media]').slice(0, 120)}
            </p>
          </div>
          <button type="button" className="btn btn--sm btn--ghost" onClick={onCancelReply}>
            Hủy
          </button>
        </div>
      )}
      <input
        ref={imageInputRef}
        type="file"
        accept={CHAT_MEDIA_ACCEPT}
        className="message-image-input"
        onChange={onMediaSelect}
        disabled={sending || loadingMessages}
      />
      {selectedMedia && (
        <div className="message-image-preview">
          {mediaPreview ? (
            <img src={mediaPreview} alt={selectedMedia.name} />
          ) : (
            <div className="message-file-preview">
              <span className="message-file-kind">
                {selectedMediaKind ? chatMediaKindLabel(selectedMediaKind) : 'File'}
              </span>
              <span className="muted">{selectedMedia.name}</span>
              <span className="muted">{formatFileSize(selectedMedia.size)}</span>
            </div>
          )}
          <div className="message-image-preview-meta">
            <span className="muted">{selectedMedia.name}</span>
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              onClick={onClearMedia}
              disabled={sending}
            >
              Bỏ file
            </button>
          </div>
        </div>
      )}
      <div className="message-compose-box">
        <button
          type="button"
          className="btn btn--icon btn--ghost message-compose-attach"
          title="Chọn ảnh, video hoặc file"
          onClick={() => imageInputRef.current?.click()}
          disabled={sending || loadingMessages}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
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
        </button>
        <textarea
          ref={composeInputRef}
          className="message-compose-input"
          rows={1}
          placeholder={
            editingMessage
              ? 'Sửa nội dung tin…'
              : selectedMedia
                ? 'Thêm caption (tùy chọn)…'
                : replyTo
                  ? 'Viết câu trả lời…'
                  : 'Nhập tin nhắn…'
          }
          value={draftText}
          onChange={(e) => onDraftChange(e.target.value)}
          onPaste={onPaste}
          disabled={sending || loadingMessages}
          maxLength={selectedMedia ? 1024 : 4096}
        />
        <button
          type="submit"
          className="btn btn--primary btn--send"
          disabled={sending || loadingMessages || (!draftText.trim() && !selectedMedia)}
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
        {selectedMedia
          ? `${draftText.length}/1024 · ${selectedMediaKind ? chatMediaKindLabel(selectedMediaKind).toLowerCase() : 'file'} đã chọn`
          : `${draftText.length}/4096`}
      </p>
    </form>
  )
}
