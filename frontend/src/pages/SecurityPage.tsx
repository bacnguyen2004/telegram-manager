import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import './SecurityPage.css'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { AccountPickerPanel, type AccountPickerFilterState } from '../components/AccountPickerPanel'
import { Alert } from '../components/Alert'
import { PasswordInput } from '../components/PasswordInput'
import { TaskDelayField } from '../components/TaskDelayField'
import { useSessionAccounts } from '../hooks/useSessionAccounts'
import { resolveBulkDelayMs, validateBulkDelay, waitBulkDelay } from '../utils/bulkDelay'
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

function Security2faIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 2.5l7.5 3.75V11c0 4.65-3.2 8.85-7.5 9.5C7.7 19.85 4.5 15.65 4.5 11V6.25L12 2.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M9.5 11.5l2 2 3.5-4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function SecurityPrivacyIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3c4 2.5 7 3 7 3v6c0 5.2-3.2 9.2-7 10-3.8-.8-7-4.8-7-10V6s3-0.5 7-3Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M9.5 12.5h5M12 10v5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

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

type SecuritySection = '2fa' | 'privacy'

type BulkRowStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped'

interface BulkActionRow {
  phone: string
  status: BulkRowStatus
  message: string
}

function bulkStatusLabel(status: BulkRowStatus): string {
  const map: Record<BulkRowStatus, string> = {
    pending: 'Chờ',
    running: 'Đang chạy',
    success: 'OK',
    error: 'Lỗi',
    skipped: 'Bỏ qua',
  }
  return map[status]
}

function bulkProgressStats(rows: BulkActionRow[]) {
  const finished = rows.filter((row) =>
    ['success', 'error', 'skipped'].includes(row.status),
  ).length
  const total = rows.length
  const pct = total > 0 ? Math.round((finished / total) * 100) : 0
  const done = rows.filter((row) => row.status === 'success').length
  const failed = rows.filter((row) => row.status === 'error').length
  const skipped = rows.filter((row) => row.status === 'skipped').length
  return { finished, total, pct, done, failed, skipped }
}

