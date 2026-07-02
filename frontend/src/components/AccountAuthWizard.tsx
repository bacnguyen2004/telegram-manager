import { useMemo, useState } from 'react'
import './AccountAuthWizard.css'
import { api } from '../api/client'
import { buildE164, DEFAULT_DIAL_CODE, isValidE164 } from '../utils/phoneDial'
import { Alert } from './Alert'
import { PhoneDialInput } from './PhoneDialInput'

type Step = 'phone' | 'code' | '2fa' | 'profile' | 'done'
type VerifyKind = '2fa' | 'signup' | null

const VERIFY_STEP_INDEX = 2

export interface AccountAuthWizardProps {
  variant?: 'page' | 'embedded'
  onSuccess?: (phone: string) => void
  donePrimaryLabel?: string
  onDonePrimary?: () => void
}

export function AccountAuthWizard({
  variant = 'page',
  onSuccess,
  donePrimaryLabel = 'Xem Sessions',
  onDonePrimary,
}: AccountAuthWizardProps) {
  const [step, setStep] = useState<Step>('phone')
  const [verifyKind, setVerifyKind] = useState<VerifyKind>(null)
  const [skippedVerify, setSkippedVerify] = useState(false)
  const [wasSignup, setWasSignup] = useState(false)
  const [dialCode, setDialCode] = useState(DEFAULT_DIAL_CODE)
  const [phoneLocal, setPhoneLocal] = useState('')
  const e164Phone = useMemo(() => buildE164(dialCode, phoneLocal), [dialCode, phoneLocal])
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
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

  const stepIndex =
    step === 'phone' ? 0 : step === 'code' ? 1 : step === '2fa' || step === 'profile' ? 2 : 3

  const stepperLabels = useMemo(() => {
    const verifyLabel =
      verifyKind === 'signup' ? 'Thông tin' : verifyKind === '2fa' ? '2FA' : 'Xác thực'
    return ['Gửi OTP', 'Nhập mã', verifyLabel, 'Hoàn tất'] as const
  }, [verifyKind])

  function applyAccountResult(
    data: {
      first_name: string
      last_name: string
      username: string
      session_file: string
      message: string
    },
    signup: boolean,
  ) {
    setAccountInfo({
      first_name: data.first_name,
      last_name: data.last_name,
      username: data.username,
      session_file: data.session_file,
    })
    setWasSignup(signup)
    setSuccess(data.message)
    setStep('done')
    onSuccess?.(e164Phone)
  }

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault()
    if (!isValidE164(e164Phone)) {
      setError('Nhập số điện thoại hợp lệ (chọn đầu số + phần số, không cần số 0 đầu).')
      return
    }
    setLoading(true)
    setError('')
    setSuccess('')
    setVerifyKind(null)
    setSkippedVerify(false)
    try {
      const res = await api.sendCode(e164Phone)
      if (!res.success || !res.data) {
        setError(res.error ?? 'Gửi mã thất bại')
        return
      }
      if (res.data.status === 'error') {
        setError(res.data.message)
        return
      }
      if (res.data.status === 'info') {
        setSuccess(res.data.message)
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

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      const res = await api.login(e164Phone, code.trim())
      if (!res.success || !res.data) {
        setError(res.error ?? 'Xác thực thất bại')
        return
      }
      if (res.data.status === 'need_2fa') {
        setSkippedVerify(false)
        setVerifyKind('2fa')
        setSuccess(res.data.message)
        setStep('2fa')
        return
      }
      if (res.data.status === 'need_signup') {
        setSkippedVerify(false)
        setVerifyKind('signup')
        setSuccess(res.data.message)
        setStep('profile')
        return
      }
      if (res.data.status === 'error') {
        setError(res.data.message)
        return
      }
      setSkippedVerify(true)
      setVerifyKind(null)
      applyAccountResult(res.data, false)
    } catch {
      setError('Không kết nối được API khi xác thực.')
    } finally {
      setLoading(false)
    }
  }

  async function handle2fa(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      const res = await api.login(e164Phone, code.trim(), password)
      if (!res.success || !res.data) {
        setError(res.error ?? 'Xác thực 2FA thất bại')
        return
      }
      if (res.data.status === 'need_signup') {
        setVerifyKind('signup')
        setSuccess(res.data.message)
        setStep('profile')
        return
      }
      if (res.data.status === 'error') {
        setError(res.data.message)
        return
      }
      if (res.data.status === 'need_2fa') {
        setError(res.data.message)
        return
      }
      setSkippedVerify(false)
      setVerifyKind('2fa')
      applyAccountResult(res.data, false)
    } catch {
      setError('Không kết nối được API khi xác thực 2FA.')
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
      const res = await api.register(e164Phone, code.trim(), firstName.trim(), lastName.trim())
      if (!res.success || !res.data) {
        setError(res.error ?? 'Đăng ký thất bại')
        return
      }
      if (res.data.status === 'error') {
        setError(res.data.message)
        return
      }
      setSkippedVerify(false)
      setVerifyKind('signup')
      applyAccountResult(res.data, true)
    } catch {
      setError('Không kết nối được API khi đăng ký.')
    } finally {
      setLoading(false)
    }
  }

  function resetForm() {
    setStep('phone')
    setVerifyKind(null)
    setSkippedVerify(false)
    setWasSignup(false)
    setDialCode(DEFAULT_DIAL_CODE)
    setPhoneLocal('')
    setCode('')
    setPassword('')
    setFirstName('')
    setLastName('')
    setError('')
    setSuccess('')
    setAccountInfo({ first_name: '', last_name: '', username: '', session_file: '' })
  }

  const rootClass =
    variant === 'embedded' ? 'auth-wizard auth-wizard--embedded' : 'auth-wizard auth-wizard--page'

  return (
    <div className={rootClass}>
      <div className="auth-flow">
        <div className="auth-shell">
          <AuthStepper
            steps={stepperLabels}
            currentIndex={stepIndex}
            skippedIndex={skippedVerify ? VERIFY_STEP_INDEX : undefined}
          />

          <div className="auth-body">
            <Alert type="error" message={error} />
            <Alert type="success" message={success} />

            <section className="panel auth-form-panel">
              <div className="auth-card-inner">
                {step === 'phone' && (
                  <form onSubmit={(e) => void handleSendCode(e)}>
                    <div className="auth-card-head">
                      <span className="auth-card-icon" aria-hidden>
                        📱
                      </span>
                      <div>
                        <h2>Gửi mã OTP</h2>
                        <p className="form-meta">
                          Dùng cho mọi số — Telegram sẽ gửi mã xác thực qua app
                        </p>
                      </div>
                    </div>
                    <div className="field phone-dial-field">
                      <PhoneDialInput
                        dialCode={dialCode}
                        localNumber={phoneLocal}
                        onDialCodeChange={setDialCode}
                        onLocalNumberChange={setPhoneLocal}
                        disabled={loading}
                        autoFocus
                      />
                      <p className="form-meta phone-dial-hint">
                        Ví dụ Việt Nam: chọn <strong>+84</strong>, nhập{' '}
                        <strong>901234567</strong> (không gõ số 0 đầu).
                      </p>
                    </div>
                    <button type="submit" className="btn btn--primary btn--block" disabled={loading}>
                      {loading ? 'Đang gửi…' : 'Gửi mã OTP'}
                    </button>
                  </form>
                )}

                {step === 'code' && (
                  <form onSubmit={(e) => void handleVerifyCode(e)}>
                    <div className="auth-card-head">
                      <span className="auth-card-icon" aria-hidden>
                        🔢
                      </span>
                      <div>
                        <h2>Nhập mã OTP</h2>
                        <p className="form-meta">
                          Mã đã gửi tới <strong>{e164Phone}</strong>
                        </p>
                      </div>
                    </div>
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
                        {loading ? 'Đang xác thực…' : 'Tiếp tục'}
                      </button>
                    </div>
                  </form>
                )}

                {step === '2fa' && (
                  <form onSubmit={(e) => void handle2fa(e)}>
                    <div className="auth-card-head">
                      <span className="auth-card-icon" aria-hidden>
                        🔒
                      </span>
                      <div>
                        <h2>Mật khẩu 2FA</h2>
                        <p className="form-meta">
                          Tài khoản <strong>{e164Phone}</strong> bật xác thực 2 bước
                        </p>
                      </div>
                    </div>
                    <label className="field">
                      <span>Mật khẩu Cloud Password</span>
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

                {step === 'profile' && (
                  <form onSubmit={(e) => void handleRegister(e)}>
                    <div className="auth-card-head">
                      <span className="auth-card-icon" aria-hidden>
                        👤
                      </span>
                      <div>
                        <h2>Hoàn tất đăng ký</h2>
                        <p className="form-meta">
                          Số <strong>{e164Phone}</strong> chưa có tài khoản — nhập tên để tạo tài khoản
                          mới
                        </p>
                      </div>
                    </div>
                    <label className="field">
                      <span>Tên</span>
                      <input
                        type="text"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        required
                        autoFocus
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
                      <button type="button" className="btn btn--ghost" onClick={() => setStep('code')}>
                        Quay lại
                      </button>
                      <button type="submit" className="btn btn--primary" disabled={loading}>
                        {loading ? 'Đang tạo tài khoản…' : 'Tạo tài khoản'}
                      </button>
                    </div>
                  </form>
                )}

                {step === 'done' && (
                  <div className="auth-done-panel done-panel">
                    <div className="done-icon">✓</div>
                    <h2>{wasSignup ? 'Đăng ký thành công' : 'Đăng nhập thành công'}</h2>
                    <div className="auth-done-details">
                      <AccountDetails phone={e164Phone} accountInfo={accountInfo} />
                    </div>
                    <div className="form-actions">
                      <button type="button" className="btn btn--ghost" onClick={resetForm}>
                        Thêm tài khoản khác
                      </button>
                      <button type="button" className="btn btn--primary" onClick={onDonePrimary}>
                        {donePrimaryLabel}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
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