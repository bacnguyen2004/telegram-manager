import { useMemo, useRef, useState } from 'react'
import './AutoProfilePage.css'
import { api } from '../api/client'
import {
  AccountPickerPanel,
  type AccountPickerFilterState,
} from '../components/AccountPickerPanel'
import { Alert } from '../components/Alert'
import { TaskDelayField } from '../components/TaskDelayField'
import { useSessionAccounts } from '../hooks/useSessionAccounts'
import type {
  AutoProfileAvatarMode,
  AutoProfileRegion,
  AutoProfileRow,
} from '../types/api'
import { resolveBulkDelayMs, validateBulkDelay } from '../utils/bulkDelay'

type RowStatus = 'pending' | 'running' | 'success' | 'error' | 'cancelled'

type PreviewRow = AutoProfileRow & {
  status: RowStatus
  message: string
}

const REGION_OPTIONS: { value: AutoProfileRegion; label: string }[] = [
  { value: 'global', label: 'Global' },
  { value: 'vietnam', label: 'Vietnam' },
  { value: 'mix', label: 'Mix' },
]

function statusLabel(status: RowStatus): string {
  const map: Record<RowStatus, string> = {
    pending: 'Chờ',
    running: 'Đang chạy',
    success: 'Xong',
    error: 'Lỗi',
    cancelled: 'Đã dừng',
  }
  return map[status]
}

function avatarModeLabel(mode: AutoProfileAvatarMode): string {
  if (mode === 'delete') return 'Xóa avatar'
  if (mode === 'url') return 'Đổi avatar'
  return 'Giữ avatar'
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Cancelled', 'AbortError'))
      return
    }
    const timer = window.setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer)
        reject(new DOMException('Cancelled', 'AbortError'))
      },
      { once: true },
    )
  })
}

