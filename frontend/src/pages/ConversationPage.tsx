import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/client'
import { Alert } from '../components/Alert'
import {
  analyzeConversationPrompt,
  buildDefaultCryptoPrompt,
  defaultMultiSpeakerNames,
  resolveConversationPrompt,
  type ConversationPromptStyle,
} from '../utils/conversationPrompts'
import {
  buildPreviewLines,
  buildScriptPayload,
  CONVERSATION_TEMPLATE,
  DEFAULT_CONVERSATION_TIMING,
  detectSpeakersFromScript,
  effectiveConversationScript,
  isDefaultConversationTemplate,
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
  type ConversationMode,
  type ConversationPreviewLine,
  type ConversationScript,
  type ConversationTiming,
  type ConversationValidateData,
  type MultiSpeakerRow,
} from '../utils/conversationScript'

const ACTIVE_JOB_STATUSES = new Set(['pending', 'running'])

type PreviewFilter = 'all' | 'error' | 'pending'

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
  const classes = ['conv-preview-row']
  if (line.lineId === activeId) classes.push('conv-preview-row--active')
  if (line.status === 'success') classes.push('conv-preview-row--sent')
  if (line.status === 'error') classes.push('conv-preview-row--error')
  return classes.join(' ')
}

function ConvPanelIcon({ kind }: { kind: 'prompt' | 'telegram' | 'script' | 'preview' | 'job' }) {
  const paths: Record<typeof kind, string> = {
    prompt:
      'M8 6h8M8 10h8M8 14h5M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
    telegram:
      'M4 10.5 18 4l-3.2 14.5-4.3-3.3-2.5 2.4V10.5Z',
    script:
      'M7 5h10M7 9h10M7 13h6M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
    preview:
      'M8 10a2 2 0 1 0 4 0 2 2 0 0 0-4 0Zm8-2.5A8 8 0 1 1 4 7.5',
    job:
      'M6 6h12v12H6V6Zm3 3h6M9 15h6',
  }
  return (
    <span className={`conv-panel-icon conv-panel-icon--${kind}`} aria-hidden>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d={paths[kind]} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

function ConvEmptyChatIcon() {
  return (
    <svg className="conv-empty-chat-icon" viewBox="0 0 64 64" fill="none" aria-hidden>
      <circle cx="32" cy="32" r="28" stroke="currentColor" strokeWidth="1.5" opacity="0.18" />
      <path
        d="M18 26c0-5.523 6.268-10 14-10s14 4.477 14 10v2c0 5.523-6.268 10-14 10-1.63 0-3.2-.22-4.62-.64L18 50l2.38-7.14C19.22 41.8 18 40.1 18 38v-2Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function ConversationPage() {
  const [sessions, setSessions] = useState<string[]>([])
  const [groupLink, setGroupLink] = useState('')
  const [mode, setMode] = useState<ConversationMode>('multi')
  const [promptStyle, setPromptStyle] = useState<ConversationPromptStyle>('flexible')
  const [promptMessageCount, setPromptMessageCount] = useState(120)
  const [promptSpeakerCount, setPromptSpeakerCount] = useState(4)
  const [promptText, setPromptText] = useState('')
  const [speakerA, setSpeakerA] = useState('Person A')
  const [speakerB, setSpeakerB] = useState('Person B')
  const [phoneA, setPhoneA] = useState('')
  const [phoneB, setPhoneB] = useState('')
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
  const [replyOnSpeakerChange, setReplyOnSpeakerChange] = useState(true)
  const [continueOnError, setContinueOnError] = useState(false)
  const [preview, setPreview] = useState<ConversationValidateData | null>(null)
  const [previewLines, setPreviewLines] = useState<ConversationPreviewLine[]>([])
  const [activeLineId, setActiveLineId] = useState(0)
  const [job, setJob] = useState<ConversationJobData | null>(null)
  const [jobHistory, setJobHistory] = useState<ConversationJobSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [info, setInfo] = useState('')
  const [previewFilter, setPreviewFilter] = useState<PreviewFilter>('all')
  const [pollEpoch, setPollEpoch] = useState(0)
  const [draftHydrated, setDraftHydrated] = useState(false)
  const jobIdRef = useRef<number | null>(null)
  const previewScrollRef = useRef<HTMLDivElement>(null)

  const apiSpeakers = useMemo(
    () =>
      speakersForApi({
        mode,
        speakerA,
        speakerB,
        phoneA,
        phoneB,
        multiSpeakers,
      }),
    [mode, speakerA, speakerB, phoneA, phoneB, multiSpeakers],
  )

  const speakerFormError = useMemo(
    () => speakerConfigError(apiSpeakers),
    [apiSpeakers],
  )

  function bumpJobPolling() {
    setPollEpoch((value) => value + 1)
  }

  function syncFormFromJobScript(script: ConversationScript) {
    const speakers = script.speakers
    if (speakers.length > 2) {
      setMode('multi')
      setMultiSpeakers(
        speakers.map((item) => ({ speaker: item.label, phone: item.phone })),
      )
      setPromptSpeakerCount(speakers.length)
    } else {
      setMode('two')
      if (speakers[0]) {
        setSpeakerA(speakers[0].label)
        setPhoneA(speakers[0].phone)
      }
      if (speakers[1]) {
        setSpeakerB(speakers[1].label)
        setPhoneB(speakers[1].phone)
      }
    }
    if (script.timing) setTiming(script.timing)
    setEnableDelay(script.timing.delay_max_sec > 0 || script.timing.delay_min_sec > 0)
    setEnableSpeakerDelay(
      script.timing.speaker_change_delay_max_sec > 0 ||
        script.timing.speaker_change_delay_min_sec > 0,
    )
    setReplyOnSpeakerChange(script.reply_on_speaker_change)
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
    else if (jobData.script.lines[0]) setActiveLineId(jobData.script.lines[0].id)
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
    }),
    [enableDelay, enableSpeakerDelay, timing],
  )

  const effectiveSpeakerCount = mode === 'multi' ? promptSpeakerCount : 2

  const promptPlaceholder = useMemo(
    () =>
      buildDefaultCryptoPrompt({
        messageCount: promptMessageCount,
        speakerCount: effectiveSpeakerCount,
        mode: mode === 'two' ? 'two' : 'multi',
      }),
    [promptMessageCount, effectiveSpeakerCount, mode],
  )

  const usesPromptPlaceholder = !promptText.trim()

  const effectivePrompt = useMemo(
    () =>
      resolveConversationPrompt({
        promptText,
        placeholder: promptPlaceholder,
        messageCount: promptMessageCount,
        speakerCount: effectiveSpeakerCount,
        mode: mode === 'two' ? 'two' : 'multi',
      }),
    [
      promptText,
      promptPlaceholder,
      promptMessageCount,
      effectiveSpeakerCount,
      mode,
    ],
  )

  const promptAnalysis = useMemo(
    () =>
      analyzeConversationPrompt(effectivePrompt, {
        messageCount: promptMessageCount,
        speakerCount: effectiveSpeakerCount,
        usesPlaceholder: usesPromptPlaceholder,
      }),
    [effectivePrompt, promptMessageCount, effectiveSpeakerCount, usesPromptPlaceholder],
  )

  const effectiveScriptText = useMemo(
    () => effectiveConversationScript(scriptText),
    [scriptText],
  )

  const loadJobHistory = useCallback(async () => {
    try {
      const res = await api.listConversationJobs(8)
      if (res.success && res.data) setJobHistory(res.data.items)
    } catch {
      // ignore history load errors
    }
  }, [])

  const loadSessions = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.listSessions()
      if (!res.success || !res.data) {
        setError(res.error ?? 'Không tải được sessions')
        return
      }
      const phones = res.data.sessions
      setSessions(phones)
      setPhoneA((prev) => prev || phones[0] || '')
      setPhoneB((prev) => prev || phones[1] || '')
    } catch {
      setError('Không kết nối được API. Kiểm tra backend port 8001.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const draft = loadConversationDraft()
    if (draft) {
      if (typeof draft.groupLink === 'string') setGroupLink(draft.groupLink)
      if (typeof draft.scriptText === 'string' && draft.scriptText.trim()) {
        setScriptText(
          isDefaultConversationTemplate(draft.scriptText) ? '' : draft.scriptText,
        )
      }
      if (draft.mode === 'two' || draft.mode === 'multi') setMode(draft.mode)
      if (draft.promptStyle === 'fixed' || draft.promptStyle === 'flexible') {
        setPromptStyle(draft.promptStyle)
      }
      if (typeof draft.promptMessageCount === 'number') {
        setPromptMessageCount(draft.promptMessageCount)
      }
      if (typeof draft.promptSpeakerCount === 'number') {
        setPromptSpeakerCount(draft.promptSpeakerCount)
      }
      if (typeof draft.speakerA === 'string') setSpeakerA(draft.speakerA)
      if (typeof draft.speakerB === 'string') setSpeakerB(draft.speakerB)
      if (typeof draft.phoneA === 'string') setPhoneA(draft.phoneA)
      if (typeof draft.phoneB === 'string') setPhoneB(draft.phoneB)
      if (Array.isArray(draft.multiSpeakers)) {
        setMultiSpeakers(draft.multiSpeakers as MultiSpeakerRow[])
      }
      if (draft.timing) setTiming({ ...DEFAULT_CONVERSATION_TIMING, ...(draft.timing as object) })
      if (typeof draft.enableDelay === 'boolean') setEnableDelay(draft.enableDelay)
      if (typeof draft.enableSpeakerDelay === 'boolean') {
        setEnableSpeakerDelay(draft.enableSpeakerDelay)
      }
      if (typeof draft.replyOnSpeakerChange === 'boolean') {
        setReplyOnSpeakerChange(draft.replyOnSpeakerChange)
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
    void loadSessions()
    void loadJobHistory()
  }, [loadSessions, loadJobHistory])

  useEffect(() => {
    if (!draftHydrated) return
    saveConversationDraft({
      groupLink,
      scriptText,
      mode,
      promptStyle,
      promptMessageCount,
      promptSpeakerCount,
      promptText,
      speakerA,
      speakerB,
      phoneA,
      phoneB,
      multiSpeakers,
      timing,
      enableDelay,
      enableSpeakerDelay,
      replyOnSpeakerChange,
      continueOnError,
    })
  }, [
    groupLink,
    scriptText,
    mode,
    promptStyle,
    promptMessageCount,
    promptSpeakerCount,
    promptText,
    speakerA,
    speakerB,
    phoneA,
    phoneB,
    multiSpeakers,
    timing,
    enableDelay,
    enableSpeakerDelay,
    replyOnSpeakerChange,
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

  const activeLine = previewLines.find((line) => line.lineId === activeLineId) ?? previewLines[0]

  function getSpeakers() {
    return speakersForApi({
      mode,
      speakerA,
      speakerB,
      phoneA,
      phoneB,
      multiSpeakers,
    })
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
      const res = await api.parseConversation(
        buildScriptPayload(groupLink, getSpeakers(), effectiveScriptText, {
          timing: effectiveTiming,
          replyOnSpeakerChange,
          continueOnError,
        }),
      )
      if (!res.success || !res.data) {
        setError(res.error ?? 'Tách nội dung thất bại')
        setPreview(null)
        return
      }
      setPreview(res.data)
      const errors = res.data.issues.filter((item) => item.level === 'error')
      const warnings = res.data.issues.filter((item) => item.level === 'warning')
      const firstIssueLine = errors.find((item) => item.line_id)?.line_id
      if (firstIssueLine) {
        setActiveLineId(firstIssueLine)
      } else if (res.data.script?.lines.length) {
        setActiveLineId(res.data.script.lines[0].id)
      }
      if (errors.length) {
        setError(errors.map((item) => item.message).join(' · '))
      } else if (warnings.length) {
        setSuccess(
          `Đã tách ${res.data.line_count} dòng · ${warnings.map((item) => item.message).join(' · ')}`,
        )
      } else {
        setSuccess(`Đã tách ${res.data.line_count} dòng`)
      }
    } catch (err) {
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
      if (!script?.lines?.length) {
        const parsed = await api.parseConversation(
          buildScriptPayload(groupLink, getSpeakers(), effectiveScriptText, {
            timing: effectiveTiming,
            replyOnSpeakerChange,
            continueOnError,
          }),
        )
        if (!parsed.success || !parsed.data?.script || !parsed.data.valid) {
          setError(
            parsed.data?.issues.map((item) => item.message).join(' · ') ??
              'Kịch bản không hợp lệ',
          )
          return
        }
        script = parsed.data.script
        setPreview(parsed.data)
      }

      const payload = { ...script, timing: effectiveTiming }
      const startLineId = !fromStart && activeLineId > 0 ? activeLineId : undefined
      if (startLineId && !payload.lines.some((line) => line.id === startLineId)) {
        setError('Dòng đang chọn không hợp lệ')
        return
      }

      const created = await api.createConversationJob(payload, { startLineId })
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
    const previous = new Map(
      multiSpeakers.map((row) => [row.speaker.trim().toLowerCase(), row.phone]),
    )
    setMultiSpeakers(
      detected.map((speaker, index) => ({
        speaker,
        phone:
          previous.get(speaker.toLowerCase()) ??
          sessions[index] ??
          sessions[0] ??
          '',
      })),
    )
    setPromptSpeakerCount(Math.max(2, Math.min(detected.length, 10)))
    setSuccess(`Đã nhận diện ${detected.length} vai`)
  }

  function syncMultiSpeakerCount(count: number) {
    const safeCount = Math.max(2, Math.min(count, 10))
    const names = defaultMultiSpeakerNames(safeCount)
    setMultiSpeakers((prev) => {
      const usedPhones: string[] = []
      return names.map((speaker, index) => {
        const keptPhone = prev[index]?.phone?.trim() ?? ''
        const phone =
          keptPhone && !usedPhones.includes(keptPhone)
            ? keptPhone
            : pickUnusedPhoneFromList(sessions, usedPhones)
        if (phone) usedPhones.push(phone)
        return { speaker, phone }
      })
    })
    setPromptSpeakerCount(safeCount)
  }

  function addMultiSpeaker() {
    setMultiSpeakers((prev) => {
      if (prev.length >= 10) return prev
      const used = prev.map((row) => row.phone).filter(Boolean)
      return [
        ...prev,
        {
          speaker: `Person ${String.fromCharCode(65 + prev.length)}`,
          phone: pickUnusedPhoneFromList(sessions, used),
        },
      ]
    })
  }

  function removeMultiSpeaker(index: number) {
    setMultiSpeakers((prev) => {
      if (prev.length <= 2) return prev
      return prev.filter((_, i) => i !== index)
    })
  }

  useEffect(() => {
    if (mode === 'two') {
      setPromptSpeakerCount(2)
      return
    }
    setPromptSpeakerCount((prev) =>
      prev === multiSpeakers.length ? prev : multiSpeakers.length,
    )
  }, [mode, multiSpeakers.length])

  function setConversationMode(next: ConversationMode) {
    setMode(next)
    if (next === 'two') {
      setPromptSpeakerCount(2)
      return
    }
    setPromptSpeakerCount((prev) => (prev <= 2 ? 4 : prev))
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

  function clearNotices() {
    setError('')
    setSuccess('')
    setInfo('')
  }

  const hasNotices = Boolean(error || success || info)

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
  const runBlockReason = speakerFormError
    ? speakerFormError
    : !groupLink.trim()
      ? 'Chưa nhập link nhóm'
      : busy || loading
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
    if (previewFilter === 'pending') {
      return previewLines.filter((line) => line.status === 'pending')
    }
    return previewLines
  }, [previewFilter, previewLines])
  const pendingLineCount = job?.line_results.filter((item) => item.status === 'pending').length ?? 0

  function accountOptionsForRow(currentPhone: string, otherPhones: string[]) {
    return sessionOptionsForSpeaker(sessions, otherPhones, currentPhone)
  }

  const promptModeLabel = promptText.trim() ? 'Đang ghi đè' : 'Mẫu crypto'
  const scriptModeLabel = scriptText.trim() ? 'Nội dung đã dán' : 'Mẫu ví dụ'

  return (
    <div className="page page--conversation">
      <header className="conv-hero">
        <div className="conv-hero-main">
          <span className="conv-page-kicker">Natural chat</span>
          <h1>Hội thoại tự nhiên</h1>
          <p className="page-desc">
            Tạo kịch bản bằng GPT, gán account cho từng vai và chạy tự động với delay ngẫu nhiên
            — giống người thật trò chuyện trong nhóm.
          </p>
          <div className="conv-hero-chips">
            <span className="conv-hero-chip">Bước {currentStep}/3</span>
            <span className="conv-hero-chip conv-hero-chip--accent">
              {effectiveSpeakerCount} vai · {promptMessageCount} tin
            </span>
            {preview?.line_count ? (
              <span className="conv-hero-chip conv-hero-chip--success">
                {preview.line_count} dòng đã tách
              </span>
            ) : null}
          </div>
        </div>
        <div className="conv-header-actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => void loadSessions()}
            disabled={loading || busy}
          >
            {loading ? 'Đang tải…' : 'Tải lại acc'}
          </button>
        </div>
      </header>

      <section className="stats-grid conv-stats">
        <article className="stat-card conv-stat-card conv-stat-card--prompt">
          <p className="stat-label">Prompt GPT</p>
          <p className="stat-value stat-value--sm">
            {promptMessageCount} tin · {effectiveSpeakerCount} vai
          </p>
          <p className="stat-foot conv-stat-foot">{promptModeLabel}</p>
        </article>
        <article
          className={`stat-card conv-stat-card conv-stat-card--lines${preview?.line_count ? ' stat-card--active' : ''}`}
        >
          <p className="stat-label">Dòng kịch bản</p>
          <p className="stat-value">{preview?.line_count ?? 0}</p>
          <p className="stat-foot conv-stat-foot">{scriptModeLabel}</p>
        </article>
        <article className="stat-card conv-stat-card conv-stat-card--accounts">
          <p className="stat-label">Accounts</p>
          <p className="stat-value">{loading ? '—' : sessions.length}</p>
          <p className="stat-foot conv-stat-foot">Telegram sessions</p>
        </article>
        <article className="stat-card conv-stat-card conv-stat-card--progress">
          <p className="stat-label">Tiến trình</p>
          <p className="stat-value stat-value--sm">{jobProgress}</p>
          <p className="stat-foot conv-stat-foot">
            {job ? jobStatusLabel(job.status) : 'Chưa chạy'}
          </p>
        </article>
      </section>

      <nav className="conv-steps" aria-label="Các bước thực hiện">
        {(
          [
            ['Cấu hình & gán vai', 1],
            ['Kịch bản & xem trước', 2],
            ['Chạy & theo dõi', 3],
          ] as const
        ).map(([label, step]) => (
          <div
            key={step}
            className={[
              'conv-step',
              currentStep === step ? ' conv-step--active' : '',
              currentStep > step ? ' conv-step--done' : '',
            ].join('')}
          >
            <span className="conv-step-num">{step}</span>
            <span className="conv-step-label">{label}</span>
          </div>
        ))}
      </nav>

      {hasNotices ? (
        <div className="conv-notice-stack" aria-live="polite">
          <Alert type="error" message={error} onDismiss={() => setError('')} />
          <Alert type="success" message={success} onDismiss={() => setSuccess('')} />
          <Alert type="info" message={info} onDismiss={() => setInfo('')} />
          {(error && (success || info)) || (success && info) ? (
            <button type="button" className="conv-notice-clear btn btn--ghost btn--sm" onClick={clearNotices}>
              Xóa tất cả thông báo
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="conv-workspace">
        <div className="conv-col conv-col--left">
          <div className="panel conv-panel conv-panel--prompt">
            <div className="conv-panel-head">
              <div className="conv-panel-head-main">
                <ConvPanelIcon kind="prompt" />
                <div>
                  <p className="conv-panel-step">Bước 1 · GPT</p>
                  <h2>Prompt tạo kịch bản</h2>
                  <p className="panel-meta">
                    Mẫu crypto là placeholder — ô trống thì sao chép theo số tin / số vai.
                  </p>
                </div>
              </div>
              <span
                className={`conv-status-chip${promptText.trim() ? ' conv-status-chip--edit' : ''}`}
              >
                {promptModeLabel}
              </span>
            </div>
            <div className="conv-panel-body">
              <div className="conv-prompt-controls">
                <label className="field conv-prompt-control">
                  <span>Số tin</span>
                  <input
                    className="conv-input"
                    type="number"
                    min={1}
                    max={500}
                    value={promptMessageCount}
                    onChange={(e) => setPromptMessageCount(Number(e.target.value || 120))}
                  />
                </label>
                {mode === 'multi' ? (
                  <label className="field conv-prompt-control">
                    <span>Số vai</span>
                    <input
                      className="conv-input"
                      type="number"
                      min={2}
                      max={10}
                      value={promptSpeakerCount}
                      onChange={(e) => {
                        const count = Number(e.target.value || 4)
                        setPromptSpeakerCount(count)
                        syncMultiSpeakerCount(count)
                      }}
                    />
                  </label>
                ) : (
                  <div className="field conv-prompt-control conv-prompt-control--fixed">
                    <span>Số vai</span>
                    <div className="conv-input conv-input--readonly" aria-readonly>
                      2 (Person A, Person B)
                    </div>
                  </div>
                )}
              </div>

              <section className="conv-prompt-analysis" aria-label="Phân tích prompt">
                <div className="conv-prompt-analysis-head">
                  <div>
                    <p className="conv-prompt-analysis-title">Phân tích prompt</p>
                    <p className="conv-prompt-analysis-sub">
                      {mode === 'two'
                        ? usesPromptPlaceholder
                          ? 'Chế độ 2 vai — mẫu prompt tự dùng Person A & B.'
                          : 'Chế độ 2 vai — prompt ghi đè vẫn đồng bộ về 2 người khi sao chép.'
                        : usesPromptPlaceholder
                          ? 'Đang dùng mẫu crypto — số tin / số vai cập nhật tự động khi bạn đổi ô trên.'
                          : 'Đã ghi đè — số tin / số vai vẫn được đồng bộ vào nội dung khi sao chép.'}
                    </p>
                  </div>
                  <span
                    className={`conv-status-chip${usesPromptPlaceholder ? '' : ' conv-status-chip--edit'}`}
                  >
                    {promptModeLabel}
                  </span>
                </div>

                <div className="conv-prompt-analysis-grid">
                  <article className="conv-analysis-card">
                    <p className="conv-analysis-label">Số tin</p>
                    <p className="conv-analysis-value">{promptAnalysis.messageCount}</p>
                  </article>
                  <article className="conv-analysis-card">
                    <p className="conv-analysis-label">Số vai</p>
                    <p className="conv-analysis-value">{promptAnalysis.speakerCount}</p>
                  </article>
                  <article className="conv-analysis-card">
                    <p className="conv-analysis-label">Ký tự</p>
                    <p className="conv-analysis-value">
                      {promptAnalysis.charCount.toLocaleString('vi-VN')}
                    </p>
                  </article>
                  <article className="conv-analysis-card">
                    <p className="conv-analysis-label">Dòng</p>
                    <p className="conv-analysis-value">{promptAnalysis.lineCount}</p>
                  </article>
                </div>

                <div className="conv-prompt-analysis-tags">
                  {promptAnalysis.usesWebSearch ? (
                    <span className="conv-analysis-tag conv-analysis-tag--accent">Web search</span>
                  ) : null}
                  {promptAnalysis.hasReplyRules ? (
                    <span className="conv-analysis-tag">reply_to</span>
                  ) : null}
                  {promptAnalysis.hasConsecutiveLimit ? (
                    <span className="conv-analysis-tag">Tối đa 4 tin liên tiếp / vai</span>
                  ) : null}
                  <span className="conv-analysis-tag conv-analysis-tag--muted">
                    {mode === 'two' ? '2 vai · Crypto' : 'Crypto'}
                  </span>
                </div>

                <div className="conv-prompt-analysis-speakers">
                  <p className="conv-field-label">Vai trong prompt</p>
                  <div className="conv-speaker-tag-list">
                    {promptAnalysis.speakerNames.map((name) => (
                      <span className="conv-speaker-tag" key={name}>
                        {name}
                      </span>
                    ))}
                  </div>
                </div>

                <details className="conv-prompt-analysis-detail">
                  <summary>Format output GPT (mẫu)</summary>
                  <pre className="conv-prompt-format-preview">{promptAnalysis.formatExamples}</pre>
                </details>
              </section>

              <div className="conv-editor-shell conv-editor-shell--prompt">
                <div className="conv-editor-toolbar">
                  <span className="conv-editor-label">Nội dung prompt</span>
                  <div className="conv-meta-row conv-meta-row--inline">
                    <span className="conv-meta-pill">
                      {effectivePrompt.length.toLocaleString('vi-VN')} ký tự
                    </span>
                    {promptText.trim() ? (
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={resetCryptoPrompt}
                      >
                        Xóa ghi đè
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="conv-prompt-wrap conv-prompt-wrap--placeholder">
                  <textarea
                    className="conv-prompt"
                    rows={12}
                    value={promptText}
                    onChange={(e) => setPromptText(e.target.value)}
                    placeholder={promptPlaceholder}
                    spellCheck={false}
                  />
                </div>
              </div>

              {!usesPromptPlaceholder ? (
                <Alert
                  type="info"
                  compact
                  message="Prompt đã ghi đè — thay đổi Số tin / Số vai sẽ cập nhật các chỗ tương ứng trong prompt khi sao chép."
                />
              ) : null}

              <div className="conv-prompt-copy-actions">
                <button
                  type="button"
                  className="btn btn--primary btn--block"
                  onClick={() => void copyPrompt()}
                >
                  Sao chép prompt cho GPT
                </button>
              </div>
            </div>
          </div>

          <div className="panel conv-panel conv-panel--telegram">
            <div className="conv-panel-head">
              <div className="conv-panel-head-main">
                <ConvPanelIcon kind="telegram" />
                <div>
                  <p className="conv-panel-step">Bước 1 · Telegram</p>
                  <h2>Cấu hình gửi</h2>
                  <p className="panel-meta">Chọn nhóm, gán account cho từng vai và thiết lập delay.</p>
                </div>
              </div>
              <span className="conv-status-chip conv-status-chip--neutral">
                {effectiveSpeakerCount} vai
              </span>
            </div>
            <div className="conv-panel-body">
              <label className="field">
                <span>Link / Username nhóm</span>
                <input
                  className="conv-input"
                  value={groupLink}
                  onChange={(e) => setGroupLink(e.target.value)}
                  placeholder="https://t.me/group hoặc @username"
                />
              </label>

              <Alert type="warning" message={speakerFormError ?? ''} compact />

              <div className="conv-mode-box">
                <span className="conv-field-label">Chế độ hội thoại</span>
                <div className="conv-segment" role="group" aria-label="Chế độ hội thoại">
                  <button
                    type="button"
                    className={`conv-segment-btn${mode === 'two' ? ' conv-segment-btn--active' : ''}`}
                    onClick={() => setConversationMode('two')}
                  >
                    2 vai
                  </button>
                  <button
                    type="button"
                    className={`conv-segment-btn${mode === 'multi' ? ' conv-segment-btn--active' : ''}`}
                    onClick={() => setConversationMode('multi')}
                  >
                    Nhiều vai
                  </button>
                </div>
                <p className="conv-muted">
                  {mode === 'multi'
                    ? 'Map từng Person A/B/C... với một account.'
                    : 'Mặc định 2 tài khoản. Bật nhiều vai khi cần nhóm đông hơn.'}
                </p>
              </div>

              {mode === 'multi' ? (
                <div className="conv-hint-card conv-hint-card--info">
                  <span className="conv-hint-card-icon" aria-hidden>
                    ℹ
                  </span>
                  <p>
                    {multiSpeakers.length} vai — đồng bộ hai chiều với ô Prompt. Mỗi account chỉ
                    hiện ở một vai.
                  </p>
                </div>
              ) : null}

              {mode === 'two' ? (
                <div className="conv-two-speakers">
                  {[
                    { title: 'Vai A', badge: 'A', speaker: speakerA, setSpeaker: setSpeakerA, phone: phoneA, setPhone: setPhoneA },
                    { title: 'Vai B', badge: 'B', speaker: speakerB, setSpeaker: setSpeakerB, phone: phoneB, setPhone: setPhoneB },
                  ].map((item) => (
                    <div className="conv-speaker-card" key={item.title}>
                      <div className="conv-speaker-badge" aria-hidden>
                        {item.badge}
                      </div>
                      <div className="conv-speaker-fields">
                        <div className="conv-section-title">{item.title}</div>
                        <div className="conv-inline-grid">
                          <label className="field">
                            <span>Tên vai nói</span>
                            <input
                              className="conv-input"
                              value={item.speaker}
                              onChange={(e) => item.setSpeaker(e.target.value)}
                            />
                          </label>
                          <label className="field">
                            <span>Tài khoản</span>
                            <select
                              className="conv-input"
                              value={item.phone}
                              onChange={(e) => item.setPhone(e.target.value)}
                            >
                              <option value="">Chọn tài khoản</option>
                              {accountOptionsForRow(
                                item.phone,
                                item.title === 'Vai A' ? [phoneB] : [phoneA],
                              ).map((phone) => (
                                <option key={phone} value={phone}>
                                  {phone}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="conv-multi-map">
                  <div className="conv-section-title">Danh sách vai nói</div>
                  <div className="conv-multi-list">
                    {multiSpeakers.map((row, index) => (
                      <div className="conv-speaker-card conv-speaker-card--multi" key={`${row.speaker}-${index}`}>
                        <div className="conv-speaker-badge" aria-hidden>
                          {speakerBadgeLabel(row.speaker)}
                        </div>
                        <div className="conv-speaker-fields">
                          <div className="conv-inline-grid conv-inline-grid--3">
                            <label className="field">
                              <span>Tên vai</span>
                              <input
                                className="conv-input"
                                value={row.speaker}
                                onChange={(e) => {
                                  const value = e.target.value
                                  setMultiSpeakers((prev) =>
                                    prev.map((item, i) =>
                                      i === index ? { ...item, speaker: value } : item,
                                    ),
                                  )
                                }}
                              />
                            </label>
                            <label className="field">
                              <span>Tài khoản</span>
                              <select
                                className="conv-input"
                                value={row.phone}
                                onChange={(e) => {
                                  const value = e.target.value
                                  setMultiSpeakers((prev) =>
                                    prev.map((item, i) =>
                                      i === index ? { ...item, phone: value } : item,
                                    ),
                                  )
                                }}
                              >
                                <option value="">Chọn tài khoản</option>
                                {accountOptionsForRow(
                                  row.phone,
                                  multiSpeakers
                                    .filter((_, i) => i !== index)
                                    .map((item) => item.phone),
                                ).map((phone) => (
                                  <option key={phone} value={phone}>
                                    {phone}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <div className="conv-multi-actions">
                              <button
                                type="button"
                                className="btn btn--danger btn--sm"
                                disabled={multiSpeakers.length <= 2}
                                onClick={() => removeMultiSpeaker(index)}
                              >
                                Xóa
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="conv-toolbar">
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={multiSpeakers.length >= 10}
                      onClick={addMultiSpeaker}
                    >
                      + Thêm vai nói
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={handleDetectSpeakers}
                    >
                      Tự nhận diện từ nội dung
                    </button>
                  </div>
                </div>
              )}

              <div className="conv-delay-box">
                <div className="conv-switch-row">
                  <div>
                    <div className="conv-section-title">Delay tự động</div>
                    <div className="conv-muted">Nghỉ ngẫu nhiên giữa từng câu.</div>
                  </div>
                  <input
                    type="checkbox"
                    className="conv-toggle"
                    checked={enableDelay}
                    onChange={(e) => setEnableDelay(e.target.checked)}
                  />
                </div>
                <div className="conv-range-row">
                  <input
                    className="conv-input conv-delay-input"
                    type="number"
                    min={0}
                    value={timing.delay_min_sec}
                    disabled={!enableDelay}
                    onChange={(e) =>
                      setTiming((prev) => ({
                        ...prev,
                        delay_min_sec: Number(e.target.value || 0),
                      }))
                    }
                  />
                  <span className="conv-muted">đến</span>
                  <input
                    className="conv-input conv-delay-input"
                    type="number"
                    min={0}
                    value={timing.delay_max_sec}
                    disabled={!enableDelay}
                    onChange={(e) =>
                      setTiming((prev) => ({
                        ...prev,
                        delay_max_sec: Number(e.target.value || 0),
                      }))
                    }
                  />
                  <span className="conv-muted">giây</span>
                </div>
              </div>

              <div className="conv-delay-box">
                <div className="conv-switch-row">
                  <div>
                    <div className="conv-section-title">Delay khi đổi vai</div>
                    <div className="conv-muted">Khi chuyển từ vai này sang vai khác.</div>
                  </div>
                  <input
                    type="checkbox"
                    className="conv-toggle"
                    checked={enableSpeakerDelay}
                    onChange={(e) => setEnableSpeakerDelay(e.target.checked)}
                  />
                </div>
                <div className="conv-range-row">
                  <input
                    className="conv-input conv-delay-input"
                    type="number"
                    min={0}
                    value={timing.speaker_change_delay_min_sec}
                    disabled={!enableSpeakerDelay}
                    onChange={(e) =>
                      setTiming((prev) => ({
                        ...prev,
                        speaker_change_delay_min_sec: Number(e.target.value || 0),
                      }))
                    }
                  />
                  <span className="conv-muted">đến</span>
                  <input
                    className="conv-input conv-delay-input"
                    type="number"
                    min={0}
                    value={timing.speaker_change_delay_max_sec}
                    disabled={!enableSpeakerDelay}
                    onChange={(e) =>
                      setTiming((prev) => ({
                        ...prev,
                        speaker_change_delay_max_sec: Number(e.target.value || 0),
                      }))
                    }
                  />
                  <span className="conv-muted">giây</span>
                </div>
              </div>

              <div className="conv-options-box">
                <label className="conv-check-row">
                  <input
                    type="checkbox"
                    className="conv-toggle"
                    checked={replyOnSpeakerChange}
                    onChange={(e) => setReplyOnSpeakerChange(e.target.checked)}
                  />
                  <span>
                    Câu đầu của vai mới reply câu cuối của vai trước
                    <span className="conv-muted conv-check-hint">
                      {' '}
                      — bỏ qua nếu kịch bản đã có <code>reply_to</code>
                    </span>
                  </span>
                </label>
                <label className="conv-check-row">
                  <input
                    type="checkbox"
                    className="conv-toggle"
                    checked={continueOnError}
                    onChange={(e) => setContinueOnError(e.target.checked)}
                  />
                  <span>
                    Một câu lỗi vẫn chạy tiếp
                    <span className="conv-muted conv-check-hint">
                      {' '}
                      — tắt = dừng job, dùng Retry / Resume
                    </span>
                  </span>
                </label>
              </div>
            </div>
          </div>
        </div>

        <div className="conv-col conv-col--right">
          <div className="panel conv-panel conv-panel--script">
            <div className="conv-panel-head">
              <div className="conv-panel-head-main">
                <ConvPanelIcon kind="script" />
                <div>
                  <p className="conv-panel-step">Bước 2 · Kịch bản</p>
                  <h2>Nội dung hội thoại</h2>
                  <p className="panel-meta">
                    Dán output GPT — định dạng <code>#1 Person A: ...</code> hoặc Round / Person A.
                  </p>
                </div>
              </div>
              <span
                className={`conv-status-chip${scriptText.trim() ? ' conv-status-chip--edit' : ''}`}
              >
                {scriptModeLabel}
              </span>
            </div>
            <div className="conv-panel-body">
              <div className="conv-editor-shell">
                <div className="conv-editor-toolbar">
                  <span className="conv-editor-label">Kịch bản</span>
                  <div className="conv-meta-row conv-meta-row--inline">
                    <span className="conv-meta-pill">
                      {(scriptText.trim() ? scriptText : CONVERSATION_TEMPLATE).length.toLocaleString(
                        'vi-VN',
                      )}{' '}
                      ký tự
                    </span>
                    {scriptText.trim() ? (
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={clearScriptOverride}
                      >
                        Xóa nội dung đã dán
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="conv-script-wrap conv-script-wrap--placeholder">
                  <textarea
                    className="conv-script"
                    rows={13}
                    value={scriptText}
                    onChange={(e) => setScriptText(e.target.value)}
                    placeholder={CONVERSATION_TEMPLATE}
                    spellCheck={false}
                  />
                </div>
              </div>
              <div className="conv-action-bar">
                <div className="conv-action-group conv-action-group--primary">
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    disabled={busy || loading || Boolean(speakerFormError)}
                    onClick={() => void handleParse()}
                  >
                    Tách nội dung
                  </button>
                </div>
                <div className="conv-action-group">
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => void copyMessagesOnly()}
                  >
                    Sao chép nội dung tin
                  </button>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={resetProgress}>
                    Làm lại
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="panel conv-panel conv-panel--preview">
            <div className="conv-panel-head">
              <div className="conv-panel-head-main">
                <ConvPanelIcon kind="preview" />
                <div>
                  <p className="conv-panel-step">Bước 2 · Xem trước</p>
                  <h2>Xem trước &amp; gửi</h2>
                  <p className="panel-meta">Kiểm tra từng dòng, chọn dòng bắt đầu và chạy tác vụ.</p>
                </div>
              </div>
              {preview?.line_count ? (
                <span className="conv-status-chip conv-status-chip--success">
                  {preview.line_count} dòng
                </span>
              ) : null}
            </div>
            <div className="conv-panel-body">
              {parseIssues.length ? (
                <div className="conv-alert-list">
                  <p className="conv-field-label">Kết quả kiểm tra</p>
                  {parseErrors.map((item) => (
                    <Alert
                      key={`${item.code}-${item.line_id ?? item.message}`}
                      type="error"
                      compact
                      message={item.message}
                      disabled={!item.line_id}
                      onClick={
                        item.line_id ? () => focusIssueLine(item.line_id) : undefined
                      }
                    />
                  ))}
                  {parseWarnings.map((item) => (
                    <Alert
                      key={`${item.code}-${item.line_id ?? item.message}`}
                      type="warning"
                      compact
                      message={item.message}
                      disabled={!item.line_id}
                      onClick={
                        item.line_id ? () => focusIssueLine(item.line_id) : undefined
                      }
                    />
                  ))}
                </div>
              ) : null}

              <div className="conv-current">
                {activeLine ? (
                  <div className="conv-current-bubble">
                    <div className="conv-current-meta">
                      <span className="conv-pill">id {activeLine.lineId}</span>
                      <span className="conv-pill">GPT #{activeLine.scriptRef}</span>
                      {activeLine.round ? (
                        <span className="conv-pill">Round {activeLine.round}</span>
                      ) : null}
                      <span className="conv-pill conv-pill--accent">{activeLine.speakerLabel}</span>
                      <span className={statusBadgeClass(activeLine.status)}>
                        {lineStatusLabel(activeLine.status)}
                      </span>
                    </div>
                    <p className="conv-current-message">{activeLine.message}</p>
                  </div>
                ) : (
                  <div className="conv-current-empty">
                    <ConvEmptyChatIcon />
                    <p>Chưa có dòng nào. Bấm <strong>Tách nội dung</strong>.</p>
                  </div>
                )}
              </div>

              <div className="conv-action-bar conv-action-bar--run">
                <div className="conv-action-group conv-action-group--primary">
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    disabled={Boolean(runBlockReason)}
                    title={runBlockReason || undefined}
                    onClick={() => void handleRun(true)}
                  >
                    Chạy từ đầu
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={Boolean(runBlockReason)}
                    title={runBlockReason || undefined}
                    onClick={() => void handleRun(false)}
                  >
                    Chạy từ dòng đang chọn
                  </button>
                </div>
                <div className="conv-action-group">
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={!canResume}
                    title={resumeBlockReason || undefined}
                    onClick={() => void handleResume()}
                  >
                    Resume
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={busy || !canRetryLine}
                    title={retryBlockReason || undefined}
                    onClick={() => void handleRetryLine()}
                  >
                    Retry dòng chọn
                  </button>
                  <button
                    type="button"
                    className="btn btn--danger btn--sm"
                    disabled={Boolean(stopBlockReason)}
                    title={stopBlockReason || undefined}
                    onClick={() => void handleStop()}
                  >
                    Dừng
                  </button>
                </div>
              </div>
              {runBlockReason ? (
                <Alert type="warning" compact message={runBlockReason} />
              ) : null}

              <div className="conv-preview-filters">
                <span className="conv-field-label">Lọc bảng</span>
                <div className="conv-segment" role="group" aria-label="Lọc bảng xem trước">
                  {(
                    [
                      ['all', 'Tất cả'],
                      ['error', 'Lỗi'],
                      ['pending', 'Chưa gửi'],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={`conv-segment-btn${previewFilter === value ? ' conv-segment-btn--active' : ''}`}
                      onClick={() => setPreviewFilter(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div
                className="conv-preview-wrap table-wrap"
                id="conversationPreviewScroll"
                ref={previewScrollRef}
              >
                <table className="data-table conv-preview-table">
                  <thead>
                    <tr>
                      <th>id</th>
                      <th>GPT #</th>
                      <th>Lượt</th>
                      <th>Vai nói</th>
                      <th>Tài khoản</th>
                      <th>Nội dung</th>
                      <th>Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPreviewLines.map((line) => (
                      <tr
                        key={line.lineId}
                        data-line-id={line.lineId}
                        className={rowClass(line, activeLine?.lineId ?? 0)}
                        onClick={() => setActiveLineId(line.lineId)}
                      >
                        <td className="mono">{line.lineId}</td>
                        <td className="mono muted">{line.scriptRef}</td>
                        <td>{line.round || '—'}</td>
                        <td>{line.speakerLabel}</td>
                        <td className="phone">{line.phone || '—'}</td>
                        <td className="conv-table-message">{line.message}</td>
                        <td>
                          <span className={statusBadgeClass(line.status)} title={line.status}>
                            {lineStatusLabel(line.status)}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {!previewLines.length ? (
                      <tr>
                        <td colSpan={7} className="conv-empty-cell muted">
                          Chưa parse nội dung.
                        </td>
                      </tr>
                    ) : !filteredPreviewLines.length ? (
                      <tr>
                        <td colSpan={7} className="conv-empty-cell muted">
                          Không có dòng nào khớp bộ lọc.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="panel conv-panel conv-panel--job">
            <div className="conv-panel-head">
              <div className="conv-panel-head-main">
                <ConvPanelIcon kind="job" />
                <div>
                  <p className="conv-panel-step">Bước 3 · Tiến độ</p>
                  <h2>Thông báo tác vụ</h2>
                  <p className="panel-meta">Theo dõi tiến độ, resume / retry và lịch sử job.</p>
                </div>
              </div>
              {job ? (
                <span className={statusBadgeClass(job.status)} title={job.status}>
                  {jobStatusLabel(job.status)}
                </span>
              ) : (
                <span className="conv-status-chip conv-status-chip--neutral">Chưa chạy</span>
              )}
            </div>
            <div className="conv-panel-body conv-task-log">
              {jobHistory.length ? (
                <div className="conv-job-history">
                  <p className="conv-field-label">Lịch sử gần đây</p>
                  <ul className="conv-job-history-list">
                    {jobHistory.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          className={`conv-job-history-btn${job?.id === item.id ? ' conv-job-history-btn--active' : ''}`}
                          onClick={() => void handleLoadJob(item.id)}
                        >
                          <span className="conv-job-history-main">
                            <span className="mono">#{item.id}</span>
                            <span className={statusBadgeClass(item.status)} title={item.status}>
                              {jobStatusLabel(item.status)}
                            </span>
                            <span className="conv-muted">
                              {item.completed_lines}/{item.total_lines}
                            </span>
                          </span>
                          <span className="conv-job-history-meta">
                            <span className="conv-muted">{formatJobTime(item.created_at)}</span>
                            <span className="conv-job-history-group" title={item.group_link}>
                              {shortenGroupLink(item.group_link)}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {!job ? (
                <div className="conv-empty-job">
                  <ConvEmptyChatIcon />
                  <p>Chưa có tác vụ nào. Tách kịch bản rồi bấm <strong>Chạy từ đầu</strong>.</p>
                </div>
              ) : (
                <>
                  <div className="conv-progress-head">
                    <span className="conv-progress-label">
                      Tiến độ <strong>{job.completed_lines}</strong> / {job.total_lines}
                    </span>
                    <span className="conv-progress-pct">{jobPercent}%</span>
                  </div>
                  <div className="conv-progress-bar" aria-hidden>
                    <div
                      className={`conv-progress-bar-fill${job.error_lines > 0 ? ' conv-progress-bar-fill--error' : ''}`}
                      style={{ width: `${jobPercent}%` }}
                    />
                  </div>
                  <div className="conv-job-summary">
                    <span className="conv-job-stat conv-job-stat--ok">
                      {job.success_lines} đã gửi
                    </span>
                    <span className="conv-job-stat conv-job-stat--pending">
                      {pendingLineCount} chờ
                    </span>
                    <span className="conv-job-stat conv-job-stat--err">
                      {job.error_lines} lỗi
                    </span>
                  </div>
                  <ul className="conv-task-list">
                    {[...job.line_results]
                      .sort((a, b) => a.line_id - b.line_id)
                      .map((item) => (
                        <li
                          key={item.line_id}
                          className={`conv-task-item${item.status === 'pending' ? ' conv-task-item--pending' : ''}`}
                        >
                          <span className="conv-task-line mono">#{item.line_id}</span>
                          <span className="phone conv-task-phone">{item.phone || '—'}</span>
                          <span className={statusBadgeClass(item.status)} title={item.status}>
                            {lineStatusLabel(item.status)}
                          </span>
                          <span className="conv-muted conv-task-detail">
                            {item.detail ||
                              (item.status === 'pending' ? 'Chưa gửi' : '')}
                          </span>
                        </li>
                      ))}
                  </ul>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
