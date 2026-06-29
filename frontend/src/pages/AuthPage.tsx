import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { Alert } from '../components/Alert'

type AuthMode = 'login' | 'register'
type LoginStep = 'phone' | 'code' | '2fa' | 'done'
type RegisterStep = 'phone' | 'profile' | 'done'

const LOGIN_STEPS = ['Gửi OTP', 'Nhập mã', '2FA', 'Hoàn tất'] as const
const LOGIN_2FA_STEP_INDEX = 2
const REGISTER_STEPS = ['Gửi OTP', 'Thông tin', 'Hoàn tất'] as const

export function AuthPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const mode: AuthMode = searchParams.get('mode') === 'register' ? 'register' : 'login'

  function setMode(next: AuthMode) {
    if (next === 'register') {
      setSearchParams({ mode: 'register' })
    } else {
      setSearchParams({})
    }
  }

  return (
    <div className="page page--auth">
      <header className="page-header">
        <div>
          <h1>Tài khoản</h1>
          <p className="page-desc">
            Gửi OTP → nhập mã → 2FA (nếu có) → tạo file <code>.session</code>
          </p>
        </div>
      </header>

      <div className="tab-bar auth-mode-tabs">
        <button
          type="button"
          className={`tab-btn${mode === 'login' ? ' tab-btn--active' : ''}`}
          onClick={() => setMode('login')}
        >
          Đăng nhập
        </button>
        <button
          type="button"
          className={`tab-btn${mode === 'register' ? ' tab-btn--active' : ''}`}
          onClick={() => setMode('register')}
        >
          Đăng ký mới
        </button>
      </div>

      {mode === 'login' ? <LoginFlow /> : <RegisterFlow />}
    </div>
  )
}

function authStepClass(index: number, currentIndex: number, skippedIndex?: number): string {
  if (skippedIndex === index) return 'auth-step auth-step--skipped'
  if (index < currentIndex) return 'auth-step auth-step--done'
  if (index === currentIndex) return 'auth-step auth-step--active'
  return 'auth-step'
}

function AuthStepper({
  steps,
  currentIndex,
  skippedIndex,
}: {
  steps: readonly string[]
  currentIndex: number
  skippedIndex?: number
}) {
  return (
    <ol className="auth-stepper" aria-label="Tiến trình">
      {steps.map((label, i) => (
        <li key={`${label}-${i}`} className={authStepClass(i, currentIndex, skippedIndex)}>
          <span className="auth-step-num">{skippedIndex === i ? '—' : i + 1}</span>
          <span className="auth-step-label">
            {label}
            {skippedIndex === i ? ' (không cần)' : ''}
          </span>
        </li>
      ))}
    </ol>
  )
}

