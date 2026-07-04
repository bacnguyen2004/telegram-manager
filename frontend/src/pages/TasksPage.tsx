import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import './TasksPage.css'
import { api } from '../api/client'
import { AccountPickerPanel, type AccountPickerFilterState } from '../components/AccountPickerPanel'
import { TaskDelayField } from '../components/TaskDelayField'
import { validateBulkDelay } from '../utils/bulkDelay'
import { TasksJoinConfig } from '../components/TasksJoinConfig'

import { Alert } from '../components/Alert'
import type { PollInfoData, PollOptionItem } from '../types/api'
import { useSessionAccounts } from '../hooks/useSessionAccounts'
import {
  CHAT_MEDIA_ACCEPT,
  detectChatMediaKind,
  validateChatMediaFile,
} from '../utils/chatMedia'
import { DEFAULT_QUICK_REACTIONS } from '../utils/reactions'

import { resolveAccountStatus } from '../utils/accountPicker'
import {
  actionsForGroup,
  getActionMeta,
  isActionAllowed,
  parseTelegramLink,
  TASK_ACTION_GROUPS,
  type TaskAction,
  type TaskActionGroup,
} from '../utils/telegramLink'
import {
  runTaskQueue,
  type TaskProgressRow,
  type TaskRowStatus,
} from '../utils/taskRunner'

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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function pollOptionVoteKey(option: PollOptionItem): string {
  if (option.option_hex) return option.option_hex
  if (option.todo_item_id != null) return String(option.todo_item_id)
  return String(option.index)
}

function pollWarnings(info: PollInfoData): string[] {
  const warnings: string[] = []
  if (info.closed) warnings.push('Poll đã đóng — không vote được.')
  if (info.shuffle_answers) {
    warnings.push(
      'Poll xáo thứ tự — chọn theo tên đáp án trên tool, không theo vị trí trên Telegram.',
    )
  }
  if (info.open_answers) {
    warnings.push(
      'Cho phép thêm đáp án — danh sách có thể đổi; bấm Tải lại trước khi chạy nếu cần.',
    )
  }
  if (info.multiple_choice) {
    warnings.push('Cho phép nhiều đáp án — có thể chọn nhiều mục cùng lúc.')
  }
  if (!info.revoting_allowed) {
    warnings.push('Không cho vote lại — acc đã vote trước đó sẽ báo lỗi.')
  }
  if (info.close_date) {
    warnings.push(
      `Tự đóng lúc ${new Date(info.close_date).toLocaleString('vi-VN')}.`,
    )
  }
  return warnings
}

function pollCancelWarnings(info: PollInfoData): string[] {
  const warnings: string[] = []
  if (info.closed) warnings.push('Poll đã đóng.')
  if (info.kind === 'poll' && !info.revoting_allowed) {
    warnings.push('Poll không cho phép hủy hoặc đổi vote.')
  }
  return warnings
}

type TodoCancelMode = 'all' | 'pick'

const TASK_GROUP_THEME: Record<
  TaskActionGroup,
  { accent: string; soft: string; border: string; glow: string }
> = {
  groups: {
    accent: '#2481cc',
    soft: 'rgba(36, 129, 204, 0.08)',
    border: 'rgba(36, 129, 204, 0.28)',
    glow: 'rgba(36, 129, 204, 0.14)',
  },
  messages: {
    accent: '#7c3aed',
    soft: 'rgba(124, 58, 237, 0.08)',
    border: 'rgba(124, 58, 237, 0.28)',
    glow: 'rgba(124, 58, 237, 0.14)',
  },
  reactions: {
    accent: '#16a34a',
    soft: 'rgba(22, 163, 74, 0.08)',
    border: 'rgba(22, 163, 74, 0.28)',
    glow: 'rgba(22, 163, 74, 0.14)',
  },
  polls: {
    accent: '#d97706',
    soft: 'rgba(217, 119, 6, 0.08)',
    border: 'rgba(217, 119, 6, 0.28)',
    glow: 'rgba(217, 119, 6, 0.14)',
  },
  pipelines: {
    accent: '#db2777',
    soft: 'rgba(219, 39, 119, 0.08)',
    border: 'rgba(219, 39, 119, 0.28)',
    glow: 'rgba(219, 39, 119, 0.14)',
  },
}

