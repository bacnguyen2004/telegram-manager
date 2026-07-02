import { useNavigate } from 'react-router-dom'
import './AuthPage.css'
import { AccountAuthWizard } from '../components/AccountAuthWizard'

export function AuthPage() {
  const navigate = useNavigate()

  return (
    <div className="page page--auth">
      <header className="panel auth-intro">
        <span className="auth-intro-icon" aria-hidden>
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none">
            <path
              d="M7 18.5 5 20V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9.5L7 18.5Z"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <div className="auth-intro-text">
          <span className="auth-kicker">Đăng nhập · Đăng ký</span>
          <h1>Thêm tài khoản Telegram</h1>
          <p className="page-desc">
            Nhập số điện thoại và mã OTP — Telegram tự nhận đăng nhập hay đăng ký. Hỗ trợ 2FA
            nếu có.
          </p>
        </div>
        <div className="auth-intro-chips">
          <span className="auth-intro-chip">OTP qua app</span>
          <span className="auth-intro-chip">Hỗ trợ 2FA</span>
          <span className="auth-intro-chip">Lưu file .session</span>
        </div>
      </header>

      <AccountAuthWizard
        variant="page"
        donePrimaryLabel="Xem Sessions"
        onDonePrimary={() => navigate('/sessions')}
      />
    </div>
  )
}