import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { Alert } from '../components/Alert'

export function SendCodePage() {
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [info, setInfo] = useState('')

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setSuccess('')
    setInfo('')
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
        setInfo(res.data.message)
        return
      }
      setSuccess(res.data.message)
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
          <h1>Gửi OTP</h1>
          <p className="page-desc">
            <code>POST /api/auth/send-code</code> — bước đầu trước login/register
          </p>
        </div>
      </header>

      <Alert type="error" message={error} />
      <Alert type="success" message={success} />
      {info && <Alert type="info" message={info} />}

      <section className="panel" style={{ maxWidth: 480 }}>
        <form onSubmit={(e) => void handleSendCode(e)}>
          <label className="field">
            <span>Số điện thoại (E.164)</span>
            <input
              type="tel"
              placeholder="+84901234567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
          </label>
          <button type="submit" className="btn btn--primary btn--block" disabled={loading}>
            {loading ? 'Đang gửi…' : 'Gửi mã OTP'}
          </button>
        </form>
        <p className="form-meta" style={{ marginTop: 16 }}>
          Tiếp theo: <Link to="/login">Đăng nhập</Link> hoặc{' '}
          <Link to="/register">Đăng ký</Link>
        </p>
      </section>
    </div>
  )
}