export function TasksPage() {
  const { sessions, loading: sessionsLoading, getPickerLabel, getMeta, metaByPhone } =
    useSessionAccounts()
  const [accountFilterState, setAccountFilterState] = useState<AccountPickerFilterState>({
    filteredCount: 0,
    totalCount: 0,
    hasFilters: false,
  })
  const [selectedPhones, setSelectedPhones] = useState<Set<string>>(new Set())
  const [targetLink, setTargetLink] = useState('')
  const [actionGroup, setActionGroup] = useState<TaskActionGroup>('reactions')
  const [action, setAction] = useState<TaskAction>('react')
  const [emoji, setEmoji] = useState<string>(DEFAULT_QUICK_REACTIONS[0])
  const [text, setText] = useState('')
  const [mediaFile, setMediaFile] = useState<File | null>(null)
  const [delaySeconds, setDelaySeconds] = useState(5)
  const [delayMinSeconds, setDelayMinSeconds] = useState(3)
  const [delayMaxSeconds, setDelayMaxSeconds] = useState(8)
  const [useRandomDelay, setUseRandomDelay] = useState(false)
  const [pipelineStepDelaySeconds, setPipelineStepDelaySeconds] = useState(3)

  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<TaskProgressRow[]>([])
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [pollInfo, setPollInfo] = useState<PollInfoData | null>(null)
  const [pollLoading, setPollLoading] = useState(false)
  const [pollError, setPollError] = useState('')
  const [selectedVoteKeys, setSelectedVoteKeys] = useState<string[]>([])
  const [pollReloadKey, setPollReloadKey] = useState(0)
  const [pollAddOptionLabel, setPollAddOptionLabel] = useState('')
  const [pollAddOptionOnRun, setPollAddOptionOnRun] = useState(false)
  const [pollAddOptionLoading, setPollAddOptionLoading] = useState(false)
  const [todoCancelMode, setTodoCancelMode] = useState<TodoCancelMode>('all')
  const abortRef = useRef<AbortController | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const parsedLink = useMemo(() => parseTelegramLink(targetLink), [targetLink])
  const actionMeta = useMemo(() => getActionMeta(action), [action])

  const hasStatusData = metaByPhone.size > 0

  const accountPickerMeta = useMemo(() => {
    if (sessionsLoading || sessions.length === 0) return 'Chọn acc để chạy bulk'
    if (accountFilterState.hasFilters) {
      return `${accountFilterState.filteredCount}/${sessions.length} hiển thị`
    }
    return `${sessions.length} acc`
  }, [sessionsLoading, sessions.length, accountFilterState])

  const groupActions = useMemo(() => actionsForGroup(actionGroup), [actionGroup])

  const selectedList = useMemo(
    () => sessions.filter((phone) => selectedPhones.has(phone)),
    [sessions, selectedPhones],
  )
  const selectedCount = selectedPhones.size
  const isMultiAcc = selectedCount > 1

  const pollPreviewPhone = selectedList[0] ?? sessions[0] ?? ''

  useEffect(() => {
    if (action === 'cancel-vote-poll') {
      setTodoCancelMode('all')
    }
  }, [action])

  useEffect(() => {
    if (action !== 'vote-poll' && action !== 'cancel-vote-poll') {
      setPollInfo(null)
      setPollError('')
      setPollLoading(false)
      setSelectedVoteKeys([])
      return
    }

    if (!pollPreviewPhone) {
      setPollInfo(null)
      setPollError('Chọn ít nhất một tài khoản để tải poll')
      setPollLoading(false)
      return
    }

    if (parsedLink.kind !== 'post' || !parsedLink.messageId) {
      setPollInfo(null)
      setPollError('')
      setPollLoading(false)
      return
    }

    let cancelled = false
    setPollLoading(true)
    setPollError('')
    setSelectedVoteKeys([])

    void (async () => {
      try {
        const res = await api.getPollInfo(
          pollPreviewPhone,
          parsedLink.peerId,
          parsedLink.messageId!,
          targetLink.trim() || parsedLink.raw || parsedLink.cleanLink,
        )
        if (cancelled) return
        if (!res.success || !res.data) {
          setPollInfo(null)
          setPollError(res.error ?? 'Không tải được poll')
          return
        }
        if (res.data.status === 'error') {
          setPollInfo(null)
          setPollError(res.data.message)
          return
        }
        setPollInfo(res.data)
        if (action === 'vote-poll' && res.data.suggested_option_index) {
          const suggested = res.data.options.find(
            (option) => option.index === res.data!.suggested_option_index,
          )
          if (suggested) {
            setSelectedVoteKeys([pollOptionVoteKey(suggested)])
          }
        } else if (action === 'cancel-vote-poll' && res.data.kind === 'poll') {
          setSelectedVoteKeys([])
        }
      } catch (err) {
        if (cancelled) return
        setPollInfo(null)
        setPollError(err instanceof Error ? err.message : 'Không tải được poll')
      } finally {
        if (!cancelled) setPollLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    action,
    pollPreviewPhone,
    parsedLink.kind,
    parsedLink.peerId,
    parsedLink.messageId,
    targetLink,
    pollReloadKey,
  ])

  const pollWarningList = useMemo(
    () => (pollInfo ? pollWarnings(pollInfo) : []),
    [pollInfo],
  )

  const pollCancelWarningList = useMemo(
    () => (pollInfo ? pollCancelWarnings(pollInfo) : []),
    [pollInfo],
  )

  const activeCount = useMemo(
    () =>
      sessions.filter((phone) => resolveAccountStatus(getMeta(phone)) === 'active').length,
    [sessions, getMeta],
  )

  const progressStats = useMemo(() => {
    const done = progress.filter((row) => row.status === 'success').length
    const failed = progress.filter((row) => row.status === 'error').length
    const skipped = progress.filter((row) => row.status === 'skipped').length
    const runningCount = progress.filter((row) => row.status === 'running').length
    const total = progress.length
    const pct = total > 0 ? Math.round((done / total) * 100) : 0
    return { done, failed, skipped, runningCount, total, pct }
  }, [progress])

  useEffect(() => {
    setSelectedPhones((prev) => {
      const next = new Set<string>()
      for (const phone of sessions) {
        if (prev.has(phone)) next.add(phone)
      }
      return next
    })
  }, [sessions])

  useEffect(() => {
    if (action !== 'send-media') {
      setMediaFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }, [action])

  function selectCategory(group: TaskActionGroup) {
    const actions = actionsForGroup(group)
    setActionGroup(group)
    if (!actions.some((item) => item.id === action)) {
      setAction(actions[0]?.id ?? 'react')
    }
  }

  function selectAction(next: TaskAction) {
    setAction(next)
    setActionGroup(getActionMeta(next).group)
  }

  function isActionDisabled(item: TaskAction): boolean {
    if (item === 'leave-all') return false
    if (parsedLink.kind === 'invalid') return false
    return !isActionAllowed(parsedLink, item)
  }

  function applyMediaFile(file: File): boolean {
    const validationError = validateChatMediaFile(file)
    if (validationError) {
      setError(validationError)
      setMediaFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return false
    }
    setError('')
    setMediaFile(file)
    return true
  }

  function normalizePastedFile(file: File, mimeType: string): File {
    const type = (mimeType || file.type || 'image/png').split(';')[0].trim().toLowerCase()
    if (file.name && file.name !== 'image.png' && !file.name.startsWith('blob')) {
      return file
    }
    const ext =
      type === 'image/jpeg'
        ? 'jpg'
        : type === 'image/webp'
          ? 'webp'
          : type === 'image/gif'
            ? 'gif'
            : type === 'video/mp4'
              ? 'mp4'
              : type === 'video/webm'
                ? 'webm'
                : 'png'
    return new File([file], `paste-${Date.now()}.${ext}`, { type })
  }

  function handleMediaChange(file: File | null) {
    if (!file) {
      setMediaFile(null)
      return
    }
    applyMediaFile(file)
  }

  function handleMediaPaste(event: React.ClipboardEvent<HTMLElement>) {
    if (running || action !== 'send-media') return

    const items = event.clipboardData?.items
    if (!items?.length) return

    for (const item of items) {
      if (item.kind !== 'file') continue
      const raw = item.getAsFile()
      if (!raw) continue

      const mimeType = (item.type || raw.type || '').split(';')[0].trim().toLowerCase()
      const file = normalizePastedFile(raw, mimeType)
      if (!detectChatMediaKind(file)) continue

      event.preventDefault()
      applyMediaFile(file)
      return
    }
  }

  async function handleAddPollOption(selectAfterAdd = true) {
    const label = pollAddOptionLabel.trim()
    if (!label) {
      setPollError('Nhập nội dung đáp án mới')
      return
    }
    if (!pollPreviewPhone || !parsedLink.messageId) {
      setPollError('Cần link poll và ít nhất một tài khoản')
      return
    }

    setPollAddOptionLoading(true)
    setPollError('')
    try {
      const res = await api.addPollOption(
        pollPreviewPhone,
        parsedLink.peerId,
        pollInfo?.message_id ?? parsedLink.messageId,
        label,
        targetLink.trim() || parsedLink.raw || parsedLink.cleanLink,
        false,
      )
      if (!res.success || !res.data) {
        setPollError(res.error ?? 'Không thêm được đáp án')
        return
      }
      if (res.data.status === 'error') {
        setPollError(res.data.message)
        return
      }

      const voteKey =
        res.data.option_hex ||
        (res.data.todo_item_id != null ? String(res.data.todo_item_id) : '')

      const pollRes = await api.getPollInfo(
        pollPreviewPhone,
        parsedLink.peerId,
        res.data.message_id ?? parsedLink.messageId,
        targetLink.trim() || parsedLink.raw || parsedLink.cleanLink,
      )
      if (pollRes.success && pollRes.data?.status === 'success') {
        setPollInfo(pollRes.data)
        if (selectAfterAdd && voteKey) {
          setSelectedVoteKeys((prev) =>
            pollRes.data!.multiple_choice
              ? prev.includes(voteKey)
                ? prev
                : [...prev, voteKey]
              : [voteKey],
          )
        }
      } else if (selectAfterAdd && voteKey) {
        setSelectedVoteKeys([voteKey])
        setPollReloadKey((key) => key + 1)
      } else {
        setPollReloadKey((key) => key + 1)
      }
      setSuccess(res.data.message || 'Đã thêm đáp án')
    } catch (err) {
      setPollError(err instanceof Error ? err.message : 'Không thêm được đáp án')
    } finally {
      setPollAddOptionLoading(false)
    }
  }

  function toggleVoteOption(voteKey: string, multiple: boolean) {
    setSelectedVoteKeys((prev) => {
      if (multiple) {
        return prev.includes(voteKey)
          ? prev.filter((key) => key !== voteKey)
          : [...prev, voteKey]
      }
      return [voteKey]
    })
  }

  function validateBeforeRun(): string | null {
    if (selectedList.length === 0) return 'Chọn ít nhất một tài khoản'

    if (actionMeta.requiresLink) {
      if (parsedLink.kind === 'invalid') return parsedLink.label
      if (!isActionAllowed(parsedLink, action)) {
        return `Link này không hỗ trợ "${actionMeta.label}"`
      }
      if (actionMeta.requiresMessageId && !parsedLink.messageId) {
        return 'Cần link bài post dạng t.me/channel/123'
      }
    }

    if (actionMeta.needsEmoji && !emoji.trim()) return 'Chọn emoji reaction'
    if (action === 'cancel-vote-poll' && pollInfo?.closed) {
      return 'Poll đã đóng — không thể hủy vote'
    }
    if (
      action === 'cancel-vote-poll' &&
      pollInfo?.kind === 'poll' &&
      !pollInfo.revoting_allowed
    ) {
      return 'Poll không cho phép hủy hoặc đổi vote'
    }
    if (
      action === 'cancel-vote-poll' &&
      todoCancelMode === 'pick' &&
      pollInfo?.kind === 'poll'
    ) {
      return 'Poll thường chỉ hỗ trợ Hủy hết — chuyển chế độ'
    }
    if (action === 'cancel-vote-poll' && todoCancelMode === 'pick' && !pollInfo) {
      return 'Tải preview To-Do để chọn mục, hoặc chuyển sang Hủy hết'
    }
    if (
      action === 'cancel-vote-poll' &&
      todoCancelMode === 'pick' &&
      pollInfo?.kind === 'todo' &&
      selectedVoteKeys.length === 0
    ) {
      return 'Chọn ít nhất một mục To-Do cần bỏ tick'
    }
    if (actionMeta.needsVoteOption && pollInfo?.closed) {
      return 'Poll đã đóng — không thể vote'
    }
    if (actionMeta.needsVoteOption && pollAddOptionOnRun) {
      if (!pollAddOptionLabel.trim()) return 'Nhập đáp án cần thêm khi chạy bulk'
      if (!pollInfo?.open_answers) return 'Poll không cho phép thêm đáp án'
      return null
    }
    if (
      actionMeta.needsVoteOption &&
      selectedVoteKeys.length === 0 &&
      !parsedLink.pollOptionToken
    ) {
      return pollInfo?.multiple_choice
        ? 'Chọn ít nhất một lựa chọn poll'
        : 'Chọn một lựa chọn poll'
    }
    if (actionMeta.needsText && !text.trim()) return 'Nhập nội dung tin nhắn'
    if (actionMeta.needsMedia && !mediaFile) return 'Chọn file media để gửi'

    if (isMultiAcc) {
      const delayError = validateBulkDelay({
        useRandomDelay,
        delaySeconds,
        delayMinSeconds,
        delayMaxSeconds,
      })
      if (delayError) return delayError
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
        mediaFile,
        delaySeconds,
        delayMinSeconds,
        delayMaxSeconds,
        useRandomDelay,
        retryAttempts: 0,
        stopAfterConsecutiveErrors: 0,
        preCheckLive: false,
        pipelineStepDelaySeconds,
        voteMessageId:
          action === 'vote-poll' || action === 'cancel-vote-poll'
            ? pollInfo?.message_id ?? parsedLink.messageId
            : null,
        voteLink:
          action === 'vote-poll' || action === 'cancel-vote-poll'
            ? targetLink.trim() || parsedLink.raw
            : null,
        voteOptions:
          action === 'vote-poll' && selectedVoteKeys.length > 0
            ? selectedVoteKeys
            : action === 'cancel-vote-poll' &&
                pollInfo?.kind === 'todo' &&
                todoCancelMode === 'pick' &&
                selectedVoteKeys.length > 0
              ? selectedVoteKeys
              : undefined,
        pollAddOptionLabel:
          action === 'vote-poll' ? pollAddOptionLabel.trim() : undefined,
        pollAddOptionOnRun: action === 'vote-poll' ? pollAddOptionOnRun : undefined,
        signal: abortRef.current.signal,
        onProgress: setProgress,
      })
      const ok = finalRows.filter((row) => row.status === 'success').length
      const fail = finalRows.filter((row) => row.status === 'error').length
      const skip = finalRows.filter((row) => row.status === 'skipped').length
      setSuccess(`Hoàn tất: ${ok} thành công, ${fail} lỗi${skip ? `, ${skip} bỏ qua` : ''}`)
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

  const needsTextField = actionMeta.needsText || action === 'send-media'
  const groupTheme = TASK_GROUP_THEME[actionGroup]
  const groupThemeStyle = {
    '--task-accent': groupTheme.accent,
    '--task-soft': groupTheme.soft,
    '--task-border': groupTheme.border,
    '--task-glow': groupTheme.glow,
  } as CSSProperties

  const progressRingStyle = {
    '--ring-pct': progressStats.pct,
  } as CSSProperties

  const delaySummary = useRandomDelay
    ? `${delayMinSeconds}–${delayMaxSeconds}s`
    : `${delaySeconds}s`

  return (
    <div className="page page--tasks">
      <Alert type="error" message={error} />
      <Alert type="success" message={success} />

      <div className="tasks-workspace">
        <div className="tasks-workspace-top">
          <AccountPickerPanel
            className="tasks-accounts-panel"
            title="Tài khoản"
            meta={accountPickerMeta}
            badgeCount={selectedList.length}
            sessions={sessions}
            loading={sessionsLoading}
            getMeta={getMeta}
            selectionMode="multiple"
            selectedPhones={selectedPhones}
            onSelectedPhonesChange={setSelectedPhones}
            disabled={running}
            busy={running}
            showSelectActivePill
            hasStatusData={hasStatusData}
            showClearFiltersInToolbar
            bodyBordered={false}
            onFiltersChange={setAccountFilterState}
            panelFoot={
              <>
                Chưa có session? Thêm tại <Link to="/sessions">Sessions</Link>.
              </>
            }
          />

          <section className="panel task-composer">
            <header className="task-composer__head">
              <div className="task-composer__head-main">
                <h2>Tác vụ hàng loạt</h2>
                <p className="task-composer__head-desc muted">
                  Chọn acc, hành động và chạy lần lượt.
                </p>
              </div>

              <div className="task-composer__stats" aria-label="Tổng quan">
                <div className="task-composer__stat">
                  <span className="task-composer__stat-value">
                    {sessionsLoading ? '—' : sessions.length}
                  </span>
                  <span className="task-composer__stat-label">Sessions</span>
                </div>
                <div className="task-composer__stat task-composer__stat--accent">
                  <span className="task-composer__stat-value">{selectedList.length}</span>
                  <span className="task-composer__stat-label">Đã chọn</span>
                </div>
                <div className="task-composer__stat">
                  <span className="task-composer__stat-value">
                    {hasStatusData ? activeCount : '—'}
                  </span>
                  <span className="task-composer__stat-label">Live</span>
                </div>
                <div
                  className={`task-composer__stat${
                    progressStats.done > 0 ? ' task-composer__stat--success' : ''
                  }`}
                >
                  <span className="task-composer__stat-value">
                    {progress.length > 0 ? progressStats.done : '—'}
                  </span>
                  <span className="task-composer__stat-label">Xong</span>
                </div>
                <div
                  className={`task-composer__stat${
                    progressStats.failed > 0 ? ' task-composer__stat--error' : ''
                  }`}
                >
                  <span className="task-composer__stat-value">
                    {progress.length > 0 ? progressStats.failed : '—'}
                  </span>
                  <span className="task-composer__stat-label">Lỗi</span>
                </div>
                <div className="task-composer__stat">
                  <span className="task-composer__stat-value">
                    {progress.length > 0 ? progressStats.skipped : '—'}
                  </span>
                  <span className="task-composer__stat-label">Bỏ qua</span>
                </div>
              </div>
            </header>

            <div className="task-composer__body">
              <section
                className="task-section task-section--action"
                style={groupThemeStyle}
                aria-label="Chọn hành động"
              >
                <div className="task-section__head">
                  <h3>Hành động</h3>
                  <p className="task-section__meta muted">
                    {TASK_ACTION_GROUPS.find((group) => group.id === actionGroup)?.label}
                  </p>
                </div>

                <div className="task-category-pills" role="tablist" aria-label="Nhóm hành động">
                  {TASK_ACTION_GROUPS.map((group) => (
                    <button
                      key={group.id}
                      type="button"
                      role="tab"
                      aria-selected={actionGroup === group.id}
                      className={`task-category-pill${actionGroup === group.id ? ' task-category-pill--active' : ''}`}
                      disabled={running}
                      onClick={() => selectCategory(group.id)}
                    >
                      {group.label}
                    </button>
                  ))}
                </div>

                <div className="task-action-grid">
                  {groupActions.map((item) => {
                    const disabled = isActionDisabled(item.id)
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`task-action-card${action === item.id ? ' task-action-card--active' : ''}${disabled ? ' task-action-card--disabled' : ''}`}
                        disabled={running || disabled}
                        onClick={() => selectAction(item.id)}
                        title={disabled ? 'Link hiện tại không hỗ trợ' : item.hint}
                      >
                        <span className="task-action-card__icon" aria-hidden>
                          {item.icon}
                        </span>
                        <span className="task-action-card__label">{item.label}</span>
                        {item.isPipeline ? (
                          <span className="task-action-card__badge">2 bước</span>
                        ) : null}
                      </button>
                    )
                  })}
                </div>

                <p className="task-action-hint task-action-hint--compact">
                  <span className="task-action-hint__icon" aria-hidden>
                    {actionMeta.icon}
                  </span>
                  <span className="muted">{actionMeta.hint}</span>
                </p>
              </section>

              <section
                className={`task-section task-section--config${action === 'join' ? ' task-section--join' : ''}`}
                aria-label={action === 'join' ? 'Cấu hình join' : 'Cấu hình tác vụ'}
              >
                <div className="task-section__head">
                  <h3>{action === 'join' ? 'Join nhóm' : 'Cấu hình'}</h3>
                  <p className="task-section__meta muted">
                    {action === 'join'
                      ? selectedList.length > 0
                        ? isMultiAcc
                          ? `${selectedList.length} acc · ${delaySummary}`
                          : `${selectedList.length} acc`
                        : 'Chọn acc bên trái'
                      : isMultiAcc
                        ? `${selectedList.length} acc · delay ${delaySummary}`
                        : `${selectedList.length} acc`}
                  </p>
                </div>

                <div
                  className={`task-config-fields task-config-card${
                    action === 'join' ? ' task-config-card--join' : ''
                  }${action === 'join' && !isMultiAcc ? ' task-config-card--join-single' : ''}`}
                >
            {action === 'join' ? (
              <TasksJoinConfig
                targetLink={targetLink}
                onTargetLinkChange={setTargetLink}
                parsedLink={parsedLink}
                disabled={running}
              />
            ) : actionMeta.requiresLink ? (
              <>
                <label className="field tasks-field">
                  <span className="tasks-field__label">Link mục tiêu</span>
                  <input
                    type="url"
                    className="tasks-input"
                    placeholder="https://t.me/channel/123 hoặc https://t.me/+invite"
                    value={targetLink}
                    onChange={(e) => setTargetLink(e.target.value)}
                    disabled={running}
                  />
                </label>

                <div
                  className={`tasks-link-preview${
                    parsedLink.kind === 'invalid' && targetLink.trim()
                      ? ' tasks-link-preview--invalid'
                      : parsedLink.kind !== 'invalid' && targetLink.trim()
                        ? ' tasks-link-preview--valid'
                        : ''
                  }`}
                >
                  <p className="tasks-link-preview-label">Phân tích link</p>
                  <p className="tasks-link-preview-text">
                    {targetLink.trim() ? parsedLink.label : 'Dán link Telegram để xem preview'}
                  </p>
                  {parsedLink.kind !== 'invalid' && targetLink.trim() ? (
                    <p className="tasks-link-preview-meta">
                      Hỗ trợ:{' '}
                      {parsedLink.supportedActions
                        .filter((item) => !item.startsWith('pipeline-'))
                        .map((item) => getActionMeta(item).label)
                        .join(' · ')}
                    </p>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="tasks-no-link-banner">
                <p>
                  <strong>Leave all</strong> — rời toàn bộ group/channel của từng acc đã chọn.
                  Không cần link mục tiêu.
                </p>
              </div>
            )}

            {action === 'cancel-vote-poll' ? (
              <div className="field tasks-field">
                <span>Hủy bình chọn</span>
                <div className="tasks-poll-cancel-panel">
                  <div
                    className="tasks-poll-cancel-mode"
                    role="tablist"
                    aria-label="Cách hủy bình chọn"
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={todoCancelMode === 'all'}
                      className={`tasks-poll-cancel-mode-btn${
                        todoCancelMode === 'all' ? ' tasks-poll-cancel-mode-btn--active' : ''
                      }`}
                      disabled={running}
                      onClick={() => {
                        setTodoCancelMode('all')
                        setSelectedVoteKeys([])
                      }}
                    >
                      Hủy hết
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={todoCancelMode === 'pick'}
                      className={`tasks-poll-cancel-mode-btn${
                        todoCancelMode === 'pick' ? ' tasks-poll-cancel-mode-btn--active' : ''
                      }`}
                      disabled={running}
                      onClick={() => setTodoCancelMode('pick')}
                    >
                      Chọn mục
                      <span className="tasks-poll-cancel-mode-tag">To-Do</span>
                    </button>
                  </div>
                  <p className="tasks-poll-cancel-mode-desc muted">
                    {todoCancelMode === 'all'
                      ? pollInfo?.kind === 'todo'
                        ? 'Bỏ tick hết mục acc đã hoàn thành trên To-Do.'
                        : pollInfo?.kind === 'poll'
                          ? 'Gỡ toàn bộ vote poll của từng acc (kể cả nhiều đáp án).'
                          : 'Gỡ toàn bộ vote — áp dụng cho Poll và To-Do.'
                      : 'Chỉ To-Do — tick mục cần bỏ, không tick hết mục acc đã chọn.'}
                  </p>

                  {pollLoading ? (
                    <div className="tasks-poll-state">
                      <span className="tasks-poll-loading-dot" aria-hidden />
                      <p>Đang kiểm tra bài poll…</p>
                    </div>
                  ) : null}

                  {!pollLoading && pollError ? (
                    <p className="tasks-poll-cancel-soft-warn">{pollError}</p>
                  ) : null}

                  {!pollLoading && pollInfo ? (
                    <div className="tasks-poll-cancel-head">
                      <div>
                        {pollInfo.question ? (
                          <p className="tasks-poll-cancel-question">{pollInfo.question}</p>
                        ) : (
                          <p className="tasks-poll-cancel-question">Bài poll</p>
                        )}
                        <p className="tasks-poll-meta muted">
                          Tải qua <strong>{pollPreviewPhone}</strong>
                          {pollInfo.message_id ? ` · tin #${pollInfo.message_id}` : ''}
                        </p>
                      </div>
                      <div className="tasks-poll-cancel-badges">
                        <span
                          className={`tasks-poll-cancel-badge${
                            pollInfo.kind === 'todo' ? ' tasks-poll-cancel-badge--todo' : ''
                          }`}
                        >
                          {pollInfo.kind === 'todo' ? 'To-Do' : 'Poll'}
                        </span>
                        <button
                          type="button"
                          className="tasks-poll-reload"
                          disabled={running || pollLoading}
                          onClick={() => setPollReloadKey((key) => key + 1)}
                        >
                          Tải lại
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {pollInfo && pollCancelWarningList.length > 0 ? (
                    <ul className="tasks-poll-warnings">
                      {pollCancelWarningList.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  ) : null}

                  {todoCancelMode === 'all' ? (
                    <div className="tasks-poll-cancel-full">
                      <span className="tasks-poll-cancel-full-icon" aria-hidden>
                        ↩
                      </span>
                      <div>
                        <p className="tasks-poll-cancel-full-title">
                          {pollInfo?.kind === 'todo' ? 'Bỏ tick toàn bộ' : 'Hủy toàn bộ vote'}
                        </p>
                        <p className="tasks-poll-cancel-full-text muted">
                          {pollInfo?.kind === 'todo'
                            ? 'Mỗi acc sẽ bỏ tick hết mục đã hoàn thành trên To-Do này.'
                            : pollInfo?.multiple_choice
                              ? 'Dù đã chọn nhiều đáp án, thao tác này gỡ hết vote của từng acc.'
                              : pollInfo?.kind === 'poll'
                                ? 'Gỡ lựa chọn hiện tại của từng acc trên poll này.'
                                : 'Mỗi acc sẽ gỡ toàn bộ vote trên bài post này.'}
                        </p>
                      </div>
                    </div>
                  ) : pollInfo?.kind === 'todo' ? (
                    <>
                      <p className="tasks-poll-cancel-mode-hint">
                        Chọn mục cần bỏ tick ({selectedVoteKeys.length} đã chọn).
                      </p>
                      <div
                        className="tasks-poll-options tasks-poll-options--cancel"
                        role="group"
                        aria-label="Mục cần bỏ tick"
                      >
                        {pollInfo.options.map((option) => {
                          const voteKey = pollOptionVoteKey(option)
                          const selected = selectedVoteKeys.includes(voteKey)
                          return (
                            <button
                              key={`cancel-${option.index}-${voteKey}`}
                              type="button"
                              role="checkbox"
                              aria-checked={selected}
                              className={`tasks-poll-option tasks-poll-option--cancel${
                                selected ? ' tasks-poll-option--active' : ''
                              }`}
                              disabled={running}
                              onClick={() => toggleVoteOption(voteKey, true)}
                            >
                              <span className="tasks-poll-option-num">
                                {selected ? '✓' : '○'}
                              </span>
                              <span className="tasks-poll-option-label">{option.label}</span>
                            </button>
                          )
                        })}
                      </div>
                    </>
                  ) : pollInfo?.kind === 'poll' ? (
                    <div className="tasks-poll-cancel-poll-only">
                      <p className="tasks-poll-cancel-soft-warn">
                        Bài này là <strong>Poll</strong> — Telegram không cho bỏ từng đáp án.
                        Chỉ dùng <strong>Hủy hết</strong> để gỡ vote.
                      </p>
                      <button
                        type="button"
                        className="tasks-poll-cancel-switch-btn"
                        disabled={running}
                        onClick={() => {
                          setTodoCancelMode('all')
                          setSelectedVoteKeys([])
                        }}
                      >
                        Chuyển sang Hủy hết
                      </button>
                    </div>
                  ) : !pollLoading ? (
                    <p className="tasks-field-hint muted">
                      Chọn <strong>Chọn mục</strong> cần đợi preview tải xong (loại To-Do).{' '}
                      <strong>Hủy hết</strong> có thể chạy ngay chỉ với link.
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}

            {actionMeta.needsVoteOption ? (
              <div className="field tasks-field">
                <span>Lựa chọn poll</span>
                {pollLoading ? (
                  <div className="tasks-poll-state">
                    <span className="tasks-poll-loading-dot" aria-hidden />
                    <p>Đang tải poll từ Telegram…</p>
                  </div>
                ) : null}
                {!pollLoading && pollError ? (
                  <div className="tasks-poll-error-wrap">
                    <p className="tasks-poll-error">{pollError}</p>
                    {parsedLink.pollOptionToken ? (
                      <p className="tasks-field-hint muted">
                        Link có <code>?option=</code> — vẫn có thể chạy vote nếu acc đã
                        join group. Hoặc bấm Tải lại rồi chọn đáp án theo tên.
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {!pollLoading && pollInfo && pollInfo.options.length > 0 ? (
                  <div className="tasks-poll-preview">
                    {pollInfo.question ? (
                      <p className="tasks-poll-question">{pollInfo.question}</p>
                    ) : null}
                    <div className="tasks-poll-meta-row">
                      <p className="tasks-poll-meta muted">
                        Tải qua <strong>{pollPreviewPhone}</strong> ·{' '}
                        {pollInfo.options.length} lựa chọn
                        {pollInfo.kind === 'todo' ? ' · To-Do' : ''}
                        {pollInfo.multiple_choice ? ' · Nhiều đáp án' : ''}
                        {pollInfo.message_id &&
                        parsedLink.messageId &&
                        pollInfo.message_id !== parsedLink.messageId
                          ? ` · poll ở tin #${pollInfo.message_id}`
                          : ''}
                      </p>
                      <button
                        type="button"
                        className="tasks-poll-reload"
                        disabled={running || pollLoading}
                        onClick={() => setPollReloadKey((key) => key + 1)}
                      >
                        Tải lại
                      </button>
                    </div>
                    {pollWarningList.length > 0 ? (
                      <ul className="tasks-poll-warnings">
                        {pollWarningList.map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    ) : null}
                    {pollInfo.open_answers && action === 'vote-poll' ? (
                      <div className="tasks-poll-add-option">
                        <label className="tasks-poll-add-option-label" htmlFor="pollAddOption">
                          Thêm đáp án mới
                        </label>
                        <div className="tasks-poll-add-option-row">
                          <input
                            id="pollAddOption"
                            className="tasks-poll-add-option-input"
                            type="text"
                            maxLength={200}
                            placeholder="Nhập đáp án…"
                            value={pollAddOptionLabel}
                            disabled={running || pollAddOptionLoading || pollInfo.closed}
                            onChange={(event) => setPollAddOptionLabel(event.target.value)}
                          />
                          <button
                            type="button"
                            className="tasks-poll-add-option-btn"
                            disabled={
                              running ||
                              pollAddOptionLoading ||
                              pollInfo.closed ||
                              !pollAddOptionLabel.trim()
                            }
                            onClick={() => void handleAddPollOption(true)}
                          >
                            {pollAddOptionLoading ? 'Đang thêm…' : 'Thêm & chọn'}
                          </button>
                        </div>
                        <label className="tasks-poll-add-option-run">
                          <input
                            type="checkbox"
                            checked={pollAddOptionOnRun}
                            disabled={running}
                            onChange={(event) => setPollAddOptionOnRun(event.target.checked)}
                          />
                          <span>
                            Khi chạy bulk: mỗi acc tự thêm đáp án trên rồi vote
                          </span>
                        </label>
                      </div>
                    ) : null}
                    <div
                      className="tasks-poll-options"
                      role={pollInfo.multiple_choice ? 'group' : 'radiogroup'}
                      aria-label="Lựa chọn poll"
                    >
                      {pollInfo.options.map((option) => {
                        const voteKey = pollOptionVoteKey(option)
                        const selected = selectedVoteKeys.includes(voteKey)
                        return (
                          <button
                            key={`${option.index}-${voteKey}`}
                            type="button"
                            role={pollInfo.multiple_choice ? 'checkbox' : 'radio'}
                            aria-checked={selected}
                            className={`tasks-poll-option${selected ? ' tasks-poll-option--active' : ''}`}
                            disabled={running || pollInfo.closed}
                            onClick={() =>
                              toggleVoteOption(voteKey, pollInfo.multiple_choice)
                            }
                          >
                            <span className="tasks-poll-option-num">
                              {pollInfo.multiple_choice ? (selected ? '✓' : '+') : option.index}
                            </span>
                            <span className="tasks-poll-option-label">{option.label}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ) : null}
                {!pollLoading &&
                !pollError &&
                parsedLink.kind === 'post' &&
                parsedLink.messageId &&
                pollPreviewPhone &&
                !pollInfo ? (
                  <p className="tasks-field-hint muted">Dán link bài poll để hiện lựa chọn.</p>
                ) : null}
              </div>
            ) : null}

            {actionMeta.needsEmoji ? (
              <div className="field tasks-field">
                <span>Reaction</span>
                <div className="tasks-emoji-picker">
                  {DEFAULT_QUICK_REACTIONS.map((item) => (
                    <button
                      key={item}
                      type="button"
                      className={`tasks-emoji-btn${emoji === item ? ' tasks-emoji-btn--active' : ''}`}
                      onClick={() => setEmoji(item)}
                      disabled={running}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {actionMeta.needsMedia ? (
              <div className="field tasks-field">
                <span>File media</span>
                <div className="tasks-file-upload" onPaste={handleMediaPaste}>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={CHAT_MEDIA_ACCEPT}
                    disabled={running}
                    onChange={(e) => handleMediaChange(e.target.files?.[0] ?? null)}
                  />
                  {mediaFile ? (
                    <div className="tasks-file-preview">
                      <span className="tasks-file-name">{mediaFile.name}</span>
                      <span className="tasks-file-size">{formatFileSize(mediaFile.size)}</span>
                      <button
                        type="button"
                        className="tasks-file-clear"
                        disabled={running}
                        onClick={() => {
                          setMediaFile(null)
                          if (fileInputRef.current) fileInputRef.current.value = ''
                        }}
                      >
                        Xóa
                      </button>
                    </div>
                  ) : (
                    <p className="tasks-file-hint">
                      Ảnh, video hoặc file — dùng chung cho mọi acc · Ctrl+V để dán ảnh
                    </p>
                  )}
                </div>
              </div>
            ) : null}

            {needsTextField ? (
              <label className="field tasks-field tasks-field--content">
                <span className="tasks-field__label">
                  {action === 'send-media'
                    ? 'Caption (tùy chọn)'
                    : action === 'pipeline-join-send'
                      ? 'Tin nhắn sau khi join'
                      : action === 'reply' || action === 'pipeline-join-reply'
                        ? 'Nội dung reply'
                        : 'Nội dung'}
                </span>
                <textarea
                  className="tasks-textarea"
                  rows={4}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onPaste={action === 'send-media' ? handleMediaPaste : undefined}
                  placeholder={
                    action === 'send-media'
                      ? 'Caption kèm file (có thể để trống)…'
                      : action === 'pipeline-join-send'
                        ? 'Tin nhắn gửi vào group sau khi join…'
                        : action === 'reply' || action === 'pipeline-join-reply'
                          ? 'Nội dung reply bài post…'
                          : 'Tin nhắn gửi vào group/chat…'
                  }
                  disabled={running}
                  required={actionMeta.needsText}
                />
              </label>
            ) : null}

                {isMultiAcc ? (
                  <div className="task-config-delay">
                    <TaskDelayField
                      useRandomDelay={useRandomDelay}
                      onUseRandomDelayChange={setUseRandomDelay}
                      delaySeconds={delaySeconds}
                      onDelaySecondsChange={setDelaySeconds}
                      delayMinSeconds={delayMinSeconds}
                      onDelayMinSecondsChange={setDelayMinSeconds}
                      delayMaxSeconds={delayMaxSeconds}
                      onDelayMaxSecondsChange={setDelayMaxSeconds}
                      showPipelineDelay={actionMeta.isPipeline}
                      pipelineStepDelaySeconds={pipelineStepDelaySeconds}
                      onPipelineStepDelaySecondsChange={setPipelineStepDelaySeconds}
                      disabled={running}
                    />
                  </div>
                ) : null}
                </div>
              </section>
            </div>

            <footer className="task-composer__foot">
              <div className="task-composer__summary">
                <span className="task-composer__summary-title">
                  {actionMeta.icon} {actionMeta.label}
                </span>
                <span className="task-composer__summary-meta muted">
                  {selectedList.length} acc · {actionMeta.isPipeline ? '2 bước' : '1 bước'}
                  {isMultiAcc ? ` · delay ${delaySummary}` : ''}
                </span>
              </div>

              {progress.length > 0 || running ? (
                <div
                  className="task-composer__progress-ring"
                  style={progressRingStyle}
                  role="progressbar"
                  aria-valuenow={progressStats.pct}
                  aria-label={`Tiến trình ${progressStats.pct}%`}
                >
                  <span className="task-composer__progress-ring-label">{progressStats.pct}%</span>
                </div>
              ) : null}

              <div className="task-composer__actions">
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => void handleRun()}
                  disabled={running || selectedList.length === 0}
                >
                  {running ? 'Đang chạy…' : `Chạy ${selectedList.length} acc`}
                </button>
                {running ? (
                  <button type="button" className="btn btn--danger" onClick={handleStop}>
                    Dừng
                  </button>
                ) : null}
              </div>
            </footer>
          </section>
        </div>
      </div>

      <section
        className={`panel tasks-progress-panel${progress.length === 0 ? ' tasks-progress-panel--idle' : ''}${running ? ' tasks-progress-panel--live' : ''}`}
      >
          <div className="tasks-progress-head">
            <div>
              <h2>Tiến trình</h2>
              <p className="panel-meta">
                {progress.length > 0
                  ? `${progressStats.done} xong · ${progressStats.failed} lỗi · ${progressStats.skipped} bỏ qua`
                  : 'Chọn acc và bấm Chạy để xem log từng tài khoản'}
              </p>
            </div>
            {progress.length > 0 ? (
              <span className="tasks-progress-pct">{progressStats.pct}%</span>
            ) : null}
          </div>

          {progress.length > 0 ? (
            <div className="tasks-progress-body">
              <div
                className="tasks-progress-bar"
                role="progressbar"
                aria-valuenow={progressStats.pct}
              >
                <div
                  className="tasks-progress-bar-fill"
                  style={{ width: `${progressStats.pct}%` }}
                />
              </div>
              <div className="table-wrap tasks-table-wrap">
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
                        <td className="mono">{getPickerLabel(row.phone)}</td>
                        <td>
                          <span className={`tasks-status-pill tasks-status-pill--${row.status}`}>
                            {statusLabel(row.status)}
                          </span>
                        </td>
                        <td className="tasks-result-cell">{row.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className="tasks-progress-empty">
              Chưa có log — chọn acc ở sidebar và bấm <strong>Chạy</strong>.
            </p>
          )}
      </section>
    </div>
  )
}