export interface ConversationSpeaker {
  id: string
  label: string
  phone: string
}

export interface ConversationTiming {
  delay_min_sec: number
  delay_max_sec: number
  speaker_change_delay_min_sec: number
  speaker_change_delay_max_sec: number
  typing_min_sec: number
  typing_max_sec: number
}

export interface ConversationLine {
  id: number
  script_ref: number
  speaker_id: string
  text: string
  reply_to?: number | null
}

export interface ConversationScript {
  version: number
  group_link: string
  peer_id?: string | null
  speakers: ConversationSpeaker[]
  lines: ConversationLine[]
  timing: ConversationTiming
  reply_on_speaker_change: boolean
  continue_on_error: boolean
}

export const DEFAULT_CONVERSATION_TIMING: ConversationTiming = {
  delay_min_sec: 5,
  delay_max_sec: 12,
  speaker_change_delay_min_sec: 15,
  speaker_change_delay_max_sec: 30,
  typing_min_sec: 2,
  typing_max_sec: 6,
}

export const CONVERSATION_TEMPLATE = `Round 1
Person A: Did you check the market today?
Person A: BTC still looks stable to me
Person B: Yeah, I was watching ETH this morning
Person B: Same here, nothing crazy yet
---
Round 2
Person A: Anyone joining the call tonight?
#6 Person B reply_to #1: Maybe, depends on work`

export function isDefaultConversationTemplate(text: string): boolean {
  return text.trim() === CONVERSATION_TEMPLATE.trim()
}

export function effectiveConversationScript(scriptText: string): string {
  return scriptText.trim() || CONVERSATION_TEMPLATE
}

export const CONVERSATION_DRAFT_KEY = 'telegram_manager_conversation_draft_v4'

export type ConversationMode = 'two' | 'multi'

export interface MultiSpeakerRow {
  speaker: string
  phone: string
}

export interface ConversationPreviewLine {
  lineId: number
  scriptRef: number
  round: string
  speakerLabel: string
  speakerId: string
  phone: string
  message: string
  replyTo: number | null
  status: ConversationLineResult['status']
  detail: string
}

export interface ConversationJobSummary {
  id: number
  status: string
  total_lines: number
  completed_lines: number
  success_lines: number
  error_lines: number
  group_link: string
  created_at: string
  updated_at: string
}

export interface ConversationJobListData {
  items: ConversationJobSummary[]
  total: number
  limit: number
  offset: number
}

