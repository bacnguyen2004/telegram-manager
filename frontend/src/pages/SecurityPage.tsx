import { useEffect, useMemo, useRef, useState } from 'react'
import './SecurityPage.css'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { AccountPickerPanel, type AccountPickerFilterState } from '../components/AccountPickerPanel'
import { Alert } from '../components/Alert'
import { PasswordInput } from '../components/PasswordInput'
import { useSessionAccounts } from '../hooks/useSessionAccounts'
import type { PrivacyRuleType } from '../types/api'

const PRIVACY_OPTIONS: {
  id: PrivacyRuleType
  label: string
  desc: string
  hint: string
}[] = [
  {
    id: 'all',
    label: 'Mọi người',
    desc: 'Bất kỳ ai cũng có thể mời bạn vào nhóm',
    hint: 'Mở — phù hợp acc công khai hoặc nhận lời mời từ người lạ.',
  },
  {
    id: 'contacts',
    label: 'Danh bạ',
    desc: 'Chỉ người trong danh bạ Telegram',
    hint: 'Cân bằng — hạn chế spam nhưng vẫn nhận lời từ người quen.',
  },
  {
    id: 'nobody',
    label: 'Không ai',
    desc: 'Không cho phép mời vào nhóm',
    hint: 'Chặt — không ai có thể mời bạn tham gia nhóm.',
  },
]

function PrivacyRuleIcon({ id }: { id: PrivacyRuleType }) {
  if (id === 'all') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="9" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.8" />
        <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M16 8.5h5M18.5 6v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    )
  }
  if (id === 'contacts') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M6 6h8a2 2 0 0 1 2 2v11H8a2 2 0 0 1-2-2V6Z" stroke="currentColor" strokeWidth="1.8" />
        <path d="M9 10h4M9 13h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M16 8h2.5a2 2 0 0 1 2 2v9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 11V8a4 4 0 1 1 8 0v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

type ActionMode = 'single' | 'bulk'

type BulkRowStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped'

interface BulkActionRow {
  phone: string
  status: BulkRowStatus
  message: string
}

