import { useEffect, useMemo, useRef, useState } from 'react'
import './CampaignPage.css'
import { api } from '../api/client'
import {
  AccountPickerPanel,
  type AccountPickerFilterState,
} from '../components/AccountPickerPanel'
import { Alert } from '../components/Alert'
import { useSessionAccounts } from '../hooks/useSessionAccounts'
import type {
  CampaignAiStatusData,
  CampaignGoalConflict,
  CampaignGoalTone,
  CampaignGoalTopic,
  CampaignMarketContext,
  CampaignPlan,
  CampaignPlanLine,
  CampaignSpeaker,
} from '../types/api'
import type { ConversationJobData } from '../types/api'
import {
  clampDurationMin,
  clampTargetLines,
  densityLabel,
  formatDurationHint,
  MAX_DURATION_MIN,
  MAX_TARGET_LINES,
  MIN_DURATION_MIN,
  MIN_TARGET_LINES,
  suggestDurationFromLines,
  type CampaignDensity,
} from '../utils/campaignTiming'
import { resolveSessionName } from '../utils/sessionDisplay'

const ROLES = [
  {
    value: 'lead',
    label: 'Lead',
    short: 'Nói nhiều hơn một chút',
    hint: 'Peer hay note chart — cũng hỏi / đoán sai, không host',
  },
  {
    value: 'reactor',
    label: 'Reactor',
    short: 'Phản ứng nhanh',
    hint: 'Nhanh, cảm xúc — không phải câu nào cũng Lol/Ouch/Pain',
  },
  {
    value: 'echo',
    label: 'Echo',
    short: 'Riff / phản biện',
    hint: 'Đôi khi đồng ý, đôi khi phản biện hoặc đổi góc',
  },
  {
    value: 'member',
    label: 'Member',
    short: 'Ít nói',
    hint: 'Yên, thỉnh thoảng mở topic mới',
  },
  {
    value: 'degen',
    label: 'Degen',
    short: 'Risk-on',
    hint: 'FOMO / size — cũng biết sợ và ngồi ngoài',
  },
  {
    value: 'skeptic',
    label: 'Skeptic',
    short: 'Thận trọng',
    hint: 'Nghi pump — thỉnh thoảng thừa nhận move thật',
  },
  {
    value: 'lurker',
    label: 'Lurker',
    short: 'Hiếm',
    hint: 'Ít xuất hiện, đôi khi một câu sắc',
  },
] as const

type RoleValue = (typeof ROLES)[number]['value']

function roleMeta(value: string) {
  return ROLES.find((r) => r.value === value) ?? ROLES[3]
}

const DENSITY_OPTIONS: { value: CampaignDensity; label: string }[] = [
  { value: 'light', label: 'Thưa' },
  { value: 'normal', label: 'Vừa' },
  { value: 'dense', label: 'Dày' },
]

type SetupTab = 'group' | 'goal' | 'market' | 'cast'

const SETUP_TABS: { id: SetupTab; label: string; hint: string; step: string }[] = [
  { id: 'group', label: 'Nhóm', hint: 'Link & nhịp', step: '1' },
  { id: 'goal', label: 'Goal', hint: 'Ngôn ngữ & vibe', step: '2' },
  { id: 'market', label: 'Market', hint: 'Giá & tin', step: '3' },
  { id: 'cast', label: 'Cast', hint: 'Vai acc', step: '4' },
]

/** Structured vibe — no freeform essay. Goal is compiled, not written. */
type VibeId = 'casual' | 'debate' | 'cautious' | 'warmup'

const VIBE_OPTIONS: {
  id: VibeId
  label: string
  descEn: string
  descVi: string
  tone: CampaignGoalTone
  conflict: CampaignGoalConflict
  topic: CampaignGoalTopic
}[] = [
  {
    id: 'casual',
    label: 'Casual',
    descEn: 'Friends chat · price vibe',
    descVi: 'Bạn bè chat · giá',
    tone: 'casual',
    conflict: 'low',
    topic: 'btc_eth',
  },
  {
    id: 'debate',
    label: 'Debate',
    descEn: 'Bull vs cautious',
    descVi: 'Lạc quan vs thận trọng',
    tone: 'debate',
    conflict: 'medium',
    topic: 'btc_eth',
  },
  {
    id: 'cautious',
    label: 'Cautious',
    descEn: 'Skeptical takes',
    descVi: 'Giọng thận trọng',
    tone: 'skeptical',
    conflict: 'low',
    topic: 'btc_eth',
  },
  {
    id: 'warmup',
    label: 'Warm-up',
    descEn: 'Quiet group start',
    descVi: 'Warm-up yên',
    tone: 'casual',
    conflict: 'none',
    topic: 'btc_eth',
  },
]

function compileStructuredGoal(opts: {
  language: string
  vibe: VibeId
  useNews: boolean
  note: string
}): string {
  const vi = opts.language === 'vi'
  const note = opts.note.trim().slice(0, 120)

  if (vi) {
    const toneMap: Record<VibeId, string> = {
      casual: 'Bạn bè chat ĐT về BTC/ETH hôm nay — giá + vibe, không giọng MC.',
      debate: 'Bạn bè cãi nhẹ market hôm nay (một bull, một thận trọng), vẫn giọng ĐT.',
      cautious: 'Group chat thận trọng về market hôm nay, không FUD, không báo cáo.',
      warmup: 'Group im: 1 câu len chuyện rồi vào giá BTC/ETH (không chào cả group).',
    }
    const bits = [
      toneMap[opts.vibe] || toneMap.casual,
      'Câu rất ngắn (4–12 từ), viết hoa chữ đầu, tiếng Việt đời thường.',
      'CẤM: chào mn / morning all / nói chung thị trường / giọng chuyên gia / tóm tắt cuối.',
      'CẤM xoay vòng A-B-C-D-A-B-C-D: thứ tự nói lộn xộn, lead nói nhiều hơn, có người nói 2 câu gần nhau.',
      'Ack ngắn được (Ok/Ừ/Chốt/Lụm; EN: Yep/Exactly cũng 1–2 lần) — cả plan dài ~2–3 lần, rải thưa, không spam; cấm dump tin.',
      'Giá live kiểu khoảng/gần; tin đã chọn chỉ bàn tán thưa thớt (diễn lại).',
    ]
    if (note) bits.push(note)
    return bits.join(' ')
  }

  const toneMap: Record<VibeId, string> = {
    casual: 'Friends texting today BTC/ETH on phones — price + vibe, not a market show.',
    debate: 'Light bull vs cautious debate, still phone chat not a panel.',
    cautious: 'Cautious group texts about today market — no FUD essay, no report tone.',
    warmup: 'Quiet start into BTC/ETH prices (no big group greeting).',
  }
  const bits = [
    toneMap[opts.vibe] || toneMap.casual,
    'Very short texts (4–12 words), first letter capital, English only.',
    'FORBIDDEN: "Morning all", "Overall…", analyst speak, news dumps, strict A-B-C-D-A-B-C-D speaker order.',
    'Speaker order must be messy/uneven (not a panel). Lead can talk more; occasional back-to-back ok.',
    'Short acks OK sparingly: Ok/True/Yep/Exactly ~2–3 total in a long plan (1–2 Yep/Exactly fine), spread out — never spam chains.',
    'Live prices as around/near only.',
    opts.useNews
      ? 'Selected news: rare gossip only, never headline dumps.'
      : 'Price + vibe only; invent no headlines.',
  ]
  if (note) bits.push(note)
  return bits.join(' ')
}

function speakerIdFromIndex(index: number): string {
  return String.fromCharCode(97 + (index % 26))
}