export function normalizeSpeakerName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function detectSpeakersFromScript(scriptText: string): string[] {
  const speakers: string[] = []
  const seen = new Set<string>()
  for (const raw of scriptText.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || /^-{3,}$/.test(line) || /^Round\s+\d+/i.test(line)) continue
    const marker = line.match(/^(?:#\s*\d+\s+)?([^:]{1,80}?)(?:\s+reply(?:_to)?\s+#?\s*\d+)?\s*:/i)
    const simple = line.match(/^([^:]{1,80}):\s*/)
    const label = (marker?.[1] ?? simple?.[1] ?? '').trim()
    if (!label) continue
    const key = normalizeSpeakerName(label)
    if (!seen.has(key)) {
      seen.add(key)
      speakers.push(label)
    }
  }
  return speakers
}

export function configuredSpeakerKeys(speakers: ConversationSpeaker[]): Set<string> {
  return new Set(speakers.map((item) => normalizeSpeakerName(item.label)))
}

export function speakersMissingFromConfig(
  scriptText: string,
  speakers: ConversationSpeaker[],
): string[] {
  const configured = configuredSpeakerKeys(speakers)
  return detectSpeakersFromScript(scriptText).filter(
    (name) => !configured.has(normalizeSpeakerName(name)),
  )
}

export function buildMultiSpeakersFromDetected(
  detected: string[],
  previous: MultiSpeakerRow[],
  sessions: string[],
): MultiSpeakerRow[] {
  const previousMap = new Map(
    previous.map((row) => [normalizeSpeakerName(row.speaker), row.phone]),
  )
  const usedPhones: string[] = []
  return detected.map((speaker) => {
    const kept = previousMap.get(normalizeSpeakerName(speaker))?.trim() ?? ''
    const phone =
      kept && !usedPhones.includes(kept)
        ? kept
        : pickUnusedPhoneFromList(sessions, usedPhones)
    if (phone) usedPhones.push(phone)
    return { speaker, phone }
  })
}

export interface SummarizedParseIssue {
  message: string
  line_id?: number | null
}

export function summarizeParseIssues(issues: ConversationValidationIssue[]): SummarizedParseIssue[] {
  const skippedBySpeaker = new Map<string, { count: number; firstLineId?: number | null }>()
  const other: ConversationValidationIssue[] = []

  for (const item of issues) {
    if (item.code === 'skipped_line' && item.message.includes('khong nhan dien duoc vai')) {
      const match = item.message.match(/\(([^)]+)\)/)
      const speaker = match?.[1]?.trim() || '?'
      const entry = skippedBySpeaker.get(speaker) ?? { count: 0, firstLineId: item.line_id }
      entry.count += 1
      if (entry.firstLineId == null && item.line_id != null) {
        entry.firstLineId = item.line_id
      }
      skippedBySpeaker.set(speaker, entry)
      continue
    }
    other.push(item)
  }

  const lines: SummarizedParseIssue[] = []
  for (const [speaker, entry] of skippedBySpeaker) {
    lines.push({
      message: `${entry.count} dòng bị bỏ qua — vai "${speaker}" chưa được cấu hình (bấm Tách nội dung để tự nhận diện)`,
      line_id: entry.firstLineId,
    })
  }
  for (const item of other) {
    lines.push({ message: item.message, line_id: item.line_id })
  }
  return lines
}

export function summarizeParseIssueMessages(issues: ConversationValidationIssue[]): string[] {
  return summarizeParseIssues(issues).map((item) => item.message)
}

export function speakersForApi(multiSpeakers: MultiSpeakerRow[]): ConversationSpeaker[] {
  return multiSpeakers
    .filter((row) => row.speaker.trim())
    .map((row, index) => ({
      id: String.fromCharCode(97 + index),
      label: row.speaker.trim(),
      phone: row.phone,
    }))
}

export const MIN_CONVERSATION_SPEAKERS = 1
export const MAX_CONVERSATION_SPEAKERS = 10

const DEFAULT_SPEAKER_LABELS = [
  'An',
  'Bình',
  'Chi',
  'Dũng',
  'Em',
  'Phúc',
  'Giang',
  'Hà',
  'Minh',
  'Lan',
]

export function speakerLabelAt(index: number): string {
  return DEFAULT_SPEAKER_LABELS[index] ?? `Vai ${index + 1}`
}

export function nextSpeakerId(speakers: ConversationSpeaker[]): string {
  const used = new Set(speakers.map((item) => item.id))
  for (let code = 97; code <= 122; code += 1) {
    const id = String.fromCharCode(code)
    if (!used.has(id)) return id
  }
  let index = speakers.length + 1
  while (used.has(`s${index}`)) index += 1
  return `s${index}`
}

export function pickUnusedPhone(
  speakers: ConversationSpeaker[],
  sessions: string[],
): string {
  const used = new Set(speakers.map((item) => item.phone).filter(Boolean))
  return sessions.find((phone) => !used.has(phone)) ?? ''
}

export function pickUnusedPhoneFromList(
  sessions: string[],
  usedPhones: string[],
  currentPhone = '',
): string {
  const used = new Set(
    usedPhones.map((phone) => phone.trim()).filter((phone) => phone && phone !== currentPhone),
  )
  return sessions.find((phone) => !used.has(phone)) ?? ''
}

