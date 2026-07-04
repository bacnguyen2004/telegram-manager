import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './ConversationPage.css'
import { api } from '../api/client'
import { ConversationPageView } from './ConversationPageView'
import { useSessionAccounts } from '../hooks/useSessionAccounts'
import {
  buildDefaultCryptoPrompt,
  defaultMultiSpeakerNames,
  resolveConversationPrompt,
  type ConversationPromptStyle,
} from '../utils/conversationPrompts'
import {
  buildMultiSpeakersFromDetected,
  buildPreviewLines,
  buildScriptPayload,
  DEFAULT_CONVERSATION_TIMING,
  detectSpeakersFromScript,
  effectiveConversationScript,
  speakersMissingFromConfig,
  summarizeParseIssueMessages,
  summarizeParseIssues,
  isDefaultConversationTemplate,
  isActionablePreviewLine,
  previewLinePhase,
  type ConversationSpeaker,
  lineStatusLabel,
  loadConversationDraft,
  pickUnusedPhoneFromList,
  previewFromJobScript,
  saveConversationDraft,
  scriptTextFromJobScript,
  sessionOptionsForSpeaker,
  speakerConfigError,
  speakersForApi,
  type ConversationJobData,
  type ConversationJobSummary,
  type ConversationPreviewLine,
  type ConversationScript,
  type ConversationTiming,
  type ConversationValidateData,
  type MultiSpeakerRow,
} from '../utils/conversationScript'

const ACTIVE_JOB_STATUSES = new Set(['pending', 'running'])

type PreviewFilter = 'all' | 'todo' | 'done' | 'error'

function formatJobTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

function shortenGroupLink(link: string): string {
  const trimmed = link.trim()
  if (!trimmed) return '—'
  if (trimmed.length <= 32) return trimmed
  return `${trimmed.slice(0, 29)}…`
}

function statusBadgeClass(status: string): string {
  if (status === 'success' || status === 'done') return 'badge badge--success'
  if (status === 'error') return 'badge badge--error'
  if (status === 'running' || status === 'pending') return 'badge badge--info'
  if (status === 'stopped' || status === 'skipped') return 'badge badge--default'
  return 'badge badge--default'
}

function jobStatusLabel(status: string): string {
  if (status === 'done') return 'hoàn thành'
  if (status === 'error') return 'có lỗi'
  if (status === 'running') return 'đang chạy'
  if (status === 'pending') return 'chờ'
  if (status === 'stopped') return 'đã dừng'
  return status
}

function speakerBadgeLabel(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '?'
  const match = trimmed.match(/Person\s+([A-Z])/i)
  if (match) return match[1].toUpperCase()
  return trimmed.charAt(0).toUpperCase()
}

