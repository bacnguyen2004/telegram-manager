import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { Alert } from '../components/Alert'

type Step = 'phone' | 'profile' | 'done'

export function RegisterPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [accountInfo, setAccountInfo] = useState({
    first_name: '',
    last_name: '',
    username: '',
    session_file: '',
  })

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      const res = await api.sendCode(phone.trim())
      if (!res.success || !res.data) {
        setError(res.error ?? 'Gửi mã thất bại')
        return
      }
      if (res.data.status === 'error') {
        setError(res.data.message)
        return
      }
      if (res.data.status === 'info') {
        setError(res.data.message)
        return
      }
      setSuccess(res.data.message)
      setStep('profile')
    } catch {
      setError('Không kết nối được API. Kiểm tra backend đang chạy port 8001.')
    } finally {
      setLoading(false)
    }
  }

  function resetForm() {
    setStep('phone')
    setPhone('')
    setCode('')
    setFirstName('')
    setLastName('')
    setError('')
    setSuccess('')
    setAccountInfo({ first_name: '', last_name: '', username: '', session_file: '' })
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      const res = await api.register(
        phone.trim(),
        code.trim(),
        firstName.trim(),
        lastName.trim(),
      )
      if (!res.success || !res.data) {
        setError(res.error ?? 'Đăng ký thất bại')
        return
      }
      if (res.data.status === 'error') {
        setError(res.data.message)
        return
      }
      setAccountInfo({
        first_name: res.data.first_name,
        last_name: res.data.last_name,
        username: res.data.username,
        session_file: res.data.session_file,
      })
      setSuccess(res.data.message)
      setStep('done')
    } catch {
      setError('Không kết nối được API khi đăng ký.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Đăng ký mới</h1>
          <p className="page-desc">
            <code>POST /api/auth/register</code> —{' '}
            <Link to="/send-code">Gửi OTP</Link> trước ·{' '}
            <Link to="/login">Đăng nhập</Link>
          </p>
        </div>
      </header>

      <Alert type="error" message={error} />
      <Alert type="success" message={success} />

      <div className="login-layout">
        <section className="panel login-steps">
          <h2>Quy trình</h2>
          <ol className="step-list">
            <li className={`step-item${step === 'phone' ? ' step-item--active' : ' step-item--done'}`}>
              <span className="step-num">1</span>
              Gửi OTP
            </li>
            <li
              className={`step-item${
                step === 'profile' ? ' step-item--active' : step === 'done' ? ' step-item--done' : ''
              }`}
            >
              <span className="step-num">2</span>
              OTP + Họ tên
            </li>
            <li className={`step-item${step === 'done' ? ' step-item--active step-item--done' : ''}`}>
              <span className="step-num">3</span>
              Hoàn tất
            </li>
          </ol>
          <div className="hint-box">
            <p>Dùng cho số điện thoại <strong>chưa có</strong> tài khoản Telegram.</p>
          </div>
        </section>

        <section className="panel login-form-panel">
          {step === 'phone' && (
            <form onSubmit={(e) => void handleSendCode(e)}>
              <h2>Bước 1 — Gửi mã OTP</h2>
              <label className="field">
                <span>Số điện thoại (E.164)</span>
                <input
                  type="tel"
                  placeholder="+84901234567"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                  autoFocus
                />
              </label>
              <button type="submit" className="btn btn--primary btn--block" disabled={loading}>
                {loading ? 'Đang gửi…' : 'Gửi mã OTP'}
              </button>
            </form>
          )}

          {step === 'profile' && (
            <form onSubmit={(e) => void handleRegister(e)}>
              <h2>Bước 2 — Đăng ký</h2>
              <p className="form-meta">
                OTP đã gửi tới <strong>{phone}</strong>
              </p>
              <label className="field">
                <span>Mã OTP</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                  autoFocus
                />
              </label>
              <label className="field">
                <span>Tên</span>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                />
              </label>
              <label className="field">
                <span>Họ (tuỳ chọn)</span>
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </label>
              <div className="form-actions">
                <button type="button" className="btn btn--ghost" onClick={() => setStep('phone')}>
                  Quay lại
                </button>
                <button type="submit" className="btn btn--primary" disabled={loading}>
                  {loading ? 'Đang đăng ký…' : 'Đăng ký'}
                </button>
              </div>
            </form>
          )}

          {step === 'done' && (
            <div className="done-panel">
              <div className="done-icon">✓</div>
              <h2>Đăng ký thành công</h2>
              <div className="detail-row">
                <span>Số điện thoại</span>
                <strong>{phone}</strong>
              </div>
              <div className="detail-row">
                <span>Họ tên</span>
                <strong>
                  {[accountInfo.first_name, accountInfo.last_name].filter(Boolean).join(' ') || '—'}
                </strong>
              </div>
              <div className="detail-row">
                <span>Username</span>
                <strong>{accountInfo.username ? `@${accountInfo.username}` : '—'}</strong>
              </div>
              <div className="detail-row">
                <span>Session file</span>
                <code className="session-path">{accountInfo.session_file}</code>
              </div>
              <div className="form-actions">
                <button type="button" className="btn btn--ghost" onClick={resetForm}>
                  Đăng ký số khác
                </button>
                <button type="button" className="btn btn--primary" onClick={() => navigate('/sessions')}>
                  Xem Sessions
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}