export function sessionOptionsForSpeaker(
  sessions: string[],
  usedPhones: string[],
  currentPhone: string,
): string[] {
  const trimmedCurrent = currentPhone.trim()
  const used = new Set(
    usedPhones.map((phone) => phone.trim()).filter((phone) => phone && phone !== trimmedCurrent),
  )
  return sessions.filter((phone) => !used.has(phone) || phone === trimmedCurrent)
}

export function createSpeaker(
  speakers: ConversationSpeaker[],
  sessions: string[],
): ConversationSpeaker {
  const index = speakers.length
  return {
    id: nextSpeakerId(speakers),
    label: speakerLabelAt(index),
    phone: pickUnusedPhone(speakers, sessions),
  }
}

export function defaultSpeakersFromPhones(
  phones: string[],
  count = Math.min(Math.max(phones.length, 2), MAX_CONVERSATION_SPEAKERS),
): ConversationSpeaker[] {
  const slots = Math.max(
    MIN_CONVERSATION_SPEAKERS,
    Math.min(count, phones.length, MAX_CONVERSATION_SPEAKERS),
  )
  return phones.slice(0, slots).map((phone, index) => ({
    id: String.fromCharCode(97 + index),
    label: speakerLabelAt(index),
    phone,
  }))
}

export function buildScriptPayload(
  groupLink: string,
  speakers: ConversationSpeaker[],
  scriptText: string,
  options: {
    timing?: ConversationTiming
    continueOnError?: boolean
  } = {},
): ConversationParseRequestPayload {
  return {
    script_text: scriptText,
    group_link: groupLink.trim(),
    speakers,
    timing: options.timing ?? DEFAULT_CONVERSATION_TIMING,
    reply_on_speaker_change: false,
    continue_on_error: options.continueOnError ?? false,
  }
}

export interface ConversationParseRequestPayload {
  script_text: string
  group_link: string
  peer_id?: string | null
  speakers: ConversationSpeaker[]
  timing: ConversationTiming
  reply_on_speaker_change: boolean
  continue_on_error: boolean
}

export interface ConversationValidationIssue {
  level: 'error' | 'warning'
  code: string
  message: string
  line_id?: number | null
}

export interface ConversationValidateData {
  valid: boolean
  line_count: number
  issues: ConversationValidationIssue[]
  script: ConversationScript | null
}

export interface ConversationLineResult {
  line_id: number
  speaker_id: string
  phone: string
  status: 'pending' | 'running' | 'success' | 'error' | 'skipped'
  message_id?: number | null
  reply_to_msg_id?: number | null
  detail?: string
}

export interface ConversationJobData {
  id: number
  status: 'pending' | 'running' | 'done' | 'stopped' | 'error'
  total_lines: number
  completed_lines: number
  success_lines: number
  error_lines: number
  group_link: string
  stop_requested: boolean
  line_results: ConversationLineResult[]
  script?: ConversationScript | null
  created_at: string
  updated_at: string
  error_message?: string | null
}

export function findDuplicatePhone(speakers: ConversationSpeaker[]): string | null {
  const seen = new Set<string>()
  for (const speaker of speakers) {
    const phone = speaker.phone.trim()
    if (!phone) continue
    if (seen.has(phone)) return phone
    seen.add(phone)
  }
  return null
}

export function duplicatePhoneMessage(speakers: ConversationSpeaker[]): string | null {
  const phone = findDuplicatePhone(speakers)
  if (!phone) return null
  const labels = speakers
    .filter((item) => item.phone.trim() === phone)
    .map((item) => item.label)
  return `Hai vai (${labels.join(', ')}) đang dùng cùng số ${phone}`
}

export function missingPhoneMessage(speakers: ConversationSpeaker[]): string | null {
  const missing = speakers.filter((item) => item.label.trim() && !item.phone.trim())
  if (!missing.length) return null
  return `Chưa chọn tài khoản cho: ${missing.map((item) => item.label).join(', ')}`
}

export function speakerConfigError(speakers: ConversationSpeaker[]): string | null {
  return duplicatePhoneMessage(speakers) ?? missingPhoneMessage(speakers)
}