function LoginFlow() {
  const navigate = useNavigate()
  const [step, setStep] = useState<LoginStep>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [skipped2fa, setSkipped2fa] = useState(false)
  const [accountInfo, setAccountInfo] = useState({
    first_name: '',
    last_name: '',
    username: '',
    session_file: '',
  })

  const stepIndex =
    step === 'phone' ? 0 : step === 'code' ? 1 : step === '2fa' ? 2 : 3

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
      if (res.data.status === 'error' || res.data.status === 'info') {
        setError(res.data.message)
        return
      }
      setSuccess(res.data.message)
      setStep('code')
    } catch {
      setError('Không kết nối được API. Kiểm tra backend đang chạy port 8001.')
    } finally {
      setLoading(false)
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      const res = await api.login(phone.trim(), code.trim(), password || undefined)
      if (!res.success || !res.data) {
        setError(res.error ?? 'Đăng nhập thất bại')
        return
      }
      if (res.data.status === 'need_2fa') {
        setSkipped2fa(false)
        setSuccess(res.data.message)
        setStep('2fa')
        return
      }
      if (res.data.status === 'error') {
        setError(res.data.message)
        return
      }
      setSkipped2fa(true)
      setAccountInfo({
        first_name: res.data.first_name,
        last_name: res.data.last_name,
        username: res.data.username,
        session_file: res.data.session_file,
      })
      setSuccess(res.data.message)
      setStep('done')
    } catch {
      setError('Không kết nối được API khi đăng nhập.')
    } finally {
      setLoading(false)
    }
  }

  function resetForm() {
    setStep('phone')
    setPhone('')
    setCode('')
    setPassword('')
    setSkipped2fa(false)
    setError('')
    setSuccess('')
    setAccountInfo({ first_name: '', last_name: '', username: '', session_file: '' })
  }

  return (
    <div className="auth-flow">
      <AuthStepper
        steps={LOGIN_STEPS}
        currentIndex={stepIndex}
        skippedIndex={skipped2fa ? LOGIN_2FA_STEP_INDEX : undefined}
      />

      <div className="auth-body">
        <Alert type="error" message={error} />
        <Alert type="success" message={success} />

        <section className="panel auth-form-panel">
        {step === 'phone' && (
          <form onSubmit={(e) => void handleSendCode(e)}>
            <h2>Gửi mã OTP</h2>
            <p className="form-meta">Số điện thoại đã có tài khoản Telegram</p>
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

        {step === 'code' && (
          <form onSubmit={(e) => void handleLogin(e)}>
            <h2>Nhập mã OTP</h2>
            <p className="form-meta">
              Mã đã gửi tới <strong>{phone}</strong>
            </p>
            <label className="field">
              <span>Mã xác thực</span>
              <input
                type="text"
                inputMode="numeric"
                placeholder="12345"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                autoFocus
              />
            </label>
            <div className="form-actions">
              <button type="button" className="btn btn--ghost" onClick={() => setStep('phone')}>
                Quay lại
              </button>
              <button type="submit" className="btn btn--primary" disabled={loading}>
                {loading ? 'Đang xác thực…' : 'Đăng nhập'}
              </button>
            </div>
          </form>
        )}

        {step === '2fa' && (
          <form onSubmit={(e) => void handleLogin(e)}>
            <h2>Bước 3 — Mật khẩu 2FA</h2>
            <p className="form-meta">
              Tài khoản <strong>{phone}</strong> bật xác thực 2 bước — nhập mật khẩu Cloud Password
            </p>
            <label className="field">
              <span>Mật khẩu 2FA</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
              />
            </label>
            <div className="form-actions">
              <button type="button" className="btn btn--ghost" onClick={() => setStep('code')}>
                Quay lại
              </button>
              <button type="submit" className="btn btn--primary" disabled={loading}>
                {loading ? 'Đang xác thực…' : 'Xác nhận 2FA'}
              </button>
            </div>
          </form>
        )}

        {step === 'done' && (
          <div className="done-panel">
            <div className="done-icon">✓</div>
            <h2>Đăng nhập thành công</h2>
            <AccountDetails phone={phone} accountInfo={accountInfo} />
            <div className="form-actions">
              <button type="button" className="btn btn--ghost" onClick={resetForm}>
                Thêm tài khoản khác
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

function RegisterFlow() {
  const navigate = useNavigate()
  const [step, setStep] = useState<RegisterStep>('phone')
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

  const stepIndex = step === 'phone' ? 0 : step === 'profile' ? 1 : 2

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
      if (res.data.status === 'error' || res.data.status === 'info') {
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

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      const res = await api.register(phone.trim(), code.trim(), firstName.trim(), lastName.trim())
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

  return (
    <div className="auth-flow">
      <AuthStepper steps={REGISTER_STEPS} currentIndex={stepIndex} />

      <div className="auth-body">
        <Alert type="error" message={error} />
        <Alert type="success" message={success} />

        <section className="panel auth-form-panel">
        {step === 'phone' && (
          <form onSubmit={(e) => void handleSendCode(e)}>
            <h2>Gửi mã OTP</h2>
            <p className="form-meta">Số điện thoại chưa có tài khoản Telegram</p>
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
            <h2>Thông tin đăng ký</h2>
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
            <AccountDetails phone={phone} accountInfo={accountInfo} />
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

function AccountDetails({
  phone,
  accountInfo,
}: {
  phone: string
  accountInfo: {
    first_name: string
    last_name: string
    username: string
    session_file: string
  }
}) {
  return (
    <>
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
    </>
  )
}