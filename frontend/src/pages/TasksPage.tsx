import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/client'
import { Alert } from '../components/Alert'
import type { CheckSessionItem } from '../types/api'
import { DEFAULT_QUICK_REACTIONS } from '../utils/reactions'
import {
  actionLabel,
  isActionAllowed,
  parseTelegramLink,
  type TaskAction,
} from '../utils/telegramLink'
import {
  runTaskQueue,
  type TaskProgressRow,
  type TaskRowStatus,
} from '../utils/taskRunner'

const TASK_ACTIONS: TaskAction[] = ['join', 'react', 'reply', 'send']

function statusLabel(status: TaskRowStatus): string {
  const map: Record<TaskRowStatus, string> = {
    pending: 'Chờ',
    running: 'Đang chạy',
    success: 'Xong',
    error: 'Lỗi',
    skipped: 'Bỏ qua',
    cancelled: 'Đã dừng',
  }
  return map[status]
}

export function TasksPage() {
  const [sessions, setSessions] = useState<string[]>([])
  const [checkResults, setCheckResults] = useState<CheckSessionItem[]>([])
  const [selectedPhones, setSelectedPhones] = useState<Set<string>>(new Set())
  const [targetLink, setTargetLink] = useState('')
  const [action, setAction] = useState<TaskAction>('react')
  const [emoji, setEmoji] = useState<string>(DEFAULT_QUICK_REACTIONS[0])
  const [text, setText] = useState('')
  const [delaySeconds, setDelaySeconds] = useState(5)
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [checking, setChecking] = useState(false)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<TaskProgressRow[]>([])
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  const parsedLink = useMemo(() => parseTelegramLink(targetLink), [targetLink])

  const sessionRows = useMemo(() => {
    const statusMap = new Map(checkResults.map((item) => [item.phone, item]))
    return sessions.map((phone) => ({
      phone,
      check: statusMap.get(phone) ?? null,
    }))
  }, [sessions, checkResults])

  const allowedActions = useMemo(() => {
    if (parsedLink.kind === 'invalid') return TASK_ACTIONS
    return TASK_ACTIONS.filter((item) => isActionAllowed(parsedLink, item))
  }, [parsedLink])

  const selectedList = useMemo(
    () => sessions.filter((phone) => selectedPhones.has(phone)),
    [sessions, selectedPhones],
  )

  const progressStats = useMemo(() => {
    const done = progress.filter((row) => row.status === 'success').length
    const failed = progress.filter((row) => row.status === 'error').length
    const total = progress.length
    return { done, failed, total }
  }, [progress])

  const loadSessions = useCallback(async () => {
    setLoadingSessions(true)
    setError('')
    try {
      const res = await api.listSessions()
      if (!res.success || !res.data) {
        setError(res.error ?? 'Không tải được sessions')
        return
      }
      setSessions(res.data.sessions)
      setSelectedPhones((prev) => {
        const next = new Set<string>()
        for (const phone of res.data!.sessions) {
          if (prev.has(phone)) next.add(phone)
        }
        return next
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không kết nối được API.')
    } finally {
      setLoadingSessions(false)
    }
  }, [])

  useEffect(() => {
    void loadSessions()
  }, [loadSessions])

  useEffect(() => {
    if (!allowedActions.includes(action) && allowedActions.length > 0) {
      setAction(allowedActions[0])
    }
  }, [allowedActions, action])

  function togglePhone(phone: string) {
    setSelectedPhones((prev) => {
      const next = new Set(prev)
      if (next.has(phone)) next.delete(phone)
      else next.add(phone)
      return next
    })
  }

  function selectAll() {
    setSelectedPhones(new Set(sessions))
  }

  function selectActiveOnly() {
    const active = new Set(
      checkResults.filter((item) => item.status === 'active').map((item) => item.phone),
    )
    setSelectedPhones(active)
  }

  function clearSelection() {
    setSelectedPhones(new Set())
  }

  async function handleCheckSessions() {
    setChecking(true)
    setError('')
    try {
      const res = await api.checkSessions()
      if (!res.success || !res.data) {
        setError(res.error ?? 'Kiểm tra session thất bại')
        return
      }
      setCheckResults(res.data.sessions)
      setSuccess(
        `Live: ${res.data.active} · Lỗi: ${res.data.unauthorized + res.data.error}`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không kết nối được API.')
    } finally {
      setChecking(false)
    }
  }

  function validateBeforeRun(): string | null {
    if (selectedList.length === 0) return 'Chọn ít nhất một tài khoản'
    if (parsedLink.kind === 'invalid') return parsedLink.label
    if (!isActionAllowed(parsedLink, action)) {
      return `Link này không hỗ trợ "${actionLabel(action)}"`
    }
    if ((action === 'react' || action === 'reply') && !parsedLink.messageId) {
      return 'Cần link bài post dạng t.me/channel/123'
    }
    if (action === 'react' && !emoji.trim()) return 'Chọn emoji reaction'
    if ((action === 'reply' || action === 'send') && !text.trim()) {
      return 'Nhập nội dung tin nhắn'
    }
    return null
  }

  async function handleRun() {
    const validationError = validateBeforeRun()
    if (validationError) {
      setError(validationError)
      return
    }

    setRunning(true)
    setError('')
    setSuccess('')
    abortRef.current = new AbortController()

    const initialRows: TaskProgressRow[] = selectedList.map((phone) => ({
      phone,
      status: 'pending',
      message: 'Chờ…',
    }))
    setProgress(initialRows)

    try {
      const finalRows = await runTaskQueue({
        phones: selectedList,
        action,
        parsed: parsedLink,
        emoji,
        text: text.trim(),
        delaySeconds,
        signal: abortRef.current.signal,
        onProgress: setProgress,
      })
      const ok = finalRows.filter((row) => row.status === 'success').length
      const fail = finalRows.filter((row) => row.status === 'error').length
      setSuccess(`Hoàn tất: ${ok} thành công, ${fail} lỗi`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chạy task thất bại')
    } finally {
      setRunning(false)
      abortRef.current = null
    }
  }

  function handleStop() {
    abortRef.current?.abort()
  }

  return (
    <div className="page page--tasks">
      <header className="page-header tasks-page-header">
        <div>
          <span className="tasks-page-kicker">Bulk automation</span>
          <h1>Tác vụ hàng loạt</h1>
          <p className="page-desc">
            Chọn nhiều acc, dán link Telegram, chạy lần lượt (join · react · reply ·
            gửi tin). Chỉ gọi API hiện có — không cần backend mới.
          </p>
        </div>
        <div className="tasks-header-actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => void loadSessions()}
            disabled={loadingSessions || running}
          >
            Tải lại acc
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => void handleCheckSessions()}
            disabled={checking || running || sessions.length === 0}
          >
            {checking ? 'Đang check…' : 'Check live'}
          </button>
        </div>
      </header>

      <Alert type="error" message={error} />
      <Alert type="success" message={success} />

      <div className="tasks-layout">
        <section className="panel tasks-accounts-panel">
          <div className="panel-head">
            <h2>Tài khoản</h2>
            <p className="panel-meta">
              {selectedList.length}/{sessions.length} đã chọn
            </p>
          </div>

          <div className="tasks-account-toolbar">
            <button type="button" className="btn btn--sm btn--ghost" onClick={selectAll}>
              Chọn tất cả
            </button>
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              onClick={selectActiveOnly}
              disabled={checkResults.length === 0}
            >
              Chỉ acc live
            </button>
            <button type="button" className="btn btn--sm btn--ghost" onClick={clearSelection}>
              Bỏ chọn
            </button>
          </div>

          <ul className="tasks-account-list">
            {loadingSessions ? (
              <li className="tasks-account-empty">Đang tải sessions…</li>
            ) : sessions.length === 0 ? (
              <li className="tasks-account-empty">
                Chưa có session — đăng nhập ở trang Tài khoản.
              </li>
            ) : (
              sessionRows.map(({ phone, check }) => (
                <li key={phone}>
                  <label className="tasks-account-item">
                    <input
                      type="checkbox"
                      checked={selectedPhones.has(phone)}
                      onChange={() => togglePhone(phone)}
                      disabled={running}
                    />
                    <span className="tasks-account-phone">{phone}</span>
                    {check ? (
                      <span
                        className={`tasks-account-status tasks-account-status--${check.status}`}
                      >
                        {check.status}
                        {check.username ? ` · @${check.username}` : ''}
                      </span>
                    ) : (
                      <span className="tasks-account-status">chưa check</span>
                    )}
                  </label>
                </li>
              ))
            )}
          </ul>
        </section>

        <section className="panel tasks-config-panel">
          <div className="panel-head">
            <h2>Cấu hình tác vụ</h2>
          </div>

          <label className="field">
            <span>Link mục tiêu</span>
            <input
              type="url"
              placeholder="https://t.me/channel/123 hoặc https://t.me/+invite"
              value={targetLink}
              onChange={(e) => setTargetLink(e.target.value)}
              disabled={running}
            />
          </label>

          <div
            className={`tasks-link-preview${
              parsedLink.kind === 'invalid' ? ' tasks-link-preview--invalid' : ''
            }`}
          >
            <p className="tasks-link-preview-label">Phân tích link</p>
            <p>{parsedLink.label}</p>
            {parsedLink.kind !== 'invalid' ? (
              <p className="tasks-link-preview-meta">
                Hỗ trợ:{' '}
                {parsedLink.supportedActions.map((item) => actionLabel(item)).join(' · ')}
              </p>
            ) : null}
          </div>

          <label className="field">
            <span>Loại tác vụ</span>
            <select
              value={action}
              onChange={(e) => setAction(e.target.value as TaskAction)}
              disabled={running}
            >
              {TASK_ACTIONS.map((item) => (
                <option
                  key={item}
                  value={item}
                  disabled={
                    parsedLink.kind !== 'invalid' && !isActionAllowed(parsedLink, item)
                  }
                >
                  {actionLabel(item)}
                </option>
              ))}
            </select>
          </label>

          {action === 'react' ? (
            <div className="field">
              <span>Reaction</span>
              <div className="tasks-emoji-picker">
                {DEFAULT_QUICK_REACTIONS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={`message-reaction-pick${emoji === item ? ' message-reaction-pick--active' : ''}`}
                    onClick={() => setEmoji(item)}
                    disabled={running}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {action === 'reply' || action === 'send' ? (
            <label className="field">
              <span>Nội dung</span>
              <textarea
                rows={4}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={
                  action === 'reply'
                    ? 'Nội dung reply bài post…'
                    : 'Tin nhắn gửi vào group/chat…'
                }
                disabled={running}
              />
            </label>
          ) : null}

          <label className="field">
            <span>Delay giữa các acc (giây)</span>
            <input
              type="number"
              min={0}
              max={120}
              value={delaySeconds}
              onChange={(e) => setDelaySeconds(Number(e.target.value) || 0)}
              disabled={running}
            />
          </label>

          <div className="tasks-run-actions">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => void handleRun()}
              disabled={running || selectedList.length === 0}
            >
              {running ? 'Đang chạy…' : `Chạy (${selectedList.length} acc)`}
            </button>
            {running ? (
              <button type="button" className="btn btn--danger" onClick={handleStop}>
                Dừng
              </button>
            ) : null}
          </div>
        </section>
      </div>

      {progress.length > 0 ? (
        <section className="panel tasks-progress-panel">
          <div className="panel-head">
            <h2>Tiến trình</h2>
            <p className="panel-meta">
              {progressStats.done}/{progressStats.total} xong
              {progressStats.failed > 0 ? ` · ${progressStats.failed} lỗi` : ''}
            </p>
          </div>
          <div className="table-wrap">
            <table className="data-table tasks-progress-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Phone</th>
                  <th>Trạng thái</th>
                  <th>Kết quả</th>
                </tr>
              </thead>
              <tbody>
                {progress.map((row, index) => (
                  <tr key={row.phone} className={`tasks-row--${row.status}`}>
                    <td>{index + 1}</td>
                    <td className="mono">{row.phone}</td>
                    <td>
                      <span className={`tasks-status-pill tasks-status-pill--${row.status}`}>
                        {statusLabel(row.status)}
                      </span>
                    </td>
                    <td>{row.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  )
}