export type ConversationLineStatus = ConversationLineResult['status']

export type PreviewLinePhase = 'todo' | 'live' | 'done' | 'skip' | 'fail'

export function previewLinePhase(status: ConversationLineStatus | string): PreviewLinePhase {
  if (status === 'success') return 'done'
  if (status === 'skipped') return 'skip'
  if (status === 'error') return 'fail'
  if (status === 'running') return 'live'
  return 'todo'
}

export function isActionablePreviewLine(status: ConversationLineStatus | string): boolean {
  return status === 'pending' || status === 'running' || status === 'error'
}

export function summarizePreviewLineStats(lines: ConversationPreviewLine[]) {
  const stats = {
    total: lines.length,
    todo: 0,
    live: 0,
    done: 0,
    skip: 0,
    fail: 0,
    actionable: 0,
  }
  for (const line of lines) {
    const phase = previewLinePhase(line.status)
    if (phase === 'todo') stats.todo += 1
    else if (phase === 'live') stats.live += 1
    else if (phase === 'done') stats.done += 1
    else if (phase === 'skip') stats.skip += 1
    else if (phase === 'fail') stats.fail += 1
  }
  stats.actionable = stats.todo + stats.live + stats.fail
  return stats
}

export function lineStatusLabel(status: ConversationLineStatus | string): string {
  const map: Record<string, string> = {
    pending: 'chờ',
    running: 'đang gửi',
    success: 'đã gửi',
    error: 'lỗi',
    skipped: 'không chạy',
    done: 'hoàn thành',
    stopped: 'đã dừng',
  }
  return map[status] ?? status
}

export interface DeckLogEntry {
  lineId: number
  speakerLabel: string
  phone: string
  message: string
  status: ConversationLineStatus
  detail: string
  messageId?: number | null
  replyToMsgId?: number | null
  replyToLineId?: number | null
}

const GENERIC_DECK_DETAILS = new Set([
  '',
  'da gui',
  'da gui tin nhan',
  'da gui truoc',
  'da tra loi tin nhan',
  'dang gui...',
  'dang gui',
  'gui that bai',
  'khong gui duoc',
])

function normalizeDeckDetail(detail: string): string {
  return detail.trim().toLowerCase().replace(/\s+/g, ' ')
}

function isGenericDeckDetail(detail: string): boolean {
  const normalized = normalizeDeckDetail(detail)
  if (GENERIC_DECK_DETAILS.has(normalized)) return true
  return /^dang go \(\d+s\)\.{0,3}$/.test(normalized)
}

