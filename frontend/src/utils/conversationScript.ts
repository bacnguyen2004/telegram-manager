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

export function speakersForApi(options: {
  mode: ConversationMode
  speakerA: string
  speakerB: string
  phoneA: string
  phoneB: string
  multiSpeakers: MultiSpeakerRow[]
}): ConversationSpeaker[] {
  if (options.mode === 'two') {
    return [
      { id: 'a', label: options.speakerA.trim() || 'Person A', phone: options.phoneA },
      { id: 'b', label: options.speakerB.trim() || 'Person B', phone: options.phoneB },
    ]
  }
  return options.multiSpeakers
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
    replyOnSpeakerChange?: boolean
    continueOnError?: boolean
  } = {},
): ConversationParseRequestPayload {
  return {
    script_text: scriptText,
    group_link: groupLink.trim(),
    speakers,
    timing: options.timing ?? DEFAULT_CONVERSATION_TIMING,
    reply_on_speaker_change: options.replyOnSpeakerChange ?? true,
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

export function lineStatusLabel(status: ConversationLineStatus | string): string {
  const map: Record<string, string> = {
    pending: 'chờ',
    running: 'đang gửi',
    success: 'đã gửi',
    error: 'lỗi',
    skipped: 'bỏ qua',
    done: 'hoàn thành',
    stopped: 'đã dừng',
  }
  return map[status] ?? status
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