export function AutoProfilePage() {
  const { sessions, loading, getMeta, reload } = useSessionAccounts()
  const [selectedPhones, setSelectedPhones] = useState<Set<string>>(new Set())
  const [filterState, setFilterState] = useState<AccountPickerFilterState>({
    filteredCount: 0,
    totalCount: 0,
    hasFilters: false,
  })

  const [region, setRegion] = useState<AutoProfileRegion>('global')
  const [deleteOldAvatar, setDeleteOldAvatar] = useState(false)
  const [delaySeconds, setDelaySeconds] = useState(4)
  const [useRandomDelay, setUseRandomDelay] = useState(false)
  const [delayMinSeconds, setDelayMinSeconds] = useState(3)
  const [delayMaxSeconds, setDelayMaxSeconds] = useState(8)

  const [rows, setRows] = useState<PreviewRow[]>([])
  const [previewLoading, setPreviewLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  const stats = useMemo(() => {
    const counts = { pending: 0, running: 0, success: 0, error: 0, cancelled: 0 }
    for (const row of rows) counts[row.status] += 1
    return counts
  }, [rows])

  function updateRow(phone: string, patch: Partial<PreviewRow>) {
    setRows((prev) =>
      prev.map((row) => (row.phone === phone ? { ...row, ...patch } : row)),
    )
  }

  async function handlePreview() {
    setError('')
    setInfo('')
    const phones = Array.from(selectedPhones)
    if (!phones.length) {
      setError('Chọn ít nhất một tài khoản')
      return
    }
    setPreviewLoading(true)
    try {
      const res = await api.previewAutoProfiles({
        phones,
        region,
        delete_old_avatar: deleteOldAvatar,
      })
      if (!res.success || !res.data) {
        setError(res.error || 'Tạo preview thất bại')
        return
      }
      setRows(
        res.data.items.map((item) => ({
          ...item,
          status: 'pending',
          message: '',
        })),
      )
      setInfo(
        `Đã tạo preview cho ${res.data.total} tài khoản — chỉnh tay rồi bấm Áp dụng`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Tạo preview thất bại')
    } finally {
      setPreviewLoading(false)
    }
  }

  function handleStop() {
    abortRef.current?.abort()
  }

  async function handleApply() {
    setError('')
    setInfo('')
    if (!rows.length) {
      setError('Chưa có preview — bấm Tạo preview trước')
      return
    }
    const delayError = validateBulkDelay({
      useRandomDelay,
      delaySeconds,
      delayMinSeconds,
      delayMaxSeconds,
    })
    if (delayError) {
      setError(delayError)
      return
    }

    const controller = new AbortController()
    abortRef.current = controller
    setApplying(true)

    const queue = rows.map((row) => ({
      ...row,
      status: (row.status === 'success' ? 'success' : 'pending') as RowStatus,
      message: row.status === 'success' ? row.message : '',
    }))
    setRows(queue)

    let successCount = 0
    let errorCount = 0

    try {
      for (let i = 0; i < queue.length; i += 1) {
        if (controller.signal.aborted) break
        const snapshot = queue[i]
        if (snapshot.status === 'success') {
          successCount += 1
          continue
        }

        updateRow(snapshot.phone, { status: 'running', message: 'Đang cập nhật…' })
        try {
          const res = await api.applyAutoProfile({
            phone: snapshot.phone,
            first_name: snapshot.first_name.trim(),
            last_name: snapshot.last_name.trim(),
            username: snapshot.username.trim().replace(/^@/, ''),
            about: snapshot.about.trim(),
            avatar_mode: snapshot.avatar_mode,
            avatar_url: snapshot.avatar_url.trim(),
            region: snapshot.region,
            avatar_label: snapshot.avatar_label,
          })
          if (controller.signal.aborted) {
            updateRow(snapshot.phone, { status: 'cancelled', message: 'Đã dừng' })
            break
          }
          if (!res.success || !res.data) {
            errorCount += 1
            updateRow(snapshot.phone, {
              status: 'error',
              message: res.error || 'Áp dụng thất bại',
            })
          } else if (res.data.status !== 'success') {
            errorCount += 1
            updateRow(snapshot.phone, {
              status: 'error',
              message: res.data.message || 'Áp dụng thất bại',
            })
          } else {
            successCount += 1
            const appliedUser = res.data.applied_username
            updateRow(snapshot.phone, {
              status: 'success',
              message: res.data.message || 'OK',
              username: appliedUser || snapshot.username,
            })
          }
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            updateRow(snapshot.phone, { status: 'cancelled', message: 'Đã dừng' })
            break
          }
          errorCount += 1
          updateRow(snapshot.phone, {
            status: 'error',
            message: err instanceof Error ? err.message : 'Lỗi không xác định',
          })
        }

        if (i < queue.length - 1 && !controller.signal.aborted) {
          const ms = resolveBulkDelayMs({
            useRandomDelay,
            delaySeconds,
            delayMinSeconds,
            delayMaxSeconds,
          })
          try {
            await sleep(ms, controller.signal)
          } catch {
            break
          }
        }
      }

      if (controller.signal.aborted) {
        setRows((prev) =>
          prev.map((row) =>
            row.status === 'pending' || row.status === 'running'
              ? { ...row, status: 'cancelled', message: row.message || 'Đã dừng' }
              : row,
          ),
        )
        setInfo('Đã dừng giữa chừng')
      } else {
        setInfo(`Hoàn tất: ${successCount} thành công, ${errorCount} lỗi`)
        void reload()
      }
    } finally {
      setApplying(false)
      abortRef.current = null
    }
  }

  return (
    <div className="page--auto-profile">
      <header className="ap-head">
        <div className="ap-head-intro">
          <div className="ap-head-title-row">
            <div className="ap-head-icon" aria-hidden>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.8" />
                <path
                  d="M5 19c1.5-3.5 4-5 7-5s5.5 1.5 7 5"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <div>
              <h1>Auto hồ sơ</h1>
              <p>
                Random tên, username, bio và avatar — xem preview, chỉnh tay, áp dụng có delay.
              </p>
            </div>
          </div>
        </div>
        <div className="ap-head-pills">
          <span className="ap-pill ap-pill--accent">{selectedPhones.size} đã chọn</span>
          {rows.length > 0 ? <span className="ap-pill">{rows.length} preview</span> : null}
          {stats.success > 0 ? (
            <span className="ap-pill ap-pill--ok">{stats.success} xong</span>
          ) : null}
          {stats.error > 0 ? (
            <span className="ap-pill ap-pill--err">{stats.error} lỗi</span>
          ) : null}
        </div>
      </header>

      <div className="ap-alerts">
        <Alert type="error" message={error} onDismiss={() => setError('')} />
        <Alert type="info" message={info} onDismiss={() => setInfo('')} />
      </div>

      <div className="ap-workspace">
        <AccountPickerPanel
          className="ap-session-panel"
          title="Tài khoản"
          meta={
            filterState.hasFilters
              ? `${filterState.filteredCount}/${filterState.totalCount}`
              : undefined
          }
          badgeCount={selectedPhones.size}
          sessions={sessions}
          loading={loading}
          getMeta={getMeta}
          selectionMode="multiple"
          selectedPhones={selectedPhones}
          onSelectedPhonesChange={setSelectedPhones}
          onFiltersChange={setFilterState}
          disabled={applying}
        />

        <div className="ap-main">
          <section className="ap-card ap-card--setup">
            <div className="ap-card-head">
              <div>
                <h2>Thiết lập</h2>
                <p className="hint">Chọn vùng tên, delay giữa các acc, rồi tạo preview</p>
              </div>
            </div>
            <div className="ap-card-body">
              <div className="ap-setup-grid">
                <div className="ap-field">
                  <span className="ap-field-label">Vùng tên</span>
                  <div className="ap-segment" role="radiogroup" aria-label="Vùng tên">
                    {REGION_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        role="radio"
                        aria-checked={region === opt.value}
                        className={`ap-segment-btn${region === opt.value ? ' is-active' : ''}`}
                        disabled={applying}
                        onClick={() => setRegion(opt.value)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="ap-setup-side">
                  <label className="ap-check">
                    <input
                      type="checkbox"
                      checked={deleteOldAvatar}
                      onChange={(e) => setDeleteOldAvatar(e.target.checked)}
                      disabled={applying}
                    />
                    <span className="ap-check-text">
                      <strong>Xóa avatar khi random “giữ nguyên”</strong>
                      <span>
                        Chỉ ảnh hưởng preview mode keep → chuyển thành xóa avatar cũ trên Telegram
                      </span>
                    </span>
                  </label>

                  <div className="ap-delay-wrap">
                    <TaskDelayField
                      delaySeconds={delaySeconds}
                      onDelaySecondsChange={setDelaySeconds}
                      useRandomDelay={useRandomDelay}
                      onUseRandomDelayChange={setUseRandomDelay}
                      delayMinSeconds={delayMinSeconds}
                      onDelayMinSecondsChange={setDelayMinSeconds}
                      delayMaxSeconds={delayMaxSeconds}
                      onDelayMaxSecondsChange={setDelayMaxSeconds}
                      disabled={applying}
                    />
                  </div>
                </div>
              </div>

              <div className="ap-actions">
                <button
                  type="button"
                  className="ap-btn ap-btn--secondary"
                  onClick={() => void handlePreview()}
                  disabled={previewLoading || applying || selectedPhones.size === 0}
                >
                  {previewLoading ? 'Đang tạo…' : 'Tạo preview'}
                </button>
                <button
                  type="button"
                  className="ap-btn ap-btn--primary"
                  onClick={() => void handleApply()}
                  disabled={applying || rows.length === 0}
                >
                  {applying ? 'Đang áp dụng…' : 'Áp dụng'}
                </button>
                {applying ? (
                  <button type="button" className="ap-btn ap-btn--danger" onClick={handleStop}>
                    Dừng
                  </button>
                ) : null}
              </div>
            </div>
          </section>

          <section className="ap-card ap-card--preview">
            <div className="ap-card-head">
              <div>
                <h2>Preview & tiến độ</h2>
                <p className="hint">Sửa trực tiếp trên từng thẻ trước khi áp dụng</p>
              </div>
            </div>
            <div className="ap-card-body">
              {rows.length > 0 ? (
                <div className="ap-stats">
                  <span className="ap-stat">
                    Tổng <b>{rows.length}</b>
                  </span>
                  <span className="ap-stat">
                    Chờ <b>{stats.pending}</b>
                  </span>
                  <span className="ap-stat ap-stat--run">
                    Chạy <b>{stats.running}</b>
                  </span>
                  <span className="ap-stat ap-stat--ok">
                    Xong <b>{stats.success}</b>
                  </span>
                  <span className="ap-stat ap-stat--err">
                    Lỗi <b>{stats.error}</b>
                  </span>
                  {stats.cancelled > 0 ? (
                    <span className="ap-stat">
                      Dừng <b>{stats.cancelled}</b>
                    </span>
                  ) : null}
                </div>
              ) : null}

              {rows.length === 0 ? (
                <div className="ap-empty">
                  <div className="ap-empty-icon" aria-hidden>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M12 5v14M5 12h14"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                      />
                    </svg>
                  </div>
                  <strong>Chưa có preview</strong>
                  <p>
                    Chọn tài khoản bên trái → chọn vùng tên → bấm <b>Tạo preview</b> để xem tên,
                    username, bio và avatar.
                  </p>
                </div>
              ) : (
                <div className="ap-list">
                  {rows.map((row) => (
                    <article
                      key={row.phone}
                      className={`ap-row is-${row.status}`}
                      aria-label={`Preview ${row.phone}`}
                    >
                      <div className="ap-row-avatar">
                        {row.avatar_mode === 'url' && row.avatar_url ? (
                          <img
                            src={row.avatar_url}
                            alt={row.avatar_label || 'avatar'}
                            loading="lazy"
                          />
                        ) : (
                          <span className="ap-row-avatar-fallback">
                            {row.avatar_mode === 'delete' ? 'Xóa' : 'Giữ'}
                          </span>
                        )}
                      </div>

                      <div className="ap-row-meta">
                        <div className="ap-phone">{row.phone}</div>
                        <div className="ap-row-tags">
                          <span className="ap-tag">{row.region}</span>
                          <span className="ap-tag">
                            {row.avatar_label || avatarModeLabel(row.avatar_mode)}
                          </span>
                        </div>
                        <select
                          className="ap-select"
                          value={row.avatar_mode}
                          disabled={applying}
                          aria-label={`Avatar mode ${row.phone}`}
                          onChange={(e) =>
                            updateRow(row.phone, {
                              avatar_mode: e.target.value as AutoProfileAvatarMode,
                            })
                          }
                        >
                          <option value="keep">Giữ avatar</option>
                          <option value="delete">Xóa avatar</option>
                          <option value="url">Dùng URL</option>
                        </select>
                      </div>

                      <div className="ap-fields">
                        <input
                          className="ap-input"
                          value={row.first_name}
                          disabled={applying}
                          placeholder="Tên"
                          aria-label={`Tên ${row.phone}`}
                          onChange={(e) =>
                            updateRow(row.phone, { first_name: e.target.value })
                          }
                        />
                        <input
                          className="ap-input"
                          value={row.last_name}
                          disabled={applying}
                          placeholder="Họ"
                          aria-label={`Họ ${row.phone}`}
                          onChange={(e) =>
                            updateRow(row.phone, { last_name: e.target.value })
                          }
                        />
                        <input
                          className="ap-input"
                          value={row.username}
                          disabled={applying}
                          placeholder="username"
                          aria-label={`Username ${row.phone}`}
                          onChange={(e) =>
                            updateRow(row.phone, { username: e.target.value })
                          }
                        />
                        <input
                          className="ap-input ap-input--full"
                          value={row.about}
                          disabled={applying}
                          placeholder="Bio"
                          aria-label={`Bio ${row.phone}`}
                          onChange={(e) => updateRow(row.phone, { about: e.target.value })}
                        />
                      </div>

                      <div className="ap-row-side">
                        <span className={`ap-status ${row.status}`}>
                          {statusLabel(row.status)}
                        </span>
                        <div className="ap-msg">{row.message}</div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
