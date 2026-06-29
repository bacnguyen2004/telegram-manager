import { useState } from 'react'
import { api } from '../api/client'
import { Alert } from '../components/Alert'
import { PhoneSelect } from '../components/PhoneSelect'

export function LoginCodePage() {
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function handleFetchCode(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setSuccess('')
    setCode('')
    try {
      const res = await api.getLoginCode(phone)
      if (!res.success || !res.data) {
        setError(res.error ?? 'Không lấy được mã')
        return
      }
      if (res.data.status === 'error') {
        setError(res.data.message)
        return
      }
      setCode(res.data.code)
      setSuccess('Đã đọc mã từ tin nhắn Telegram (777000)')
    } catch {
      setError('Không kết nối được API.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Đọc mã OTP</h1>
          <p className="page-desc">
            Lấy mã đăng nhập từ tin nhắn Telegram — cần session đã đăng nhập
          </p>
        </div>
      </header>

      <Alert type="error" message={error} />
      <Alert type="success" message={success} />

      <div className="login-layout">
        <section className="panel login-steps">
          <h2>Lưu ý</h2>
          <div className="hint-box">
            <p>
              Dùng khi bạn đăng nhập Telegram ở thiết bị khác và cần đọc mã OTP tự động từ
              tài khoản đã có session trên server.
            </p>
          </div>
          <ul className="bullet-list">
            <li>Không cần gọi send-code</li>
            <li>Session phải đang active</li>
            <li>Đọc tin nhắn mới nhất từ Telegram (777000)</li>
          </ul>
        </section>

        <section className="panel login-form-panel">
          <form onSubmit={(e) => void handleFetchCode(e)}>
            <h2>Chọn tài khoản</h2>
            <PhoneSelect value={phone} onChange={setPhone} allowManual={false} />
            <button
              type="submit"
              className="btn btn--primary btn--block"
              disabled={loading || !phone}
            >
              {loading ? 'Đang đọc…' : 'Lấy mã OTP'}
            </button>
          </form>

          {code && (
            <div className="code-result">
              <p className="code-result-label">Mã OTP</p>
              <p className="code-result-value">{code}</p>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => void navigator.clipboard.writeText(code)}
              >
                Sao chép
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}