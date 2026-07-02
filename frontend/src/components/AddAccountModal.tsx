import { useEffect } from 'react'
import './AddAccountModal.css'
import './SessionDetailModal.css'
import { AccountAuthWizard } from './AccountAuthWizard'

interface AddAccountModalProps {
  onClose: () => void
  onSuccess: (phone: string) => void
}

export function AddAccountModal({ onClose, onSuccess }: AddAccountModalProps) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  return (
    <div className="modal-backdrop session-detail-backdrop" onClick={onClose}>
      <div
        className="modal session-detail-modal add-account-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-account-title"
      >
        <header className="sd-hero">
          <div className="sd-hero-bg" aria-hidden />
          <button
            type="button"
            className="sd-hero-close"
            onClick={onClose}
            aria-label="Đóng"
          >
            ✕
          </button>
          <div className="sd-hero-content">
            <div className="add-account-hero-icon" aria-hidden>
              <svg viewBox="0 0 24 24" width="28" height="28" fill="none">
                <path
                  d="M7 18.5 5 20V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9.5L7 18.5Z"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div className="sd-hero-text">
              <h2 id="add-account-title" className="sd-hero-name">
                Thêm tài khoản Telegram
              </h2>
              <p className="sd-hero-phone">
                Nhập số điện thoại và mã OTP — file <code>.session</code> lưu tự động
              </p>
              <div className="add-account-hero-chips">
                <span className="add-account-hero-chip">OTP qua app</span>
                <span className="add-account-hero-chip">Hỗ trợ 2FA</span>
              </div>
            </div>
          </div>
        </header>

        <div className="sd-body add-account-body">
          <AccountAuthWizard
            variant="embedded"
            onSuccess={onSuccess}
            donePrimaryLabel="Xong"
            onDonePrimary={onClose}
          />
        </div>
      </div>
    </div>
  )
}