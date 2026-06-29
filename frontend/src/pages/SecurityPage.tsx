import { useState } from 'react'
import { api } from '../api/client'
import { Alert } from '../components/Alert'
import { PhoneSelect } from '../components/PhoneSelect'
import type { PrivacyRuleType } from '../types/api'

export function SecurityPage() {
  const [phone, setPhone] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [hint, setHint] = useState('')
  const [ruleType, setRuleType] = useState<PrivacyRuleType>('all')
  const [loading2fa, setLoading2fa] = useState(false)
  const [loadingPrivacy, setLoadingPrivacy] = useState(false)
  const [error2fa, setError2fa] = useState('')
  const [success2fa, setSuccess2fa] = useState('')
  const [errorPrivacy, setErrorPrivacy] = useState('')
  const [successPrivacy, setSuccessPrivacy] = useState('')

  async function handleUpdate2fa(e: React.FormEvent) {
    e.preventDefault()
    setLoading2fa(true)
    setError2fa('')
    setSuccess2fa('')
    try {
      const res = await api.update2fa(
        phone,
        newPassword,
        currentPassword || undefined,
        hint || undefined,
      )
      if (!res.success || !res.data) {
        setError2fa(res.error ?? 'Cập nhật 2FA thất bại')
        return
      }
      if (res.data.status === 'error') {
        setError2fa(res.data.message)
        return
      }
      setSuccess2fa(res.data.message)
      setCurrentPassword('')
      setNewPassword('')
      setHint('')
    } catch {
      setError2fa('Không kết nối được API.')
    } finally {
      setLoading2fa(false)
    }
  }

  async function handleUpdatePrivacy(e: React.FormEvent) {
    e.preventDefault()
    setLoadingPrivacy(true)
    setErrorPrivacy('')
    setSuccessPrivacy('')
    try {
      const res = await api.updatePrivacy(phone, ruleType)
      if (!res.success || !res.data) {
        setErrorPrivacy(res.error ?? 'Cập nhật privacy thất bại')
        return
      }
      if (res.data.status === 'error') {
        setErrorPrivacy(res.data.message)
        return
      }
      setSuccessPrivacy(res.data.message)
    } catch {
      setErrorPrivacy('Không kết nối được API.')
    } finally {
      setLoadingPrivacy(false)
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Bảo mật</h1>
          <p className="page-desc">2FA và quyền riêng tư — cần session đã đăng nhập</p>
        </div>
      </header>

      <div className="security-grid">
        <section className="panel">
          <h2>Đổi / bật 2FA</h2>
          <Alert type="error" message={error2fa} />
          <Alert type="success" message={success2fa} />
          <form onSubmit={(e) => void handleUpdate2fa(e)}>
            <PhoneSelect value={phone} onChange={setPhone} allowManual={false} />
            <label className="field">
              <span>Mật khẩu 2FA hiện tại (nếu đã bật)</span>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Mật khẩu 2FA mới</span>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
            </label>
            <label className="field">
              <span>Gợi ý (tuỳ chọn)</span>
              <input type="text" value={hint} onChange={(e) => setHint(e.target.value)} />
            </label>
            <button
              type="submit"
              className="btn btn--primary btn--block"
              disabled={loading2fa || !phone}
            >
              {loading2fa ? 'Đang cập nhật…' : 'Cập nhật 2FA'}
            </button>
          </form>
        </section>

        <section className="panel">
          <h2>Privacy — mời vào group</h2>
          <Alert type="error" message={errorPrivacy} />
          <Alert type="success" message={successPrivacy} />
          <form onSubmit={(e) => void handleUpdatePrivacy(e)}>
            <PhoneSelect
              value={phone}
              onChange={setPhone}
              allowManual={false}
              label="Tài khoản"
            />
            <label className="field">
              <span>Ai được mời bạn vào group</span>
              <select
                value={ruleType}
                onChange={(e) => setRuleType(e.target.value as PrivacyRuleType)}
              >
                <option value="all">Mọi người</option>
                <option value="contacts">Danh bạ</option>
                <option value="nobody">Không ai</option>
              </select>
            </label>
            <button
              type="submit"
              className="btn btn--primary btn--block"
              disabled={loadingPrivacy || !phone}
            >
              {loadingPrivacy ? 'Đang cập nhật…' : 'Cập nhật Privacy'}
            </button>
          </form>
        </section>
      </div>
    </div>
  )
}