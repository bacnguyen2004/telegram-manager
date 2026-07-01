import { useEffect, useState } from 'react'
import { api } from '../api/client'

interface PhoneSelectProps {
  value: string
  onChange: (phone: string) => void
  allowManual?: boolean
  required?: boolean
  label?: string
  emptyOptionLabel?: string
}

export function PhoneSelect({
  value,
  onChange,
  allowManual = true,
  required = true,
  label = 'Chọn tài khoản',
  emptyOptionLabel,
}: PhoneSelectProps) {
  const emptyLabel = emptyOptionLabel ?? (required ? '— Chọn số điện thoại —' : 'Tất cả acc')
  const [sessions, setSessions] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      try {
        const res = await api.listSessions()
        if (res.success && res.data) {
          setSessions(res.data.sessions)
        }
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  if (loading) {
    return <p className="muted">Đang tải danh sách session…</p>
  }

  if (sessions.length === 0 && !allowManual) {
    return (
      <p className="muted">
        Chưa có session. Hãy <strong>Đăng nhập</strong> hoặc <strong>Đăng ký</strong> trước.
      </p>
    )
  }

  if (sessions.length > 0) {
    return (
      <label className="field">
        <span>{label}</span>
        <select value={value} onChange={(e) => onChange(e.target.value)} required={required}>
          <option value="">{emptyLabel}</option>
          {sessions.map((phone) => (
            <option key={phone} value={phone}>
              {phone}
            </option>
          ))}
        </select>
      </label>
    )
  }

  return (
    <label className="field">
      <span>Số điện thoại (E.164)</span>
      <input
        type="tel"
        placeholder="+84901234567"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
      />
    </label>
  )
}