function SecurityProgressPanel({
  rows,
  stats,
  running,
  tone,
  getLabel,
  emptyHint,
}: {
  rows: BulkActionRow[]
  stats: ReturnType<typeof bulkProgressStats>
  running: boolean
  tone: '2fa' | 'privacy'
  getLabel: (phone: string) => string
  emptyHint: string
}) {
  return (
    <section
      className={`panel security-progress-panel security-progress-panel--${tone}${
        rows.length === 0 ? ' security-progress-panel--idle' : ''
      }${running ? ' security-progress-panel--live' : ''}`}
    >
      <div className="security-progress-head">
        <div>
          <h2>Tiến trình</h2>
          <p className="panel-meta">
            {rows.length > 0
              ? `${stats.done} xong · ${stats.failed} lỗi · ${stats.skipped} bỏ qua`
              : emptyHint}
          </p>
        </div>
        {rows.length > 0 ? (
          <span className="security-progress-pct">{stats.pct}%</span>
        ) : null}
      </div>

      {rows.length > 0 ? (
        <div className="security-progress-body">
          <div
            className="security-progress-bar"
            role="progressbar"
            aria-valuenow={stats.pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="security-progress-bar-fill" style={{ width: `${stats.pct}%` }} />
          </div>
          <div className="table-wrap security-table-wrap">
            <table className="data-table security-progress-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Phone</th>
                  <th>Trạng thái</th>
                  <th>Kết quả</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.phone} className={`security-progress-row--${row.status}`}>
                    <td>{index + 1}</td>
                    <td className="mono">{getLabel(row.phone)}</td>
                    <td>
                      <span className={`security-progress-pill security-progress-pill--${row.status}`}>
                        {bulkStatusLabel(row.status)}
                      </span>
                    </td>
                    <td className="security-result-cell">{row.message || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <p className="security-progress-empty">{emptyHint}</p>
      )}
    </section>
  )
}

export function SecurityPage() {
  const [searchParams] = useSearchParams()
  const accounts = useSessionAccounts()
  const [securitySection, setSecuritySection] = useState<SecuritySection>('2fa')
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(() => {
    const fromUrl = searchParams.get('phone')
    return fromUrl ? new Set([fromUrl]) : new Set()
  })
  const [accountFilterState, setAccountFilterState] = useState<AccountPickerFilterState>({
    filteredCount: 0,
    totalCount: 0,
    hasFilters: false,
  })
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [hint, setHint] = useState('')
  const [ruleType, setRuleType] = useState<PrivacyRuleType>('all')

  const [error2fa, setError2fa] = useState('')
  const [success2fa, setSuccess2fa] = useState('')
  const [errorPrivacy, setErrorPrivacy] = useState('')
  const [successPrivacy, setSuccessPrivacy] = useState('')
  const [bulk2faRows, setBulk2faRows] = useState<BulkActionRow[]>([])
  const [bulk2faRunning, setBulk2faRunning] = useState(false)
  const [bulkPrivacyRows, setBulkPrivacyRows] = useState<BulkActionRow[]>([])
  const [bulkPrivacyRunning, setBulkPrivacyRunning] = useState(false)
  const [delaySeconds, setDelaySeconds] = useState(5)
  const [delayMinSeconds, setDelayMinSeconds] = useState(3)
  const [delayMaxSeconds, setDelayMaxSeconds] = useState(8)
  const [useRandomDelay, setUseRandomDelay] = useState(false)
  const bulk2faAbortRef = useRef(false)
  const bulkPrivacyAbortRef = useRef(false)

  const bulkSelectedList = useMemo(() => [...bulkSelected], [bulkSelected])
  const selectedCount = bulkSelected.size
  const isMultiAcc = selectedCount > 1
  const hasSelection = selectedCount > 0
  const singlePhone = selectedCount === 1 ? bulkSelectedList[0] : ''
  const anyBulkRunning = bulk2faRunning || bulkPrivacyRunning
  const actionBusy = anyBulkRunning

  const accountPickerMeta = useMemo(() => {
    const { filteredCount, totalCount, hasFilters } = accountFilterState
    if (selectedCount === 1) {
      return accounts.getPickerLabel(singlePhone)
    }
    if (selectedCount > 1) {
      if (hasFilters) {
        return `${selectedCount} chọn · ${filteredCount}/${totalCount} hiển thị`
      }
      return `${selectedCount} / ${totalCount} đã chọn`
    }
    if (hasFilters) return `${filteredCount}/${totalCount} hiển thị`
    return 'Chọn 1 hoặc nhiều tài khoản'
  }, [accountFilterState, selectedCount, singlePhone, accounts])

  function selectionSummary(): string {
    if (selectedCount === 0) return 'Chọn acc ở sidebar'
    if (selectedCount === 1) return accounts.getPickerLabel(singlePhone)
    return `${selectedCount} acc đã chọn`
  }

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

  const bulkDelayOptions = useMemo(
    () => ({
      useRandomDelay,
      delaySeconds,
      delayMinSeconds,
      delayMaxSeconds,
    }),
    [useRandomDelay, delaySeconds, delayMinSeconds, delayMaxSeconds],
  )

  async function handleBulkUpdate2fa(e: React.FormEvent) {
    e.preventDefault()
    const phones = bulkSelectedList
    if (phones.length === 0 || !newPassword.trim()) return

    if (phones.length > 1) {
      const delayError = validateBulkDelay(bulkDelayOptions)
      if (delayError) {
        setError2fa(delayError)
        return
      }
    }

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

      if (i < phones.length - 1 && !bulk2faAbortRef.current) {
        await waitBulkDelay(resolveBulkDelayMs(bulkDelayOptions))
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

  async function handleBulkUpdatePrivacy(e: React.FormEvent) {
    e.preventDefault()
    const phones = bulkSelectedList
    if (phones.length === 0) return

    if (phones.length > 1) {
      const delayError = validateBulkDelay(bulkDelayOptions)
      if (delayError) {
        setErrorPrivacy(delayError)
        return
      }
    }

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

      if (i < phones.length - 1 && !bulkPrivacyAbortRef.current) {
        await waitBulkDelay(resolveBulkDelayMs(bulkDelayOptions))
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

  const bulk2faProgress = bulkProgressStats(bulk2faRows)
  const bulkPrivacyProgress = bulkProgressStats(bulkPrivacyRows)

  const activeBulkRows = securitySection === '2fa' ? bulk2faRows : bulkPrivacyRows
  const activeBulkProgress =
    securitySection === '2fa' ? bulk2faProgress : bulkPrivacyProgress
  const activeBulkRunning = securitySection === '2fa' ? bulk2faRunning : bulkPrivacyRunning

  const delaySummary = useRandomDelay
    ? `${delayMinSeconds}–${delayMaxSeconds}s`
    : `${delaySeconds}s`

  const progressEmptyHint =
    securitySection === '2fa'
      ? 'Chọn acc, nhập mật khẩu mới và bấm Cập nhật để xem log từng tài khoản'
      : 'Chọn acc, chọn quy tắc và bấm Cập nhật để xem log từng tài khoản'

  return (
    <div className="page page--security">
      <div className="security-workspace">
        <div className="security-workspace-top">
        <AccountPickerPanel
          className="security-session-panel"
          title="Tài khoản"
          meta={accountPickerMeta}
          badgeCount={selectedCount}
          sessions={accounts.sessions}
          loading={accounts.loading}
          getMeta={accounts.getMeta}
          selectionMode="multiple"
          selectedPhones={bulkSelected}
          onSelectedPhonesChange={setBulkSelected}
          disabled={anyBulkRunning}
          busy={anyBulkRunning}
          footerSelectedSuffix="acc đã chọn"
          showSelectionToolbar
          onFiltersChange={setAccountFilterState}
          panelFoot={
            <>
              Session lỗi → kiểm tra tại <Link to="/sessions">Sessions</Link>.
            </>
          }
        />

        <div className="security-main">
          <section
            className={`panel security-composer security-composer--${securitySection}`}
          >
            <div className="security-section-tabs" role="tablist" aria-label="Loại thao tác">
              <button
                type="button"
                role="tab"
                aria-selected={securitySection === '2fa'}
                className={`security-section-tab security-section-tab--2fa${
                  securitySection === '2fa' ? ' security-section-tab--active' : ''
                }`}
                disabled={actionBusy}
                onClick={() => setSecuritySection('2fa')}
              >
                <Security2faIcon />
                <span>2FA</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={securitySection === 'privacy'}
                className={`security-section-tab security-section-tab--privacy${
                  securitySection === 'privacy' ? ' security-section-tab--active' : ''
                }`}
                disabled={actionBusy}
                onClick={() => setSecuritySection('privacy')}
              >
                <SecurityPrivacyIcon />
                <span>Privacy</span>
              </button>
            </div>

          {securitySection === '2fa' ? (
          <div className="security-pane security-pane--2fa">
            <header className="security-pane__hero">
              <div className="security-pane__hero-icon security-pane__hero-icon--2fa">
                <Security2faIcon />
              </div>
              <div className="security-pane__hero-text">
                <h2>Đổi / bật 2FA</h2>
                <p className="muted">Mật khẩu xác thực hai lớp trên Telegram</p>
              </div>
              <span
                className={`security-pane__chip security-pane__chip--2fa${
                  hasSelection ? '' : ' security-pane__chip--empty'
                }`}
              >
                {hasSelection ? `${selectedCount} acc` : 'Chưa chọn'}
              </span>
            </header>

            <div className="security-pane__body">
              <Alert type="error" message={error2fa} />
              <Alert type="success" message={success2fa} />

              <section className="security-pane__section">
                <div className="security-target-card security-target-card--2fa">
                  <span className="security-target-card__label">Áp dụng cho</span>
                  <span className="security-target-card__value">{selectionSummary()}</span>
                </div>
              </section>

              <section className="security-pane__section security-pane__section--fields">
                <h3 className="security-pane__section-title">Mật khẩu</h3>
                <form
                  id="security-2fa-form"
                  className="security-form security-form--2fa"
                  onSubmit={(e) => void handleBulkUpdate2fa(e)}
                >
                  <div className="security-field-stack">
                    <PasswordInput
                      label="Mật khẩu hiện tại"
                      value={currentPassword}
                      onChange={setCurrentPassword}
                      placeholder="Bỏ trống nếu chưa bật"
                      autoComplete="current-password"
                      disabled={actionBusy || !hasSelection}
                    />
                    <PasswordInput
                      label="Mật khẩu mới"
                      value={newPassword}
                      onChange={setNewPassword}
                      placeholder={isMultiAcc ? 'Dùng chung cho tất cả acc' : 'Nhập mật khẩu mới'}
                      required
                      autoComplete="new-password"
                      disabled={actionBusy || !hasSelection}
                    />
                    <label className="field security-hint-field">
                      <span>Gợi ý khi quên (tuỳ chọn)</span>
                      <input
                        type="text"
                        value={hint}
                        onChange={(e) => setHint(e.target.value)}
                        placeholder="Ví dụ: tên thú cưng, ngày sinh…"
                        disabled={actionBusy || !hasSelection}
                      />
                    </label>
                  </div>
                </form>
              </section>

              {isMultiAcc ? (
                <section className="security-pane__section security-pane__section--delay">
                  <TaskDelayField
                    useRandomDelay={useRandomDelay}
                    onUseRandomDelayChange={setUseRandomDelay}
                    delaySeconds={delaySeconds}
                    onDelaySecondsChange={setDelaySeconds}
                    delayMinSeconds={delayMinSeconds}
                    onDelayMinSecondsChange={setDelayMinSeconds}
                    delayMaxSeconds={delayMaxSeconds}
                    onDelayMaxSecondsChange={setDelayMaxSeconds}
                    disabled={actionBusy}
                  />
                </section>
              ) : (
                <p className="security-callout security-callout--2fa">
                  Bỏ trống mật khẩu cũ nếu acc chưa bật 2FA.
                </p>
              )}
            </div>

            <footer className="security-pane__foot security-pane__foot--2fa">
              <div className="security-pane__foot-summary">
                <span className="security-pane__foot-title">
                  {isMultiAcc
                    ? `${selectedCount} acc · delay ${delaySummary}`
                    : selectionSummary()}
                </span>
                <span className="security-pane__foot-meta muted">
                  {bulk2faRunning
                    ? `Đang chạy ${bulk2faProgress.finished}/${bulk2faProgress.total}`
                    : hasSelection
                      ? 'Cuộn xuống xem tiến trình'
                      : 'Chọn acc ở sidebar'}
                </span>
              </div>
              {bulk2faRows.length > 0 ? (
                <div
                  className="security-pane__ring security-pane__ring--2fa"
                  style={{ '--ring-pct': bulk2faProgress.pct } as CSSProperties}
                  aria-hidden
                >
                  <span>{bulk2faProgress.pct}%</span>
                </div>
              ) : null}
              <div className="security-pane__foot-actions">
                {bulk2faRunning ? (
                  <button type="button" className="btn btn--danger" onClick={stopBulk2fa}>
                    Dừng
                  </button>
                ) : null}
                <button
                  type="submit"
                  form="security-2fa-form"
                  className="btn security-pane__submit security-pane__submit--2fa"
                  disabled={bulk2faRunning || !newPassword.trim() || !hasSelection}
                >
                  {bulk2faRunning
                    ? `Đang chạy ${bulk2faProgress.finished}/${selectedCount}…`
                    : isMultiAcc
                      ? `Cập nhật ${selectedCount} acc`
                      : 'Cập nhật 2FA'}
                </button>
              </div>
            </footer>
          </div>
          ) : (
          <div className="security-pane security-pane--privacy">
            <header className="security-pane__hero">
              <div className="security-pane__hero-icon security-pane__hero-icon--privacy">
                <SecurityPrivacyIcon />
              </div>
              <div className="security-pane__hero-text">
                <h2>Mời vào group</h2>
                <p className="muted">
                  {isMultiAcc
                    ? `${selectedCount} acc · cùng quy tắc`
                    : 'Ai được phép mời bạn tham gia nhóm'}
                </p>
              </div>
              <span
                className={`security-pane__chip security-pane__chip--privacy${
                  hasSelection ? '' : ' security-pane__chip--empty'
                }`}
              >
                {hasSelection ? `${selectedCount} acc` : 'Chưa chọn'}
              </span>
            </header>

            <div className="security-pane__body">
              <Alert type="error" message={errorPrivacy} />
              <Alert type="success" message={successPrivacy} />

              <section className="security-pane__section">
                <div className="security-target-card security-target-card--privacy">
                  <span className="security-target-card__label">Áp dụng cho</span>
                  <span className="security-target-card__value">
                    {selectedCount > 1
                      ? `${selectedCount} acc · cùng quy tắc`
                      : selectionSummary()}
                  </span>
                </div>
              </section>

              <section className="security-pane__section security-pane__section--rules">
                <h3 className="security-pane__section-title">Quy tắc mời group</h3>
                <form
                  id="security-privacy-form"
                  className="privacy-form"
                  onSubmit={(e) => void handleBulkUpdatePrivacy(e)}
                >
                  <div className="privacy-rule-list" role="radiogroup" aria-label="Quy tắc mời group">
                    {PRIVACY_OPTIONS.map((option) => {
                      const active = ruleType === option.id
                      return (
                        <button
                          key={option.id}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          className={`privacy-rule-option${active ? ' privacy-rule-option--active' : ''}`}
                          onClick={() => setRuleType(option.id)}
                          disabled={actionBusy || !hasSelection}
                        >
                          <span className="privacy-rule-option__icon" aria-hidden>
                            <PrivacyRuleIcon id={option.id} />
                          </span>
                          <span className="privacy-rule-option__content">
                            <span className="privacy-rule-option__label">{option.label}</span>
                            <span className="privacy-rule-option__desc muted">{option.desc}</span>
                          </span>
                          <span
                            className={`privacy-rule-option__check${active ? ' privacy-rule-option__check--on' : ''}`}
                            aria-hidden
                          />
                        </button>
                      )
                    })}
                  </div>
                </form>
                <p className="security-callout security-callout--privacy">
                  {PRIVACY_OPTIONS.find((o) => o.id === ruleType)?.hint}
                </p>
              </section>

              {isMultiAcc ? (
                <section className="security-pane__section security-pane__section--delay">
                  <TaskDelayField
                    useRandomDelay={useRandomDelay}
                    onUseRandomDelayChange={setUseRandomDelay}
                    delaySeconds={delaySeconds}
                    onDelaySecondsChange={setDelaySeconds}
                    delayMinSeconds={delayMinSeconds}
                    onDelayMinSecondsChange={setDelayMinSeconds}
                    delayMaxSeconds={delayMaxSeconds}
                    onDelayMaxSecondsChange={setDelayMaxSeconds}
                    disabled={actionBusy}
                  />
                </section>
              ) : null}
            </div>

            <footer className="security-pane__foot security-pane__foot--privacy">
              <div className="security-pane__foot-summary">
                <span className="security-pane__foot-title">
                  {isMultiAcc
                    ? `${selectedCount} acc · ${PRIVACY_OPTIONS.find((o) => o.id === ruleType)?.label}`
                    : selectionSummary()}
                </span>
                <span className="security-pane__foot-meta muted">
                  {bulkPrivacyRunning
                    ? `Đang chạy ${bulkPrivacyProgress.finished}/${bulkPrivacyProgress.total}${isMultiAcc ? ` · ${delaySummary}` : ''}`
                    : hasSelection
                      ? 'Cuộn xuống xem tiến trình'
                      : PRIVACY_OPTIONS.find((o) => o.id === ruleType)?.label ?? 'Chọn quy tắc'}
                </span>
              </div>
              {bulkPrivacyRows.length > 0 ? (
                <div
                  className="security-pane__ring security-pane__ring--privacy"
                  style={{ '--ring-pct': bulkPrivacyProgress.pct } as CSSProperties}
                  aria-hidden
                >
                  <span>{bulkPrivacyProgress.pct}%</span>
                </div>
              ) : null}
              <div className="security-pane__foot-actions">
                {bulkPrivacyRunning ? (
                  <button type="button" className="btn btn--danger" onClick={stopBulkPrivacy}>
                    Dừng
                  </button>
                ) : null}
                <button
                  type="submit"
                  form="security-privacy-form"
                  className="btn security-pane__submit security-pane__submit--privacy"
                  disabled={bulkPrivacyRunning || !hasSelection}
                >
                  {bulkPrivacyRunning
                    ? `Đang chạy ${bulkPrivacyProgress.finished}/${selectedCount}…`
                    : isMultiAcc
                      ? `Cập nhật ${selectedCount} acc`
                      : 'Cập nhật Privacy'}
                </button>
              </div>
            </footer>
          </div>
          )}
          </section>
        </div>
        </div>
      </div>

      <SecurityProgressPanel
        rows={activeBulkRows}
        stats={activeBulkProgress}
        running={activeBulkRunning}
        tone={securitySection}
        getLabel={accounts.getPickerLabel}
        emptyHint={progressEmptyHint}
      />
    </div>
  )
}