function formatAt(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function previewText(text: string, max = 72): string {
  const t = (text || '').replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

function colorClass(id: string): string {
  const n = Math.max(0, id.toLowerCase().charCodeAt(0) - 97) % 8
  return `cg-c${n}`
}

function jobProgress(job: ConversationJobData): number {
  if (!job.total_lines) return 0
  return Math.min(100, Math.round((job.completed_lines / job.total_lines) * 100))
}

type WaitPhase = 'typing' | 'delay' | 'sending' | 'idle'

type ActiveWaitInfo = {
  lineId: number
  speakerId: string
  phone: string
  phase: WaitPhase
  /** Full wait seconds reported by backend when the phase started */
  totalSec: number | null
  detail: string
  key: string
}

/** Parse runner detail strings: "Dang go (4s)..." / "Cho delay (12s) — doi nguoi" */
function parseActiveWait(job: ConversationJobData | null): ActiveWaitInfo | null {
  if (!job?.line_results?.length) return null
  const running = job.line_results.find((r) => r.status === 'running')
  const waiting = job.line_results.find(
    (r) =>
      r.status === 'pending' &&
      /cho delay|chờ delay/i.test(r.detail || ''),
  )
  const active = running || waiting
  if (!active) return null

  const detail = active.detail || ''
  let phase: WaitPhase = 'idle'
  let totalSec: number | null = null

  const typingMatch = detail.match(/(?:dang go|đang gõ)\s*\((\d+)\s*s\)/i)
  const delayMatch = detail.match(/(?:cho delay|chờ delay)\s*\((\d+)\s*s\)/i)

  if (typingMatch) {
    phase = 'typing'
    totalSec = Number(typingMatch[1])
  } else if (delayMatch) {
    phase = 'delay'
    totalSec = Number(delayMatch[1])
  } else if (active.status === 'running') {
    phase = 'sending'
  }

  return {
    lineId: active.line_id,
    speakerId: active.speaker_id,
    phone: active.phone || '',
    phase,
    totalSec: totalSec != null && Number.isFinite(totalSec) ? totalSec : null,
    detail,
    key: `${active.line_id}:${active.status}:${detail}`,
  }
}

function phaseLabel(phase: WaitPhase): string {
  if (phase === 'typing') return 'Đang gõ'
  if (phase === 'delay') return 'Chờ lượt'
  if (phase === 'sending') return 'Đang gửi'
  return 'Chờ'
}

function lineStatusLabel(status: string): string {
  const map: Record<string, string> = {
    pending: 'Chờ',
    running: 'Đang chạy',
    success: 'Thành công',
    error: 'Lỗi',
    skipped: 'Bỏ qua',
  }
  return map[status] || status
}

/** Map Telethon / runner detail → readable Vietnamese for timeline + log. */
function humanizeRunDetail(detail: string): string {
  const raw = (detail || '').trim()
  if (!raw) return ''
  const lower = raw.toLowerCase()
  if (
    lower.includes("you can't write in this chat") ||
    lower.includes('you cant write in this chat') ||
    lower.includes("can't write in this chat")
  ) {
    return (
      'Acc không gửi được trong group này (chưa join / bị mute / mất quyền chat). ' +
      'Vào Telegram bằng đúng số đó, join group rồi thử lại. · ' +
      raw
    )
  }
  if (lower.includes('chat write forbidden') || lower.includes('chatwriteforbidden')) {
    return 'Group cấm gửi tin (ChatWriteForbidden) — kiểm tra quyền acc. · ' + raw
  }
  if (lower.includes('user is banned') || lower.includes('userbannedinchannel')) {
    return 'Acc bị ban khỏi group/channel. · ' + raw
  }
  if (lower.includes('flood wait')) {
    return 'Telegram giới hạn tần suất (Flood wait) — chờ rồi chạy lại. · ' + raw
  }
  if (lower.includes('session chua dang nhap') || lower.includes('authorization key')) {
    return 'Session hết hạn / chưa login — login lại acc. · ' + raw
  }
  if (lower.includes('khong tim thay file session')) {
    return 'Thiếu file .session cho số này. · ' + raw
  }
  if (lower.includes('not a participant') || lower.includes('user not participant')) {
    return 'Acc chưa là thành viên group. · ' + raw
  }
  return raw
}

export function CampaignPage() {
  const { sessions, loading, getMeta } = useSessionAccounts()
  const [selectedPhones, setSelectedPhones] = useState<Set<string>>(new Set())
  const [filterState, setFilterState] = useState<AccountPickerFilterState>({
    filteredCount: 0,
    totalCount: 0,
    hasFilters: false,
  })
  const [rolesByPhone, setRolesByPhone] = useState<Record<string, string>>({})

  const [vibe, setVibe] = useState<VibeId>('casual')
  const [goalUseNews, setGoalUseNews] = useState(true)
  const [goalNote, setGoalNote] = useState('')
  const [groupLink, setGroupLink] = useState('')
  const [targetLines, setTargetLines] = useState(22)
  const [density, setDensity] = useState<CampaignDensity>('normal')
  const [durationMin, setDurationMin] = useState(() => suggestDurationFromLines(22, 'normal'))
  const [durationLocked, setDurationLocked] = useState(false)
  const [language, setLanguage] = useState('en')
  const [useMarketContext, setUseMarketContext] = useState(true)
  const [market, setMarket] = useState<CampaignMarketContext | null>(null)
  /** Keys: `${source}::${title}` for stable checkbox state */
  const [selectedNewsKeys, setSelectedNewsKeys] = useState<Set<string>>(new Set())
  const [mustNewsKeys, setMustNewsKeys] = useState<Set<string>>(new Set())
  const [newsQuery, setNewsQuery] = useState('')
  const [newsTagFilter, setNewsTagFilter] = useState<string[]>([])
  const [newsKeywordInput, setNewsKeywordInput] = useState('')

  const [aiStatus, setAiStatus] = useState<CampaignAiStatusData | null>(null)
  const [aiModel, setAiModel] = useState('')
  const [plan, setPlan] = useState<CampaignPlan | null>(null)
  const [speakers, setSpeakers] = useState<CampaignSpeaker[]>([])
  const [planning, setPlanning] = useState(false)
  const [starting, setStarting] = useState(false)
  const [job, setJob] = useState<ConversationJobData | null>(null)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const pollRef = useRef<number | null>(null)
  /** Client countdown for current typing/delay phase (resets when phase key changes). */
  const waitCountdownRef = useRef<{ key: string; endsAt: number; totalSec: number } | null>(
    null,
  )
  const [waitRemainSec, setWaitRemainSec] = useState<number | null>(null)

  const [injectAngle, setInjectAngle] = useState('')
  const [injectLineCount, setInjectLineCount] = useState(3)
  const [injectNewsKeys, setInjectNewsKeys] = useState<Set<string>>(new Set())
  const [injecting, setInjecting] = useState(false)
  const [injectCooldownUntil, setInjectCooldownUntil] = useState(0)
  const [setupTab, setSetupTab] = useState<SetupTab>('group')
  const [modelModalOpen, setModelModalOpen] = useState(false)

  function newsKey(source: string, title: string): string {
    return `${source}::${title}`
  }

  function applyMarketData(
    data: CampaignMarketContext,
    options?: { preferKeepSelection?: boolean },
  ) {
    const preferKeepSelection = Boolean(options?.preferKeepSelection)
    setMarket(data)
    const items = data.news ?? []
    setSelectedNewsKeys((prev) => {
      if (preferKeepSelection && prev.size > 0) {
        const next = new Set<string>()
        for (const n of items) {
          const k = newsKey(n.source, n.title)
          if (prev.has(k)) next.add(k)
        }
        if (next.size > 0) return next
      }
      const next = new Set<string>()
      for (const n of items.slice(0, 4)) {
        next.add(newsKey(n.source, n.title))
      }
      return next
    })
    setMustNewsKeys((prev) => {
      if (!preferKeepSelection || prev.size === 0) return new Set()
      const next = new Set<string>()
      for (const n of items) {
        const k = newsKey(n.source, n.title)
        if (prev.has(k)) next.add(k)
      }
      return next
    })
  }

  function loadMarket(refresh = false) {
    void api
      .campaignMarket(refresh, { q: newsQuery, tags: newsTagFilter })
      .then((res) => {
        if (res.success && res.data) {
          // Keep checked headlines across reloads/filters when titles still exist
          applyMarketData(res.data, { preferKeepSelection: true })
          if (refresh && !res.data.news?.length) {
            setError(
              res.data.news_error ||
                'Vẫn không có tin — thử bỏ filter hoặc kiểm tra mạng RSS',
            )
          }
        } else if (refresh) setError(res.error || 'Không tải được market')
      })
  }

  useEffect(() => {
    void api.campaignAiStatus().then((res) => {
      if (res.success && res.data) {
        setAiStatus(res.data)
        const models = res.data.models?.length
          ? res.data.models
          : res.data.model
            ? [res.data.model]
            : []
        setAiModel((prev) => {
          if (prev && models.includes(prev)) return prev
          return res.data?.model || models[0] || ''
        })
      }
    })
    loadMarket(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load only
  }, [])

  const aiModelOptions = useMemo(() => {
    const fromStatus = aiStatus?.models?.length
      ? aiStatus.models
      : aiStatus?.model
        ? [aiStatus.model]
        : []
    if (aiModel && !fromStatus.includes(aiModel)) {
      return [aiModel, ...fromStatus]
    }
    return fromStatus
  }, [aiStatus, aiModel])

  const selectedNewsTitles = useMemo(() => {
    if (!market?.news?.length) return [] as string[]
    return market.news
      .filter((n) => selectedNewsKeys.has(newsKey(n.source, n.title)))
      .map((n) => n.title)
  }, [market, selectedNewsKeys])

  const mustNewsTitles = useMemo(() => {
    if (!market?.news?.length) return [] as string[]
    return market.news
      .filter((n) => mustNewsKeys.has(newsKey(n.source, n.title)))
      .map((n) => n.title)
  }, [market, mustNewsKeys])

  const newsKeywords = useMemo(() => {
    return newsKeywordInput
      .split(/[,，;]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 12)
  }, [newsKeywordInput])

  function toggleNews(source: string, title: string) {
    const k = newsKey(source, title)
    setSelectedNewsKeys((prev) => {
      const next = new Set(prev)
      if (next.has(k)) {
        next.delete(k)
        setMustNewsKeys((m) => {
          const nm = new Set(m)
          nm.delete(k)
          return nm
        })
      } else next.add(k)
      return next
    })
  }

  function toggleMustNews(source: string, title: string) {
    const k = newsKey(source, title)
    setMustNewsKeys((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else {
        next.add(k)
        setSelectedNewsKeys((sel) => new Set(sel).add(k))
      }
      return next
    })
  }

  function selectAllNews() {
    if (!market?.news?.length) return
    setSelectedNewsKeys(new Set(market.news.map((n) => newsKey(n.source, n.title))))
  }

  function clearNewsSelection() {
    setSelectedNewsKeys(new Set())
    setMustNewsKeys(new Set())
  }

  function toggleNewsTag(tag: string) {
    setNewsTagFilter((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    )
  }

  const compiledGoal = useMemo(
    () =>
      compileStructuredGoal({
        language,
        vibe,
        useNews: goalUseNews && useMarketContext,
        note: goalNote,
      }),
    [language, vibe, goalUseNews, useMarketContext, goalNote],
  )

  async function handleInject() {
    if (!job?.id) return
    if (Date.now() < injectCooldownUntil) {
      setError('Chờ cooldown inject (~30s)')
      return
    }
    setInjecting(true)
    setError('')
    try {
      const titles =
        market?.news
          ?.filter((n) => injectNewsKeys.has(newsKey(n.source, n.title)))
          .map((n) => n.title) ?? []
      const res = await api.injectCampaignJob(job.id, {
        angle: injectAngle.trim(),
        selected_news: titles,
        line_count: injectLineCount,
        use_live_price: true,
        model: aiModel.trim() || undefined,
      })
      if (!res.success || !res.data) {
        setError(res.error || 'Inject thất bại')
        return
      }
      setInfo(
        `Đã chèn ${res.data.injected_count} dòng · total ${res.data.new_total_lines}`,
      )
      setInjectCooldownUntil(Date.now() + 30_000)
      const jobRes = await api.getCampaignJob(job.id)
      if (jobRes.success && jobRes.data) setJob(jobRes.data)
      if (plan && res.data.lines?.length) {
        setPlan({
          ...plan,
          lines: [
            ...plan.lines,
            ...res.data.lines.map((ln) => ({
              ...ln,
              reply_to_line: ln.reply_to_line ?? null,
            })),
          ],
        })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Inject thất bại')
    } finally {
      setInjecting(false)
    }
  }

  useEffect(() => {
    return () => {
      if (pollRef.current != null) window.clearInterval(pollRef.current)
    }
  }, [])

  const cast: CampaignSpeaker[] = useMemo(() => {
    const phones = Array.from(selectedPhones)
    return phones.map((phone, index) => {
      const meta = getMeta(phone)
      const label = resolveSessionName(meta) || meta?.username || phone
      return {
        id: speakerIdFromIndex(index),
        label: String(label).slice(0, 80),
        phone,
        role:
          rolesByPhone[phone] ||
          ROLES[Math.min(index, ROLES.length - 1)]?.value ||
          'member',
      }
    })
  }, [selectedPhones, rolesByPhone, getMeta])

  const castRoleSummary = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of cast) {
      counts.set(row.role, (counts.get(row.role) || 0) + 1)
    }
    return ROLES.filter((r) => (counts.get(r.value) || 0) > 0).map((r) => ({
      ...r,
      count: counts.get(r.value) || 0,
    }))
  }, [cast])

  function setCastRole(phone: string, role: string) {
    setRolesByPhone((prev) => ({ ...prev, [phone]: role }))
  }

  function autoBalanceRoles() {
    const phones = Array.from(selectedPhones)
    if (phones.length === 0) return
    const next: Record<string, string> = {}
    phones.forEach((phone, index) => {
      // 1 lead, rest cycle reactor/echo/degen/skeptic/member/lurker
      if (index === 0) next[phone] = 'lead'
      else {
        const pool = ['reactor', 'echo', 'degen', 'skeptic', 'member', 'lurker'] as const
        next[phone] = pool[(index - 1) % pool.length]
      }
    })
    setRolesByPhone((prev) => ({ ...prev, ...next }))
  }

  const castForPlan = speakers.length ? speakers : cast

  // Suggestion always from a sane line count (even while the field is empty/mid-edit)
  const suggestedDuration = useMemo(() => {
    const lines = Number.isFinite(targetLines)
      ? clampTargetLines(targetLines)
      : 22
    return suggestDurationFromLines(lines, density)
  }, [targetLines, density])

  // Auto-sync duration from lines/density only when user has not locked manual minutes
  useEffect(() => {
    if (durationLocked) return
    if (!Number.isFinite(targetLines)) return
    setDurationMin(suggestedDuration)
  }, [suggestedDuration, durationLocked, targetLines])

  function handleTargetLinesChange(raw: string) {
    // Allow empty / intermediate values while typing — clamp only on blur
    if (raw.trim() === '') {
      setTargetLines(Number.NaN)
      return
    }
    const n = Number(raw)
    if (!Number.isFinite(n)) return
    // Keep raw integer so user can type 1 → 15 → 150 without jumping to min 4
    setTargetLines(Math.trunc(n))
    setDurationLocked(false)
  }

  function handleTargetLinesBlur() {
    setTargetLines((prev) =>
      clampTargetLines(Number.isFinite(prev) ? prev : 22),
    )
    // Lines committed → re-follow suggested minutes unless user re-edits duration
    setDurationLocked(false)
  }

  function handleDensityChange(value: CampaignDensity) {
    setDensity(value)
    setDurationLocked(false)
  }

  function handleDurationChange(raw: string) {
    if (raw.trim() === '') {
      setDurationMin(Number.NaN)
      return
    }
    const n = Number(raw)
    if (!Number.isFinite(n)) return
    // No clamp while typing (min 5 would turn "1" into 5 mid-keystroke)
    setDurationMin(Math.trunc(n))
    setDurationLocked(true)
  }

  function handleDurationBlur() {
    const base = Number.isFinite(durationMin) ? durationMin : suggestedDuration
    const next = clampDurationMin(base)
    setDurationMin(next)
    // Same as suggestion → unlock so future line edits keep syncing minutes
    if (next === suggestedDuration) {
      setDurationLocked(false)
    }
  }

  function applySuggestedDuration() {
    setDurationMin(suggestedDuration)
    setDurationLocked(false)
  }

  const targetLinesDisplay = Number.isFinite(targetLines) ? String(targetLines) : ''
  const durationMinDisplay = Number.isFinite(durationMin) ? String(durationMin) : ''
  const usingSuggestion =
    Number.isFinite(durationMin) &&
    !durationLocked &&
    durationMin === suggestedDuration

  /** Edit line fields; keep reply targets valid when switching action. */
  function updateLine(index: number, patch: Partial<CampaignPlanLine>) {
    setPlan((prev) => {
      if (!prev) return prev
      const lines = prev.lines.map((line, i) => {
        if (i !== index) return line
        let next: CampaignPlanLine = { ...line, ...patch }
        if (next.action === 'send') {
          next = { ...next, reply_to_line: null }
        } else if (next.action === 'reply') {
          // reply_to_line is 1-based and must point to an earlier line
          let reply = next.reply_to_line
          if (reply == null || reply < 1 || reply > index) {
            reply = index > 0 ? index : null
          }
          // First line cannot reply
          if (index === 0) {
            next = { ...next, action: 'send', reply_to_line: null }
          } else {
            next = { ...next, action: 'reply', reply_to_line: reply }
          }
        }
        return next
      })
      return { ...prev, lines }
    })
  }

  async function handlePlan() {
    setError('')
    setInfo('')
    if (cast.length < 2) {
      setError('Chọn ít nhất 2 tài khoản')
      return
    }
    const goalText = compiledGoal.trim()
    if (goalText.length < 8) {
      setError('Chọn vibe / ngôn ngữ để tạo goal')
      return
    }
    setPlanning(true)
    try {
      const lines = clampTargetLines(Number(targetLines) || 22)
      const mins = clampDurationMin(Number(durationMin) || suggestDurationFromLines(lines, density))
      setTargetLines(lines)
      setDurationMin(mins)

      const res = await api.planCampaign({
        goal: goalText,
        duration_min: mins,
        target_lines: lines,
        density,
        language,
        group_link: groupLink.trim(),
        speakers: cast,
        use_market_context: useMarketContext,
        // Always send array when market on — empty means "no news topics"
        selected_news: useMarketContext && goalUseNews ? selectedNewsTitles : [],
        must_discuss_news: useMarketContext && goalUseNews ? mustNewsTitles : [],
        news_keywords: useMarketContext && goalUseNews ? newsKeywords : [],
        model: aiModel.trim() || undefined,
      })
      if (!res.success || !res.data) {
        setError(res.error || 'Lập chiến dịch thất bại')
        return
      }
      // New plan = fresh run: drop old job/errors/progress (Start creates a new job)
      stopPolling()
      setJob(null)
      // Normalize action / reply_to_line so timeline always shows replies correctly
      const normalizedLines = res.data.plan.lines.map((ln, i) => {
        const action = ln.action === 'reply' ? 'reply' : 'send'
        let replyTo = ln.reply_to_line ?? null
        if (action === 'send') replyTo = null
        else if (replyTo == null || replyTo < 1 || replyTo > i) {
          replyTo = i > 0 ? i : null
        }
        if (i === 0) {
          return { ...ln, action: 'send' as const, reply_to_line: null }
        }
        return {
          ...ln,
          action: action as 'send' | 'reply',
          reply_to_line: action === 'reply' ? replyTo : null,
        }
      })
      setPlan({ ...res.data.plan, lines: normalizedLines })
      if (res.data.market) applyMarketData(res.data.market, { preferKeepSelection: true })
      setSpeakers(cast)
      const actual = normalizedLines.length
      const replyCount = normalizedLines.filter((l) => l.action === 'reply').length
      const issues = res.data.validation?.issues || []
      const mismatch = issues.find((i) => i.code === 'line_count_mismatch')
      if (actual < lines) {
        setError(
          mismatch?.message ||
            `Bạn yêu cầu ${lines} lượt nhưng AI chỉ trả ${actual} dòng. Bấm Lập lại, hoặc Start với ${actual} dòng.`,
        )
        setInfo(
          `Plan «${res.data.plan.title}» · ${actual}/${lines} lượt · ${replyCount} reply · ~${mins} phút (thiếu ${lines - actual})`,
        )
      } else if (actual > lines) {
        setInfo(
          `Plan «${res.data.plan.title}» · ${actual} dòng · ${replyCount} reply · ~${mins} phút`,
        )
      } else {
        setInfo(
          `Plan «${res.data.plan.title}» · đủ ${actual} lượt · ${replyCount} reply · ~${mins} phút — chỉnh reply/text rồi Start`,
        )
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lập chiến dịch thất bại')
    } finally {
      setPlanning(false)
    }
  }

  function stopPolling() {
    if (pollRef.current != null) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  function startPolling(jobId: number) {
    stopPolling()
    // 1s poll so typing/delay countdown stays in sync with runner
    pollRef.current = window.setInterval(() => {
      void api.getCampaignJob(jobId).then((res) => {
        if (res.success && res.data) {
          setJob(res.data)
          if (['done', 'stopped', 'error'].includes(res.data.status)) {
            stopPolling()
          }
        }
      })
    }, 1000)
  }

  async function handleStart() {
    setError('')
    setInfo('')
    if (!plan) {
      setError('Chưa có plan — bấm Lập chiến dịch (AI)')
      return
    }
    if (!groupLink.trim()) {
      setError('Nhập link nhóm / peer trước khi chạy')
      return
    }
    if (castForPlan.length < 2) {
      setError('Cần ít nhất 2 acc')
      return
    }
    setStarting(true)
    try {
      const res = await api.startCampaignJob({
        plan,
        speakers: castForPlan,
        group_link: groupLink.trim(),
      })
      if (!res.success || !res.data) {
        setError(res.error || 'Không start được job')
        return
      }
      setInfo(`Đã start job #${res.data.job_id} · ${res.data.total_lines} dòng`)
      const jobRes = await api.getCampaignJob(res.data.job_id)
      if (jobRes.success && jobRes.data) {
        setJob(jobRes.data)
        startPolling(res.data.job_id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Start thất bại')
    } finally {
      setStarting(false)
    }
  }

  async function handleStop() {
    if (!job?.id) return
    const res = await api.stopCampaignJob(job.id)
    if (res.success && res.data) {
      setJob(res.data)
      setInfo('Đã gửi lệnh dừng — bấm Tiếp tục để chạy nốt')
    }
  }

  async function handleResume() {
    if (!job?.id) return
    setError('')
    setInfo('')
    setStarting(true)
    try {
      const res = await api.resumeCampaignJob(job.id)
      if (!res.success || !res.data) {
        setError(res.error || 'Không tiếp tục được job')
        return
      }
      setJob(res.data)
      setInfo(`Đã tiếp tục job #${job.id} từ các dòng còn lại`)
      startPolling(job.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Tiếp tục thất bại')
    } finally {
      setStarting(false)
    }
  }

  async function handleRetryLine(lineId: number) {
    if (!job?.id) return
    setError('')
    setInfo('')
    setStarting(true)
    try {
      const res = await api.retryCampaignLine(job.id, lineId)
      if (!res.success || !res.data) {
        setError(res.error || `Không retry được dòng #${lineId}`)
        return
      }
      setJob(res.data)
      setInfo(`Đang retry dòng #${lineId}`)
      startPolling(job.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Retry thất bại')
    } finally {
      setStarting(false)
    }
  }

  const progressPct = job ? jobProgress(job) : 0
  const lineResultById = useMemo(() => {
    const map = new Map<
      number,
      { status: string; detail: string; phone: string; messageId: number | null }
    >()
    if (!job?.line_results) return map
    for (const item of job.line_results) {
      map.set(item.line_id, {
        status: item.status,
        detail: item.detail || '',
        phone: item.phone || '',
        messageId: item.message_id ?? null,
      })
    }
    return map
  }, [job])
  const firstError = useMemo(() => {
    if (!job?.line_results) return null
    return job.line_results.find((r) => r.status === 'error') ?? null
  }, [job])
  const activeWait = useMemo(() => parseActiveWait(job), [job])
  const activeWaitLine = useMemo(() => {
    if (!plan || !activeWait) return null
    return plan.lines[activeWait.lineId - 1] ?? null
  }, [plan, activeWait])
  const activeWaitSpeaker = useMemo(() => {
    if (!activeWait) return null
    return (
      castForPlan.find((s) => s.id === activeWait.speakerId) ||
      speakers.find((s) => s.id === activeWait.speakerId) ||
      null
    )
  }, [activeWait, castForPlan, speakers])

  useEffect(() => {
    if (!activeWait || activeWait.totalSec == null || activeWait.totalSec <= 0) {
      waitCountdownRef.current = null
      setWaitRemainSec(null)
      return
    }
    if (
      !waitCountdownRef.current ||
      waitCountdownRef.current.key !== activeWait.key
    ) {
      waitCountdownRef.current = {
        key: activeWait.key,
        endsAt: Date.now() + activeWait.totalSec * 1000,
        totalSec: activeWait.totalSec,
      }
    }
    const tick = () => {
      const ends = waitCountdownRef.current?.endsAt
      if (ends == null) {
        setWaitRemainSec(null)
        return
      }
      setWaitRemainSec(Math.max(0, Math.ceil((ends - Date.now()) / 1000)))
    }
    tick()
    const id = window.setInterval(tick, 200)
    return () => window.clearInterval(id)
  }, [activeWait])

  const stepSetupDone =
    cast.length >= 2 && groupLink.trim().length > 0 && compiledGoal.trim().length >= 8
  const stepPlanDone = Boolean(plan)
  const stepRunActive = Boolean(job && (job.status === 'running' || job.status === 'pending'))
  const jobCanResume = Boolean(
    job &&
      !stepRunActive &&
      ['stopped', 'error', 'pending', 'done'].includes(job.status) &&
      job.line_results?.some(
        (r) => r.status !== 'success' && r.status !== 'skipped',
      ),
  )
  const remainingLines = job
    ? job.line_results.filter(
        (r) => r.status !== 'success' && r.status !== 'skipped',
      ).length
    : 0
  const progressSegments = useMemo(() => {
    if (!job?.total_lines) {
      return { ok: 0, err: 0, rest: 100 }
    }
    const total = job.total_lines
    const ok = Math.round((job.success_lines / total) * 100)
    const err = Math.round((job.error_lines / total) * 100)
    const rest = Math.max(0, 100 - ok - err)
    return { ok, err, rest }
  }, [job])
  const jobStatusLabel =
    job?.status === 'running'
      ? 'Đang chạy'
      : job?.status === 'pending'
        ? 'Chờ chạy'
        : job?.status === 'stopped'
          ? 'Đã dừng'
          : job?.status === 'error'
            ? 'Lỗi'
            : job?.status === 'done'
              ? 'Hoàn tất'
              : job?.status || ''
  const setupReadyBits = {
    accounts: cast.length >= 2,
    group: groupLink.trim().length > 0,
    goal: compiledGoal.trim().length >= 8,
  }
  const setupReadyCount =
    Number(setupReadyBits.accounts) +
    Number(setupReadyBits.group) +
    Number(setupReadyBits.goal)

  return (
    <div className="page--campaign">
      <div className="cg-above-fold">
      <header className="cg-head">
        <div className="cg-head-main">
          <div className="cg-head-title-row">
            <div className="cg-head-icon" aria-hidden>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path
                  d="M4 6h10l2 3H20v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6Z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                />
                <path
                  d="M8 12v3M12 11v4M16 13v2"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <div className="cg-head-copy">
              <span className="cg-kicker">Hội thoại · Multi-acc · AI</span>
              <h1>Hội thoại group</h1>
              <p>Chọn dàn acc → goal & tin → AI dựng timeline → chạy multi-acc trong group</p>
            </div>
          </div>

          <nav className="cg-steps" aria-label="Các bước">
            <div
              className={`cg-step${stepSetupDone ? ' is-done' : ''}${!stepPlanDone ? ' is-active' : ''}`}
            >
              <span className="cg-step-num">{stepSetupDone ? '✓' : '1'}</span>
              <span className="cg-step-text">
                <strong>Setup</strong>
                <em>Acc · group · goal</em>
              </span>
            </div>
            <span className="cg-step-connector" aria-hidden />
            <div
              className={`cg-step${stepPlanDone ? ' is-done' : ''}${plan && !stepRunActive ? ' is-active' : ''}`}
            >
              <span className="cg-step-num">{stepPlanDone ? '✓' : '2'}</span>
              <span className="cg-step-text">
                <strong>Kế hoạch</strong>
                <em>Timeline AI</em>
              </span>
            </div>
            <span className="cg-step-connector" aria-hidden />
            <div
              className={`cg-step${job?.status === 'done' ? ' is-done' : ''}${stepRunActive ? ' is-active' : ''}`}
            >
              <span className="cg-step-num">{job?.status === 'done' ? '✓' : '3'}</span>
              <span className="cg-step-text">
                <strong>Chạy</strong>
                <em>Live multi-acc</em>
              </span>
            </div>
          </nav>
        </div>

        <div className="cg-pills">
          <button
            type="button"
            className={`cg-pill cg-pill--btn${aiStatus?.configured ? ' cg-pill--ok' : ' cg-pill--warn'}`}
            onClick={() => setModelModalOpen(true)}
            title="Chọn model GPT & xem giá"
          >
            {aiStatus?.configured
              ? `Model · ${aiModel || aiStatus.model || 'ready'}`
              : 'AI chưa cấu hình'}
            <span className="cg-pill-chevron" aria-hidden>
              ▾
            </span>
          </button>
          <span className="cg-pill cg-pill--soft">
            <b>{cast.length}</b> acc
          </span>
          {plan ? (
            <span className="cg-pill cg-pill--soft">
              <b>{plan.lines.length}</b> dòng
            </span>
          ) : null}
          {job ? (
            <span className="cg-pill cg-pill--run">
              Job #{job.id} · {job.status}
            </span>
          ) : null}
        </div>
      </header>

      <div className="cg-alerts">
        <Alert type="error" message={error} onDismiss={() => setError('')} />
        <Alert type="info" message={info} onDismiss={() => setInfo('')} />
      </div>

      <div className="cg-workspace">
        <AccountPickerPanel
          className="cg-session-panel"
          title="Dàn acc"
          meta={
            filterState.hasFilters
              ? `${filterState.filteredCount}/${filterState.totalCount}`
              : 'Chọn ≥ 2'
          }
          badgeCount={selectedPhones.size}
          sessions={sessions}
          loading={loading}
          getMeta={getMeta}
          selectionMode="multiple"
          selectedPhones={selectedPhones}
          onSelectedPhonesChange={setSelectedPhones}
          onFiltersChange={setFilterState}
          disabled={planning || starting}
        />

        <section className="cg-setup">
          <div className="cg-setup-top">
            <div className="cg-setup-top-copy">
              <h2>Thiết lập</h2>
              <p>
                Bước {SETUP_TABS.findIndex((t) => t.id === setupTab) + 1}/4 · {setupReadyCount}
                /3 sẵn sàng
              </p>
            </div>
            <div className="cg-setup-progress" aria-hidden>
              <span style={{ width: `${(setupReadyCount / 3) * 100}%` }} />
            </div>
            <div className="cg-setup-checklist">
              <span className={setupReadyBits.accounts ? 'is-on' : ''}>
                {setupReadyBits.accounts ? '✓' : '○'} ≥2 acc
              </span>
              <span className={setupReadyBits.group ? 'is-on' : ''}>
                {setupReadyBits.group ? '✓' : '○'} Group
              </span>
              <span className={setupReadyBits.goal ? 'is-on' : ''}>
                {setupReadyBits.goal ? '✓' : '○'} Goal
              </span>
            </div>
          </div>

          <div className="cg-setup-tabs" role="tablist" aria-label="Mục thiết lập">
            {SETUP_TABS.map((tab) => {
              const badge =
                tab.id === 'cast'
                  ? cast.length
                  : tab.id === 'market' && useMarketContext
                    ? selectedNewsTitles.length
                    : null
              const tabReady =
                (tab.id === 'group' && setupReadyBits.group) ||
                (tab.id === 'goal' && setupReadyBits.goal) ||
                (tab.id === 'cast' && setupReadyBits.accounts)
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={setupTab === tab.id}
                  className={`cg-setup-tab${setupTab === tab.id ? ' is-active' : ''}${tabReady ? ' is-ready' : ''}`}
                  onClick={() => setSetupTab(tab.id)}
                >
                  <span className="cg-setup-tab-step">{tabReady ? '✓' : tab.step}</span>
                  <span className="cg-setup-tab-label">{tab.label}</span>
                  {badge != null && badge > 0 ? (
                    <span className="cg-setup-tab-badge">{badge}</span>
                  ) : null}
                </button>
              )
            })}
          </div>

          <div className="cg-setup-body" role="tabpanel">
            {setupTab === 'group' ? (
              <div className="cg-stack">
                <div className="cg-card">
                  <div className="cg-card-head">
                    <span className="cg-card-title">Group</span>
                  </div>
                  <label className="cg-field">
                    <span>Link nhóm / peer</span>
                    <input
                      value={groupLink}
                      onChange={(e) => setGroupLink(e.target.value)}
                      placeholder="https://t.me/… hoặc peer_id"
                      disabled={planning || starting}
                    />
                  </label>
                  <span className="cg-field-hint">
                    Model AI chọn ở nút <b>Model · …</b> trên header (không nằm trong
                    setup).
                  </span>
                </div>

                <div className="cg-card">
                  <div className="cg-card-head">
                    <span className="cg-card-title">Nhịp chat</span>
                    <span className="cg-card-meta">
                      {Number.isFinite(targetLines) ? clampTargetLines(targetLines) : '—'} lượt ·{' '}
                      {formatDurationHint(suggestedDuration)}
                    </span>
                  </div>
                  <div className="cg-field-row">
                    <div className="cg-field">
                      <span>Số lượt tin</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={MIN_TARGET_LINES}
                        max={MAX_TARGET_LINES}
                        step={1}
                        value={targetLinesDisplay}
                        onChange={(e) => handleTargetLinesChange(e.target.value)}
                        onBlur={handleTargetLinesBlur}
                        disabled={planning || starting}
                      />
                      <span className="cg-field-hint">
                        Hỗ trợ tới {MAX_TARGET_LINES} (vd 150). Plan dài chia batch; AI
                        tiếp mạch, không kể lại tin.
                      </span>
                    </div>
                    <div className="cg-field">
                      <span>Phút{durationLocked ? ' · tay' : ' · auto'}</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={MIN_DURATION_MIN}
                        max={MAX_DURATION_MIN}
                        step={1}
                        value={durationMinDisplay}
                        onChange={(e) => handleDurationChange(e.target.value)}
                        onBlur={handleDurationBlur}
                        disabled={planning || starting}
                      />
                    </div>
                  </div>
                  <div className="cg-field">
                    <span>Mật độ</span>
                    <div className="cg-segment" role="radiogroup" aria-label="Mật độ">
                      {DENSITY_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          role="radio"
                          aria-checked={density === opt.value}
                          className={`cg-segment-btn${density === opt.value ? ' is-active' : ''}`}
                          disabled={planning || starting}
                          onClick={() => handleDensityChange(opt.value)}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    <span className="cg-field-hint">{densityLabel(density)}</span>
                  </div>
                  {!usingSuggestion ? (
                    <button
                      type="button"
                      className="cg-btn cg-btn--secondary cg-btn--compact"
                      disabled={planning || starting}
                      onClick={applySuggestedDuration}
                    >
                      Áp dụng đề xuất {formatDurationHint(suggestedDuration)}
                    </button>
                  ) : (
                    <span className="cg-field-hint cg-hint-ok">
                      ✓ Phút đang khớp đề xuất theo lượt + mật độ
                    </span>
                  )}
                </div>
              </div>
            ) : null}

            {setupTab === 'goal' ? (
              <div className="cg-stack">
                <div className="cg-card">
                  <div className="cg-card-head">
                    <span className="cg-card-title">Ngôn ngữ</span>
                  </div>
                  <div className="cg-segment" role="radiogroup" aria-label="Language">
                    {(
                      [
                        { value: 'en', label: 'English' },
                        { value: 'vi', label: 'Tiếng Việt' },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        role="radio"
                        aria-checked={language === opt.value}
                        className={`cg-segment-btn${language === opt.value ? ' is-active' : ''}`}
                        disabled={planning || starting}
                        onClick={() => setLanguage(opt.value)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="cg-card">
                  <div className="cg-card-head">
                    <span className="cg-card-title">Vibe</span>
                    <span className="cg-card-meta">Tự ghép goal</span>
                  </div>
                  <div className="cg-style-grid" role="listbox" aria-label="Vibe">
                    {VIBE_OPTIONS.map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        role="option"
                        aria-selected={vibe === v.id}
                        className={`cg-style-card${vibe === v.id ? ' is-active' : ''}`}
                        disabled={planning || starting}
                        onClick={() => setVibe(v.id)}
                      >
                        <strong>{v.label}</strong>
                        <span>{language === 'vi' ? v.descVi : v.descEn}</span>
                      </button>
                    ))}
                  </div>
                  <label className={`cg-check${goalUseNews ? ' is-on' : ''}`}>
                    <input
                      type="checkbox"
                      checked={goalUseNews}
                      disabled={planning || starting || !useMarketContext}
                      onChange={(e) => setGoalUseNews(e.target.checked)}
                    />
                    <span className="cg-check-text">
                      <strong>Kèm tin Market</strong>
                      <span>
                        {useMarketContext
                          ? `${selectedNewsTitles.length} tin · ${mustNewsTitles.length} must`
                          : 'Bật Market ở bước 3'}
                      </span>
                    </span>
                    <span className="cg-check-switch" aria-hidden />
                  </label>
                  <label className="cg-field">
                    <span>Ghi chú (tuỳ chọn)</span>
                    <input
                      value={goalNote}
                      maxLength={120}
                      disabled={planning || starting}
                      placeholder={
                        language === 'vi'
                          ? 'vd: một acc hơi bear…'
                          : 'e.g. one acc slightly bearish…'
                      }
                      onChange={(e) => setGoalNote(e.target.value)}
                    />
                  </label>
                </div>

                <div className="cg-card cg-card--goal-preview">
                  <div className="cg-card-head">
                    <span className="cg-card-title">Goal</span>
                    <span className="cg-card-tag cg-card-tag--accent">Auto</span>
                  </div>
                  <p className="cg-goal-preview">{compiledGoal}</p>
                </div>
              </div>
            ) : null}

            {setupTab === 'market' ? (
              <div className="cg-stack">
                <label className={`cg-check${useMarketContext ? ' is-on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={useMarketContext}
                    onChange={(e) => setUseMarketContext(e.target.checked)}
                    disabled={planning || starting}
                  />
                  <span className="cg-check-text">
                    <strong>Giá live + top gainer/loser + tin</strong>
                    <span>CoinGecko + Binance 24h + RSS · chỉ tin đã tick</span>
                  </span>
                  <span className="cg-check-switch" aria-hidden />
                </label>

                {useMarketContext ? (
                  <>
                    <div className={`cg-market-box${market && !market.ok ? ' is-error' : ''}`}>
                      <div className="cg-market-head">
                        <span className="cg-label">Giá tham chiếu</span>
                        <button
                          type="button"
                          className="cg-link-btn"
                          disabled={planning || starting}
                          onClick={() => loadMarket(true)}
                        >
                          Làm mới
                        </button>
                      </div>
                      {!market ? (
                        <span className="cg-field-hint">Đang tải giá + tin…</span>
                      ) : !market.ok ? (
                        <span className="cg-field-hint">
                          Lỗi: {market.error || 'không lấy được giá'} — plan vẫn chạy nhưng AI có
                          thể bịa số
                        </span>
                      ) : (
                        <>
                          {market.fetched_at ? (
                            <span className="cg-field-hint">
                              Snapshot: {new Date(market.fetched_at).toLocaleString()}
                            </span>
                          ) : null}
                          <div className="cg-market-coins">
                            {market.coins.map((c) => (
                              <div key={c.symbol} className="cg-market-coin">
                                <b>{c.symbol}</b>
                                <span>
                                  $
                                  {c.usd >= 1000
                                    ? c.usd.toLocaleString('en-US', {
                                        maximumFractionDigits: 0,
                                      })
                                    : c.usd.toLocaleString('en-US', {
                                        maximumFractionDigits: 2,
                                      })}
                                </span>
                                <span
                                  className={
                                    (c.usd_24h_change ?? 0) >= 0 ? 'cg-chg-up' : 'cg-chg-down'
                                  }
                                >
                                  {c.usd_24h_change == null
                                    ? '—'
                                    : `${c.usd_24h_change >= 0 ? '+' : ''}${c.usd_24h_change.toFixed(2)}%`}
                                </span>
                              </div>
                            ))}
                          </div>
                          {(market.gainers?.length || market.losers?.length || market.movers_error) ? (
                            <div className="cg-movers">
                              <div className="cg-movers-head">
                                <span className="cg-label">Top 24h · Binance</span>
                                {market.movers_source ? (
                                  <span className="cg-field-hint">{market.movers_source}</span>
                                ) : null}
                              </div>
                              {market.movers_error ? (
                                <span className="cg-field-hint">
                                  Movers: {market.movers_error}
                                </span>
                              ) : (
                                <div className="cg-movers-grid">
                                  <div className="cg-movers-col">
                                    <span className="cg-movers-title cg-chg-up">Gainers</span>
                                    <ul className="cg-movers-list">
                                      {(market.gainers ?? []).slice(0, 5).map((m) => (
                                        <li key={`g-${m.symbol}`}>
                                          <b>{m.symbol}</b>
                                          <span>
                                            $
                                            {m.usd >= 1
                                              ? m.usd.toLocaleString('en-US', {
                                                  maximumFractionDigits: 2,
                                                })
                                              : m.usd.toLocaleString('en-US', {
                                                  maximumFractionDigits: 4,
                                                })}
                                          </span>
                                          <span className="cg-chg-up">
                                            {m.usd_24h_change == null
                                              ? '—'
                                              : `+${m.usd_24h_change.toFixed(1)}%`}
                                          </span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                  <div className="cg-movers-col">
                                    <span className="cg-movers-title cg-chg-down">Losers</span>
                                    <ul className="cg-movers-list">
                                      {(market.losers ?? []).slice(0, 5).map((m) => (
                                        <li key={`l-${m.symbol}`}>
                                          <b>{m.symbol}</b>
                                          <span>
                                            $
                                            {m.usd >= 1
                                              ? m.usd.toLocaleString('en-US', {
                                                  maximumFractionDigits: 2,
                                                })
                                              : m.usd.toLocaleString('en-US', {
                                                  maximumFractionDigits: 4,
                                                })}
                                          </span>
                                          <span className="cg-chg-down">
                                            {m.usd_24h_change == null
                                              ? '—'
                                              : `${m.usd_24h_change.toFixed(1)}%`}
                                          </span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                </div>
                              )}
                              <span className="cg-field-hint">
                                AI chỉ gossip 1–3 alt (not touching / rekt / lol pump) — không shill
                              </span>
                            </div>
                          ) : null}
                        </>
                      )}
                    </div>

                    {market?.ok ? (
                      <div className="cg-card cg-card--news">
                        <div className="cg-news-toolbar">
                          <span className="cg-label">
                            Tin · chọn {selectedNewsTitles.length} · must{' '}
                            {mustNewsTitles.length}/{market.news?.length ?? 0}
                          </span>
                          <div className="cg-news-actions">
                            <button
                              type="button"
                              className="cg-link-btn"
                              disabled={planning || starting || !(market.news?.length)}
                              onClick={selectAllNews}
                            >
                              Chọn hết
                            </button>
                            <button
                              type="button"
                              className="cg-link-btn"
                              disabled={planning || starting || selectedNewsKeys.size === 0}
                              onClick={clearNewsSelection}
                            >
                              Bỏ chọn
                            </button>
                          </div>
                        </div>
                        <div className="cg-news-filters">
                          <input
                            className="cg-news-q"
                            value={newsQuery}
                            disabled={planning || starting}
                            placeholder="Lọc keyword (ETF, SEC…)"
                            onChange={(e) => setNewsQuery(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') loadMarket(true)
                            }}
                          />
                          <button
                            type="button"
                            className="cg-link-btn"
                            disabled={planning || starting}
                            onClick={() => loadMarket(true)}
                          >
                            Lọc
                          </button>
                        </div>
                        <div className="cg-goal-presets" role="group" aria-label="Tag tin">
                          {['btc', 'eth', 'sol', 'etf', 'regulation', 'macro'].map((tag) => (
                            <button
                              key={tag}
                              type="button"
                              className={`cg-chip${newsTagFilter.includes(tag) ? ' is-active' : ''}`}
                              disabled={planning || starting}
                              onClick={() => toggleNewsTag(tag)}
                            >
                              {tag}
                            </button>
                          ))}
                        </div>
                        <label className="cg-field">
                          <span>Keyword bias (prompt)</span>
                          <input
                            value={newsKeywordInput}
                            disabled={planning || starting}
                            placeholder="ETF, SEC, rate…"
                            onChange={(e) => setNewsKeywordInput(e.target.value)}
                          />
                        </label>
                        <span className="cg-field-hint">
                          Tick = optional. ★ Must = AI bắt buộc paraphrase ≥1 lần.
                        </span>
                        {market.news_error ? (
                          <span className="cg-field-hint">{market.news_error}</span>
                        ) : null}
                        {(market.news?.length ?? 0) === 0 ? (
                          <span className="cg-field-hint">
                            Chưa có tin — bấm Làm mới / bỏ filter
                          </span>
                        ) : (
                          <ul className="cg-news-pick cg-news-pick--tall">
                            {(market.news ?? []).map((n, i) => {
                              const k = newsKey(n.source, n.title)
                              const checked = selectedNewsKeys.has(k)
                              const isMust = mustNewsKeys.has(k)
                              return (
                                <li key={`${k}-${i}`}>
                                  <div
                                    className={`cg-news-item${checked ? ' is-on' : ''}${isMust ? ' is-must' : ''}`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      disabled={planning || starting}
                                      onChange={() => toggleNews(n.source, n.title)}
                                      aria-label={`Chọn tin ${n.title}`}
                                    />
                                    <span className="cg-news-body">
                                      <span className="cg-news-src">
                                        {n.source}
                                        {(n.tags ?? []).length
                                          ? ` · ${(n.tags ?? []).join(', ')}`
                                          : ''}
                                      </span>
                                      <span className="cg-news-title">{n.title}</span>
                                    </span>
                                    <button
                                      type="button"
                                      className={`cg-must-btn${isMust ? ' is-on' : ''}`}
                                      disabled={planning || starting}
                                      title="Must discuss"
                                      onClick={() => toggleMustNews(n.source, n.title)}
                                    >
                                      ★
                                    </button>
                                  </div>
                                </li>
                              )
                            })}
                          </ul>
                        )}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="cg-cast-empty">
                    <strong>Market tắt</strong>
                    <span>AI lập plan không dùng giá/tin live</span>
                  </div>
                )}
              </div>
            ) : null}

            {setupTab === 'cast' ? (
              <div className="cg-stack cg-cast-setup">
                <div className="cg-card cg-cast-hero">
                  <div className="cg-cast-hero-top">
                    <div className="cg-cast-hero-copy">
                      <span className="cg-kicker">Bước 4 · Dàn vai</span>
                      <h3 className="cg-cast-hero-title">
                        Cast
                        <em>{cast.length}</em>
                      </h3>
                      <p>
                        Gán role để AI viết giọng khác nhau. Cần ≥2 acc; nên có 1{' '}
                        <b>Lead</b>.
                      </p>
                    </div>
                    <div
                      className={`cg-cast-ready${
                        cast.length >= 2 ? ' is-ok' : ' is-warn'
                      }`}
                    >
                      <strong>{cast.length >= 2 ? 'Sẵn sàng' : 'Thiếu acc'}</strong>
                      <span>
                        {cast.length >= 2
                          ? `${cast.length} acc đã chọn`
                          : `Chọn thêm ${Math.max(0, 2 - cast.length)} ở cột trái`}
                      </span>
                    </div>
                  </div>
                  {castRoleSummary.length > 0 ? (
                    <div className="cg-cast-summary" aria-label="Phân bổ role">
                      {castRoleSummary.map((r) => (
                        <span
                          key={r.value}
                          className={`cg-cast-chip cg-cast-chip--${r.value}`}
                        >
                          <b>{r.count}</b> {r.label}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {cast.length > 0 ? (
                    <div className="cg-cast-toolbar">
                      <button
                        type="button"
                        className="cg-btn cg-btn--secondary cg-btn--compact"
                        disabled={planning || starting}
                        onClick={() => autoBalanceRoles()}
                      >
                        Tự chia role
                      </button>
                      <span className="cg-field-hint">
                        Lead #1 · còn lại xoay reactor / echo / degen…
                      </span>
                    </div>
                  ) : null}
                </div>

                <div className="cg-card">
                  <div className="cg-card-head">
                    <span className="cg-card-title">Danh sách vai</span>
                    <span className="cg-card-meta">Theo thứ tự chọn acc</span>
                  </div>
                  {cast.length === 0 ? (
                    <div className="cg-cast-empty">
                      <div className="cg-cast-empty-icon" aria-hidden>
                        👥
                      </div>
                      <strong>Chưa chọn acc</strong>
                      <span>
                        Tick ≥ 2 session ở panel <b>Dàn acc</b> bên trái, rồi gán
                        role tại đây.
                      </span>
                    </div>
                  ) : (
                    <div className="cg-cast-list">
                      {cast.map((row, idx) => {
                        const meta = roleMeta(row.role)
                        return (
                          <article
                            key={row.phone}
                            className={`cg-cast-card cg-cast-card--${row.role}`}
                          >
                            <div className="cg-cast-card-main">
                              <span className="cg-cast-order" aria-hidden>
                                {String(idx + 1).padStart(2, '0')}
                              </span>
                              <div
                                className={`cg-avatar ${colorClass(row.id)}`}
                                aria-hidden
                              >
                                {row.id.toUpperCase()}
                              </div>
                              <div className="cg-cast-meta">
                                <div className="cg-cast-name-row">
                                  <span className="cg-cast-name">{row.label}</span>
                                  <span
                                    className={`cg-cast-role-pill cg-cast-chip--${row.role}`}
                                  >
                                    {meta.label}
                                  </span>
                                </div>
                                <div className="cg-cast-phone">{row.phone}</div>
                                <div className="cg-cast-role-hint">{meta.hint}</div>
                              </div>
                            </div>
                            <label className="cg-cast-role-field">
                              <span>Role AI</span>
                              <select
                                value={row.role}
                                disabled={planning || starting}
                                aria-label={`Role ${row.label}`}
                                onChange={(e) =>
                                  setCastRole(row.phone, e.target.value as RoleValue)
                                }
                              >
                                {ROLES.map((r) => (
                                  <option key={r.value} value={r.value}>
                                    {r.label} · {r.short}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </article>
                        )
                      })}
                    </div>
                  )}
                </div>

                <div className="cg-card cg-cast-legend-card">
                  <div className="cg-card-head">
                    <span className="cg-card-title">Gợi ý role</span>
                    <span className="cg-card-meta">Cho AI viết giọng</span>
                  </div>
                  <div className="cg-cast-legend">
                    {ROLES.map((r) => (
                      <div key={r.value} className="cg-cast-legend-item">
                        <span className={`cg-cast-chip cg-cast-chip--${r.value}`}>
                          {r.label}
                        </span>
                        <span className="cg-cast-legend-desc">{r.hint}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            <div className="cg-setup-nav">
              <button
                type="button"
                className="cg-btn cg-btn--secondary cg-btn--compact"
                disabled={SETUP_TABS.findIndex((t) => t.id === setupTab) <= 0}
                onClick={() => {
                  const i = SETUP_TABS.findIndex((t) => t.id === setupTab)
                  if (i > 0) setSetupTab(SETUP_TABS[i - 1].id)
                }}
              >
                ← Trước
              </button>
              <button
                type="button"
                className="cg-btn cg-btn--secondary cg-btn--compact"
                disabled={
                  SETUP_TABS.findIndex((t) => t.id === setupTab) >= SETUP_TABS.length - 1
                }
                onClick={() => {
                  const i = SETUP_TABS.findIndex((t) => t.id === setupTab)
                  if (i < SETUP_TABS.length - 1) setSetupTab(SETUP_TABS[i + 1].id)
                }}
              >
                Tiếp →
              </button>
            </div>
          </div>

          <div className="cg-setup-foot">
            <button
              type="button"
              className="cg-btn cg-btn--primary"
              onClick={() => void handlePlan()}
              disabled={planning || starting || cast.length < 2 || !stepSetupDone}
            >
              {planning ? (
                <>
                  <span className="cg-btn-spinner" aria-hidden />
                  AI đang lập kế hoạch…
                </>
              ) : (
                <>
                  <span className="cg-btn-spark" aria-hidden>
                    ✦
                  </span>
                  Lập chiến dịch (AI)
                </>
              )}
            </button>
            <div className="cg-btn-row">
              {jobCanResume ? (
                <button
                  type="button"
                  className="cg-btn cg-btn--primary"
                  onClick={() => void handleResume()}
                  disabled={starting || planning}
                  title={`Còn ${remainingLines} dòng chưa gửi xong`}
                >
                  {starting ? 'Đang tiếp…' : `▶ Tiếp tục (${remainingLines})`}
                </button>
              ) : (
                <button
                  type="button"
                  className="cg-btn cg-btn--secondary"
                  onClick={() => void handleStart()}
                  disabled={starting || planning || !plan || stepRunActive}
                >
                  {starting ? 'Starting…' : '▶ Start'}
                </button>
              )}
              {job && (job.status === 'running' || job.status === 'pending') ? (
                <button
                  type="button"
                  className="cg-btn cg-btn--danger"
                  onClick={() => void handleStop()}
                  disabled={starting}
                >
                  ⏹ Dừng
                </button>
              ) : jobCanResume ? (
                <button
                  type="button"
                  className="cg-btn cg-btn--secondary"
                  onClick={() => void handleStart()}
                  disabled={starting || planning || !plan}
                  title="Tạo job mới từ đầu (không dùng job đã dừng)"
                >
                  Start mới
                </button>
              ) : (
                <button type="button" className="cg-btn cg-btn--secondary" disabled>
                  Dừng
                </button>
              )}
            </div>
          </div>
        </section>

        <section className="cg-plan">
          <div className="cg-plan-head">
            <div className="cg-plan-head-copy">
              <span className="cg-kicker">Timeline</span>
              <h2>{plan ? plan.title : 'Kế hoạch chiến dịch'}</h2>
              <p>
                {plan
                  ? `~${plan.duration_min} phút · ~${
                      plan.lines.filter((l) => l.action === 'reply').length
                    } reply · chỉnh text / reply nếu cần`
                  : 'AI sẽ dựng timeline chat tại đây sau khi lập plan'}
              </p>
            </div>
            {plan ? (
              <div className="cg-plan-stats">
                <span
                  className={`cg-stat${
                    Number.isFinite(targetLines) && plan.lines.length < Number(targetLines)
                      ? ' cg-stat--warn'
                      : ''
                  }`}
                >
                  Dòng{' '}
                  <b>
                    {plan.lines.length}
                    {Number.isFinite(targetLines) ? `/${targetLines}` : ''}
                  </b>
                </span>
                <span className="cg-stat">
                  Acc <b>{castForPlan.length}</b>
                </span>
                <span className="cg-stat">
                  Reply{' '}
                  <b>{plan.lines.filter((l) => l.action === 'reply').length}</b>
                </span>
                <span className="cg-stat">
                  ~<b>{durationMinDisplay || '—'}</b>p
                </span>
                {job ? (
                  <a
                    href="#cg-progress"
                    className={`cg-stat cg-stat--job cg-stat--job-${job.status}`}
                    title="Xem tiến trình bên dưới"
                  >
                    {jobStatusLabel} · <b>{progressPct}%</b>
                  </a>
                ) : null}
              </div>
            ) : null}
            {job && firstError ? (
              <div className="cg-plan-error-banner" role="alert">
                <strong>
                  Lỗi #{firstError.line_id}
                  {firstError.phone ? ` · ${firstError.phone}` : ''}
                </strong>
                <span>{humanizeRunDetail(firstError.detail || 'Gui that bai')}</span>
              </div>
            ) : null}
          </div>

          <div className="cg-timeline-wrap">
            {!plan ? (
              <div className="cg-empty">
                <div className="cg-empty-glow" aria-hidden />
                <div className="cg-empty-icon" aria-hidden>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M8 9h8M8 13h5"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                    <path
                      d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-5l-4 3v-3H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
                <strong>Chưa có kế hoạch</strong>
                <p>
                  Chọn ≥2 acc, nhập group + goal, rồi bấm <b>Lập chiến dịch (AI)</b>.
                </p>
                <ol className="cg-empty-steps">
                  <li>Chọn dàn acc (≥2)</li>
                  <li>Nhập link group & goal</li>
                  <li>Lập plan → chỉnh text (nếu cần) → Start</li>
                </ol>
                <p className="cg-empty-note">
                  Cần <code>AI_ENABLED=true</code> + <code>OPENAI_API_KEY</code> trong{' '}
                  <code>backend/.env</code>
                </p>
              </div>
            ) : (
              <div className="cg-timeline">
                {plan.lines.map((line, index) => {
                  const speaker =
                    castForPlan.find((s) => s.id === line.speaker_id) || castForPlan[0]
                  const lineNo = index + 1
                  const runResult = lineResultById.get(lineNo)
                  const runStatus = runResult?.status
                  const runDetail = runResult?.detail || ''
                  const replyIdx =
                    line.action === 'reply' &&
                    line.reply_to_line != null &&
                    line.reply_to_line >= 1 &&
                    line.reply_to_line <= plan.lines.length
                      ? line.reply_to_line - 1
                      : null
                  const replyTarget =
                    replyIdx != null && replyIdx < index ? plan.lines[replyIdx] : null
                  const replySpeaker = replyTarget
                    ? castForPlan.find((s) => s.id === replyTarget.speaker_id)
                    : null

                  return (
                    <article
                      key={`${index}-${line.speaker_id}`}
                      className={`cg-line${line.action === 'reply' ? ' is-reply' : ''}${
                        runStatus ? ` is-run-${runStatus}` : ''
                      }`}
                      id={`cg-line-${lineNo}`}
                    >
                      <div className="cg-line-time">
                        <span className="cg-line-no" title={`Dòng #${lineNo}`}>
                          #{lineNo}
                        </span>
                        <span className="cg-line-dot" aria-hidden />
                        <span
                          className="cg-line-clock"
                          title={`${line.at_sec} giây từ lúc bắt đầu`}
                        >
                          {formatAt(line.at_sec)}
                        </span>
                      </div>
                      <div className="cg-line-card">
                        <div className="cg-line-card-top">
                          <div className="cg-line-speaker">
                            <div
                              className={`cg-avatar ${colorClass(line.speaker_id)}`}
                              aria-hidden
                            >
                              {line.speaker_id.toUpperCase()}
                            </div>
                            <div className="cg-line-speaker-meta">
                              <span className="cg-line-speaker-id">
                                {speaker?.label || line.speaker_id.toUpperCase()}
                              </span>
                              <span className="cg-line-speaker-role">
                                {speaker?.role || line.speaker_id}
                              </span>
                            </div>
                            <span
                              className={`cg-badge cg-badge--${line.action === 'reply' ? 'reply' : 'send'}`}
                            >
                              {line.action === 'reply'
                                ? replyIdx != null
                                  ? `↩ #${replyIdx + 1}`
                                  : '↩ reply'
                                : 'send'}
                            </span>
                            {runStatus ? (
                              <span
                                className={`cg-run-pill cg-run-pill--${runStatus}`}
                                title={
                                  runDetail
                                    ? humanizeRunDetail(runDetail)
                                    : runStatus
                                }
                              >
                                {runStatus === 'success'
                                  ? '✓'
                                  : runStatus === 'running'
                                    ? '…'
                                    : runStatus === 'error'
                                      ? '!'
                                      : runStatus === 'skipped'
                                        ? '–'
                                        : '○'}
                              </span>
                            ) : null}
                          </div>
                          <div className="cg-line-tools">
                            <select
                              value={line.speaker_id}
                              disabled={starting}
                              aria-label={`Speaker line ${lineNo}`}
                              onChange={(e) =>
                                updateLine(index, { speaker_id: e.target.value })
                              }
                            >
                              {castForPlan.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.id.toUpperCase()} · {s.label}
                                </option>
                              ))}
                            </select>
                            <select
                              value={line.action}
                              disabled={starting || index === 0}
                              aria-label={`Action line ${lineNo}`}
                              title={
                                index === 0
                                  ? 'Dòng đầu chỉ send'
                                  : 'send = tin thường · reply = trả lời dòng trước'
                              }
                              onChange={(e) =>
                                updateLine(index, {
                                  action: e.target.value as 'send' | 'reply',
                                })
                              }
                            >
                              <option value="send">send</option>
                              <option value="reply">reply</option>
                            </select>
                            <label className="cg-at-sec">
                              <span>t+</span>
                              <input
                                type="number"
                                min={0}
                                value={line.at_sec}
                                disabled={starting}
                                title="Giây từ lúc bắt đầu"
                                aria-label={`at_sec ${lineNo}`}
                                onChange={(e) =>
                                  updateLine(index, {
                                    at_sec: Number(e.target.value) || 0,
                                  })
                                }
                              />
                              <span>s</span>
                            </label>
                          </div>
                        </div>

                        {line.action === 'reply' ? (
                          <div className="cg-reply-to">
                            <div className="cg-reply-to-row">
                              <div className="cg-reply-to-label">↩ Reply tới</div>
                              <select
                                className="cg-reply-select"
                                value={
                                  replyTarget && replyIdx != null
                                    ? String(replyIdx + 1)
                                    : ''
                                }
                                disabled={starting || index === 0}
                                aria-label={`Reply target line ${lineNo}`}
                                onChange={(e) =>
                                  updateLine(index, {
                                    action: 'reply',
                                    reply_to_line: e.target.value
                                      ? Number(e.target.value)
                                      : null,
                                  })
                                }
                              >
                                <option value="">— chọn câu —</option>
                                {plan.lines.slice(0, index).map((prev, pi) => {
                                  const prevNo = pi + 1
                                  const sp =
                                    castForPlan.find((s) => s.id === prev.speaker_id)
                                      ?.label || prev.speaker_id.toUpperCase()
                                  return (
                                    <option key={prevNo} value={prevNo}>
                                      #{prevNo} · {sp}: {previewText(prev.text, 48)}
                                    </option>
                                  )
                                })}
                              </select>
                            </div>
                            {replyTarget && replyIdx != null ? (
                              <a
                                className="cg-reply-quote"
                                href={`#cg-line-${replyIdx + 1}`}
                                title="Nhảy tới câu gốc"
                              >
                                <span className="cg-reply-quote-bar" aria-hidden />
                                <span className="cg-reply-quote-body">
                                  <span className="cg-reply-quote-meta">
                                    ↩ #{replyIdx + 1} ·{' '}
                                    {replySpeaker?.label ||
                                      replyTarget.speaker_id.toUpperCase()}
                                  </span>
                                  <span className="cg-reply-quote-text">
                                    {previewText(replyTarget.text, 120)}
                                  </span>
                                </span>
                              </a>
                            ) : index === 0 ? (
                              <span className="cg-field-hint">
                                Dòng đầu không reply được
                              </span>
                            ) : (
                              <span className="cg-field-hint">Chưa chọn câu để reply</span>
                            )}
                          </div>
                        ) : null}

                        <div className="cg-line-body">
                          <textarea
                            value={line.text}
                            disabled={starting}
                            aria-label={`Nội dung dòng ${lineNo}`}
                            onChange={(e) => updateLine(index, { text: e.target.value })}
                          />
                        </div>
                        {runStatus === 'error' && runDetail ? (
                          <div className="cg-line-error" role="alert">
                            <div className="cg-line-error-head">
                              <strong>Lỗi gửi</strong>
                              {runResult?.phone ? (
                                <span className="cg-line-error-phone">
                                  {runResult.phone}
                                </span>
                              ) : null}
                              {job && !stepRunActive ? (
                                <button
                                  type="button"
                                  className="cg-btn cg-btn--secondary cg-btn--compact cg-line-retry-btn"
                                  disabled={starting}
                                  onClick={() => void handleRetryLine(lineNo)}
                                >
                                  Retry dòng
                                </button>
                              ) : null}
                            </div>
                            <p>{humanizeRunDetail(runDetail)}</p>
                          </div>
                        ) : null}
                        {runStatus === 'success' && runDetail ? (
                          <div className="cg-line-ok-meta" title={runDetail}>
                            {runResult?.messageId
                              ? `TG #${runResult.messageId}`
                              : null}
                            {runResult?.phone ? ` · ${runResult.phone}` : ''}
                          </div>
                        ) : null}
                        {(runStatus === 'running' || runStatus === 'pending') &&
                        runDetail ? (
                          <div className="cg-line-live-meta">{runDetail}</div>
                        ) : null}
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </div>
        </section>
      </div>
      </div>

      {job ? (
        <section
          id="cg-progress"
          className={`cg-progress-panel${stepRunActive ? ' is-live' : ''}${
            job.status === 'error' ? ' is-error' : ''
          }${job.status === 'stopped' ? ' is-stopped' : ''}${
            job.status === 'done' ? ' is-done' : ''
          }`}
          aria-label="Tiến trình job"
        >
          <div className="cg-progress-head">
            <div>
              <h2>Tiến trình</h2>
              <p className="cg-progress-meta">
                Job #{job.id} · {jobStatusLabel}
                {' · '}
                {job.success_lines} xong · {job.error_lines} lỗi · {remainingLines}{' '}
                còn
                {stepRunActive && activeWait
                  ? ` · #${activeWait.lineId} ${phaseLabel(activeWait.phase)}`
                  : ''}
              </p>
            </div>
            <span
              className={`cg-progress-pct${
                job.error_lines > 0 && !stepRunActive ? ' is-warn' : ''
              }`}
            >
              {progressPct}%
            </span>
          </div>

          <div className="cg-progress-body">
            <div
              className="cg-progress-bar"
              role="progressbar"
              aria-valuenow={progressPct}
              aria-label={`Tiến trình ${progressPct}%`}
            >
              <div className="cg-progress-bar-segs" aria-hidden>
                {progressSegments.ok > 0 ? (
                  <span
                    className="cg-progress-bar-seg is-ok"
                    style={{ width: `${progressSegments.ok}%` }}
                  />
                ) : null}
                {progressSegments.err > 0 ? (
                  <span
                    className="cg-progress-bar-seg is-err"
                    style={{ width: `${progressSegments.err}%` }}
                  />
                ) : null}
                {progressSegments.rest > 0 ? (
                  <span
                    className="cg-progress-bar-seg is-rest"
                    style={{ width: `${progressSegments.rest}%` }}
                  />
                ) : null}
              </div>
            </div>

            {job.error_message ? (
              <div className="cg-progress-banner is-err">{job.error_message}</div>
            ) : null}

            {jobCanResume ? (
              <div className="cg-resume-bar">
                <div className="cg-resume-copy">
                  <strong>
                    {job.status === 'stopped'
                      ? 'Đã dừng giữa chừng'
                      : job.status === 'error'
                        ? 'Dừng vì lỗi'
                        : 'Còn dòng chưa gửi'}
                  </strong>
                  <span>
                    Còn <b>{remainingLines}</b> dòng · Tiếp tục giữ tin đã gửi
                  </span>
                </div>
                <button
                  type="button"
                  className="cg-btn cg-btn--primary cg-btn--compact"
                  disabled={starting || planning}
                  onClick={() => void handleResume()}
                >
                  {starting ? 'Đang tiếp…' : '▶ Tiếp tục'}
                </button>
              </div>
            ) : null}

            {stepRunActive && activeWait ? (
              <div
                className={`cg-countdown cg-countdown--${activeWait.phase}`}
                aria-live="polite"
              >
                <div className="cg-countdown-clock" aria-hidden>
                  <span className="cg-countdown-sec">
                    {activeWait.phase === 'sending'
                      ? '…'
                      : waitRemainSec != null
                        ? String(waitRemainSec).padStart(2, '0')
                        : activeWait.totalSec != null
                          ? String(activeWait.totalSec).padStart(2, '0')
                          : '--'}
                  </span>
                  <span className="cg-countdown-unit">s</span>
                </div>
                <div className="cg-countdown-body">
                  <div className="cg-countdown-phase">
                    <strong>{phaseLabel(activeWait.phase)}</strong>
                    {waitRemainSec != null &&
                    activeWait.totalSec != null &&
                    activeWait.phase !== 'sending' ? (
                      <span className="cg-countdown-frac">
                        {waitRemainSec}/{activeWait.totalSec}s
                      </span>
                    ) : null}
                  </div>
                  <div className="cg-countdown-line">
                    #{activeWait.lineId}
                    {' · '}
                    {activeWaitSpeaker?.label ||
                      activeWait.speakerId.toUpperCase()}
                    {activeWait.phone ? (
                      <span className="cg-countdown-phone">
                        {' '}
                        · {activeWait.phone}
                      </span>
                    ) : null}
                  </div>
                  {activeWaitLine?.text ? (
                    <div className="cg-countdown-text" title={activeWaitLine.text}>
                      {previewText(activeWaitLine.text, 90)}
                    </div>
                  ) : activeWait.detail ? (
                    <div className="cg-countdown-text">{activeWait.detail}</div>
                  ) : null}
                  {waitRemainSec != null &&
                  activeWait.totalSec != null &&
                  activeWait.totalSec > 0 &&
                  activeWait.phase !== 'sending' ? (
                    <div className="cg-countdown-bar" aria-hidden>
                      <span
                        style={{
                          width: `${Math.max(
                            0,
                            Math.min(
                              100,
                              ((activeWait.totalSec - waitRemainSec) /
                                activeWait.totalSec) *
                                100,
                            ),
                          )}%`,
                        }}
                      />
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="cg-btn cg-btn--danger cg-btn--compact cg-countdown-stop"
                  onClick={() => void handleStop()}
                  disabled={starting}
                >
                  ⏹ Dừng
                </button>
              </div>
            ) : null}

            <div className="cg-progress-table-wrap">
              <table className="cg-progress-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Acc</th>
                    <th>Trạng thái</th>
                    <th>Kết quả</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(job.line_results?.length
                    ? [...job.line_results].sort((a, b) => a.line_id - b.line_id)
                    : []
                  ).map((item) => {
                    const sp =
                      castForPlan.find((s) => s.id === item.speaker_id) ||
                      speakers.find((s) => s.id === item.speaker_id)
                    const label = sp?.label || item.speaker_id.toUpperCase()
                    const detail =
                      item.status === 'error'
                        ? humanizeRunDetail(item.detail || 'Gui that bai')
                        : item.detail || '—'
                    return (
                      <tr
                        key={`prog-${item.line_id}-${item.status}`}
                        className={`cg-progress-row is-${item.status}`}
                      >
                        <td className="cg-progress-col-num">{item.line_id}</td>
                        <td>
                          <div className="cg-progress-acc">
                            <span className="cg-progress-acc-name">{label}</span>
                            {item.phone ? (
                              <span className="cg-progress-acc-phone mono">
                                {item.phone}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td>
                          <span
                            className={`cg-status-pill cg-status-pill--${item.status}`}
                          >
                            {lineStatusLabel(item.status)}
                          </span>
                        </td>
                        <td className="cg-progress-result" title={detail}>
                          {detail}
                        </td>
                        <td className="cg-progress-actions">
                          {item.status === 'error' && !stepRunActive ? (
                            <button
                              type="button"
                              className="cg-btn cg-btn--secondary cg-btn--compact"
                              disabled={starting}
                              onClick={() => void handleRetryLine(item.line_id)}
                            >
                              Retry
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {job.status === 'running' || job.status === 'pending' ? (
              <details className="cg-inject-details">
                <summary className="cg-inject-summary">
                  <span>Live inject tin</span>
                  <em>Chèn 2–5 dòng khi đang chạy</em>
                </summary>
                <div className="cg-inject">
                  <input
                    value={injectAngle}
                    disabled={injecting}
                    placeholder="Angle (vd: bàn tin ETF vừa ra…)"
                    onChange={(e) => setInjectAngle(e.target.value)}
                  />
                  <div className="cg-inject-row">
                    <label className="cg-field">
                      <span>Số dòng</span>
                      <input
                        type="number"
                        min={2}
                        max={5}
                        value={injectLineCount}
                        disabled={injecting}
                        onChange={(e) =>
                          setInjectLineCount(
                            Math.max(2, Math.min(5, Number(e.target.value) || 3)),
                          )
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="cg-btn cg-btn--primary cg-btn--compact"
                      disabled={
                        injecting ||
                        Date.now() < injectCooldownUntil ||
                        !aiStatus?.configured
                      }
                      onClick={() => void handleInject()}
                    >
                      {injecting
                        ? 'Đang chèn…'
                        : Date.now() < injectCooldownUntil
                          ? 'Đang cooldown…'
                          : 'Chèn vào chat'}
                    </button>
                  </div>
                  {(market?.news?.length ?? 0) > 0 ? (
                    <ul className="cg-news-pick cg-news-pick--inject">
                      {(market?.news ?? []).slice(0, 8).map((n, i) => {
                        const k = newsKey(n.source, n.title)
                        const on = injectNewsKeys.has(k)
                        return (
                          <li key={`inj-${k}-${i}`}>
                            <label className={`cg-news-item${on ? ' is-on' : ''}`}>
                              <input
                                type="checkbox"
                                checked={on}
                                disabled={injecting}
                                onChange={() => {
                                  setInjectNewsKeys((prev) => {
                                    const next = new Set(prev)
                                    if (next.has(k)) next.delete(k)
                                    else {
                                      if (next.size >= 3) return prev
                                      next.add(k)
                                    }
                                    return next
                                  })
                                }}
                              />
                              <span className="cg-news-body">
                                <span className="cg-news-src">{n.source}</span>
                                <span className="cg-news-title">{n.title}</span>
                              </span>
                            </label>
                          </li>
                        )
                      })}
                    </ul>
                  ) : null}
                </div>
              </details>
            ) : null}
          </div>
        </section>
      ) : null}


      {modelModalOpen ? (
        <div
          className="cg-model-modal-backdrop"
          role="presentation"
          onClick={() => setModelModalOpen(false)}
        >
          <div
            className="cg-model-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cg-model-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="cg-model-modal-head">
              <div>
                <h2 id="cg-model-modal-title">Chọn model GPT</h2>
                <p>
                  Giá & ước lượng cost ·{' '}
                  {aiStatus?.models_source === 'openai_api+catalog'
                    ? 'list live từ API'
                    : 'catalog nội bộ'}
                </p>
              </div>
              <button
                type="button"
                className="cg-model-modal-close"
                onClick={() => setModelModalOpen(false)}
                aria-label="Đóng"
              >
                ×
              </button>
            </div>

            <div className="cg-token-help">
              <strong>Token là gì?</strong>
              <p>
                OpenAI tính theo <b>token</b> (mảnh chữ), không theo tin Telegram. ~1
                token ≈ ¾ từ EN.
              </p>
              <ul>
                <li>
                  <b>Input</b> = prompt gửi lên (goal, giá, tin…)
                </li>
                <li>
                  <b>Output</b> = JSON kịch bản (thường đắt hơn input)
                </li>
                <li>
                  Plan <b>150 dòng</b> → nhiều batch → nhìn cột Out rẻ nếu chạy hằng ngày
                </li>
              </ul>
              <p className="cg-token-help-tip">
                Gợi ý: <code>gpt-4.1-mini</code> / <code>gpt-4o-mini</code> /{' '}
                <code>gpt-5.4-mini</code>. Tránh <code>pro</code>/<code>sol</code> nếu
                không cần.
              </p>
            </div>

            <label className="cg-field">
              <span>Model đang chọn</span>
              <select
                value={aiModel}
                onChange={(e) => setAiModel(e.target.value)}
                disabled={planning || starting || !aiStatus?.configured}
              >
                {aiModelOptions.length === 0 ? (
                  <option value="">— chưa cấu hình AI —</option>
                ) : (
                  [...aiModelOptions]
                    .sort((a, b) => {
                      const ca =
                        aiStatus?.model_catalog?.find((c) => c.id === a)?.cost_index ??
                        9999
                      const cb =
                        aiStatus?.model_catalog?.find((c) => c.id === b)?.cost_index ??
                        9999
                      return Number(ca) - Number(cb)
                    })
                    .map((m) => {
                      const row = aiStatus?.model_catalog?.find((c) => c.id === m)
                      const badge = row?.price_badge ? ` · ${row.price_badge}` : ''
                      return (
                        <option key={m} value={m}>
                          {m}
                          {badge}
                          {m === aiStatus?.model ? ' · default' : ''}
                        </option>
                      )
                    })
                )}
              </select>
              <span className="cg-field-hint">
                {aiStatus?.model_catalog?.find((c) => c.id === aiModel)?.price_badge ||
                  '—'}
                {' · ~150 dòng ≈ '}
                <b>
                  {(() => {
                    const est = aiStatus?.plan_cost_estimates_150?.find(
                      (e) => e.model === aiModel,
                    )
                    return est?.estimate_usd != null ? `$${est.estimate_usd}` : 'chưa rõ'
                  })()}
                </b>
                {' · '}
                <a
                  href={
                    aiStatus?.pricing_source ||
                    'https://developers.openai.com/api/docs/pricing'
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  OpenAI pricing
                </a>
              </span>
            </label>

            <div className="cg-model-table-wrap cg-model-table-wrap--modal">
              <table className="cg-model-table">
                <thead>
                  <tr>
                    <th>Rẻ→đắt</th>
                    <th>Model</th>
                    <th>Input</th>
                    <th>Output</th>
                    <th>Loại</th>
                    <th>~150 dòng</th>
                  </tr>
                </thead>
                <tbody>
                  {(aiStatus?.model_catalog?.length
                    ? aiStatus.model_catalog
                    : aiModelOptions.map((id) => ({
                        id,
                        input_per_1m: null as number | null,
                        output_per_1m: null as number | null,
                        tier: '—',
                        tier_label: '—',
                        known: false,
                        price_badge: '?',
                      }))
                  ).map((row) => {
                    const est = aiStatus?.plan_cost_estimates_150?.find(
                      (e) => e.model === row.id,
                    )
                    const active = row.id === aiModel
                    const badge = row.price_badge || '—'
                    const badgeClass =
                      badge === 'Rẻ nhất' || badge === 'Rẻ'
                        ? 'is-cheap'
                        : badge === 'Đắt'
                          ? 'is-pricey'
                          : ''
                    return (
                      <tr
                        key={row.id}
                        className={active ? 'is-active' : undefined}
                        onClick={() => {
                          if (!planning && !starting && aiStatus?.configured) {
                            setAiModel(row.id)
                          }
                        }}
                      >
                        <td>
                          <span className={`cg-price-badge ${badgeClass}`}>{badge}</span>
                        </td>
                        <td>
                          <code>{row.id}</code>
                          {row.id === aiStatus?.model ? (
                            <span className="cg-model-def"> default</span>
                          ) : null}
                        </td>
                        <td>
                          {row.input_per_1m != null ? `$${row.input_per_1m}` : '—'}
                        </td>
                        <td>
                          {row.output_per_1m != null ? `$${row.output_per_1m}` : '—'}
                        </td>
                        <td>{row.tier_label || row.tier || '—'}</td>
                        <td>
                          {est?.estimate_usd != null ? `~$${est.estimate_usd}` : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="cg-model-modal-foot">
              <button
                type="button"
                className="cg-btn cg-btn--primary cg-btn--compact"
                onClick={() => setModelModalOpen(false)}
              >
                Xong · {aiModel || 'chưa chọn'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