function rowClass(line: ConversationPreviewLine, activeId: number): string {
  return [
    'conv-preview__feed-item',
    `is-phase-${previewLinePhase(line.status)}`,
    line.lineId === activeId ? 'is-active' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

function buildSpeakerRoster(
  count: number,
  prev: MultiSpeakerRow[],
  phones: string[],
): MultiSpeakerRow[] {
  const safeCount = Math.max(2, Math.min(count, 10))
  const defaultNames = defaultMultiSpeakerNames(safeCount)
  const usedPhones: string[] = []
  return defaultNames.map((fallbackName, index) => {
    const keptSpeaker = prev[index]?.speaker?.trim() || fallbackName
    const keptPhone = prev[index]?.phone?.trim() ?? ''
    const phone =
      keptPhone && !usedPhones.includes(keptPhone)
        ? keptPhone
        : pickUnusedPhoneFromList(phones, usedPhones)
    if (phone) usedPhones.push(phone)
    return { speaker: keptSpeaker, phone }
  })
}

export function ConversationPage() {
  const { sessions, loading: sessionsLoading, reload, getPickerLabel, getMeta } =
    useSessionAccounts()
  const [groupLink, setGroupLink] = useState('')
  const [promptStyle, setPromptStyle] = useState<ConversationPromptStyle>('flexible')
  const [promptMessageCount, setPromptMessageCount] = useState(120)
  const [promptSpeakerCount, setPromptSpeakerCount] = useState(4)
  const [promptText, setPromptText] = useState('')
  const [multiSpeakers, setMultiSpeakers] = useState<MultiSpeakerRow[]>([
    { speaker: 'Person A', phone: '' },
    { speaker: 'Person B', phone: '' },
    { speaker: 'Person C', phone: '' },
    { speaker: 'Person D', phone: '' },
  ])
  const [scriptText, setScriptText] = useState('')
  const [timing, setTiming] = useState<ConversationTiming>(DEFAULT_CONVERSATION_TIMING)
  const [enableDelay, setEnableDelay] = useState(true)
  const [enableSpeakerDelay, setEnableSpeakerDelay] = useState(true)
  const [enableTypingDelay, setEnableTypingDelay] = useState(true)
  const [continueOnError, setContinueOnError] = useState(false)
  const [preview, setPreview] = useState<ConversationValidateData | null>(null)
  const [previewLines, setPreviewLines] = useState<ConversationPreviewLine[]>([])
  const [activeLineId, setActiveLineId] = useState(0)
  const [job, setJob] = useState<ConversationJobData | null>(null)
  const [jobHistory, setJobHistory] = useState<ConversationJobSummary[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [info, setInfo] = useState('')
  const [previewFilter, setPreviewFilter] = useState<PreviewFilter>('all')
  const [pollEpoch, setPollEpoch] = useState(0)
  const [draftHydrated, setDraftHydrated] = useState(false)
  const jobIdRef = useRef<number | null>(null)
  const previewScrollRef = useRef<HTMLDivElement>(null)

  const apiSpeakers = useMemo(() => speakersForApi(multiSpeakers), [multiSpeakers])

  const speakerFormError = useMemo(
    () => speakerConfigError(apiSpeakers),
    [apiSpeakers],
  )

  function bumpJobPolling() {
    setPollEpoch((value) => value + 1)
  }

  function syncFormFromJobScript(script: ConversationScript) {
    const speakers = script.speakers
    setMultiSpeakers(speakers.map((item) => ({ speaker: item.label, phone: item.phone })))
    setPromptSpeakerCount(Math.max(2, speakers.length))
    if (script.timing) setTiming(script.timing)
    setEnableDelay(script.timing.delay_max_sec > 0 || script.timing.delay_min_sec > 0)
    setEnableSpeakerDelay(
      script.timing.speaker_change_delay_max_sec > 0 ||
        script.timing.speaker_change_delay_min_sec > 0,
    )
    setEnableTypingDelay(
      (script.timing.typing_max_sec ?? 0) > 0 || (script.timing.typing_min_sec ?? 0) > 0,
    )
    setContinueOnError(script.continue_on_error)
  }

  function applyJobToPreview(jobData: ConversationJobData) {
    if (!jobData.script?.lines?.length) return
    syncFormFromJobScript(jobData.script)
    setScriptText(scriptTextFromJobScript(jobData.script))
    setPreview(previewFromJobScript(jobData.script, jobData.line_results))
    if (jobData.group_link) setGroupLink(jobData.group_link)
    const focusLine =
      jobData.line_results.find((item) => item.status === 'error') ??
      jobData.line_results.find((item) => item.status === 'pending') ??
      jobData.line_results.find((item) => item.status === 'running')
    if (focusLine) setActiveLineId(focusLine.line_id)
    else {
      const firstActionable = jobData.line_results.find(
        (item) => item.status === 'pending' || item.status === 'running' || item.status === 'error',
      )
      if (firstActionable) setActiveLineId(firstActionable.line_id)
      else if (jobData.script.lines[0]) setActiveLineId(jobData.script.lines[0].id)
    }
    const hasDoneOrSkip = jobData.line_results.some(
      (item) => item.status === 'success' || item.status === 'skipped',
    )
    if (hasDoneOrSkip) setPreviewFilter('todo')
  }

  const effectiveTiming = useMemo<ConversationTiming>(
    () => ({
      delay_min_sec: enableDelay ? timing.delay_min_sec : 0,
      delay_max_sec: enableDelay ? timing.delay_max_sec : 0,
      speaker_change_delay_min_sec: enableSpeakerDelay
        ? timing.speaker_change_delay_min_sec
        : 0,
      speaker_change_delay_max_sec: enableSpeakerDelay
        ? timing.speaker_change_delay_max_sec
        : 0,
      typing_min_sec: enableTypingDelay ? timing.typing_min_sec : 0,
      typing_max_sec: enableTypingDelay ? timing.typing_max_sec : 0,
    }),
    [enableDelay, enableSpeakerDelay, enableTypingDelay, timing],
  )

  const effectiveSpeakerCount = promptSpeakerCount

  const promptPlaceholder = useMemo(
    () =>
      buildDefaultCryptoPrompt({
        messageCount: promptMessageCount,
        speakerCount: effectiveSpeakerCount,
        mode: 'multi',
      }),
    [promptMessageCount, effectiveSpeakerCount],
  )

  const effectivePrompt = useMemo(
    () =>
      resolveConversationPrompt({
        promptText,
        placeholder: promptPlaceholder,
        messageCount: promptMessageCount,
        speakerCount: effectiveSpeakerCount,
        mode: 'multi',
      }),
    [promptText, promptPlaceholder, promptMessageCount, effectiveSpeakerCount],
  )

  const effectiveScriptText = useMemo(
    () => effectiveConversationScript(scriptText),
    [scriptText],
  )

  const scriptSpeakersDetected = useMemo(
    () => (scriptText.trim() ? detectSpeakersFromScript(effectiveScriptText) : []),
    [scriptText, effectiveScriptText],
  )

  const scriptSpeakersMissing = useMemo(
    () =>
      scriptText.trim() ? speakersMissingFromConfig(effectiveScriptText, apiSpeakers) : [],
    [scriptText, effectiveScriptText, apiSpeakers],
  )

  const loadJobHistory = useCallback(async () => {
    try {
      const res = await api.listConversationJobs(8)
      if (res.success && res.data) setJobHistory(res.data.items)
    } catch {
      // ignore history load errors
    }
  }, [])

  const fillEmptySpeakerPhones = useCallback((phones: string[]) => {
    if (!phones.length) return
    setMultiSpeakers((prev) => {
      const used = prev.map((row) => row.phone).filter(Boolean)
      let changed = false
      const next = prev.map((row) => {
        if (row.phone.trim()) return row
        const phone = pickUnusedPhoneFromList(phones, used)
        if (!phone) return row
        used.push(phone)
        changed = true
        return { ...row, phone }
      })
      return changed ? next : prev
    })
  }, [])

  const loadSessions = useCallback(async () => {
    setError('')
    try {
      const result = await reload()
      if (!result) return
      fillEmptySpeakerPhones(result.sessions)
    } catch {
      setError('Không kết nối được API. Kiểm tra backend port 8001.')
    }
  }, [reload, fillEmptySpeakerPhones])

  useEffect(() => {
    fillEmptySpeakerPhones(sessions)
  }, [sessions, fillEmptySpeakerPhones])

  useEffect(() => {
    const draft = loadConversationDraft()
    if (draft) {
      if (typeof draft.groupLink === 'string') setGroupLink(draft.groupLink)
      if (typeof draft.scriptText === 'string' && draft.scriptText.trim()) {
        setScriptText(
          isDefaultConversationTemplate(draft.scriptText) ? '' : draft.scriptText,
        )
      }
      if (draft.promptStyle === 'fixed' || draft.promptStyle === 'flexible') {
        setPromptStyle(draft.promptStyle)
      }
      if (typeof draft.promptMessageCount === 'number') {
        setPromptMessageCount(draft.promptMessageCount)
      }
      let loadedSpeakers: MultiSpeakerRow[] = [
        { speaker: 'Person A', phone: '' },
        { speaker: 'Person B', phone: '' },
        { speaker: 'Person C', phone: '' },
        { speaker: 'Person D', phone: '' },
      ]
      if (Array.isArray(draft.multiSpeakers)) {
        loadedSpeakers = draft.multiSpeakers as MultiSpeakerRow[]
      } else if (draft.mode === 'two') {
        loadedSpeakers = [
          {
            speaker: typeof draft.speakerA === 'string' ? draft.speakerA : 'Person A',
            phone: typeof draft.phoneA === 'string' ? draft.phoneA : '',
          },
          {
            speaker: typeof draft.speakerB === 'string' ? draft.speakerB : 'Person B',
            phone: typeof draft.phoneB === 'string' ? draft.phoneB : '',
          },
        ]
      }
      const loadedCount =
        typeof draft.promptSpeakerCount === 'number'
          ? Math.max(2, Math.min(draft.promptSpeakerCount, 10))
          : loadedSpeakers.length
      setPromptSpeakerCount(loadedCount)
      setMultiSpeakers(buildSpeakerRoster(loadedCount, loadedSpeakers, []))
      if (draft.timing) setTiming({ ...DEFAULT_CONVERSATION_TIMING, ...(draft.timing as object) })
      if (typeof draft.enableDelay === 'boolean') setEnableDelay(draft.enableDelay)
      if (typeof draft.enableSpeakerDelay === 'boolean') {
        setEnableSpeakerDelay(draft.enableSpeakerDelay)
      }
      if (typeof draft.enableTypingDelay === 'boolean') {
        setEnableTypingDelay(draft.enableTypingDelay)
      }
      if (typeof draft.continueOnError === 'boolean') {
        setContinueOnError(draft.continueOnError)
      }
      if (typeof draft.promptText === 'string' && draft.promptText.trim()) {
        setPromptText(draft.promptText)
      } else if (typeof draft.promptTemplate === 'string' && draft.promptTemplate.trim()) {
        const saved = draft.promptTemplate.trim()
        const isDefaultCrypto =
          saved.includes('Search the web') && saved.includes('multi-person crypto')
        setPromptText(isDefaultCrypto ? '' : saved)
      }
    }
    setDraftHydrated(true)
    void loadJobHistory()
  }, [loadJobHistory])

  useEffect(() => {
    if (!draftHydrated) return
    saveConversationDraft({
      groupLink,
      scriptText,
      promptStyle,
      promptMessageCount,
      promptSpeakerCount,
      promptText,
      multiSpeakers,
      timing,
      enableDelay,
      enableSpeakerDelay,
      enableTypingDelay,
      continueOnError,
    })
  }, [
    groupLink,
    scriptText,
    promptStyle,
    promptMessageCount,
    promptSpeakerCount,
    promptText,
    multiSpeakers,
    timing,
    enableDelay,
    enableSpeakerDelay,
    enableTypingDelay,
    continueOnError,
    draftHydrated,
  ])

  useEffect(() => {
    if (!preview?.script) {
      setPreviewLines([])
      return
    }
    setPreviewLines(
      buildPreviewLines(preview.script, effectiveScriptText, job?.line_results),
    )
  }, [preview, effectiveScriptText, job])

  useEffect(() => {
    if (!activeLineId || !previewScrollRef.current) return
    const row = previewScrollRef.current.querySelector(`[data-line-id="${activeLineId}"]`)
    row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeLineId, previewLines])

  useEffect(() => {
    if (!success && !info) return
    const timer = window.setTimeout(() => {
      setSuccess('')
      setInfo('')
    }, 3500)
    return () => window.clearTimeout(timer)
  }, [success, info])

  useEffect(() => {
    const jobId = jobIdRef.current
    if (!jobId) return

    let cancelled = false
    let timer: number | null = null

    const poll = () => {
      void api.getConversationJob(jobId).then((res) => {
        if (cancelled || !res.success || !res.data) return
        setJob(res.data)
        if (ACTIVE_JOB_STATUSES.has(res.data.status)) {
          timer = window.setTimeout(poll, 2000)
        } else {
          void loadJobHistory()
        }
      })
    }

    poll()
    return () => {
      cancelled = true
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [pollEpoch, loadJobHistory])

  const activeLine = useMemo(() => {
    const selected = previewLines.find((line) => line.lineId === activeLineId)
    if (selected) return selected
    return (
      previewLines.find((line) => isActionablePreviewLine(line.status)) ?? previewLines[0]
    )
  }, [previewLines, activeLineId])

  function getSpeakers() {
    return speakersForApi(multiSpeakers)
  }

  function previewNeedsRefresh(): boolean {
    if (!preview?.script?.lines?.length) return true
    if (!preview.valid) return true
    if (speakersMissingFromConfig(effectiveScriptText, getSpeakers()).length > 0) return true
    return preview.issues.some((item) => item.level === 'error')
  }

  async function parseConversationScript(speakers: ConversationSpeaker[]) {
    return api.parseConversation(
      buildScriptPayload(groupLink, speakers, effectiveScriptText, {
        timing: effectiveTiming,
        continueOnError,
      }),
    )
  }

  function applyParseResult(data: ConversationValidateData, speakers: ConversationSpeaker[]) {
    const errors = data.issues.filter((item) => item.level === 'error')
    const warnings = data.issues.filter((item) => item.level === 'warning')
    const missing = speakersMissingFromConfig(effectiveScriptText, speakers)
    const hasErrors = !data.valid || errors.length > 0

    if (hasErrors) {
      setPreview(null)
      setActiveLineId(0)
      setInfo('')
      setError(
        summarizeParseIssueMessages(errors).join(' · ') || 'Kịch bản không hợp lệ — chưa tách được xem trước',
      )
      return
    }

    setPreview(data)
    if (data.script?.lines.length) {
      setActiveLineId(data.script.lines[0].id)
    }
    if (warnings.length) {
      setSuccess(`Đã tách ${data.line_count} dòng · ${warnings.map((item) => item.message).join(' · ')}`)
    } else {
      setSuccess(`Đã tách ${data.line_count} dòng`)
    }
    if (missing.length) {
      setInfo(
        `Kịch bản có ${missing.length} vai chưa cấu hình (${missing.join(', ')}). Giữ ${speakers.length} vai hiện tại — bấm Nhận diện nếu muốn sync roster.`,
      )
    }
  }

  function focusIssueLine(lineId?: number | null) {
    if (!lineId) return
    setActiveLineId(lineId)
  }

  async function handleParse() {
    if (speakerFormError) {
      setError(speakerFormError)
      return
    }
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      const speakers = getSpeakers()
      const res = await parseConversationScript(speakers)
      if (!res.success || !res.data) {
        setError(res.error ?? 'Tách nội dung thất bại')
        setPreview(null)
        return
      }
      applyParseResult(res.data, speakers)
    } catch (err) {
      setPreview(null)
      setActiveLineId(0)
      setError(err instanceof Error ? err.message : 'Tách nội dung thất bại')
    } finally {
      setBusy(false)
    }
  }

  async function handleRun(fromStart: boolean) {
    if (speakerFormError) {
      setError(speakerFormError)
      return
    }
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      let script: ConversationScript | null = preview?.script ?? null
      if (previewNeedsRefresh()) {
        const speakers = getSpeakers()
        const parsed = await parseConversationScript(speakers)
        if (!parsed.success || !parsed.data) {
          setError(parsed.error ?? 'Tách nội dung thất bại')
          return
        }
        applyParseResult(parsed.data, speakers)
        if (!parsed.data.valid || !parsed.data.script?.lines.length) {
          const issueMessages = summarizeParseIssueMessages(
            parsed.data.issues.filter((item) => item.level === 'error'),
          )
          setError(issueMessages.join(' · ') || 'Kịch bản không hợp lệ')
          return
        }
        script = parsed.data.script
      } else if (!script?.lines?.length) {
        setError('Chưa tách kịch bản — bấm Tách nội dung trước')
        return
      }

      const payload = { ...script, timing: effectiveTiming }
      const startLineId = !fromStart && activeLineId > 0 ? activeLineId : undefined
      if (startLineId && !payload.lines.some((line) => line.id === startLineId)) {
        setError('Dòng đang chọn không hợp lệ')
        return
      }

      const carriedLineResults =
        startLineId && job?.line_results?.length
          ? job.line_results.filter(
              (item) => item.line_id < startLineId && item.status === 'success',
            )
          : undefined

      const created = await api.createConversationJob(payload, {
        startLineId,
        carriedLineResults,
      })
      if (!created.success || !created.data) {
        setError(created.error ?? 'Không tạo được tác vụ')
        return
      }
      jobIdRef.current = created.data.job_id
      const detail = await api.getConversationJob(created.data.job_id)
      if (detail.success && detail.data) {
        setJob(detail.data)
        applyJobToPreview(detail.data)
      }
      bumpJobPolling()
      setSuccess(
        startLineId
          ? `Đã bắt đầu tác vụ #${created.data.job_id} từ dòng ${startLineId}`
          : `Đã bắt đầu tác vụ #${created.data.job_id}`,
      )
      void loadJobHistory()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chạy thất bại')
    } finally {
      setBusy(false)
    }
  }

  async function handleResume() {
    const jobId = jobIdRef.current
    if (!jobId) return
    setBusy(true)
    setError('')
    try {
      const res = await api.resumeConversationJob(jobId)
      if (!res.success || !res.data) {
        setError(res.error ?? 'Không resume được tác vụ')
        return
      }
      setJob(res.data)
      applyJobToPreview(res.data)
      bumpJobPolling()
      setSuccess(`Đã resume tác vụ #${jobId}`)
      void loadJobHistory()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Resume thất bại')
    } finally {
      setBusy(false)
    }
  }

  async function handleRetryLine() {
    const jobId = jobIdRef.current
    const lineId = activeLine?.lineId
    if (!jobId || !lineId) return
    setBusy(true)
    setError('')
    try {
      const res = await api.retryConversationLine(jobId, lineId)
      if (!res.success || !res.data) {
        setError(res.error ?? 'Không retry được dòng này')
        return
      }
      setJob(res.data)
      applyJobToPreview(res.data)
      bumpJobPolling()
      setSuccess(`Đang retry dòng #${lineId}`)
      void loadJobHistory()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Retry thất bại')
    } finally {
      setBusy(false)
    }
  }

  async function handleLoadJob(jobId: number) {
    setBusy(true)
    setError('')
    try {
      const res = await api.getConversationJob(jobId)
      if (res.success && res.data) {
        setJob(res.data)
        jobIdRef.current = jobId
        applyJobToPreview(res.data)
        if (ACTIVE_JOB_STATUSES.has(res.data.status)) bumpJobPolling()
        setSuccess(`Đã tải tác vụ #${jobId}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tải được tác vụ')
    } finally {
      setBusy(false)
    }
  }

  async function handleStop() {
    const jobId = jobIdRef.current
    if (!jobId) return
    setBusy(true)
    try {
      const res = await api.stopConversationJob(jobId)
      if (res.success && res.data) setJob(res.data)
      setSuccess('Đã yêu cầu dừng tác vụ')
      void loadJobHistory()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dừng thất bại')
    } finally {
      setBusy(false)
    }
  }

  function handleDetectSpeakers() {
    const detected = detectSpeakersFromScript(effectiveScriptText)
    if (!detected.length) {
      setError('Không nhận diện được vai nào từ nội dung')
      return
    }
    setMultiSpeakers(buildMultiSpeakersFromDetected(detected, multiSpeakers, sessions))
    setPromptSpeakerCount(Math.max(2, Math.min(detected.length, 10)))
    setSuccess(`Đã nhận diện ${detected.length} vai`)
  }

  function syncMultiSpeakerCount(count: number) {
    const safeCount = Math.max(2, Math.min(count, 10))
    setMultiSpeakers((prev) => buildSpeakerRoster(safeCount, prev, sessions))
    setPromptSpeakerCount(safeCount)
  }

  function addMultiSpeaker() {
    setMultiSpeakers((prev) => {
      if (prev.length >= 10) return prev
      const used = prev.map((row) => row.phone).filter(Boolean)
      const next = [
        ...prev,
        {
          speaker: `Person ${String.fromCharCode(65 + prev.length)}`,
          phone: pickUnusedPhoneFromList(sessions, used),
        },
      ]
      setPromptSpeakerCount(next.length)
      return next
    })
  }

  function removeMultiSpeaker(index: number) {
    setMultiSpeakers((prev) => {
      if (prev.length <= 2) return prev
      const next = prev.filter((_, i) => i !== index)
      setPromptSpeakerCount(next.length)
      return next
    })
  }

  function clearPromptOverride() {
    if (!promptText.trim()) return
    if (!window.confirm('Xóa chỉnh sửa và dùng lại mẫu crypto (placeholder)?')) {
      return
    }
    setPromptText('')
    setSuccess('Đã dùng lại mẫu crypto')
  }

  function resetCryptoPrompt() {
    clearPromptOverride()
  }

  function clearScriptOverride() {
    if (!scriptText.trim()) return
    if (!window.confirm('Xóa nội dung đã dán và dùng lại mẫu ví dụ (placeholder)?')) {
      return
    }
    setScriptText('')
    setSuccess('Đã dùng lại mẫu ví dụ')
  }

  async function copyPrompt() {
    await navigator.clipboard.writeText(effectivePrompt)
    setInfo('Đã sao chép prompt cho GPT')
    setError('')
  }

  async function copyMessagesOnly() {
    const text = previewLines.map((line) => line.message).join('\n')
    if (!text) {
      setError('Chưa có nội dung để sao chép')
      return
    }
    await navigator.clipboard.writeText(text)
    setSuccess('Đã sao chép danh sách tin')
  }

  function resetProgress() {
    const hasProgress = Boolean(job || preview?.line_count || activeLineId > 0)
    if (
      hasProgress &&
      !window.confirm(
        'Làm lại sẽ xóa tiến độ tác vụ và bảng xem trước hiện tại. Kịch bản trong ô nội dung vẫn giữ nguyên. Tiếp tục?',
      )
    ) {
      return
    }
    setJob(null)
    jobIdRef.current = null
    setPreview(null)
    setPreviewLines([])
    setActiveLineId(0)
    setPreviewFilter('all')
    setSuccess('Đã làm lại tiến độ')
  }

  const currentStep = !groupLink.trim() ? 1 : !preview?.line_count ? 2 : 3
  const jobProgress = job ? `${job.completed_lines}/${job.total_lines}` : '—'
  const jobPercent =
    job && job.total_lines > 0
      ? Math.min(100, Math.round((job.completed_lines / job.total_lines) * 100))
      : 0
  const parseIssues = preview?.issues ?? []
  const parseErrors = parseIssues.filter((item) => item.level === 'error')
  const parseWarnings = parseIssues.filter((item) => item.level === 'warning')
  const parseErrorSummaries = useMemo(() => summarizeParseIssues(parseErrors), [parseErrors])
  const parseWarningSummaries = useMemo(() => summarizeParseIssues(parseWarnings), [parseWarnings])
  const runBlockReason = speakerFormError
    ? speakerFormError
    : !groupLink.trim()
      ? 'Chưa nhập link nhóm'
      : busy || sessionsLoading
        ? 'Đang xử lý…'
        : ''
  const retryBlockReason = !jobIdRef.current
    ? 'Chưa có tác vụ'
    : ACTIVE_JOB_STATUSES.has(job?.status ?? '')
      ? 'Tác vụ đang chạy'
      : !activeLine
        ? 'Chưa chọn dòng'
        : activeLine.status !== 'error'
          ? 'Chỉ retry được dòng đang lỗi'
          : ''
  const resumeBlockReason = !jobIdRef.current
    ? 'Chưa có tác vụ'
    : busy
      ? 'Đang xử lý…'
      : ACTIVE_JOB_STATUSES.has(job?.status ?? '')
        ? 'Tác vụ đang chạy'
        : !job?.line_results.some(
              (item) => item.status === 'pending' || item.status === 'error',
            )
          ? 'Không còn dòng chờ hoặc lỗi để resume'
          : ''
  const stopBlockReason = !job
    ? 'Chưa có tác vụ'
    : busy
      ? 'Đang xử lý…'
      : !ACTIVE_JOB_STATUSES.has(job.status)
        ? 'Tác vụ không đang chạy'
        : ''
  const canResume = !resumeBlockReason
  const canRetryLine = !retryBlockReason
  const filteredPreviewLines = useMemo(() => {
    if (previewFilter === 'error') {
      return previewLines.filter((line) => line.status === 'error')
    }
    if (previewFilter === 'done') {
      return previewLines.filter((line) => line.status === 'success')
    }
    if (previewFilter === 'todo') {
      return previewLines.filter((line) => isActionablePreviewLine(line.status))
    }
    return previewLines
  }, [previewFilter, previewLines])

  const runFromLineBlockReason = useMemo(() => {
    if (runBlockReason) return runBlockReason
    if (!activeLine) return 'Chưa chọn dòng'
    if (activeLine.status === 'success') return 'Dòng này đã gửi — chọn dòng chưa gửi'
    if (activeLine.status === 'skipped') return 'Dòng này không chạy — chọn dòng cần gửi'
    if (activeLine.status === 'running') return 'Dòng đang gửi'
    return ''
  }, [runBlockReason, activeLine])
  const pendingLineCount = job?.line_results.filter((item) => item.status === 'pending').length ?? 0

  function accountOptionsForRow(currentPhone: string, otherPhones: string[]) {
    return sessionOptionsForSpeaker(sessions, otherPhones, currentPhone)
  }

  const promptModeLabel = promptText.trim() ? 'Tuỳ chỉnh' : 'Mẫu crypto'
  const scriptModeLabel = scriptText.trim() ? 'Nội dung đã dán' : 'Mẫu ví dụ'

  return (
    <ConversationPageView
      error={error}
      success={success}
      info={info}
      setError={setError}
      setSuccess={setSuccess}
      setInfo={setInfo}
      sessions={sessions}
      sessionsLoading={sessionsLoading}
      busy={busy}
      loadSessions={() => void loadSessions()}
      currentStep={currentStep}
      promptMessageCount={promptMessageCount}
      preview={preview}
      sessionsCount={sessions.length}
      jobProgress={jobProgress}
      groupLink={groupLink}
      promptText={promptText}
      promptModeLabel={promptModeLabel}
      scriptModeLabel={scriptModeLabel}
      scriptSpeakersDetected={scriptSpeakersDetected}
      scriptSpeakersMissing={scriptSpeakersMissing}
      effectiveSpeakerCount={effectiveSpeakerCount}
      promptPlaceholder={promptPlaceholder}
      effectivePrompt={effectivePrompt}
      promptSpeakerCount={promptSpeakerCount}
      speakerFormError={speakerFormError}
      multiSpeakers={multiSpeakers}
      scriptText={scriptText}
      timing={timing}
      enableDelay={enableDelay}
      enableSpeakerDelay={enableSpeakerDelay}
      enableTypingDelay={enableTypingDelay}
      continueOnError={continueOnError}
      previewFilter={previewFilter}
      previewLines={previewLines}
      filteredPreviewLines={filteredPreviewLines}
      activeLine={activeLine}
      job={job}
      jobHistory={jobHistory}
      jobPercent={jobPercent}
      pendingLineCount={pendingLineCount}
      parseErrors={parseErrors}
      parseWarnings={parseWarnings}
      parseErrorSummaries={parseErrorSummaries}
      parseWarningSummaries={parseWarningSummaries}
      runBlockReason={runBlockReason}
      runFromLineBlockReason={runFromLineBlockReason}
      resumeBlockReason={resumeBlockReason}
      retryBlockReason={retryBlockReason}
      stopBlockReason={stopBlockReason}
      canResume={canResume}
      canRetryLine={canRetryLine}
      previewScrollRef={previewScrollRef}
      setGroupLink={setGroupLink}
      setPromptMessageCount={setPromptMessageCount}
      setPromptSpeakerCount={setPromptSpeakerCount}
      setPromptText={setPromptText}
      setScriptText={setScriptText}
      setMultiSpeakers={setMultiSpeakers}
      setEnableDelay={setEnableDelay}
      setEnableSpeakerDelay={setEnableSpeakerDelay}
      setEnableTypingDelay={setEnableTypingDelay}
      setContinueOnError={setContinueOnError}
      setTiming={setTiming}
      setPreviewFilter={setPreviewFilter}
      setActiveLineId={setActiveLineId}
      syncMultiSpeakerCount={syncMultiSpeakerCount}
      resetCryptoPrompt={resetCryptoPrompt}
      clearScriptOverride={clearScriptOverride}
      copyPrompt={() => void copyPrompt()}
      getPickerLabel={getPickerLabel}
      getMeta={getMeta}
      accountOptionsForRow={accountOptionsForRow}
      handleParse={() => void handleParse()}
      handleRun={(fromStart) => void handleRun(fromStart)}
      handleResume={() => void handleResume()}
      handleRetryLine={() => void handleRetryLine()}
      handleStop={() => void handleStop()}
      handleLoadJob={(id) => void handleLoadJob(id)}
      handleDetectSpeakers={handleDetectSpeakers}
      addMultiSpeaker={addMultiSpeaker}
      removeMultiSpeaker={removeMultiSpeaker}
      copyMessagesOnly={() => void copyMessagesOnly()}
      resetProgress={resetProgress}
      focusIssueLine={focusIssueLine}
      rowClass={rowClass}
      statusBadgeClass={statusBadgeClass}
      lineStatusLabel={lineStatusLabel}
      jobStatusLabel={jobStatusLabel}
      speakerBadgeLabel={speakerBadgeLabel}
      formatJobTime={formatJobTime}
      shortenGroupLink={shortenGroupLink}
    />
  )
}
