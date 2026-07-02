import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import './ConfirmModal.css'

export type ConfirmModalVariant = 'danger' | 'warn'

interface ConfirmModalProps {
  open: boolean
  title: string
  description?: ReactNode
  details?: string[]
  confirmLabel?: string
  cancelLabel?: string
  variant?: ConfirmModalVariant
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}

const VARIANT_ICON: Record<ConfirmModalVariant, string> = {
  danger: '🗑️',
  warn: '⚠️',
}

export function ConfirmModal({
  open,
  title,
  description,
  details,
  confirmLabel = 'Xác nhận',
  cancelLabel = 'Huỷ',
  variant = 'danger',
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || loading) return
      event.preventDefault()
      event.stopImmediatePropagation()
      onCancel()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open, loading, onCancel])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div
      className="confirm-modal-backdrop"
      onClick={loading ? undefined : onCancel}
    >
      <div
        className="confirm-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`confirm-modal-icon confirm-modal-icon--${variant}`} aria-hidden>
          {VARIANT_ICON[variant]}
        </div>
        <h3 id="confirm-modal-title" className="confirm-modal-title">
          {title}
        </h3>
        {description ? <div className="confirm-modal-desc">{description}</div> : null}
        {details && details.length > 0 ? (
          <ul className="confirm-modal-details">
            {details.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}
        <div className="confirm-modal-actions">
          <button
            type="button"
            className="btn btn--ghost"
            disabled={loading}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn btn--${variant === 'danger' ? 'danger' : 'primary'}`}
            disabled={loading}
            onClick={onConfirm}
          >
            {loading ? 'Đang xử lý…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}