export function SecurityPage() {
  const [searchParams] = useSearchParams()
  const accounts = useSessionAccounts()
  const [phone, setPhone] = useState(() => searchParams.get('phone') ?? '')
  const [twoFaMode, setTwoFaMode] = useState<ActionMode>('single')
  const [privacyMode, setPrivacyMode] = useState<ActionMode>('single')
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set())
  const [accountFilterState, setAccountFilterState] = useState<AccountPickerFilterState>({
    filteredCount: 0,
    totalCount: 0,
    hasFilters: false,
  })
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
  const [bulk2faRows, setBulk2faRows] = useState<BulkActionRow[]>([])
  const [bulk2faRunning, setBulk2faRunning] = useState(false)
  const [bulkPrivacyRows, setBulkPrivacyRows] = useState<BulkActionRow[]>([])
  const [bulkPrivacyRunning, setBulkPrivacyRunning] = useState(false)
  const bulk2faAbortRef = useRef(false)
  const bulkPrivacyAbortRef = useRef(false)

  const hasSession = Boolean(phone)
  const bulkSelectedList = useMemo(() => [...bulkSelected], [bulkSelected])
  const useBulkSidebar = twoFaMode === 'bulk' || privacyMode === 'bulk'
  const anyBulkRunning = bulk2faRunning || bulkPrivacyRunning
  const actionBusy = loading2fa || loadingPrivacy || anyBulkRunning

  const selectedAccountCount = useBulkSidebar ? bulkSelected.size : phone ? 1 : 0

  const accountPickerMeta = useMemo(() => {
    const { filteredCount, totalCount, hasFilters } = accountFilterState
    if (useBulkSidebar) {
      if (hasFilters) {
        return `${bulkSelected.size} chọn · ${filteredCount}/${totalCount} hiển thị`
      }
      return `${bulkSelected.size} / ${totalCount} đã chọn`
    }
    if (phone) return accounts.getPickerLabel(phone)
    if (hasFilters) return `${filteredCount}/${totalCount} hiển thị`
    return 'Chọn một tài khoản'
  }, [accountFilterState, useBulkSidebar, bulkSelected.size, phone, accounts])

  useEffect(() => {
    if (!success2fa) return
    const timer = window.setTimeout(() => setSuccess2fa(''), 4000)
    return () => window.clearTimeout(timer)
  }, [success2fa])

  useEffect(() => {
    if (!successPrivacy) return
    const timer = window.setTimeout(() => setSuccessPrivacy(''), 3000)
    return () => window.clearTimeout(timer)
  }, [successPrivacy])

  function stopBulk2fa() {
    bulk2faAbortRef.current = true
  }

  function stopBulkPrivacy() {
    bulkPrivacyAbortRef.current = true
  }

  async function handleUpdate2fa(e: React.FormEvent) {
    e.preventDefault()
    if (!phone || !newPassword.trim()) return
    setLoading2fa(true)
    setError2fa('')
    setSuccess2fa('')
    try {
      const res = await api.update2fa(
        phone,
        newPassword.trim(),
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

  async function handleBulkUpdate2fa(e: React.FormEvent) {
    e.preventDefault()
    const phones = bulkSelectedList
    if (phones.length === 0 || !newPassword.trim()) return

    setBulk2faRunning(true)
    setError2fa('')
    setSuccess2fa('')
    bulk2faAbortRef.current = false

    const rows: BulkActionRow[] = phones.map((item) => ({
      phone: item,
      status: 'pending',
      message: '',
    }))
    setBulk2faRows(rows)

    let ok = 0
    let fail = 0

    for (let i = 0; i < phones.length; i++) {
      if (bulk2faAbortRef.current) break

      const targetPhone = phones[i]
      setBulk2faRows((prev) =>
        prev.map((row, idx) =>
          idx === i ? { ...row, status: 'running', message: 'Đang cập nhật…' } : row,
        ),
      )

      try {
        const res = await api.update2fa(
          targetPhone,
          newPassword.trim(),
          currentPassword || undefined,
          hint || undefined,
        )
        if (!res.success || !res.data) {
          fail += 1
          setBulk2faRows((prev) =>
            prev.map((row, idx) =>
              idx === i
                ? { ...row, status: 'error', message: res.error ?? 'Thất bại' }
                : row,
            ),
          )
          continue
        }
        if (res.data.status === 'error') {
          fail += 1
          setBulk2faRows((prev) =>
            prev.map((row, idx) =>
              idx === i ? { ...row, status: 'error', message: res.data!.message } : row,
            ),
          )
          continue
        }
        ok += 1
        setBulk2faRows((prev) =>
          prev.map((row, idx) =>
            idx === i ? { ...row, status: 'success', message: res.data!.message } : row,
          ),
        )
      } catch {
        fail += 1
        setBulk2faRows((prev) =>
          prev.map((row, idx) =>
            idx === i ? { ...row, status: 'error', message: 'Lỗi kết nối API' } : row,
          ),
        )
      }
    }

    if (bulk2faAbortRef.current) {
      setBulk2faRows((prev) =>
        prev.map((row) =>
          row.status === 'pending' ? { ...row, status: 'skipped', message: 'Đã dừng' } : row,
        ),
      )
      setSuccess2fa(`Đã dừng — ${ok} thành công, ${fail} lỗi`)
    } else {
      setSuccess2fa(`Hoàn tất — ${ok} thành công, ${fail} lỗi`)
    }

    setBulk2faRunning(false)
  }

  async function handleUpdatePrivacy(e: React.FormEvent) {
    e.preventDefault()
    if (!phone) return
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

  async function handleBulkUpdatePrivacy(e: React.FormEvent) {
    e.preventDefault()
    const phones = bulkSelectedList
    if (phones.length === 0) return

    setBulkPrivacyRunning(true)
    setErrorPrivacy('')
    setSuccessPrivacy('')
    bulkPrivacyAbortRef.current = false

    const rows: BulkActionRow[] = phones.map((item) => ({
      phone: item,
      status: 'pending',
      message: '',
    }))
    setBulkPrivacyRows(rows)

    let ok = 0
    let fail = 0

    for (let i = 0; i < phones.length; i++) {
      if (bulkPrivacyAbortRef.current) break

      const targetPhone = phones[i]
      setBulkPrivacyRows((prev) =>
        prev.map((row, idx) =>
          idx === i ? { ...row, status: 'running', message: 'Đang cập nhật…' } : row,
        ),
      )

      try {
        const res = await api.updatePrivacy(targetPhone, ruleType)
        if (!res.success || !res.data) {
          fail += 1
          setBulkPrivacyRows((prev) =>
            prev.map((row, idx) =>
              idx === i
                ? { ...row, status: 'error', message: res.error ?? 'Thất bại' }
                : row,
            ),
          )
          continue
        }
        if (res.data.status === 'error') {
          fail += 1
          setBulkPrivacyRows((prev) =>
            prev.map((row, idx) =>
              idx === i ? { ...row, status: 'error', message: res.data!.message } : row,
            ),
          )
          continue
        }
        ok += 1
        setBulkPrivacyRows((prev) =>
          prev.map((row, idx) =>
            idx === i ? { ...row, status: 'success', message: res.data!.message } : row,
          ),
        )
      } catch {
        fail += 1
        setBulkPrivacyRows((prev) =>
          prev.map((row, idx) =>
            idx === i ? { ...row, status: 'error', message: 'Lỗi kết nối API' } : row,
          ),
        )
      }
    }

    if (bulkPrivacyAbortRef.current) {
      setBulkPrivacyRows((prev) =>
        prev.map((row) =>
          row.status === 'pending' ? { ...row, status: 'skipped', message: 'Đã dừng' } : row,
        ),
      )
      setSuccessPrivacy(`Đã dừng — ${ok} thành công, ${fail} lỗi`)
    } else {
      setSuccessPrivacy(`Hoàn tất — ${ok} thành công, ${fail} lỗi`)
    }

    setBulkPrivacyRunning(false)
  }

  function bulkProgress(rows: BulkActionRow[]) {
    const finished = rows.filter((row) =>
      ['success', 'error', 'skipped'].includes(row.status),
    ).length
    const total = rows.length
    const pct = total > 0 ? Math.round((finished / total) * 100) : 0
    return { finished, total, pct }
  }

  const bulk2faProgress = bulkProgress(bulk2faRows)
  const bulkPrivacyProgress = bulkProgress(bulkPrivacyRows)

  return (
    <div className="page page--security page--security-active">
      <header className="page-header security-page-header">
        <div>
          <span className="security-page-kicker">Account</span>
          <h1>Bảo mật</h1>
          <p className="page-desc">
            2FA & Privacy group — một hoặc nhiều acc. Session trong{' '}
            <Link to="/sessions">Sessions</Link>.
          </p>
        </div>
        <div className="security-header-actions">
          <Link to="/sessions" className="btn btn--ghost btn--sm">
            Sessions
          </Link>
        </div>
      </header>

      <div className="security-workspace">
        <AccountPickerPanel
          className="security-session-panel"
          title={useBulkSidebar ? 'Chọn acc' : 'Tài khoản'}
          meta={accountPickerMeta}
          badgeCount={selectedAccountCount}
          sessions={accounts.sessions}
          loading={accounts.loading}
          getMeta={accounts.getMeta}
          selectionMode={useBulkSidebar ? 'multiple' : 'single'}
          selectedPhone={phone}
          onSelectedPhoneChange={setPhone}
          selectedPhones={bulkSelected}
          onSelectedPhonesChange={setBulkSelected}
          disabled={anyBulkRunning}
          busy={anyBulkRunning}
          footerSelectedSuffix={useBulkSidebar ? 'acc đã chọn' : 'acc đang dùng'}
          showSelectionToolbar={useBulkSidebar}
          onFiltersChange={setAccountFilterState}
          panelFoot={
            <>
              Session lỗi → kiểm tra tại <Link to="/sessions">Sessions</Link>.
            </>
          }
        />

        <div className="security-main">
          <section className="panel security-actions-panel">
          <div className="security-block security-block--2fa">
            <div className="security-card-head security-card-head--split security-card-head--2fa">
              <div className="security-card-head-main">
                <h2>Đổi / bật 2FA</h2>
                <p className="panel-meta">Mật khẩu xác thực hai lớp trên Telegram</p>
              </div>
              <div className="security-card-head-aside">
                <div className="security-2fa-mode" role="tablist" aria-label="Chế độ 2FA">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={twoFaMode === 'single'}
                    className={`security-2fa-mode-btn${twoFaMode === 'single' ? ' security-2fa-mode-btn--active' : ''}`}
                    onClick={() => setTwoFaMode('single')}
                    disabled={actionBusy}
                  >
                    Một acc
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={twoFaMode === 'bulk'}
                    className={`security-2fa-mode-btn${twoFaMode === 'bulk' ? ' security-2fa-mode-btn--active' : ''}`}
                    onClick={() => setTwoFaMode('bulk')}
                    disabled={actionBusy}
                  >
                    Nhiều acc
                    {bulkSelected.size > 0 ? (
                      <span className="security-2fa-mode-count">{bulkSelected.size}</span>
                    ) : null}
                  </button>
                </div>
                <span className="security-card-badge">2FA</span>
              </div>
            </div>

            <div className="security-card-body">
              <div className="security-card-scroll security-card-scroll--2fa">
                <Alert type="error" message={error2fa} />
                <Alert type="success" message={success2fa} />

                <div className="security-action-context security-action-context--2fa">
                  <span className="security-action-context-label">
                    {twoFaMode === 'single' ? 'Áp dụng cho' : 'Bulk'}
                  </span>
                  <span className="security-action-context-value">
                    {twoFaMode === 'single'
                      ? hasSession
                        ? accounts.getPickerLabel(phone)
                        : 'Chọn acc ở sidebar'
                      : bulkSelected.size > 0
                        ? `${bulkSelected.size} acc đã chọn`
                        : 'Chọn nhiều acc ở sidebar'}
                  </span>
                </div>

                <form
                  id="security-2fa-form"
                  className="security-form security-form--2fa"
                  onSubmit={(e) =>
                    void (twoFaMode === 'single' ? handleUpdate2fa(e) : handleBulkUpdate2fa(e))
                  }
                >
                  <PasswordInput
                    label="Mật khẩu 2FA hiện tại"
                    value={currentPassword}
                    onChange={setCurrentPassword}
                    placeholder="Bỏ trống nếu chưa bật 2FA"
                    autoComplete="current-password"
                    disabled={
                      actionBusy || (twoFaMode === 'single' ? !hasSession : bulkSelected.size === 0)
                    }
                  />
                  <PasswordInput
                    label="Mật khẩu 2FA mới"
                    value={newPassword}
                    onChange={setNewPassword}
                    placeholder="Mật khẩu mới (dùng chung cho bulk)"
                    required
                    autoComplete="new-password"
                    disabled={
                      actionBusy || (twoFaMode === 'single' ? !hasSession : bulkSelected.size === 0)
                    }
                  />
                  <label className="field security-hint-field">
                    <span>Gợi ý (tuỳ chọn)</span>
                    <input
                      type="text"
                      value={hint}
                      onChange={(e) => setHint(e.target.value)}
                      placeholder="Gợi ý khi quên mật khẩu"
                      disabled={
                        actionBusy || (twoFaMode === 'single' ? !hasSession : bulkSelected.size === 0)
                      }
                    />
                  </label>
                </form>

                <aside className="security-2fa-guide security-2fa-guide--row" aria-label="Hướng dẫn 2FA">
                  <p className="security-guide-kicker">Hướng dẫn</p>
                  <ol className="security-guide-steps security-guide-steps--row">
                    <li>
                      <span className="security-guide-step-num">1</span>
                      <span className="security-guide-step-text">
                        {twoFaMode === 'single'
                          ? 'Chọn acc ở sidebar'
                          : 'Chọn nhiều acc ở sidebar'}
                      </span>
                    </li>
                    <li>
                      <span className="security-guide-step-num">2</span>
                      <span className="security-guide-step-text">
                        Nhập mật khẩu mới
                        {twoFaMode === 'bulk' ? ' (chung)' : ''} — bỏ trống mật khẩu cũ nếu chưa bật
                      </span>
                    </li>
                    <li>
                      <span className="security-guide-step-num">3</span>
                      <span className="security-guide-step-text">
                        {twoFaMode === 'bulk'
                          ? 'Cập nhật — chạy lần lượt từng acc'
                          : 'Cập nhật — áp dụng ngay trên Telegram'}
                      </span>
                    </li>
                  </ol>
                </aside>

              {twoFaMode === 'bulk' && bulk2faRows.length > 0 ? (
                <div className="security-bulk-progress security-bulk-progress--2fa">
                  <div className="security-bulk-progress-head">
                    <span>Tiến trình</span>
                    <span className="security-bulk-progress-pct">{bulk2faProgress.pct}%</span>
                  </div>
                  <div className="security-bulk-progress-bar">
                    <span
                      className="security-bulk-progress-fill"
                      style={{ width: `${bulk2faProgress.pct}%` }}
                    />
                  </div>
                  <div className="table-wrap">
                    <table className="data-table security-bulk-progress-table">
                      <thead>
                        <tr>
                          <th>Acc</th>
                          <th>Trạng thái</th>
                          <th>Thông báo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bulk2faRows.map((row) => (
                          <tr
                            key={row.phone}
                            className={`security-bulk-progress-row security-bulk-progress-row--${row.status}`}
                          >
                            <td>
                              <span className="phone">{row.phone}</span>
                            </td>
                            <td>
                              <span className={`security-bulk-status security-bulk-status--${row.status}`}>
                                {row.status === 'pending'
                                  ? 'Chờ'
                                  : row.status === 'running'
                                    ? 'Đang chạy'
                                    : row.status === 'success'
                                      ? 'OK'
                                      : row.status === 'skipped'
                                        ? 'Bỏ qua'
                                        : 'Lỗi'}
                              </span>
                            </td>
                            <td>
                              <span className="security-bulk-message muted">{row.message || '—'}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
              </div>

              <div className="security-card-foot">
                <div className="security-form-actions">
                  {twoFaMode === 'bulk' && bulk2faRunning ? (
                    <button
                      type="button"
                      className="btn btn--danger"
                      onClick={stopBulk2fa}
                    >
                      Dừng
                    </button>
                  ) : null}
                  <button
                    type="submit"
                    form="security-2fa-form"
                    className="btn btn--primary security-submit-btn"
                    disabled={
                      loading2fa ||
                      bulk2faRunning ||
                      !newPassword.trim() ||
                      (twoFaMode === 'single' ? !hasSession : bulkSelected.size === 0)
                    }
                  >
                    {bulk2faRunning
                      ? `Đang chạy ${bulk2faProgress.finished}/${bulkSelected.size}…`
                      : loading2fa
                        ? 'Đang cập nhật…'
                        : twoFaMode === 'single'
                          ? 'Cập nhật 2FA'
                          : `Cập nhật ${bulkSelected.size} acc`}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="security-blocks-divider" role="presentation" />

          <div className="security-block security-block--privacy">
            <div className="security-card-head security-card-head--split security-card-head--privacy">
              <div className="security-card-head-main">
                <h2>Privacy — mời group</h2>
                <p className="panel-meta">
                  {privacyMode === 'bulk'
                    ? `${bulkSelected.size} acc · cùng quy tắc mời`
                    : hasSession
                      ? 'Ai được mời bạn vào nhóm'
                      : 'Chọn acc ở sidebar'}
                </p>
              </div>
              <div className="security-card-head-aside">
                <div className="security-privacy-mode" role="tablist" aria-label="Chế độ Privacy">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={privacyMode === 'single'}
                    className={`security-privacy-mode-btn${privacyMode === 'single' ? ' security-privacy-mode-btn--active' : ''}`}
                    onClick={() => setPrivacyMode('single')}
                    disabled={actionBusy}
                  >
                    Một acc
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={privacyMode === 'bulk'}
                    className={`security-privacy-mode-btn${privacyMode === 'bulk' ? ' security-privacy-mode-btn--active' : ''}`}
                    onClick={() => setPrivacyMode('bulk')}
                    disabled={actionBusy}
                  >
                    Nhiều acc
                    {bulkSelected.size > 0 ? (
                      <span className="security-privacy-mode-count">{bulkSelected.size}</span>
                    ) : null}
                  </button>
                </div>
                <span className="security-card-badge security-card-badge--privacy">
                  Privacy
                </span>
              </div>
            </div>

            <div className="security-card-body">
              <div className="security-card-scroll privacy-card-scroll">
                <Alert type="error" message={errorPrivacy} />
                <Alert type="success" message={successPrivacy} />

                <div className="security-action-context security-action-context--privacy">
                  <span className="security-action-context-label">
                    {privacyMode === 'single' ? 'Áp dụng cho' : 'Bulk'}
                  </span>
                  <span className="security-action-context-value">
                    {privacyMode === 'single'
                      ? hasSession
                        ? accounts.getPickerLabel(phone)
                        : 'Chọn acc ở sidebar'
                      : bulkSelected.size > 0
                        ? `${bulkSelected.size} acc · cùng quy tắc`
                        : 'Chọn nhiều acc ở sidebar'}
                  </span>
                </div>

                <form
                  id="security-privacy-form"
                  className="privacy-form"
                  onSubmit={(e) =>
                    void (privacyMode === 'single' ? handleUpdatePrivacy(e) : handleBulkUpdatePrivacy(e))
                  }
                >
                  <p className="security-control-label security-privacy-pick-label">Quy tắc mời group</p>
                  <div className="privacy-rule-grid" role="radiogroup" aria-label="Quy tắc mời group">
                    {PRIVACY_OPTIONS.map((option) => {
                      const active = ruleType === option.id
                      return (
                        <button
                          key={option.id}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          className={`privacy-rule-card${active ? ' privacy-rule-card--active' : ''}`}
                          onClick={() => setRuleType(option.id)}
                          disabled={
                            actionBusy ||
                            (privacyMode === 'single' ? !hasSession : bulkSelected.size === 0)
                          }
                        >
                          <span className="privacy-rule-card-icon" aria-hidden>
                            <PrivacyRuleIcon id={option.id} />
                          </span>
                          <span className="privacy-rule-card-text">
                            <span className="privacy-rule-card-label">{option.label}</span>
                            <span className="privacy-rule-card-desc muted">{option.desc}</span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </form>

                {privacyMode === 'bulk' && bulkPrivacyRows.length > 0 ? (
                  <div className="security-bulk-progress security-bulk-progress--privacy">
                    <div className="security-bulk-progress-head">
                      <span>Tiến trình</span>
                      <span className="security-bulk-progress-pct">{bulkPrivacyProgress.pct}%</span>
                    </div>
                    <div className="security-bulk-progress-bar">
                      <span
                        className="security-bulk-progress-fill"
                        style={{ width: `${bulkPrivacyProgress.pct}%` }}
                      />
                    </div>
                    <div className="table-wrap">
                      <table className="data-table security-bulk-progress-table">
                        <thead>
                          <tr>
                            <th>Acc</th>
                            <th>Trạng thái</th>
                            <th>Thông báo</th>
                          </tr>
                        </thead>
                        <tbody>
                          {bulkPrivacyRows.map((row) => (
                            <tr
                              key={row.phone}
                              className={`security-bulk-progress-row security-bulk-progress-row--${row.status}`}
                            >
                              <td>
                                <span className="phone">{row.phone}</span>
                              </td>
                              <td>
                                <span className={`security-bulk-status security-bulk-status--${row.status}`}>
                                  {row.status === 'pending'
                                    ? 'Chờ'
                                    : row.status === 'running'
                                      ? 'Đang chạy'
                                      : row.status === 'success'
                                        ? 'OK'
                                        : row.status === 'skipped'
                                          ? 'Bỏ qua'
                                          : 'Lỗi'}
                                </span>
                              </td>
                              <td>
                                <span className="security-bulk-message muted">{row.message || '—'}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="security-card-foot">
                <div className="security-form-actions">
                  {privacyMode === 'bulk' && bulkPrivacyRunning ? (
                    <button
                      type="button"
                      className="btn btn--danger"
                      onClick={stopBulkPrivacy}
                    >
                      Dừng
                    </button>
                  ) : null}
                  <button
                    type="submit"
                    form="security-privacy-form"
                    className="btn btn--primary security-submit-btn"
                    disabled={
                      loadingPrivacy ||
                      bulkPrivacyRunning ||
                      (privacyMode === 'single' ? !hasSession : bulkSelected.size === 0)
                    }
                  >
                    {bulkPrivacyRunning
                      ? `Đang chạy ${bulkPrivacyProgress.finished}/${bulkSelected.size}…`
                      : loadingPrivacy
                        ? 'Đang cập nhật…'
                        : privacyMode === 'single'
                          ? 'Cập nhật Privacy'
                          : `Cập nhật ${bulkSelected.size} acc`}
                  </button>
                </div>
              </div>
            </div>
          </div>
          </section>
        </div>
      </div>
    </div>
  )
}