function humanizeDeckDetailPart(part: string): string {
  const normalized = normalizeDeckDetail(part)
  const map: Record<string, string> = {
    'da gui': 'Đã gửi',
    'da gui tin nhan': 'Đã gửi tin nhắn',
    'da gui truoc': 'Giữ từ job trước',
    'da tra loi tin nhan': 'Đã trả lời tin nhắn',
    'dang gui...': 'Đang gửi…',
    'dang gui': 'Đang gửi…',
    'gui that bai': 'Gửi thất bại',
    'khong gui duoc': 'Không gửi được',
    'khong tim thay vai': 'Không tìm thấy vai diễn',
    'khong tim thay vai dien': 'Không tìm thấy vai diễn',
    'giu tu job truoc': 'Giữ từ job trước',
  }
  if (map[normalized]) return map[normalized]
  const typing = normalized.match(/^dang go \((\d+)s\)\.{0,3}$/)
  if (typing) return `Đang gõ (${typing[1]}s)…`
  const typed = normalized.match(/^go (\d+)s$/)
  if (typed) return `Đã gõ ${typed[1]}s`
  const waitDelay = normalized.match(/^cho delay \((\d+)s\) — (doi nguoi|cung nguoi)$/)
  if (waitDelay) {
    const kind = waitDelay[2] === 'doi nguoi' ? 'đổi người' : 'cùng người'
    return `Chờ delay ${waitDelay[1]}s · ${kind}`
  }
  const skipFrom = normalized.match(/^bo qua — chay tu dong #(\d+)$/)
  if (skipFrom) return `Bỏ qua — chạy từ dòng #${skipFrom[1]}`
  if (normalized === 'bo qua') return 'Bỏ qua — không nằm trong lượt chạy'
  const replyLine = normalized.match(/^tra loi dong #(\d+)$/)
  if (replyLine) return `Trả lời dòng #${replyLine[1]}`
  const tgMsg = normalized.match(/^tg #(\d+)$/)
  if (tgMsg) return `TG #${tgMsg[1]}`
  const replyTg = normalized.match(/^reply tg #(\d+)$/)
  if (replyTg) return `Reply TG #${replyTg[1]}`
  return part.trim()
}

function humanizeDeckDetail(detail: string): string {
  if (!detail.includes('·')) {
    return humanizeDeckDetailPart(detail)
  }
  return detail
    .split('·')
    .map((part) => humanizeDeckDetailPart(part))
    .filter(Boolean)
    .join(' · ')
}

function deckDetailIsRich(detail: string): boolean {
  const normalized = normalizeDeckDetail(detail)
  if (!detail.trim() || isGenericDeckDetail(detail)) return false
  return (
    detail.includes('·') ||
    normalized.includes('tg #') ||
    normalized.includes('tra loi dong #') ||
    normalized.includes('reply tg #') ||
    normalized.includes('giu tu job truoc') ||
    normalized.includes('bo qua —') ||
    normalized.includes('cho delay (') ||
    normalized.includes('go ')
  )
}

export function deckLogShowMeta(entry: DeckLogEntry): boolean {
  if (entry.status === 'error' || entry.status === 'running') return true
  const detail = (entry.detail || '').trim()
  if (!detail) return false
  const normalized = detail.toLowerCase()
  if (entry.status === 'pending' && normalized.includes('cho delay')) return true
  if (entry.status === 'success' && normalized.includes('go ')) return true
  return (
    normalized.includes('flood') ||
    normalized.includes('dang go') ||
    normalized.includes('khong tim thay') ||
    normalized.includes('khong gui')
  )
}

export function formatDeckLogMeta(entry: DeckLogEntry): string {
  const parts: string[] = []
  const detail = entry.detail?.trim() ?? ''
  const normalizedDetail = normalizeDeckDetail(detail)

  if (entry.phone) {
    parts.push(entry.phone)
  }

  const detailHasReplyLine =
    entry.replyToLineId != null &&
    normalizedDetail.includes(`tra loi dong #${entry.replyToLineId}`)
  const detailHasReplyMsg =
    entry.replyToMsgId != null &&
    normalizedDetail.includes(`reply tg #${entry.replyToMsgId}`)

  if (entry.replyToLineId != null && !detailHasReplyLine) {
    parts.push(`Trả lời #${entry.replyToLineId}`)
  } else if (
    entry.replyToMsgId != null &&
    entry.status !== 'pending' &&
    !detailHasReplyMsg &&
    !detailHasReplyLine
  ) {
    parts.push(`Reply TG #${entry.replyToMsgId}`)
  }

  if (entry.status === 'success') {
    if (deckDetailIsRich(detail)) {
      parts.push(humanizeDeckDetail(detail))
    } else {
      if (entry.messageId != null) {
        parts.push(`TG #${entry.messageId}`)
      }
      if (detail && !isGenericDeckDetail(detail)) {
        parts.push(humanizeDeckDetail(detail))
      } else {
        parts.push('Đã gửi')
      }
    }
    return parts.join(' · ')
  }

  if (entry.status === 'error') {
    if (detail) {
      parts.push(humanizeDeckDetail(detail))
    } else {
      parts.push('Gửi thất bại')
    }
    return parts.join(' · ')
  }

  if (entry.status === 'running') {
    parts.push(detail ? humanizeDeckDetail(detail) : 'Đang gửi…')
    return parts.join(' · ')
  }

  if (entry.status === 'skipped') {
    parts.push(detail ? humanizeDeckDetail(detail) : 'Không nằm trong lượt chạy')
    return parts.join(' · ')
  }

  if (entry.status === 'pending') {
    if (detail) {
      parts.push(humanizeDeckDetail(detail))
    } else {
      parts.push('Chờ đến lượt')
    }
    return parts.join(' · ')
  }

  if (detail) {
    parts.push(humanizeDeckDetail(detail))
  }

  return parts.join(' · ') || '—'
}

export function scriptTextFromJobScript(script: ConversationScript): string {
  return script.lines
    .map((line) => {
      const speaker = script.speakers.find((item) => item.id === line.speaker_id)
      const label = speaker?.label ?? line.speaker_id
      const refPrefix = line.script_ref !== line.id ? `#${line.script_ref} ` : ''
      const replySuffix = line.reply_to != null ? ` reply_to #${line.reply_to}` : ''
      return `${refPrefix}${label}${replySuffix}: ${line.text}`
    })
    .join('\n')
}

export function speakerLabel(
  speakers: ConversationSpeaker[],
  speakerId: string,
): string {
  return speakers.find((item) => item.id === speakerId)?.label ?? speakerId
}

export function saveConversationDraft(data: Record<string, unknown>) {
  try {
    localStorage.setItem(CONVERSATION_DRAFT_KEY, JSON.stringify(data))
  } catch {
    // ignore quota errors
  }
}

const LEGACY_CONVERSATION_DRAFT_KEYS = [
  CONVERSATION_DRAFT_KEY,
  'telegram_manager_conversation_draft_v3',
  'telegram_manager_conversation_draft_v2',
]

export function loadConversationDraft(): Record<string, unknown> | null {
  try {
    for (const key of LEGACY_CONVERSATION_DRAFT_KEYS) {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      return JSON.parse(raw) as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

export function buildRoundMap(scriptText: string): Map<number, string> {
  const rounds = new Map<number, string>()
  let currentRound = ''
  let autoId = 1
  for (const raw of scriptText.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const roundMatch = line.match(/^Round\s+(\d+)/i)
    if (roundMatch) {
      currentRound = roundMatch[1]
      continue
    }
    if (/^-{3,}$/.test(line)) continue
    const marker = line.match(/^#\s*(\d+)\s+/i)
    const lineId = marker ? Number(marker[1]) : autoId++
    if (marker) autoId = Math.max(autoId, lineId + 1)
    if (currentRound) rounds.set(lineId, currentRound)
  }
  return rounds
}

export function previewFromJobScript(
  script: ConversationScript,
  _lineResults?: ConversationLineResult[],
): ConversationValidateData {
  return {
    valid: true,
    line_count: script.lines.length,
    issues: [],
    script,
  }
}

export function buildPreviewLines(
  script: ConversationScript,
  scriptText: string,
  lineResults?: ConversationLineResult[],
): ConversationPreviewLine[] {
  const roundMap = buildRoundMap(scriptText)
  const resultMap = new Map((lineResults ?? []).map((item) => [item.line_id, item]))
  return script.lines.map((line) => {
    const result = resultMap.get(line.id)
    const speaker = script.speakers.find((item) => item.id === line.speaker_id)
    return {
      lineId: line.id,
      scriptRef: line.script_ref ?? line.id,
      round: roundMap.get(line.script_ref ?? line.id) ?? roundMap.get(line.id) ?? '',
      speakerLabel: speaker?.label ?? line.speaker_id,
      speakerId: line.speaker_id,
      phone: speaker?.phone ?? result?.phone ?? '',
      message: line.text,
      replyTo: line.reply_to ?? null,
      status: result?.status ?? 'pending',
      detail: result?.detail ?? (line.reply_to ? `Reply #${line.reply_to}` : ''),
    }
  })
}
