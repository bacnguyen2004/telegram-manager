import { useEffect, useMemo, useRef, useState } from 'react'
import './CampaignPage.css'
import { api } from '../api/client'
import { Alert } from '../components/Alert'
import { ConvSetupAccountSelect } from '../components/ConvSetupAccountSelect'
import { SessionAvatar } from '../components/SessionAvatar'
import { useSessionAccounts } from '../hooks/useSessionAccounts'
import type {
  CampaignAiStatusData,
  CampaignMarketContext,
  CampaignPlan,
  CampaignPlanLine,
  CampaignSpeaker,
  ConversationJobData,
} from '../types/api'
import {
  DEFAULT_MARKET_SOURCES,
  draftHasContent,
  loadCampaignDraftFromStorage,
  resolveMarketAfterFetch,
  saveCampaignDraftToStorage,
  shouldAutoFetchMarketOnMount,
  type CampaignDraftState,
  type MarketSourceToggles,
} from '../utils/campaignDraft'
import {
  buildCampaignExport,
  campaignExportToJson,
} from '../utils/campaignExport'
import { classifyMarketFreshness } from '../utils/campaignFreshness'
import { filterMarketContext } from '../utils/campaignMarketFilter'
import {
  buildAutoPersonas,
  defaultPersonaForSlot,
  personaToSpeaker,
  speakerIdFromIndex,
  type CampaignPersona,
  type PersonaActivity,
  type PersonaParticipant,
  type PersonaSentiment,
} from '../utils/campaignPersona'
import {
  CAMPAIGN_PRESETS,
  applyCampaignPreset,
  compileUserGoal,
  type CampaignLanguage,
  type CampaignPresetId,
} from '../utils/campaignPresets'
import {
  clampDurationMin,
  clampTargetLines,
  MAX_DURATION_MIN,
  MAX_TARGET_LINES,
  MIN_DURATION_MIN,
  MIN_TARGET_LINES,
  suggestDurationFromLines,
  type CampaignDensity,
} from '../utils/campaignTiming'
import { summarizeBursts } from '../utils/campaignBurstTiming'
import {
  softenNumericText,
  validatePlanFacts,
} from '../utils/campaignFactCheck'
import {
  collectPlanWarnings,
  speakerDistribution,
} from '../utils/campaignPlanValidate'
import {
  MESSAGE_LENGTH_PRESETS,
  adjustMessageLengthMix,
  matchMessageLengthPreset,
  type MessageLengthMix,
} from '../utils/campaignMessageLength'
import {
  SPEAKER_ORDER_PRESETS,
  type SpeakerOrderPattern,
} from '../utils/campaignSpeakerOrder'
import {
  deleteUserPreset,
  loadUserPresets,
  makeUserPresetId,
  upsertUserPreset,
  type UserCampaignPreset,
} from '../utils/campaignUserPresets'
import {
  splitIdFromPct,
  splitPctFromId,
  splitPctLabel,
  type SplitBubblesId,
} from '../utils/campaignChatStyle'
import { resolveSessionName } from '../utils/sessionDisplay'

const ROLES = [
  { value: 'lead', label: 'Lead', hint: 'Dẫn dắt, hay mở topic' },
  { value: 'reactor', label: 'Reactor', hint: 'Phản ứng nhanh, ngắn' },
  { value: 'echo', label: 'Echo', hint: 'Đồng ý / lặp vibe' },
  { value: 'member', label: 'Member', hint: 'Thành viên thường' },
  { value: 'degen', label: 'Degen', hint: 'FOMO, meme, bull' },
  { value: 'skeptic', label: 'Skeptic', hint: 'Hoài nghi, chi tiết' },
  { value: 'lurker', label: 'Lurker', hint: 'Ít nói, tin ngắn' },
] as const

const MAX_CAST = 8
const MIN_CAST = 2

type CastRoleSlot = {
  key: string
  role: string
  phone: string
  activity: PersonaActivity
  sentiment: PersonaSentiment
  canOpen: boolean
  /** Empty → dùng tên session khi chọn acc */
  name: string
}

function makeCastSlot(index: number, partial?: Partial<CastRoleSlot>): CastRoleSlot {
  const base = defaultPersonaForSlot(index, {
    forcedRole:
      index === 0
        ? 'lead'
        : ROLES[Math.min(index, ROLES.length - 1)]?.value || 'member',
  })
  return {
    key: `slot-${index}-${Math.random().toString(36).slice(2, 8)}`,
    role: base.role,
    phone: '',
    activity: base.activity,
    sentiment: base.sentiment,
    canOpen: index === 0 || base.role === 'lead',
    name: '',
    ...partial,
  }
}

function defaultCastSlots(count = MIN_CAST): CastRoleSlot[] {
  return Array.from({ length: Math.max(MIN_CAST, count) }, (_, i) =>
    makeCastSlot(i),
  )
}

const ACTIVITY_UI = [
  { value: 'high' as const, label: 'Cao' },
  { value: 'medium' as const, label: 'Vừa' },
  { value: 'low' as const, label: 'Thấp' },
]

const SENTIMENT_UI = [
  { value: 'neutral' as const, label: 'Trung lập' },
  { value: 'bullish' as const, label: 'Bull' },
  { value: 'cautious' as const, label: 'Thận trọng' },
  { value: 'curious' as const, label: 'Tò mò' },
  { value: 'skeptical' as const, label: 'Skeptic' },
]

const ACTIVITY_LABEL: Record<string, string> = {
  high: 'Nói nhiều',
  medium: 'Vừa phải',
  low: 'Ít nói',
}
const SENTIMENT_LABEL: Record<string, string> = {
  neutral: 'Trung lập',
  bullish: 'Bullish',
  cautious: 'Thận trọng',
  curious: 'Tò mò',
  skeptical: 'Hoài nghi',
}

function formatAt(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function colorClass(id: string): string {
  const n = Math.max(0, id.toLowerCase().charCodeAt(0) - 97) % 8
  return `cg-bubble-color-${n}`
}

function newsKey(source: string, title: string): string {
  return `${source}::${title}`
}

function downloadJson(filename: string, content: string) {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function normalizePlanLines(lines: CampaignPlanLine[]): CampaignPlanLine[] {
  return lines.map((ln, i) => {
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
}

export function CampaignPage() {
  const { sessions, loading, getMeta } = useSessionAccounts()
  // Load draft synchronously BEFORE any useState that depends on it.
  const initialDraftRef = useRef<CampaignDraftState | null | undefined>(undefined)
  if (initialDraftRef.current === undefined) {
    initialDraftRef.current = loadCampaignDraftFromStorage()
  }
  const initialDraft = initialDraftRef.current
  const hasInitialDraft = draftHasContent(initialDraft)

  function castSlotsFromDraft(draft: CampaignDraftState | null): CastRoleSlot[] {
    if (!draft) return defaultCastSlots(MIN_CAST)
    const phones = draft.selectedPhones || []
    if (phones.length >= MIN_CAST) {
      return phones.map((phone, index) => {
        const p = draft.personasByPhone?.[phone]
        const auto = defaultPersonaForSlot(index, {
          forcedRole: p?.role,
          language: draft.language === 'en' ? 'en' : 'vi',
          label: p?.name,
        })
        return makeCastSlot(index, {
          role: p?.role || auto.role,
          phone,
          activity: p?.activity || auto.activity,
          sentiment: p?.sentiment || auto.sentiment,
          canOpen: p?.canOpen ?? index === 0,
          name: p?.name || '',
        })
      })
    }
    if (draft.speakers?.length >= MIN_CAST) {
      return draft.speakers.map((s, index) => {
        const auto = defaultPersonaForSlot(index, {
          forcedRole: s.role,
          language: draft.language === 'en' ? 'en' : 'vi',
          label: s.label,
        })
        return makeCastSlot(index, {
          role: s.role || auto.role,
          phone: s.phone || '',
          activity: auto.activity,
          sentiment: auto.sentiment,
          canOpen: s.can_open ?? index === 0,
          name: s.label || '',
        })
      })
    }
    return defaultCastSlots(MIN_CAST)
  }

  const [castSlots, setCastSlots] = useState<CastRoleSlot[]>(() =>
    castSlotsFromDraft(initialDraft),
  )

  const [campaignName, setCampaignName] = useState(
    () => initialDraft?.campaignName || '',
  )
  const [prompt, setPrompt] = useState(
    () =>
      initialDraft?.prompt ||
      'Thảo luận tự nhiên về thị trường crypto hôm nay',
  )
  const [language, setLanguage] = useState<CampaignLanguage | string>(
    () => initialDraft?.language || 'vi',
  )
  const [topic, setTopic] = useState(
    () => initialDraft?.topic || 'Market overview',
  )
  const [tone, setTone] = useState(() => initialDraft?.tone || 'Casual')
  const [campaignType, setCampaignType] = useState(
    () => initialDraft?.campaignType || 'Daily market discussion',
  )
  const [presetId, setPresetId] = useState<CampaignPresetId | string | null>(
    () => initialDraft?.presetId ?? null,
  )

  const [groupLink, setGroupLink] = useState(() => initialDraft?.groupLink || '')
  const [targetLines, setTargetLines] = useState(
    () => initialDraft?.targetLines || 22,
  )
  const [density, setDensity] = useState<CampaignDensity>(
    () => initialDraft?.density || 'normal',
  )
  const [durationMin, setDurationMin] = useState(() =>
    initialDraft?.durationMin
      ? clampDurationMin(initialDraft.durationMin)
      : suggestDurationFromLines(22, 'normal'),
  )
  /** When true, duration_min stays as user/draft set (not auto from targetLines). */
  const [durationLocked, setDurationLocked] = useState(
    () => Boolean(initialDraft?.durationMin),
  )
  const [replyRate, setReplyRate] = useState(
    () => initialDraft?.replyRate ?? 0.35,
  )
  const [marketIntensity, setMarketIntensity] = useState<
    'low' | 'medium' | 'high'
  >('medium')
  const [numericDetail, setNumericDetail] = useState<'none' | 'approx' | 'exact'>(
    'approx',
  )
  const [maxNewsTopics, setMaxNewsTopics] = useState(2)
  const [messageLengthMix, setMessageLengthMix] = useState<MessageLengthMix>(
    () => ({ ...MESSAGE_LENGTH_PRESETS.mostly_short.mix }),
  )
  const messageLengthPreset = matchMessageLengthPreset(messageLengthMix)
  const [speakerOrder, setSpeakerOrder] =
    useState<SpeakerOrderPattern>('natural')
  const [maxConsecutiveSpeaker, setMaxConsecutiveSpeaker] = useState(3)
  /** 0–100: same-speaker multi-bubble intensity (UI %; API gets pct + legacy enum) */
  const [splitContinuePct, setSplitContinuePct] = useState(65)
  const splitBubbles: SplitBubblesId = splitIdFromPct(splitContinuePct)
  const [userPresets, setUserPresets] = useState<UserCampaignPreset[]>(() =>
    loadUserPresets(),
  )
  const [savePresetLabel, setSavePresetLabel] = useState('')


  const [personaMode, setPersonaMode] = useState<'auto' | 'manual'>(
    () => (initialDraft?.personaMode === 'auto' ? 'auto' : 'manual'),
  )
  const [personasByPhone, setPersonasByPhone] = useState<
    Record<string, CampaignPersona>
  >(() => initialDraft?.personasByPhone || {})

  const [useMarketContext, setUseMarketContext] = useState(
    () => initialDraft?.useMarketContext !== false,
  )
  const [marketSources, setMarketSources] = useState<MarketSourceToggles>(() => ({
    ...DEFAULT_MARKET_SOURCES,
    ...(initialDraft?.marketSources || {}),
  }))
  const [market, setMarket] = useState<CampaignMarketContext | null>(
    () => initialDraft?.marketSnapshot ?? null,
  )
  /** Protect draft market until user explicitly refreshes. */
  const protectDraftMarketRef = useRef(Boolean(initialDraft?.marketSnapshot))
  const [selectedNewsKeys, setSelectedNewsKeys] = useState<Set<string>>(
    () => new Set(initialDraft?.selectedNewsKeys || []),
  )
  const [mustNewsKeys, setMustNewsKeys] = useState<Set<string>>(
    () => new Set(initialDraft?.mustNewsKeys || []),
  )

  const [aiStatus, setAiStatus] = useState<CampaignAiStatusData | null>(null)
  const [aiModel, setAiModel] = useState(() => initialDraft?.aiModel || '')
  const [plan, setPlan] = useState<CampaignPlan | null>(() => initialDraft?.plan ?? null)
  const [speakers, setSpeakers] = useState<CampaignSpeaker[]>(
    () => initialDraft?.speakers || [],
  )
  const [selectedLineIndex, setSelectedLineIndex] = useState<number | null>(() =>
    initialDraft?.plan?.lines?.length ? 0 : null,
  )
  const [planning, setPlanning] = useState(false)
  const [starting, setStarting] = useState(false)
  const [job, setJob] = useState<ConversationJobData | null>(null)
  const [error, setError] = useState('')
  const [info, setInfo] = useState(() =>
    hasInitialDraft
      ? `Đã khôi phục draft · ${new Date(initialDraft!.savedAt).toLocaleString()}`
      : '',
  )
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(
    () => initialDraft?.savedAt || null,
  )
  /** Skip auto-save until after first paint / hydrate */
  const draftAutoSaveReady = useRef(false)
  const [configSection, setConfigSection] = useState<
    'campaign' | 'participants' | 'market' | 'settings' | 'prompt'
  >('campaign')
  const pollRef = useRef<number | null>(null)
  const timelineRef = useRef<HTMLElement | null>(null)
  const pvBodyRef = useRef<HTMLDivElement | null>(null)
  const lastAutoFocusLineRef = useRef<number | null>(null)
  /** While set (ms timestamp), job auto-focus won't steal selection from timeline click */
  const userPinLineUntilRef = useRef<number>(0)
  const draftHydrated = useRef(false)

  // ── Market ──────────────────────────────────────────────────────────────

  function applyMarketData(
    data: CampaignMarketContext,
    options?: { preferKeepSelection?: boolean; forceApply?: boolean },
  ) {
    const preferKeepSelection = Boolean(options?.preferKeepSelection)
    const forceApply = Boolean(options?.forceApply)
    const protect = protectDraftMarketRef.current && !forceApply

    const adopted = resolveMarketAfterFetch({
      current: market,
      fetched: data,
      forceApply,
      protectDraftSnapshot: protect,
    })
    // Dropped by draft protection — keep snapshot + news selection as restored
    if (protect && adopted === market) {
      return
    }
    if (forceApply) protectDraftMarketRef.current = false
    setMarket(adopted)

    const items = (adopted?.news ?? data.news) ?? []
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

  const [marketAutoRefresh, setMarketAutoRefresh] = useState(true)
  const [marketRefreshing, setMarketRefreshing] = useState(false)
  const [marketLastAutoAt, setMarketLastAutoAt] = useState<string | null>(null)
  /** Tick so freshness labels update without waiting for next fetch */
  const [nowTick, setNowTick] = useState(() => Date.now())
  const marketLoadInFlight = useRef(false)

  /** Keep under FRESH window (~10m). 5m interval is a good default. */
  const MARKET_AUTO_REFRESH_MS = 5 * 60 * 1000

  function loadMarket(
    refresh = false,
    opts?: { silent?: boolean; reason?: 'manual' | 'auto' | 'mount' | 'focus' },
  ) {
    if (marketLoadInFlight.current) return
    marketLoadInFlight.current = true
    if (refresh) setMarketRefreshing(true)
    void api
      .campaignMarket(refresh)
      .then((res) => {
        if (res.success && res.data) {
          applyMarketData(res.data, {
            preferKeepSelection: true,
            // Auto/manual refresh always overwrites (including draft snapshot)
            forceApply: refresh || opts?.reason === 'auto' || opts?.reason === 'focus',
          })
          if (opts?.reason === 'auto' || opts?.reason === 'focus') {
            setMarketLastAutoAt(new Date().toISOString())
            protectDraftMarketRef.current = false
          }
          if (refresh && !opts?.silent) {
            setInfo(
              opts?.reason === 'auto'
                ? 'Market auto-refreshed'
                : 'Market data refreshed',
            )
          }
        } else if (refresh && !opts?.silent) {
          setError(res.error || 'Không tải được market')
        }
      })
      .finally(() => {
        marketLoadInFlight.current = false
        setMarketRefreshing(false)
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
        const serverDefault = (res.data.model || '').trim()
        // Prefer OPENAI_MODEL from server; keep draft only if still in allowlist
        setAiModel((prev) => {
          if (prev && models.includes(prev)) return prev
          if (serverDefault && models.includes(serverDefault)) return serverDefault
          if (serverDefault) return serverDefault
          return models[0] || ''
        })
      }
    })
    // Initial market: cache ok if draft snapshot missing; draft still shown until first auto refresh
    if (shouldAutoFetchMarketOnMount(initialDraft)) {
      loadMarket(false, { reason: 'mount', silent: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load only
  }, [])

  // Auto-refresh market while context is ON
  useEffect(() => {
    if (!useMarketContext || !marketAutoRefresh) return

    // If draft/stale/unknown — refresh soon after mount
    const kick = window.setTimeout(() => {
      const age = classifyMarketFreshness(market?.fetched_at)
      if (!market || age.warn || age.status === 'acceptable') {
        loadMarket(true, { silent: true, reason: 'auto' })
      }
    }, market ? 2_000 : 400)

    const interval = window.setInterval(() => {
      loadMarket(true, { silent: true, reason: 'auto' })
    }, MARKET_AUTO_REFRESH_MS)

    const onVis = () => {
      if (document.visibilityState !== 'visible') return
      const age = classifyMarketFreshness(market?.fetched_at)
      if (!market || age.warn || (age.age_ms != null && age.age_ms > 3 * 60_000)) {
        loadMarket(true, { silent: true, reason: 'focus' })
      }
    }
    document.addEventListener('visibilitychange', onVis)

    return () => {
      window.clearTimeout(kick)
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVis)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- market snapshot age re-read inside timers
  }, [useMarketContext, marketAutoRefresh])

  // Re-evaluate freshness badges every 30s
  useEffect(() => {
    const t = window.setInterval(() => setNowTick(Date.now()), 30_000)
    return () => window.clearInterval(t)
  }, [])

  /** Apply a draft snapshot into UI state (open draft / re-hydrate). */
  function applyDraftToUi(
    draft: CampaignDraftState,
    opts?: { silent?: boolean },
  ) {
    setCampaignName(draft.campaignName || '')
    setPrompt(draft.prompt || '')
    setLanguage(draft.language || 'vi')
    setTopic(draft.topic || 'Market overview')
    setTone(draft.tone || 'Casual')
    setCampaignType(draft.campaignType || 'Daily market discussion')
    setPresetId(draft.presetId)
    setGroupLink(draft.groupLink || '')
    setTargetLines(draft.targetLines || 22)
    setDurationMin(draft.durationMin || 20)
    setDurationLocked(true)
    setDensity(draft.density || 'normal')
    setReplyRate(draft.replyRate ?? 0.35)
    setPersonaMode(draft.personaMode === 'auto' ? 'auto' : 'manual')
    setPersonasByPhone(draft.personasByPhone || {})
    setUseMarketContext(draft.useMarketContext !== false)
    setMarketSources({
      ...DEFAULT_MARKET_SOURCES,
      ...(draft.marketSources || {}),
    })
    setSelectedNewsKeys(new Set(draft.selectedNewsKeys || []))
    setMustNewsKeys(new Set(draft.mustNewsKeys || []))
    setPlan(draft.plan ?? null)
    setSpeakers(draft.speakers || [])
    if (draft.marketSnapshot) {
      setMarket(draft.marketSnapshot)
      protectDraftMarketRef.current = true
    }
    if (draft.aiModel != null) setAiModel(draft.aiModel || '')
    setDraftSavedAt(draft.savedAt || null)
    setSelectedLineIndex(draft.plan?.lines?.length ? 0 : null)
    setCastSlots(castSlotsFromDraft(draft))

    if (!opts?.silent) {
      const planN = draft.plan?.lines?.length || 0
      setInfo(
        `Đã mở draft · ${new Date(draft.savedAt).toLocaleString()}` +
          (planN ? ` · ${planN} tin` : '') +
          (draft.campaignName ? ` · «${draft.campaignName}»` : ''),
      )
    }
  }

  // Enable auto-save after first paint (state already hydrated from initialDraft)
  useEffect(() => {
    draftHydrated.current = true
    const t = window.setTimeout(() => {
      draftAutoSaveReady.current = true
    }, 800)
    return () => window.clearTimeout(t)
  }, [])

  // ── Derived participants (slots with assigned phone) ────────────────────

  const selectedPhones = useMemo(() => {
    const set = new Set<string>()
    for (const s of castSlots) {
      if (s.phone.trim()) set.add(s.phone.trim())
    }
    return set
  }, [castSlots])

  const labelsByPhone = useMemo(() => {
    const map: Record<string, string> = {}
    for (const phone of selectedPhones) {
      const meta = getMeta(phone)
      map[phone] = resolveSessionName(meta) || meta?.username || phone
    }
    return map
  }, [selectedPhones, getMeta])

  const participants: PersonaParticipant[] = useMemo(() => {
    const filled = castSlots.filter((s) => s.phone.trim())
    if (personaMode === 'auto') {
      return buildAutoPersonas(
        filled.map((s) => s.phone.trim()),
        {
          language: language === 'en' ? 'en' : 'vi',
          labelsByPhone,
        },
      ).map((p, index) => {
        const slot = filled[index]
        return {
          ...p,
          role: slot?.role || p.role,
          canOpen: slot?.canOpen ?? p.canOpen,
          name: slot?.name?.trim() || p.name,
        }
      })
    }
    return filled.map((slot, index) => {
      const phone = slot.phone.trim()
      const sessionName = labelsByPhone[phone] || phone
      const existing = personasByPhone[phone]
      const auto = defaultPersonaForSlot(index, {
        language: language === 'en' ? 'en' : 'vi',
        label: slot.name || sessionName,
        forcedRole: slot.role,
      })
      return {
        name: (slot.name || existing?.name || sessionName).slice(0, 80),
        role: slot.role || existing?.role || auto.role,
        activity: slot.activity || existing?.activity || auto.activity,
        style: existing?.style || auto.style,
        sentiment: slot.sentiment || existing?.sentiment || auto.sentiment,
        knowledge: existing?.knowledge || auto.knowledge,
        favoriteAssets: existing?.favoriteAssets || auto.favoriteAssets,
        emojiHabit: existing?.emojiHabit || auto.emojiHabit,
        catchphrases: existing?.catchphrases || [],
        canOpen: slot.canOpen,
        phone,
        speakerId: speakerIdFromIndex(index),
      }
    })
  }, [castSlots, personaMode, personasByPhone, labelsByPhone, language])

  const cast: CampaignSpeaker[] = useMemo(
    () => participants.map(personaToSpeaker),
    [participants],
  )

  const castForPlan = speakers.length ? speakers : cast

  const speakerLabel = useMemo(() => {
    const map = new Map<string, string>()
    for (const s of castForPlan) map.set(s.id, s.label)
    for (const p of participants) map.set(p.speakerId, p.name)
    return map
  }, [castForPlan, participants])

  const speakerPhoneById = useMemo(() => {
    const map = new Map<string, string>()
    for (const s of castForPlan) map.set(s.id, s.phone)
    for (const p of participants) map.set(p.speakerId, p.phone)
    return map
  }, [castForPlan, participants])

  const timelineSpanSec = useMemo(() => {
    if (!plan?.lines?.length) return 0
    return Math.max(...plan.lines.map((l) => l.at_sec), 1)
  }, [plan])

  // ── Duration sync ───────────────────────────────────────────────────────

  const suggestedDuration = useMemo(() => {
    const lines = Number.isFinite(targetLines)
      ? clampTargetLines(targetLines)
      : 22
    return suggestDurationFromLines(lines, density)
  }, [targetLines, density])

  useEffect(() => {
    if (durationLocked) return
    if (!Number.isFinite(targetLines)) return
    setDurationMin(suggestedDuration)
  }, [suggestedDuration, durationLocked, targetLines])

  // Auto-save draft to localStorage (debounced) so reload keeps setup/plan
  useEffect(() => {
    if (!draftAutoSaveReady.current) return
    const t = window.setTimeout(() => {
      try {
        const saved = saveCampaignDraftToStorage(buildDraftState())
        setDraftSavedAt(saved.savedAt)
      } catch {
        /* ignore quota during auto-save; manual save shows error */
      }
    }, 1200)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- persist all major UI fields
  }, [
    campaignName,
    prompt,
    language,
    topic,
    tone,
    campaignType,
    presetId,
    groupLink,
    targetLines,
    durationMin,
    density,
    replyRate,
    useMarketContext,
    marketSources,
    castSlots,
    personaMode,
    personasByPhone,
    selectedNewsKeys,
    mustNewsKeys,
    plan,
    speakers,
    market,
    aiModel,
  ])

  // Flush draft on tab close / hide
  useEffect(() => {
    const flush = () => {
      if (!draftAutoSaveReady.current) return
      try {
        saveCampaignDraftToStorage(buildDraftState())
      } catch {
        /* ignore */
      }
    }
    const onVis = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('beforeunload', flush)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('beforeunload', flush)
      document.removeEventListener('visibilitychange', onVis)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Market derived ──────────────────────────────────────────────────────

  const filteredMarket = useMemo(
    () => filterMarketContext(market, marketSources),
    [market, marketSources],
  )

  const freshness = useMemo(
    () => classifyMarketFreshness(market?.fetched_at, nowTick),
    [market?.fetched_at, nowTick],
  )

  const selectedNewsTitles = useMemo(() => {
    if (!filteredMarket?.news?.length) return [] as string[]
    return filteredMarket.news
      .filter((n) => selectedNewsKeys.has(newsKey(n.source, n.title)))
      .map((n) => n.title)
  }, [filteredMarket, selectedNewsKeys])

  const mustNewsTitles = useMemo(() => {
    if (!filteredMarket?.news?.length) return [] as string[]
    return filteredMarket.news
      .filter((n) => mustNewsKeys.has(newsKey(n.source, n.title)))
      .map((n) => n.title)
  }, [filteredMarket, mustNewsKeys])

  const compiledGoal = useMemo(
    () =>
      compileUserGoal({
        prompt,
        language,
        topic,
        tone,
        campaignType,
        replyRate,
        durationMin: Number.isFinite(durationMin)
          ? clampDurationMin(durationMin)
          : suggestDurationFromLines(
              Number.isFinite(targetLines) ? clampTargetLines(targetLines) : 22,
              density,
            ),
        targetLines: Number.isFinite(targetLines)
          ? clampTargetLines(targetLines)
          : 22,
      }),
    [
      prompt,
      language,
      topic,
      tone,
      campaignType,
      replyRate,
      durationMin,
      targetLines,
      density,
    ],
  )

  const planWarnings = useMemo(() => {
    const { warnings, factIssues } = collectPlanWarnings({
      plan,
      speakers: castForPlan,
      market,
      selectedNewsCount: selectedNewsTitles.length,
      marketIntensity,
      maxConsecutiveSpeaker:
        speakerOrder === 'rotate' ? 1 : maxConsecutiveSpeaker,
    })
    return { warnings, factIssues }
  }, [
    plan,
    castForPlan,
    market,
    selectedNewsTitles.length,
    marketIntensity,
    maxConsecutiveSpeaker,
    speakerOrder,
  ])

  const burstPreview = useMemo(() => {
    if (!plan?.lines?.length) return [] as ReturnType<typeof summarizeBursts>
    return summarizeBursts(plan.lines.map((l) => l.at_sec))
  }, [plan])

  const distPreview = useMemo(() => {
    if (!plan?.lines?.length) return []
    return speakerDistribution(plan.lines, castForPlan)
  }, [plan, castForPlan])

  const openaiPricingUrl =
    aiStatus?.pricing_url || 'https://platform.openai.com/docs/pricing'

  /** Env/server suggestions for datalist (not a locked catalog). */
  const modelSuggestions = useMemo(() => {
    if (aiStatus?.models?.length) return aiStatus.models
    if (aiStatus?.model) return [aiStatus.model]
    return [] as string[]
  }, [aiStatus])

  /** Structured API payload (source of truth for Generate — not the 5k text dump). */
  const planApiPayload = useMemo(() => {
    const linesN = Number.isFinite(targetLines)
      ? clampTargetLines(targetLines)
      : 22
    const minsN = Number.isFinite(durationMin)
      ? clampDurationMin(durationMin)
      : suggestedDuration
    const useNews = useMarketContext && marketSources.news
    const replyMid = Math.max(1, Math.round(linesN * replyRate))
    return {
      campaign: {
        name: campaignName.trim() || null,
        preset: presetId || null,
        user_prompt: prompt.trim(),
        language,
        topic: topic.trim(),
        tone: tone.trim(),
        type: campaignType.trim(),
        group_link: groupLink.trim() || null,
      },
      speakers: cast.map((s) => ({
        id: s.id,
        label: s.label,
        // phone kept for executor on wire; backend strips for LLM
        phone: s.phone,
        role: s.role,
        activity: s.activity,
        message_style: '',
        sentiment: s.sentiment,
        knowledge_level: s.knowledge_level,
        preferred_assets: [],
        can_open: s.can_open,
        emoji_habit: s.emoji_habit,
      })),
      market: {
        enabled: useMarketContext,
        freshness: freshness.status,
        sources: marketSources,
        selected_news: useNews ? selectedNewsTitles : [],
        must_discuss_news: useNews ? mustNewsTitles : [],
        prices:
          filteredMarket?.coins?.map((c) => ({
            symbol: c.symbol,
            price_usd: c.usd,
            change_24h_pct: c.usd_24h_change ?? null,
          })) ?? [],
      },
      conversation: {
        target_messages: linesN,
        duration_min: minsN,
        density,
        reply_rate: replyRate,
        market_intensity: marketIntensity,
        numeric_detail: numericDetail,
        max_news_topics: maxNewsTopics,
        message_length_preset:
          messageLengthPreset === 'custom' ? 'mostly_short' : messageLengthPreset,
        message_length_short_pct: messageLengthMix.short,
        message_length_medium_pct: messageLengthMix.medium,
        message_length_long_pct: messageLengthMix.long,
        speaker_order: speakerOrder,
        max_consecutive_same_speaker:
          speakerOrder === 'rotate' ? 1 : maxConsecutiveSpeaker,
        split_bubbles: splitBubbles,
        split_continue_pct: splitContinuePct,
        reply_target: {
          min: Math.max(1, replyMid - 1),
          max: Math.min(linesN - 1, replyMid + 1),
        },
      },
      generation: {
        model: aiModel.trim() || null,
      },
      /** Short goal for /campaign/plan (intent only) */
      goal: compiledGoal,
    }
  }, [
    campaignName,
    presetId,
    prompt,
    language,
    topic,
    tone,
    campaignType,
    groupLink,
    cast,
    useMarketContext,
    marketSources,
    freshness.status,
    selectedNewsTitles,
    mustNewsTitles,
    filteredMarket,
    targetLines,
    durationMin,
    suggestedDuration,
    density,
    replyRate,
    marketIntensity,
    numericDetail,
    maxNewsTopics,
    messageLengthPreset,
    messageLengthMix.short,
    messageLengthMix.medium,
    messageLengthMix.long,
    speakerOrder,
    maxConsecutiveSpeaker,
    splitContinuePct,
    splitBubbles,
    aiModel,
    compiledGoal,
  ])

  const planApiPayloadJson = useMemo(
    () => JSON.stringify(planApiPayload, null, 2),
    [planApiPayload],
  )

  /** Pre-generate checklist — full context for Prompt step */
  const promptReview = useMemo(() => {
    const linesN = Number.isFinite(targetLines)
      ? clampTargetLines(targetLines)
      : 22
    const minsN = Number.isFinite(durationMin)
      ? clampDurationMin(durationMin)
      : suggestedDuration
    const openers = cast.filter((s) => s.can_open === true)
    const sourceOn = Object.entries(marketSources)
      .filter(([, v]) => v)
      .map(([k]) => k)
    const checks = [
      {
        id: 'prompt',
        ok: prompt.trim().length >= 8,
        label: 'Prompt',
        value: prompt.trim() || '—',
        go: 'campaign' as const,
      },
      {
        id: 'acc',
        ok: cast.length >= 2,
        label: 'Acc',
        value: `${cast.length} · ${personaMode}`,
        go: 'participants' as const,
      },
      {
        id: 'group',
        ok: Boolean(groupLink.trim()),
        label: 'Group',
        value: groupLink.trim() || 'chưa có (cần trước Start)',
        go: 'campaign' as const,
      },
      {
        id: 'market',
        ok: !useMarketContext || !freshness.warn,
        label: 'Market',
        value: useMarketContext
          ? `${freshness.status} · news ${selectedNewsTitles.length} · must ${mustNewsTitles.length}`
          : 'OFF',
        go: 'market' as const,
      },
      {
        id: 'rhythm',
        ok: linesN >= 4 && minsN >= 5,
        label: 'Nhịp',
        value: `${linesN} msgs · ${minsN}p · ${density}`,
        go: 'settings' as const,
      },
      {
        id: 'ai',
        ok: Boolean(aiStatus?.configured || aiModel),
        label: 'Model',
        value: aiModel || aiStatus?.model || '—',
        go: 'prompt' as const,
      },
    ]
    const readyGenerate = cast.length >= 2 && prompt.trim().length >= 8
    return {
      linesN,
      minsN,
      openers,
      sourceOn,
      checks,
      readyGenerate,
      lengthLabel: `Ngắn ${messageLengthMix.short}% · Vừa ${messageLengthMix.medium}% · Dài ${messageLengthMix.long}%`,
      orderLabel: SPEAKER_ORDER_PRESETS[speakerOrder].label,
      orderExample: SPEAKER_ORDER_PRESETS[speakerOrder].example,
      timingLabel: 'Tự nhiên (theo plan)',
      numericLabel:
        numericDetail === 'none'
          ? 'Không số'
          : numericDetail === 'exact'
            ? 'Exact'
            : 'Approx',
      marketIntensityLabel:
        marketIntensity === 'low' ? 'Low' : marketIntensity === 'high' ? 'High' : 'Med',
    }
  }, [
    targetLines,
    durationMin,
    suggestedDuration,
    cast,
    personaMode,
    prompt,
    groupLink,
    useMarketContext,
    freshness.status,
    freshness.warn,
    selectedNewsTitles.length,
    mustNewsTitles.length,
    density,
    aiStatus?.configured,
    aiStatus?.model,
    aiModel,
    marketSources,
    messageLengthMix,
    speakerOrder,
    numericDetail,
    marketIntensity,
  ])

  const selectedLine =
    plan && selectedLineIndex != null ? plan.lines[selectedLineIndex] ?? null : null

  const selectedPersona = useMemo(() => {
    if (!selectedLine) return null
    return (
      participants.find((p) => p.speakerId === selectedLine.speaker_id) ||
      castForPlan.find((s) => s.id === selectedLine.speaker_id) ||
      null
    )
  }, [selectedLine, participants, castForPlan])

  // ── Handlers ────────────────────────────────────────────────────────────

  function handleApplyPreset(id: string) {
    const preset = applyCampaignPreset(id)
    if (!preset) return
    setPresetId(preset.id)
    setCampaignName(preset.name)
    setPrompt(preset.prompt)
    setLanguage(preset.language)
    setTopic(preset.topic)
    setTone(preset.tone)
    setCampaignType(preset.campaignType)
    setTargetLines(preset.targetLines)
    setDensity(preset.density)
    setDurationMin(preset.durationMin)
    setDurationLocked(false)
    setReplyRate(preset.replyRate)
    setUseMarketContext(true)
    setMarketSources({
      ...DEFAULT_MARKET_SOURCES,
      ...preset.marketSources,
    })
    setInfo(`Đã áp dụng preset «${preset.label}»`)
  }

  function handleApplyUserPreset(id: string) {
    const p = userPresets.find((x) => x.id === id) ?? null
    if (!p) return
    setPresetId(p.id)
    setCampaignName(p.name)
    setPrompt(p.prompt)
    setLanguage(p.language)
    setTopic(p.topic)
    setTone(p.tone)
    setCampaignType(p.campaignType)
    if (p.groupLink != null) setGroupLink(p.groupLink)
    setTargetLines(p.targetLines)
    setDensity(p.density)
    setDurationMin(p.durationMin)
    setDurationLocked(false)
    setReplyRate(p.replyRate)
    setUseMarketContext(p.useMarketContext)
    setMarketSources({
      ...DEFAULT_MARKET_SOURCES,
      ...p.marketSources,
    })
    setMarketIntensity(p.marketIntensity)
    setNumericDetail(p.numericDetail)
    setMaxNewsTopics(p.maxNewsTopics)
    setMessageLengthMix({ ...p.messageLengthMix })
    setSpeakerOrder(p.speakerOrder)
    setMaxConsecutiveSpeaker(p.maxConsecutiveSpeaker)
    if (typeof p.splitContinuePct === 'number') {
      setSplitContinuePct(Math.max(0, Math.min(100, Math.round(p.splitContinuePct))))
    } else if (p.splitBubbles) {
      setSplitContinuePct(splitPctFromId(p.splitBubbles))
    }
    setInfo(`Loaded preset «${p.label}»`)
  }

  function handleSaveAsUserPreset() {
    const label =
      savePresetLabel.trim() ||
      campaignName.trim() ||
      prompt.trim().slice(0, 40) ||
      'My preset'
    if (prompt.trim().length < 4) {
      setError('Nhập prompt trước khi save preset')
      return
    }
    const now = new Date().toISOString()
    const existing =
      presetId && String(presetId).startsWith('user_')
        ? userPresets.find((p) => p.id === presetId)
        : null
    const id = existing?.id || makeUserPresetId(label)
    const preset: UserCampaignPreset = {
      id,
      label,
      name: campaignName.trim() || label,
      prompt: prompt.trim(),
      language,
      topic: topic.trim(),
      tone: tone.trim(),
      campaignType: campaignType.trim(),
      groupLink: groupLink.trim(),
      targetLines: clampTargetLines(Number(targetLines) || 22),
      durationMin: clampDurationMin(Number(durationMin) || 20),
      density,
      replyRate,
      useMarketContext,
      marketSources: { ...marketSources },
      timingPattern: 'natural_bursts',
      marketIntensity,
      numericDetail,
      maxNewsTopics,
      messageLengthMix: { ...messageLengthMix },
      speakerOrder,
      maxConsecutiveSpeaker,
      splitBubbles,
      splitContinuePct,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    }
    const next = upsertUserPreset(preset)
    setUserPresets(next)
    setPresetId(preset.id)
    setSavePresetLabel('')
    setInfo(`Saved preset «${label}»`)
  }

  function handleDeleteUserPreset(id: string) {
    const next = deleteUserPreset(id)
    setUserPresets(next)
    if (presetId === id) setPresetId(null)
    setInfo('Đã xóa preset')
  }

  function updateSlot(key: string, patch: Partial<CastRoleSlot>) {
    setPersonaMode('manual')
    setCastSlots((prev) =>
      prev.map((s) => (s.key === key ? { ...s, ...patch } : s)),
    )
  }

  function assignSlotPhone(key: string, phone: string) {
    const nextPhone = phone.trim()
    setCastSlots((prev) =>
      prev.map((s) => {
        if (s.key === key) {
          const meta = nextPhone ? getMeta(nextPhone) : undefined
          const label = nextPhone
            ? resolveSessionName(meta) || meta?.username || nextPhone
            : ''
          return {
            ...s,
            phone: nextPhone,
            name: s.name.trim() ? s.name : String(label),
          }
        }
        // unique phone across slots
        if (nextPhone && s.phone === nextPhone) {
          return { ...s, phone: '', name: '' }
        }
        return s
      }),
    )
  }

  function addCastSlot() {
    setCastSlots((prev) => {
      if (prev.length >= MAX_CAST) {
        setInfo(`Tối đa ${MAX_CAST} vai`)
        return prev
      }
      return [...prev, makeCastSlot(prev.length)]
    })
  }

  function removeCastSlot(key: string) {
    setCastSlots((prev) => {
      if (prev.length <= MIN_CAST) {
        setInfo(`Cần ít nhất ${MIN_CAST} vai`)
        return prev
      }
      return prev.filter((s) => s.key !== key)
    })
  }

  function rebuildAutoPersonas() {
    setPersonaMode('auto')
    setCastSlots((prev) =>
      prev.map((s, index) => {
        const auto = defaultPersonaForSlot(index, {
          language: language === 'en' ? 'en' : 'vi',
          label: s.phone ? labelsByPhone[s.phone] : undefined,
        })
        return {
          ...s,
          role: auto.role,
          activity: auto.activity,
          sentiment: auto.sentiment,
          canOpen: index === 0 || auto.role === 'lead',
          name: s.phone ? labelsByPhone[s.phone] || s.name : s.name,
        }
      }),
    )
    setPersonasByPhone({})
    setInfo('Đã gán lại role/persona theo thứ tự vai')
  }


  function buildDraftState(): CampaignDraftState {
    return {
      version: 1,
      savedAt: new Date().toISOString(),
      campaignName,
      prompt,
      language,
      topic,
      tone,
      campaignType,
      presetId,
      groupLink,
      targetLines: clampTargetLines(Number(targetLines) || 22),
      durationMin: clampDurationMin(Number(durationMin) || 20),
      density,
      replyRate,
      useMarketContext,
      marketSources,
      selectedPhones: Array.from(selectedPhones),
      personaMode,
      personasByPhone,
      rolesByPhone: Object.fromEntries(participants.map((p) => [p.phone, p.role])),
      selectedNewsKeys: Array.from(selectedNewsKeys),
      mustNewsKeys: Array.from(mustNewsKeys),
      plan,
      speakers: castForPlan,
      marketSnapshot: market,
      aiModel,
    }
  }

  function handleSaveDraft(opts?: { silent?: boolean }) {
    try {
      const saved = saveCampaignDraftToStorage(buildDraftState())
      setDraftSavedAt(saved.savedAt)
      if (!opts?.silent) {
        setInfo(
          `Đã lưu draft · ${new Date(saved.savedAt).toLocaleString()} — reload trang sẽ tự khôi phục`,
        )
      }
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lưu draft thất bại')
      return false
    }
  }

  function handleOpenDraft() {
    const draft = loadCampaignDraftFromStorage()
    if (!draft || !draftHasContent(draft)) {
      setError('Chưa có draft — chỉnh setup rồi đợi auto-lưu hoặc bấm «Lưu draft»')
      return
    }
    setError('')
    applyDraftToUi(draft)
  }

  function handleExportJson() {
    if (!plan?.lines?.length) {
      setError('Chưa có plan để export — Generate trước')
      return
    }
    const payload = buildCampaignExport({
      campaignName: campaignName || plan.title,
      plan,
      speakers: castForPlan,
    })
    const json = campaignExportToJson(payload)
    downloadJson(`${payload.campaign_id}.json`, json)
    setInfo(`Đã export ${payload.messages.length} tin · ${payload.duration_minutes} phút`)
  }

  function updateLine(index: number, patch: Partial<CampaignPlanLine>) {
    setPlan((prev) => {
      if (!prev) return prev
      const lines = prev.lines.map((line, i) => {
        if (i !== index) return line
        let next: CampaignPlanLine = { ...line, ...patch }
        if (next.action === 'send') {
          next = { ...next, reply_to_line: null }
        } else if (next.action === 'reply') {
          let reply = next.reply_to_line
          if (reply == null || reply < 1 || reply > index) {
            reply = index > 0 ? index : null
          }
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

  function deleteLine(index: number) {
    setPlan((prev) => {
      if (!prev) return prev
      const lines = prev.lines.filter((_, i) => i !== index)
      return { ...prev, lines }
    })
    setSelectedLineIndex((cur) => {
      if (cur == null) return null
      if (cur === index) return null
      if (cur > index) return cur - 1
      return cur
    })
  }

  function stopPolling() {
    if (pollRef.current != null) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  function startPolling(jobId: number) {
    stopPolling()
    const tick = () => {
      void api.getCampaignJob(jobId).then((res) => {
        if (!res.success || !res.data) return
        setJob(res.data)
        if (res.data.error_message && res.data.status === 'error') {
          setError(res.data.error_message)
        }
        if (['done', 'stopped', 'error'].includes(res.data.status)) {
          stopPolling()
          if (res.data.status === 'done') {
            setInfo(
              `Job #${jobId} xong · ${res.data.success_lines} ok / ${res.data.error_lines} lỗi`,
            )
          } else if (res.data.status === 'stopped') {
            setInfo(`Job #${jobId} đã dừng`)
          }
        }
      })
    }
    tick()
    pollRef.current = window.setInterval(tick, 1200)
  }

  useEffect(() => {
    return () => stopPolling()
  }, [])

  async function handlePlan() {
    setError('')
    setInfo('')
    if (cast.length < 2) {
      setError('Chọn ít nhất 2 tài khoản')
      return
    }
    const goalText = compiledGoal.trim()
    if (goalText.length < 8) {
      setError('Nhập prompt (ít nhất vài ký tự có nghĩa)')
      return
    }
    if (useMarketContext && freshness.warn) {
      setInfo(freshness.message)
    }
    setPlanning(true)
    try {
      const lines = clampTargetLines(Number(targetLines) || 22)
      const mins = clampDurationMin(
        Number(durationMin) || suggestDurationFromLines(lines, density),
      )
      setTargetLines(lines)
      setDurationMin(mins)

      const useNews = useMarketContext && marketSources.news
      // Structured speakers carry persona; goal is intent-only (no persona dump)
      const res = await api.planCampaign({
        goal: goalText,
        duration_min: mins,
        target_lines: lines,
        density,
        language:
          language === 'bilingual'
            ? 'bilingual'
            : language === 'en'
              ? 'en'
              : language === 'vi'
                ? 'vi'
                : String(language || 'vi'),
        group_link: groupLink.trim(),
        speakers: cast,
        use_market_context: useMarketContext,
        selected_news: useNews ? selectedNewsTitles : [],
        must_discuss_news: useNews ? mustNewsTitles : [],
        news_keywords: [],
        model: aiModel.trim() || undefined,
        reply_rate: replyRate,
        market_intensity: marketIntensity,
        numeric_detail: numericDetail,
        max_news_topics: maxNewsTopics,
        message_length_preset:
          messageLengthPreset === 'custom' ? 'mostly_short' : messageLengthPreset,
        message_length_short_pct: messageLengthMix.short,
        message_length_medium_pct: messageLengthMix.medium,
        message_length_long_pct: messageLengthMix.long,
        speaker_order: speakerOrder,
        max_consecutive_same_speaker:
          speakerOrder === 'rotate' ? 1 : maxConsecutiveSpeaker,
        split_bubbles: splitBubbles,
        split_continue_pct: splitContinuePct,
      })
      if (!res.success || !res.data) {
        setError(res.error || 'Lập chiến dịch thất bại')
        return
      }
      stopPolling()
      setJob(null)
      const normalizedLines = normalizePlanLines(res.data.plan.lines)
      const nextPlan = {
        ...res.data.plan,
        title: campaignName.trim() || res.data.plan.title,
        lines: normalizedLines,
      }
      setPlan(nextPlan)
      setSelectedLineIndex(normalizedLines.length ? 0 : null)
      if (res.data.market) {
        applyMarketData(res.data.market, {
          preferKeepSelection: true,
          forceApply: true,
        })
      }
      setSpeakers(cast)
      const actual = normalizedLines.length
      const replyCount = normalizedLines.filter((l) => l.action === 'reply').length
      const replyPct = actual ? Math.round((replyCount / actual) * 100) : 0
      const targetPct = Math.round(replyRate * 100)
      const drift =
        actual >= 4 && Math.abs(replyPct - targetPct) > 15
          ? ' — AI lệch reply rate; Generate lại hoặc set action=reply trong editor.'
          : ''
      setInfo(
        `Plan «${nextPlan.title}» · ${actual} lượt · ${replyCount} reply (${replyPct}% · mục tiêu ${targetPct}%) · ~${mins} phút${drift}`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lập chiến dịch thất bại')
    } finally {
      setPlanning(false)
    }
  }

  const jobRunning =
    job != null && (job.status === 'running' || job.status === 'pending')

  /** Stopped / error with work left → can resume without new Start */
  const jobCanResume = useMemo(() => {
    if (!job || jobRunning) return false
    if (job.status === 'done' || job.status === 'running') return false
    const results = job.line_results || []
    if (results.length) {
      return results.some(
        (r) => r.status === 'pending' || r.status === 'error',
      )
    }
    return job.completed_lines < job.total_lines
  }, [job, jobRunning])

  const lineStatusById = useMemo(() => {
    const map = new Map<
      number,
      { status: string; detail?: string; phone?: string }
    >()
    for (const r of job?.line_results || []) {
      map.set(r.line_id, {
        status: r.status,
        detail: r.detail,
        phone: r.phone,
      })
    }
    return map
  }, [job?.line_results])

  /** 0-based index of line currently sending or next to send */
  const nextSendIndex = useMemo(() => {
    if (!job || !plan?.lines?.length) return null
    const n = plan.lines.length
    for (let i = 0; i < n; i++) {
      if (lineStatusById.get(i + 1)?.status === 'running') return i
    }
    for (let i = 0; i < n; i++) {
      const st = lineStatusById.get(i + 1)?.status
      if (st === 'pending' || st == null) {
        // If we have any results, only treat missing as pending when earlier lines done
        if (st === 'pending') return i
        if (lineStatusById.size === 0) break
        // missing status after partial results → still next candidate
        if (!lineStatusById.has(i + 1)) return i
      }
    }
    if (lineStatusById.size === 0) {
      const idx = Math.max(0, Math.min(n - 1, job.completed_lines))
      if (job.completed_lines < n) return idx
      return null
    }
    return null
  }, [job, plan, lineStatusById])

  function scrollPreviewToLine(index: number) {
    const id = window.requestAnimationFrame(() => {
      const el = pvBodyRef.current?.querySelector(
        `[data-line-index="${index}"]`,
      ) as HTMLElement | null
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      // Ensure preview panel is visible when selecting from timeline below
      const panel = pvBodyRef.current?.closest('.cg-pv') as HTMLElement | null
      panel?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    })
    return id
  }

  /** Click timeline / QA → select line and scroll preview bubble into view */
  function selectLineInPreview(index: number, opts?: { fromUser?: boolean }) {
    if (opts?.fromUser) {
      userPinLineUntilRef.current = Date.now() + 12_000
    }
    setSelectedLineIndex(index)
  }

  // Scroll preview whenever selection changes (timeline, QA, auto-next, …)
  useEffect(() => {
    if (selectedLineIndex == null) return
    const id = scrollPreviewToLine(selectedLineIndex)
    return () => window.cancelAnimationFrame(id)
  }, [selectedLineIndex])

  // Keep preview pointed at the next/current send while job runs
  // (skips while user is inspecting a timeline chip)
  useEffect(() => {
    if (!jobRunning || nextSendIndex == null) return
    if (Date.now() < userPinLineUntilRef.current) return
    if (lastAutoFocusLineRef.current === nextSendIndex) {
      setSelectedLineIndex(nextSendIndex)
      return
    }
    lastAutoFocusLineRef.current = nextSendIndex
    setSelectedLineIndex(nextSendIndex)
  }, [jobRunning, nextSendIndex, job?.completed_lines, job?.updated_at])

  function scrollToTimeline() {
    // After Start: jump to timeline progress (below fold)
    requestAnimationFrame(() => {
      timelineRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    })
  }

  async function handleStart() {
    setError('')
    setInfo('')
    if (starting || jobRunning) {
      setError(
        jobRunning
          ? `Job #${job?.id} đang chạy — bấm Stop trước khi Start lại`
          : 'Đang start, chờ giây lát…',
      )
      return
    }
    if (!plan) {
      setError('Chưa có plan — bấm Generate trước')
      return
    }
    if (!groupLink.trim()) {
      setError(
        'Chưa có link nhóm / peer — nhập https://t.me/… ở header Preview rồi Start lại',
      )
      return
    }
    if (castForPlan.length < 2) {
      setError('Cần ít nhất 2 acc trong cast')
      setConfigSection('participants')
      return
    }
    setStarting(true)
    lastAutoFocusLineRef.current = null
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
      if (res.data.status === 'error') {
        setError(
          `Job #${res.data.job_id} không chạy được (status=error). Kiểm tra acc online / session / link nhóm.`,
        )
      } else {
        setInfo(
          `Đang chạy job #${res.data.job_id} · ${res.data.total_lines} tin → ${groupLink.trim()}. Xem tiến trình ở Timeline bên dưới.`,
        )
      }
      const jobRes = await api.getCampaignJob(res.data.job_id)
      if (jobRes.success && jobRes.data) {
        setJob(jobRes.data)
        scrollToTimeline()
        if (jobRes.data.error_message) {
          setError(jobRes.data.error_message)
        }
        if (
          jobRes.data.status === 'running' ||
          jobRes.data.status === 'pending'
        ) {
          startPolling(res.data.job_id)
        } else if (jobRes.data.status === 'error') {
          setError(
            jobRes.data.error_message ||
              `Job #${res.data.job_id} lỗi ngay sau start`,
          )
        }
      } else {
        setError(
          jobRes.error ||
            `Start OK (#${res.data.job_id}) nhưng không đọc được trạng thái job`,
        )
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
      setInfo('Đã dừng — bấm Tiếp tục để chạy nốt tin còn lại')
    }
  }

  async function handleResume() {
    if (!job?.id) return
    if (starting || jobRunning) {
      setError(
        jobRunning
          ? `Job #${job.id} đang chạy — đợi Dừng xong rồi Tiếp tục`
          : 'Đang start/resume, chờ giây lát…',
      )
      return
    }
    setError('')
    setInfo('')
    setStarting(true)
    lastAutoFocusLineRef.current = null
    const jobId = job.id
    try {
      // Backend waits for stop task to exit; retry once if race
      let res = await api.resumeCampaignJob(jobId)
      if (!res.success) {
        await new Promise((r) => setTimeout(r, 600))
        res = await api.resumeCampaignJob(jobId)
      }
      if (!res.success || !res.data) {
        setError(
          res.error ||
            'Không tiếp tục được — đợi 1–2s sau khi Dừng rồi bấm Tiếp tục lại',
        )
        return
      }
      setJob(res.data)
      if (res.data.status === 'error') {
        setError(
          res.data.error_message ||
            `Job #${jobId} resume xong nhưng status=error`,
        )
      } else {
        setInfo(
          `Tiếp tục job #${jobId} · ${res.data.completed_lines}/${res.data.total_lines} đã xong — chạy nốt phần còn lại`,
        )
      }
      if (
        res.data.status === 'running' ||
        res.data.status === 'pending'
      ) {
        startPolling(jobId)
        scrollToTimeline()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Resume thất bại')
    } finally {
      setStarting(false)
    }
  }

  function handleFixFacts() {
    if (!plan?.lines?.length) return
    const issues = validatePlanFacts(plan.lines, market)
    if (!issues.length) {
      setInfo('Không có numeric mismatch')
      return
    }
    const byIndex = new Map(issues.map((i) => [i.line_index, i]))
    const lines = plan.lines.map((line, i) => {
      const issue = byIndex.get(i)
      if (!issue?.suggested_fix) return line
      return { ...line, text: issue.suggested_fix }
    })
    setPlan({ ...plan, lines })
    setInfo(`Đã soften ${issues.length} tin có số liệu lệch snapshot`)
  }

  function handleShortenMessages() {
    if (!plan?.lines?.length) return
    const lines = plan.lines.map((line) => {
      const words = (line.text || '').trim().split(/\s+/)
      if (words.length <= 10) return line
      // Keep first clause-ish chunk
      const cut = words.slice(0, 8).join(' ').replace(/[,;:]$/, '')
      return { ...line, text: cut }
    })
    setPlan({ ...plan, lines })
    setInfo('Đã rút gọn tin dài (>10 từ)')
  }

  function handleApplyFactSuggestion(lineIndex: number, text: string) {
    updateLine(lineIndex, { text })
    setInfo(`Đã áp dụng gợi ý cho tin #${lineIndex + 1}`)
  }

  // ── Render ──────────────────────────────────────────────────────────────

  const stepMarks = {
    campaign: Boolean(prompt.trim().length >= 4),
    participants: cast.length >= 2,
    market: !useMarketContext || selectedNewsTitles.length > 0 || Boolean(market?.ok),
    settings: Number.isFinite(targetLines) && Number.isFinite(durationMin),
    prompt: compiledGoal.trim().length >= 8 && cast.length >= 2,
  }

  return (
    <div className="page--campaign page--campaign-studio">
      <header className="cg-studio-bar">
        <div className="cg-studio-brand">
          <div className="cg-studio-brand-icon" aria-hidden>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M5 7h9l2 2.5H19v8.5a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 4 18V8.5A1.5 1.5 0 0 1 5.5 7H5Z"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinejoin="round"
              />
              <path
                d="M8 12v3M12 11v4M15.5 13v2"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <div className="cg-studio-brand-text">
            <span className="cg-studio-kicker">Hội thoại</span>
            <input
              className="cg-studio-title"
              value={campaignName}
              onChange={(e) => setCampaignName(e.target.value)}
              placeholder="Tên chiến dịch…"
              maxLength={120}
            />
          </div>
        </div>

        <div className="cg-studio-status">
          <span className={`cg-studio-chip${aiStatus?.configured ? ' is-ok' : ' is-warn'}`}>
            {aiStatus?.configured ? 'AI sẵn sàng' : 'AI chưa cấu hình'}
          </span>
          <span className={`cg-studio-chip${cast.length >= 2 ? ' is-ok' : ''}`}>
            {cast.length} acc
          </span>
          {plan ? (
            <span className="cg-studio-chip is-ok">
              {plan.lines.length} tin · {plan.duration_min}p
            </span>
          ) : (
            <span className="cg-studio-chip">Chưa plan</span>
          )}
          {draftSavedAt ? (
            <button
              type="button"
              className="cg-studio-chip is-ok"
              title="Click để mở lại draft đã lưu"
              onClick={handleOpenDraft}
            >
              Draft {new Date(draftSavedAt).toLocaleString()}
            </button>
          ) : null}
          {job ? (
            <span className="cg-studio-chip is-run">
              #{job.id} {job.status} · {job.completed_lines}/{job.total_lines}
            </span>
          ) : null}
        </div>

        <div className="cg-studio-actions">
          <button
            type="button"
            className="cg-studio-btn cg-studio-btn--ghost"
            onClick={() => handleSaveDraft()}
            title="Lưu setup + plan vào trình duyệt (localStorage)"
          >
            Lưu draft
          </button>
          <button
            type="button"
            className="cg-studio-btn cg-studio-btn--ghost"
            onClick={handleOpenDraft}
            title="Nạp lại draft đã lưu từ trình duyệt"
          >
            Mở draft
          </button>
          <button
            type="button"
            className="cg-studio-btn cg-studio-btn--ghost"
            onClick={handleExportJson}
            disabled={!plan?.lines?.length}
          >
            Export
          </button>
          <button
            type="button"
            className="cg-studio-btn cg-studio-btn--primary"
            onClick={() => void handlePlan()}
            disabled={planning || cast.length < 2}
          >
            {planning ? 'Đang tạo…' : '✦ Generate'}
          </button>
          {!jobRunning && !starting && jobCanResume ? (
            <button
              type="button"
              className="cg-studio-btn cg-studio-btn--success"
              onClick={() => void handleResume()}
              title="Tiếp tục job đã dừng — gửi nốt tin còn lại"
            >
              ▶ Tiếp tục
            </button>
          ) : null}
          {!jobRunning && !starting && !jobCanResume ? (
            <button
              type="button"
              className="cg-studio-btn cg-studio-btn--success"
              onClick={() => void handleStart()}
              disabled={!plan || !groupLink.trim() || cast.length < 2}
              title={
                !plan
                  ? 'Cần Generate plan trước'
                  : !groupLink.trim()
                    ? 'Cần link nhóm ở header Preview'
                    : cast.length < 2
                      ? 'Cần ≥ 2 acc'
                      : 'Chạy gửi tin theo plan'
              }
            >
              ▶ Start
            </button>
          ) : null}
          {!jobRunning && !starting && jobCanResume ? (
            <button
              type="button"
              className="cg-studio-btn cg-studio-btn--ghost"
              onClick={() => void handleStart()}
              disabled={!plan || !groupLink.trim() || cast.length < 2}
              title="Tạo job mới từ đầu (không tiếp tục job cũ)"
            >
              Start lại
            </button>
          ) : null}
          {starting && !jobRunning ? (
            <button
              type="button"
              className="cg-studio-btn cg-studio-btn--success"
              disabled
            >
              Đang chạy…
            </button>
          ) : null}
          {jobRunning ? (
            <button
              type="button"
              className="cg-studio-btn cg-studio-btn--danger"
              onClick={() => void handleStop()}
            >
              Dừng
            </button>
          ) : null}
        </div>
      </header>

      {(error || info || (useMarketContext && freshness.warn)) && (
        <div className="cg-studio-alerts">
          {error ? (
            <Alert type="error" message={error} onDismiss={() => setError('')} />
          ) : null}
          {info ? (
            <Alert type="info" message={info} onDismiss={() => setInfo('')} />
          ) : null}
          {useMarketContext && freshness.warn ? (
            <Alert type="warning" message={freshness.message} />
          ) : null}
        </div>
      )}

      <div className="cg-studio-main">
        <section className="cg-studio-setup" aria-label="Thiết lập">
          <nav className="cg-studio-steps" aria-label="Bước cấu hình">
            {(
              [
                ['campaign', '1', 'Chiến dịch'],
                ['participants', '2', 'Acc'],
                ['market', '3', 'Market'],
                ['settings', '4', 'Nhịp'],
                ['prompt', '5', 'Prompt'],
              ] as const
            ).map(([id, num, label]) => {
              const active = configSection === id
              const done = stepMarks[id]
              return (
                <button
                  key={id}
                  type="button"
                  className={`cg-studio-step${active ? ' is-active' : ''}${done ? ' is-done' : ''}`}
                  onClick={() => setConfigSection(id)}
                >
                  <span className="cg-studio-step-num">{done && !active ? '✓' : num}</span>
                  <span className="cg-studio-step-label">{label}</span>
                </button>
              )
            })}
          </nav>

          <div className="cg-studio-panel">
            <div className="cg-studio-panel-scroll">
              {configSection === 'campaign' ? (
                <div className="cg-studio-stack cg-camp">
                  <header className="cg-camp-hero">
                    <div>
                      <p className="cg-camp-kicker">Bước 1</p>
                      <h2 className="cg-camp-title">Chiến dịch</h2>
                      <p className="cg-camp-sub">
                        Chọn preset hoặc tự điền ý định · group · ngôn ngữ
                      </p>
                    </div>
                    <div className="cg-camp-hero-stat">
                      <span>{groupLink.trim() ? 'Group OK' : 'Chưa group'}</span>
                      <strong>{language === 'vi' ? 'VI' : language === 'en' ? 'EN' : 'Mix'}</strong>
                    </div>
                  </header>

                  <div className="cg-camp-block">
                    <div className="cg-camp-block-head">
                      <h3>Preset</h3>
                      <span>Built-in · click apply</span>
                    </div>
                    <div className="cg-camp-presets">
                      {CAMPAIGN_PRESETS.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          className={`cg-camp-preset${presetId === p.id ? ' is-active' : ''}`}
                          onClick={() => handleApplyPreset(p.id)}
                          title={p.description}
                        >
                          <span className="cg-camp-preset-dot" aria-hidden />
                          <span className="cg-camp-preset-body">
                            <strong>{p.label}</strong>
                            <em>{p.description}</em>
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="cg-camp-block">
                    <div className="cg-camp-block-head">
                      <h3>My presets</h3>
                      <span>Lưu setup để dùng lại</span>
                    </div>

                    {userPresets.length > 0 ? (
                      <div className="cg-camp-presets cg-camp-presets--user">
                        {userPresets.map((p) => (
                          <div
                            key={p.id}
                            className={`cg-camp-preset cg-camp-preset--user${
                              presetId === p.id ? ' is-active' : ''
                            }`}
                          >
                            <button
                              type="button"
                              className="cg-camp-preset-main"
                              onClick={() => handleApplyUserPreset(p.id)}
                            >
                              <span className="cg-camp-preset-dot" aria-hidden />
                              <span className="cg-camp-preset-body">
                                <strong>{p.label}</strong>
                                <em>
                                  {p.language} · {p.targetLines} msgs ·{' '}
                                  {p.speakerOrder}
                                </em>
                              </span>
                            </button>
                            <button
                              type="button"
                              className="cg-camp-preset-del"
                              title="Delete preset"
                              onClick={() => handleDeleteUserPreset(p.id)}
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="cg-studio-hint">
                        Chưa có preset riêng — setup xong rồi Save bên dưới.
                      </p>
                    )}

                    <div className="cg-camp-save-preset">
                      <input
                        value={savePresetLabel}
                        onChange={(e) => setSavePresetLabel(e.target.value)}
                        placeholder="Tên preset (vd: Morning VI casual)"
                        maxLength={60}
                      />
                      <button
                        type="button"
                        className="cg-studio-btn cg-studio-btn--primary"
                        onClick={handleSaveAsUserPreset}
                      >
                        {presetId && String(presetId).startsWith('user_')
                          ? 'Update preset'
                          : 'Save as preset'}
                      </button>
                    </div>
                  </div>

                  <div className="cg-camp-block">
                    <div className="cg-camp-block-head">
                      <h3>Ý định & đích</h3>
                    </div>
                    <label className="cg-camp-field cg-camp-field--grow">
                      <span>Ý định chat</span>
                      <textarea
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        rows={3}
                        placeholder="vd: Thảo luận tự nhiên về market hôm nay…"
                      />
                    </label>

                    <div className="cg-camp-field">
                      <span>Ngôn ngữ</span>
                      <div className="cg-camp-langs" role="radiogroup" aria-label="Ngôn ngữ">
                        {(
                          [
                            ['vi', 'Tiếng Việt'],
                            ['en', 'English'],
                            ['bilingual', 'Song ngữ'],
                          ] as const
                        ).map(([val, lab]) => (
                          <button
                            key={val}
                            type="button"
                            role="radio"
                            aria-checked={language === val}
                            className={language === val ? 'is-active' : ''}
                            onClick={() => setLanguage(val)}
                          >
                            {lab}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="cg-camp-fields-3">
                      <label className="cg-camp-field">
                        <span>Chủ đề</span>
                        <input
                          value={topic}
                          onChange={(e) => setTopic(e.target.value)}
                          maxLength={80}
                          placeholder="BTC, alt…"
                        />
                      </label>
                      <label className="cg-camp-field">
                        <span>Tone</span>
                        <input
                          value={tone}
                          onChange={(e) => setTone(e.target.value)}
                          maxLength={40}
                          placeholder="Casual"
                        />
                      </label>
                      <label className="cg-camp-field">
                        <span>Loại</span>
                        <input
                          value={campaignType}
                          onChange={(e) => setCampaignType(e.target.value)}
                          maxLength={80}
                          placeholder="Daily discussion"
                        />
                      </label>
                    </div>

                    <div className="cg-camp-field">
                      <span>Group Telegram</span>
                      <div
                        className={`cg-camp-group-status${
                          groupLink.trim() ? ' is-ok' : ' is-warn'
                        }`}
                      >
                        <span className="cg-camp-group-status-dot" aria-hidden />
                        <div className="cg-camp-group-status-body">
                          <strong>
                            {groupLink.trim() ? 'Đã có đích gửi' : 'Chưa có link nhóm'}
                          </strong>
                          <em>
                            {groupLink.trim()
                              ? groupLink.trim()
                              : 'Nhập link / peer ở header Preview bên phải'}
                          </em>
                        </div>
                      </div>
                    </div>
                  </div>

                  <details className="cg-camp-goal">
                    <summary>
                      Goal gửi AI <span>tự ghép · xem nhanh</span>
                    </summary>
                    <pre>{compiledGoal}</pre>
                  </details>

                  <div className="cg-studio-nav">
                    <button
                      type="button"
                      className="cg-studio-btn cg-studio-btn--primary"
                      onClick={() => setConfigSection('participants')}
                    >
                      Tiếp · Acc →
                    </button>
                  </div>
                </div>
              ) : null}

              {configSection === 'participants' ? (
                <div className="cg-studio-stack cg-acc">
                  <header className="cg-acc-bar">
                    <div className="cg-acc-bar-left">
                      <span className="cg-acc-bar-step">B2</span>
                      <div className="cg-acc-bar-copy">
                        <h2>Vai & acc</h2>
                        <p>
                          {cast.length < MIN_CAST
                            ? `Gán acc cho ≥ ${MIN_CAST} vai · tối đa ${MAX_CAST}`
                            : `${cast.length}/${MAX_CAST} vai đã gán · vai #1 mở đầu`}
                        </p>
                      </div>
                    </div>
                    <div className="cg-acc-bar-right">
                      {participants.length > 0 ? (
                        <div className="cg-acc-stack-avatars" aria-hidden>
                          {participants.slice(0, 4).map((p) => {
                            const meta = getMeta(p.phone)
                            return (
                              <SessionAvatar
                                key={p.phone}
                                phone={p.phone}
                                label={p.name}
                                hasAvatar={meta?.has_avatar}
                                avatarUpdatedAt={meta?.avatar_updated_at}
                                size="sm"
                              />
                            )
                          })}
                          {participants.length > 4 ? (
                            <span className="cg-acc-stack-more">
                              +{participants.length - 4}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                      <span
                        className={`cg-acc-count-pill${
                          cast.length >= MIN_CAST
                            ? ' is-ok'
                            : cast.length > 0
                              ? ' is-warn'
                              : ''
                        }`}
                      >
                        {cast.length}/{MAX_CAST}
                      </span>
                      <button
                        type="button"
                        className="cg-acc-text-btn"
                        onClick={rebuildAutoPersonas}
                        title="Gán lại role mặc định theo thứ tự"
                      >
                        Auto role
                      </button>
                    </div>
                  </header>

                  <section className="cg-role-cast">
                    <div className="cg-role-cast-head">
                      <div>
                        <h3>Dàn vai</h3>
                        <p>Chọn vai → gán session Telegram cho từng slot</p>
                      </div>
                      <button
                        type="button"
                        className="cg-studio-btn cg-studio-btn--ghost"
                        onClick={addCastSlot}
                        disabled={castSlots.length >= MAX_CAST || loading}
                      >
                        + Thêm vai
                      </button>
                    </div>

                    {loading ? (
                      <p className="cg-studio-hint">Đang tải session…</p>
                    ) : sessions.length === 0 ? (
                      <div className="cg-acc-empty-cast">
                        <strong>Chưa có session</strong>
                        <span>Thêm acc ở trang Sessions rồi quay lại.</span>
                      </div>
                    ) : (
                      <div className="cg-role-list">
                        {castSlots.map((slot, idx) => {
                          const sid = speakerIdFromIndex(idx)
                          const roleMeta =
                            ROLES.find((r) => r.value === slot.role) || null
                          const usedByOthers = new Set(
                            castSlots
                              .filter((s) => s.key !== slot.key && s.phone)
                              .map((s) => s.phone),
                          )
                          const options = sessions.filter(
                            (ph) =>
                              !usedByOthers.has(ph) || ph === slot.phone,
                          )
                          const meta = slot.phone
                            ? getMeta(slot.phone)
                            : undefined
                          return (
                            <article
                              key={slot.key}
                              className={`cg-role-card ${colorClass(sid)}${
                                slot.canOpen ? ' is-opener' : ''
                              }${!slot.phone ? ' is-empty' : ''}`}
                            >
                              <div className="cg-role-card-top">
                                <span className="cg-role-ord" aria-hidden>
                                  {idx + 1}
                                </span>
                                <span className="cg-role-sid">{sid}</span>
                                <div className="cg-role-fields">
                                  <label className="cg-role-field">
                                    <span>Vai</span>
                                    <select
                                      value={slot.role}
                                      onChange={(e) => {
                                        const role = e.target.value
                                        const def = defaultPersonaForSlot(idx, {
                                          forcedRole: role,
                                        })
                                        updateSlot(slot.key, {
                                          role,
                                          activity: def.activity,
                                          sentiment: def.sentiment,
                                          canOpen:
                                            idx === 0 || role === 'lead'
                                              ? true
                                              : slot.canOpen,
                                        })
                                      }}
                                    >
                                      {ROLES.map((r) => (
                                        <option key={r.value} value={r.value}>
                                          {r.label} — {r.hint}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                  <label className="cg-role-field cg-role-field--acc">
                                    <span>Acc Telegram</span>
                                    <ConvSetupAccountSelect
                                      value={slot.phone}
                                      onChange={(ph) =>
                                        assignSlotPhone(slot.key, ph)
                                      }
                                      options={options}
                                      getMeta={getMeta}
                                      placeholder="Chọn session…"
                                    />
                                  </label>
                                </div>
                                {slot.phone ? (
                                  <div className="cg-role-av">
                                    <SessionAvatar
                                      phone={slot.phone}
                                      label={
                                        slot.name ||
                                        labelsByPhone[slot.phone] ||
                                        slot.phone
                                      }
                                      hasAvatar={meta?.has_avatar}
                                      avatarUpdatedAt={meta?.avatar_updated_at}
                                      size="md"
                                    />
                                  </div>
                                ) : (
                                  <div className="cg-role-av cg-role-av--empty">
                                    ?
                                  </div>
                                )}
                                <button
                                  type="button"
                                  className="cg-acc-member-x"
                                  title="Xóa vai"
                                  disabled={castSlots.length <= MIN_CAST}
                                  onClick={() => removeCastSlot(slot.key)}
                                >
                                  ×
                                </button>
                              </div>

                              <div className="cg-role-card-meta">
                                <span
                                  className={`cg-acc-tag cg-acc-tag--role is-${slot.role}`}
                                >
                                  {roleMeta?.label || slot.role}
                                </span>
                                <span className="cg-acc-tag">
                                  {ACTIVITY_LABEL[slot.activity] ||
                                    slot.activity}
                                </span>
                                <span className="cg-acc-tag">
                                  {SENTIMENT_LABEL[slot.sentiment] ||
                                    slot.sentiment}
                                </span>
                                {slot.canOpen ? (
                                  <span className="cg-acc-tag cg-acc-tag--open">
                                    Mở đầu
                                  </span>
                                ) : null}
                                {!slot.phone ? (
                                  <span className="cg-acc-tag cg-acc-tag--warn">
                                    Chưa gán acc
                                  </span>
                                ) : null}
                              </div>

                              <details className="cg-role-more">
                                <summary>Tùy chỉnh persona</summary>
                                <div className="cg-role-more-body">
                                  <label className="cg-camp-field">
                                    <span>Tên trong chat</span>
                                    <input
                                      value={slot.name}
                                      onChange={(e) =>
                                        updateSlot(slot.key, {
                                          name: e.target.value,
                                        })
                                      }
                                      placeholder="Để trống = tên session"
                                    />
                                  </label>
                                  <div className="cg-acc-chip-row">
                                    <span>Mức nói</span>
                                    <div className="cg-acc-mini-chips">
                                      {ACTIVITY_UI.map(({ value, label }) => (
                                        <button
                                          key={value}
                                          type="button"
                                          className={
                                            slot.activity === value
                                              ? 'is-active'
                                              : ''
                                          }
                                          onClick={() =>
                                            updateSlot(slot.key, {
                                              activity: value,
                                            })
                                          }
                                        >
                                          {label}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                  <div className="cg-acc-chip-row">
                                    <span>Thái độ</span>
                                    <div className="cg-acc-mini-chips">
                                      {SENTIMENT_UI.map(({ value, label }) => (
                                        <button
                                          key={value}
                                          type="button"
                                          className={
                                            slot.sentiment === value
                                              ? 'is-active'
                                              : ''
                                          }
                                          onClick={() =>
                                            updateSlot(slot.key, {
                                              sentiment: value,
                                            })
                                          }
                                        >
                                          {label}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                  <label
                                    className={`cg-acc-open-toggle${
                                      slot.canOpen ? ' is-on' : ''
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={slot.canOpen}
                                      onChange={(e) =>
                                        updateSlot(slot.key, {
                                          canOpen: e.target.checked,
                                        })
                                      }
                                    />
                                    <span className="cg-acc-open-toggle-ui">
                                      <strong>Được mở đầu</strong>
                                      <em>Ưu tiên line #1</em>
                                    </span>
                                  </label>
                                </div>
                              </details>
                            </article>
                          )
                        })}
                      </div>
                    )}
                  </section>

                  <div className="cg-studio-nav">
                    <button
                      type="button"
                      className="cg-studio-btn cg-studio-btn--ghost"
                      onClick={() => setConfigSection('campaign')}
                    >
                      ← Campaign
                    </button>
                    <button
                      type="button"
                      className="cg-studio-btn cg-studio-btn--primary"
                      disabled={cast.length < MIN_CAST}
                      onClick={() => setConfigSection('market')}
                    >
                      Tiếp · Market →
                    </button>
                  </div>
                </div>
              ) : null}

              {configSection === 'market' ? (
                <div className="cg-studio-stack">
                  <div className="cg-studio-card">
                    <label className={`cg-studio-check${useMarketContext ? ' is-on' : ''}`}>
                      <input
                        type="checkbox"
                        checked={useMarketContext}
                        onChange={(e) => setUseMarketContext(e.target.checked)}
                      />
                      <span>
                        <strong>Market context</strong>
                        <em>Giá + tin làm fact cho AI</em>
                      </span>
                    </label>
                    <label
                      className={`cg-studio-check${marketAutoRefresh && useMarketContext ? ' is-on' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={marketAutoRefresh}
                        disabled={!useMarketContext}
                        onChange={(e) => setMarketAutoRefresh(e.target.checked)}
                      />
                      <span>
                        <strong>Auto refresh</strong>
                        <em>Mỗi 5 phút · khi stale · khi focus lại tab</em>
                      </span>
                    </label>
                    <div className="cg-studio-fresh">
                      <span className={`cg-studio-fresh-pill cg-studio-fresh-pill--${freshness.status}`}>
                        {freshness.status}
                      </span>
                      <span>{freshness.age_label}</span>
                      {marketRefreshing ? (
                        <span className="cg-studio-hint">Refreshing…</span>
                      ) : null}
                      <button
                        type="button"
                        className="cg-studio-link"
                        disabled={marketRefreshing}
                        onClick={() => loadMarket(true, { reason: 'manual' })}
                      >
                        Refresh
                      </button>
                    </div>
                    {market?.source ? (
                      <p className="cg-studio-hint">
                        Source: {market.source}
                        {marketLastAutoAt
                          ? ` · auto ${new Date(marketLastAutoAt).toLocaleTimeString()}`
                          : ''}
                      </p>
                    ) : null}
                  </div>

                  <div className="cg-studio-card">
                    <div className="cg-studio-card-head">
                      <h3>Sources AI dùng</h3>
                    </div>
                    <div className="cg-studio-toggles">
                      {(
                        [
                          ['btc', 'BTC'],
                          ['eth', 'ETH'],
                          ['sol', 'SOL'],
                          ['alts', 'Alts'],
                          ['gainers', 'Gainers'],
                          ['losers', 'Losers'],
                          ['news', 'RSS news'],
                        ] as const
                      ).map(([key, label]) => (
                        <label key={key} className="cg-studio-check">
                          <input
                            type="checkbox"
                            checked={marketSources[key]}
                            disabled={!useMarketContext}
                            onChange={(e) =>
                              setMarketSources((prev) => ({
                                ...prev,
                                [key]: e.target.checked,
                              }))
                            }
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                    <p className="cg-studio-hint">
                      Alts = BNB, XRP, DOGE, AVAX, LINK… (grounding khi news nhắc)
                    </p>
                  </div>

                  {filteredMarket?.coins?.length ? (
                    <div className="cg-studio-card">
                      <div className="cg-studio-card-head">
                        <h3>Giá</h3>
                        <span className="cg-studio-muted">
                          {filteredMarket.coins.length} coin
                        </span>
                      </div>
                      <div className="cg-studio-coins">
                        {filteredMarket.coins.map((c) => (
                          <div key={c.symbol} className="cg-studio-coin">
                            <strong>{c.symbol}</strong>
                            <span>${c.usd?.toLocaleString?.() ?? c.usd}</span>
                            <span
                              className={
                                (c.usd_24h_change ?? 0) >= 0 ? 'is-up' : 'is-down'
                              }
                            >
                              {c.usd_24h_change != null
                                ? `${c.usd_24h_change >= 0 ? '+' : ''}${c.usd_24h_change.toFixed(2)}%`
                                : '—'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="cg-studio-card">
                    <div className="cg-studio-card-head">
                      <h3>Giới hạn tin trong plan</h3>
                    </div>
                    <label className="cg-studio-field">
                      <span>Tối đa chủ đề news AI dùng</span>
                      <input
                        type="number"
                        min={0}
                        max={8}
                        value={maxNewsTopics}
                        onChange={(e) =>
                          setMaxNewsTopics(
                            Math.max(
                              0,
                              Math.min(8, Math.trunc(Number(e.target.value) || 0)),
                            ),
                          )
                        }
                      />
                      <span className="cg-studio-hint">
                        Mặc định 2 — không nhét hết tin đã chọn vào chat (kể cả khi
                        tick nhiều)
                      </span>
                    </label>
                  </div>

                  {marketSources.news && filteredMarket?.news?.length ? (
                    <div className="cg-studio-card">
                      <div className="cg-studio-card-head">
                        <h3>Tin</h3>
                        <span className="cg-studio-muted">
                          {selectedNewsTitles.length} chọn
                        </span>
                      </div>
                      <ul className="cg-studio-news">
                        {filteredMarket.news.slice(0, 12).map((n) => {
                          const k = newsKey(n.source, n.title)
                          return (
                            <li key={k}>
                              <label className="cg-studio-check">
                                <input
                                  type="checkbox"
                                  checked={selectedNewsKeys.has(k)}
                                  onChange={() => {
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
                                  }}
                                />
                                <span>
                                  <strong>{n.title}</strong>
                                  <em>
                                    {n.source}
                                    {n.published_at ? ` · ${n.published_at}` : ''}
                                  </em>
                                </span>
                              </label>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  ) : null}

                  <div className="cg-studio-nav">
                    <button
                      type="button"
                      className="cg-studio-btn cg-studio-btn--ghost"
                      onClick={() => setConfigSection('participants')}
                    >
                      ← Acc
                    </button>
                    <button
                      type="button"
                      className="cg-studio-btn cg-studio-btn--primary"
                      onClick={() => setConfigSection('settings')}
                    >
                      Tiếp · Nhịp →
                    </button>
                  </div>
                </div>
              ) : null}

              {configSection === 'settings' ? (
                <div className="cg-studio-stack cg-rhythm">
                  <div className="cg-rhythm-card">
                    <div className="cg-rhythm-head">
                      <h3>Nhịp</h3>
                      <span className="cg-rhythm-stat">
                        {Number.isFinite(targetLines) &&
                        Number.isFinite(durationMin) &&
                        durationMin > 0
                          ? `${Math.round((targetLines * 60) / durationMin)}/h`
                          : '—'}
                      </span>
                    </div>

                    <div className="cg-rhythm-block">
                      <div className="cg-rhythm-duo">
                        <label className="cg-rhythm-num">
                          <em>Số tin</em>
                          <input
                            type="number"
                            min={MIN_TARGET_LINES}
                            max={MAX_TARGET_LINES}
                            value={
                              Number.isFinite(targetLines) ? targetLines : ''
                            }
                            onChange={(e) => {
                              const raw = e.target.value
                              if (raw.trim() === '') {
                                setTargetLines(Number.NaN)
                                return
                              }
                              const n = Number(raw)
                              if (!Number.isFinite(n)) return
                              setTargetLines(Math.trunc(n))
                              setDurationLocked(false)
                            }}
                            onBlur={() =>
                              setTargetLines((prev) =>
                                clampTargetLines(
                                  Number.isFinite(prev) ? prev : 22,
                                ),
                              )
                            }
                          />
                        </label>
                        <label className="cg-rhythm-num">
                          <em>Phút</em>
                          <input
                            type="number"
                            min={MIN_DURATION_MIN}
                            max={MAX_DURATION_MIN}
                            value={
                              Number.isFinite(durationMin) ? durationMin : ''
                            }
                            onChange={(e) => {
                              const raw = e.target.value
                              if (raw.trim() === '') {
                                setDurationMin(Number.NaN)
                                return
                              }
                              const n = Number(raw)
                              if (!Number.isFinite(n)) return
                              setDurationMin(Math.trunc(n))
                              setDurationLocked(true)
                            }}
                            onBlur={() =>
                              setDurationMin((prev) =>
                                clampDurationMin(
                                  Number.isFinite(prev)
                                    ? prev
                                    : suggestedDuration,
                                ),
                              )
                            }
                          />
                        </label>
                      </div>
                    </div>

                    {/* % sliders: reply + message length only (no discrete enums) */}
                    <div className="cg-rhythm-sliders">
                      <div className="cg-rhythm-slide">
                        <div className="cg-rhythm-row-label">
                          <span>Reply</span>
                          <b>{Math.round(replyRate * 100)}%</b>
                        </div>
                        <input
                          className="cg-rhythm-range"
                          type="range"
                          min={15}
                          max={55}
                          step={5}
                          value={Math.round(replyRate * 100)}
                          onChange={(e) =>
                            setReplyRate(Number(e.target.value) / 100)
                          }
                        />
                        <div className="cg-rhythm-meta">
                          ~
                          {Math.max(
                            1,
                            Math.round(
                              (Number.isFinite(targetLines)
                                ? targetLines
                                : 22) * replyRate,
                            ),
                          )}
                          /{Number.isFinite(targetLines) ? targetLines : '—'} tin
                          reply
                        </div>
                      </div>

                      <div className="cg-rhythm-slide">
                        <div className="cg-rhythm-row-label">
                          <span>Split bubble</span>
                          <b>{splitContinuePct}%</b>
                        </div>
                        <input
                          className="cg-rhythm-range"
                          type="range"
                          min={0}
                          max={100}
                          step={5}
                          value={splitContinuePct}
                          onChange={(e) =>
                            setSplitContinuePct(Number(e.target.value))
                          }
                        />
                        <div className="cg-rhythm-meta">
                          {splitPctLabel(splitContinuePct)} · cùng acc: bubble
                          ngắn rồi bubble tiếp
                        </div>
                      </div>

                      <div className="cg-rhythm-slide">
                        <div className="cg-rhythm-row-label">
                          <span>Tin ngắn</span>
                          <b>{messageLengthMix.short}%</b>
                        </div>
                        <input
                          className="cg-rhythm-range"
                          type="range"
                          min={0}
                          max={100}
                          step={5}
                          value={messageLengthMix.short}
                          onChange={(e) =>
                            setMessageLengthMix((prev) =>
                              adjustMessageLengthMix(
                                prev,
                                'short',
                                Number(e.target.value),
                              ),
                            )
                          }
                        />
                      </div>
                      <div className="cg-rhythm-slide">
                        <div className="cg-rhythm-row-label">
                          <span>Tin vừa</span>
                          <b>{messageLengthMix.medium}%</b>
                        </div>
                        <input
                          className="cg-rhythm-range"
                          type="range"
                          min={0}
                          max={100}
                          step={5}
                          value={messageLengthMix.medium}
                          onChange={(e) =>
                            setMessageLengthMix((prev) =>
                              adjustMessageLengthMix(
                                prev,
                                'medium',
                                Number(e.target.value),
                              ),
                            )
                          }
                        />
                      </div>
                      <div className="cg-rhythm-slide">
                        <div className="cg-rhythm-row-label">
                          <span>Tin dài</span>
                          <b>{messageLengthMix.long}%</b>
                        </div>
                        <input
                          className="cg-rhythm-range"
                          type="range"
                          min={0}
                          max={100}
                          step={5}
                          value={messageLengthMix.long}
                          onChange={(e) =>
                            setMessageLengthMix((prev) =>
                              adjustMessageLengthMix(
                                prev,
                                'long',
                                Number(e.target.value),
                              ),
                            )
                          }
                        />
                        <div className="cg-rhythm-meta">
                          Tổng{' '}
                          {messageLengthMix.short +
                            messageLengthMix.medium +
                            messageLengthMix.long}
                          %
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Limited choices = pills, not % */}
                  <div className="cg-rhythm-card cg-rhythm-card--opts">
                    <div className="cg-rhythm-head cg-rhythm-head--soft">
                      <h3>Tùy chọn</h3>
                    </div>

                    <div className="cg-rhythm-opt">
                      <span className="cg-rhythm-opt-label">Fact market</span>
                      <div className="cg-rhythm-mini-seg">
                        {(
                          [
                            ['low', 'Ít'],
                            ['medium', 'Vừa'],
                            ['high', 'Nhiều'],
                          ] as const
                        ).map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            className={
                              marketIntensity === value ? 'is-on' : ''
                            }
                            onClick={() => setMarketIntensity(value)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="cg-rhythm-opt">
                      <span className="cg-rhythm-opt-label">Mật độ</span>
                      <div className="cg-rhythm-mini-seg">
                        {(
                          [
                            ['light', 'Thưa'],
                            ['normal', 'Vừa'],
                            ['dense', 'Dày'],
                          ] as const
                        ).map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            className={density === value ? 'is-on' : ''}
                            onClick={() => {
                              setDensity(value)
                              setDurationLocked(false)
                            }}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="cg-rhythm-opt">
                      <span className="cg-rhythm-opt-label">Speaker</span>
                      <div className="cg-rhythm-mini-seg cg-rhythm-mini-seg--wrap">
                        {(
                          Object.values(SPEAKER_ORDER_PRESETS) as Array<
                            (typeof SPEAKER_ORDER_PRESETS)[SpeakerOrderPattern]
                          >
                        ).map((preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            className={
                              speakerOrder === preset.id ? 'is-on' : ''
                            }
                            onClick={() => {
                              setSpeakerOrder(preset.id)
                              setMaxConsecutiveSpeaker(preset.max_consecutive)
                            }}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                      {speakerOrder !== 'rotate' ? (
                        <div className="cg-rhythm-opt-sub">
                          <div className="cg-rhythm-row-label">
                            <span>Max cùng acc liên tiếp</span>
                            <b>{maxConsecutiveSpeaker}</b>
                          </div>
                          <input
                            className="cg-rhythm-range"
                            type="range"
                            min={2}
                            max={5}
                            step={1}
                            value={maxConsecutiveSpeaker}
                            onChange={(e) =>
                              setMaxConsecutiveSpeaker(
                                Math.max(
                                  2,
                                  Math.min(5, Number(e.target.value) || 3),
                                ),
                              )
                            }
                          />
                        </div>
                      ) : null}
                    </div>

                    <div className="cg-rhythm-opt">
                      <span className="cg-rhythm-opt-label">Số liệu</span>
                      <div className="cg-rhythm-mini-seg">
                        {(
                          [
                            ['none', 'Không số'],
                            ['approx', 'Xấp xỉ'],
                            ['exact', 'Exact'],
                          ] as const
                        ).map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            className={
                              numericDetail === value ? 'is-on' : ''
                            }
                            onClick={() => setNumericDetail(value)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="cg-studio-nav">
                    <button
                      type="button"
                      className="cg-studio-btn cg-studio-btn--ghost"
                      onClick={() => setConfigSection('market')}
                    >
                      ← Market
                    </button>
                    <button
                      type="button"
                      className="cg-studio-btn cg-studio-btn--primary"
                      onClick={() => setConfigSection('prompt')}
                    >
                      Tiếp · Prompt →
                    </button>
                  </div>
                </div>
              ) : null}

              {configSection === 'prompt' ? (
                <div className="cg-studio-stack">
                  <div className="cg-studio-card cg-prompt-ready-card">
                    <div className="cg-studio-card-head">
                      <h3>Prompt · Review</h3>
                      <span
                        className={`cg-prompt-ready-badge${
                          promptReview.readyGenerate ? ' is-ok' : ' is-warn'
                        }`}
                      >
                        {promptReview.readyGenerate ? 'Ready' : 'Thiếu setup'}
                      </span>
                    </div>

                    <div className="cg-prompt-checks">
                      {promptReview.checks.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className={`cg-prompt-check${c.ok ? ' is-ok' : ' is-warn'}`}
                          onClick={() => setConfigSection(c.go)}
                          title="Jump to step"
                        >
                          <span className="cg-prompt-check-dot" aria-hidden>
                            {c.ok ? '✓' : '!'}
                          </span>
                          <span className="cg-prompt-check-label">{c.label}</span>
                          <span className="cg-prompt-check-value">{c.value}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="cg-studio-card">
                    <div className="cg-studio-card-head">
                      <h3>Model AI</h3>
                      <a
                        className="cg-studio-link"
                        href={openaiPricingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Xem bảng giá OpenAI (chính thức)"
                      >
                        Giá API OpenAI ↗
                      </a>
                    </div>
                    <label className="cg-studio-field">
                      <span>Model generate plan</span>
                      <input
                        type="text"
                        value={aiModel}
                        onChange={(e) => setAiModel(e.target.value)}
                        placeholder={
                          aiStatus?.model || 'gpt-4.1-mini'
                        }
                        list="cg-ai-model-suggestions"
                        spellCheck={false}
                        autoComplete="off"
                      />
                      {modelSuggestions.length ? (
                        <datalist id="cg-ai-model-suggestions">
                          {modelSuggestions.map((m) => (
                            <option key={m} value={m} />
                          ))}
                        </datalist>
                      ) : null}
                      <span className="cg-studio-hint">
                        Nhập model id (vd <code>gpt-4.1-mini</code>). Để trống =
                        server <code>OPENAI_MODEL</code>
                        {aiStatus?.model ? ` · ${aiStatus.model}` : ''}.{' '}
                        <a
                          href={openaiPricingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Check giá trên OpenAI
                        </a>
                        .
                      </span>
                    </label>
                  </div>

                  <div className="cg-studio-card">
                    <div className="cg-studio-card-head">
                      <h3>Campaign</h3>
                      <button
                        type="button"
                        className="cg-studio-link"
                        onClick={() => setConfigSection('campaign')}
                      >
                        Edit
                      </button>
                    </div>
                    <dl className="cg-prompt-dl">
                      <div>
                        <dt>Name</dt>
                        <dd>{campaignName.trim() || '—'}</dd>
                      </div>
                      <div>
                        <dt>Preset</dt>
                        <dd>{presetId || 'custom'}</dd>
                      </div>
                      <div className="cg-prompt-dl-full">
                        <dt>User prompt</dt>
                        <dd>{prompt.trim() || '—'}</dd>
                      </div>
                      <div>
                        <dt>Language</dt>
                        <dd>{language}</dd>
                      </div>
                      <div>
                        <dt>Topic</dt>
                        <dd>{topic.trim() || '—'}</dd>
                      </div>
                      <div>
                        <dt>Tone</dt>
                        <dd>{tone.trim() || '—'}</dd>
                      </div>
                      <div>
                        <dt>Type</dt>
                        <dd>{campaignType.trim() || '—'}</dd>
                      </div>
                      <div className="cg-prompt-dl-full">
                        <dt>Group</dt>
                        <dd className={groupLink.trim() ? '' : 'is-warn'}>
                          {groupLink.trim() || '— (cần trước Start)'}
                        </dd>
                      </div>
                      <div className="cg-prompt-dl-full">
                        <dt>Goal → API</dt>
                        <dd className="cg-prompt-mono">{compiledGoal || '—'}</dd>
                      </div>
                    </dl>
                  </div>

                  <div className="cg-studio-card">
                    <div className="cg-studio-card-head">
                      <h3>Acc · Persona</h3>
                      <button
                        type="button"
                        className="cg-studio-link"
                        onClick={() => setConfigSection('participants')}
                      >
                        Edit
                      </button>
                    </div>
                    <p className="cg-studio-hint">
                      Mode: <b>{personaMode}</b>
                      {promptReview.openers.length
                        ? ` · can_open: ${promptReview.openers.map((s) => s.label || s.id).join(', ')}`
                        : ' · chưa set can_open'}
                    </p>
                    {cast.length < 2 ? (
                      <p className="cg-prompt-miss">Chọn ≥ 2 acc để Generate</p>
                    ) : (
                      <ul className="cg-prompt-speaker-list">
                        {cast.map((s) => (
                          <li key={s.phone}>
                            <strong>
                              {s.id} · {s.label}
                            </strong>
                            <span>
                              {s.role}
                              {s.activity
                                ? ` · ${s.activity}/${s.sentiment || '—'}`
                                : ''}
                              {s.can_open ? ' · open' : ''}

                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="cg-studio-card">
                    <div className="cg-studio-card-head">
                      <h3>Market</h3>
                      <button
                        type="button"
                        className="cg-studio-link"
                        onClick={() => setConfigSection('market')}
                      >
                        Edit
                      </button>
                    </div>
                    <dl className="cg-prompt-dl">
                      <div>
                        <dt>Context</dt>
                        <dd>{useMarketContext ? 'ON' : 'OFF'}</dd>
                      </div>
                      <div>
                        <dt>Freshness</dt>
                        <dd className={freshness.warn ? 'is-warn' : ''}>
                          {useMarketContext
                            ? `${freshness.status} · ${freshness.age_label}`
                            : '—'}
                        </dd>
                      </div>
                      <div>
                        <dt>Intensity</dt>
                        <dd>{promptReview.marketIntensityLabel}</dd>
                      </div>
                      <div>
                        <dt>Numeric</dt>
                        <dd>{promptReview.numericLabel}</dd>
                      </div>
                      <div>
                        <dt>Max news</dt>
                        <dd>{maxNewsTopics}</dd>
                      </div>
                      <div className="cg-prompt-dl-full">
                        <dt>Sources</dt>
                        <dd>
                          {useMarketContext
                            ? promptReview.sourceOn.join(', ') || '—'
                            : '—'}
                        </dd>
                      </div>
                      <div className="cg-prompt-dl-full">
                        <dt>Selected news</dt>
                        <dd>
                          {selectedNewsTitles.length
                            ? selectedNewsTitles.slice(0, 6).join(' · ')
                            : '—'}
                          {selectedNewsTitles.length > 6
                            ? ` (+${selectedNewsTitles.length - 6})`
                            : ''}
                        </dd>
                      </div>
                      <div className="cg-prompt-dl-full">
                        <dt>Prices</dt>
                        <dd>
                          {filteredMarket?.coins?.length
                            ? filteredMarket.coins
                                .map(
                                  (c) =>
                                    `${c.symbol} ${c.usd}${
                                      c.usd_24h_change != null
                                        ? ` (${c.usd_24h_change >= 0 ? '+' : ''}${c.usd_24h_change.toFixed(1)}%)`
                                        : ''
                                    }`,
                                )
                                .join(' · ')
                            : '—'}
                        </dd>
                      </div>
                    </dl>
                    {useMarketContext && freshness.warn ? (
                      <p className="cg-prompt-miss">
                        Market stale — Refresh trước Generate
                      </p>
                    ) : null}
                  </div>

                  <div className="cg-studio-card">
                    <div className="cg-studio-card-head">
                      <h3>Nhịp · Conversation</h3>
                      <button
                        type="button"
                        className="cg-studio-link"
                        onClick={() => setConfigSection('settings')}
                      >
                        Edit
                      </button>
                    </div>
                    <dl className="cg-prompt-dl">
                      <div>
                        <dt>Messages</dt>
                        <dd>{promptReview.linesN}</dd>
                      </div>
                      <div>
                        <dt>Duration</dt>
                        <dd>{promptReview.minsN}p</dd>
                      </div>
                      <div>
                        <dt>Density</dt>
                        <dd>{density}</dd>
                      </div>
                      <div>
                        <dt>Reply rate</dt>
                        <dd>{Math.round(replyRate * 100)}%</dd>
                      </div>
                      <div>
                        <dt>Length mix</dt>
                        <dd>{promptReview.lengthLabel}</dd>
                      </div>
                      <div>
                        <dt>Speaker order</dt>
                        <dd>
                          {promptReview.orderLabel}
                          {speakerOrder !== 'rotate'
                            ? ` · max ${maxConsecutiveSpeaker}x`
                            : ''}
                        </dd>
                      </div>
                      <div className="cg-prompt-dl-full">
                        <dt>Order example</dt>
                        <dd>
                          <code>{promptReview.orderExample}</code>
                        </dd>
                      </div>
                      <div>
                        <dt>Timing</dt>
                        <dd>{promptReview.timingLabel}</dd>
                      </div>
                      <div>
                        <dt>Split bubbles</dt>
                        <dd>
                          {splitContinuePct}% · {splitPctLabel(splitContinuePct)}
                        </dd>
                      </div>
                      <div>
                        <dt>Model</dt>
                        <dd>{aiModel || aiStatus?.model || 'default'}</dd>
                      </div>
                    </dl>
                  </div>

                  <details className="cg-studio-card cg-prompt-json">
                    <summary>
                      Raw JSON · debug ({planApiPayloadJson.length.toLocaleString()} chars)
                    </summary>
                    <textarea
                      className="cg-studio-prompt-full"
                      readOnly
                      rows={12}
                      value={planApiPayloadJson}
                      spellCheck={false}
                    />
                  </details>

                  <div className="cg-studio-nav">
                    <button
                      type="button"
                      className="cg-studio-btn cg-studio-btn--ghost"
                      onClick={() => setConfigSection('settings')}
                    >
                      ← Nhịp
                    </button>
                    <button
                      type="button"
                      className="cg-studio-btn cg-studio-btn--primary"
                      onClick={() => void handlePlan()}
                      disabled={planning || !promptReview.readyGenerate}
                    >
                      {planning
                        ? 'Generating…'
                        : promptReview.readyGenerate
                          ? '✦ Generate plan'
                          : '✦ Generate (thiếu Acc/Prompt)'}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        {/* RIGHT: Telegram-style preview + editor */}
        <section className="cg-pv" aria-label="Preview">
          <header className="cg-pv-head">
            <div className="cg-pv-head-top">
              <div className="cg-pv-head-left">
                <div className="cg-pv-mark" aria-hidden>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M21 5.5 11 13l-2.8 5.6c-.3.6-1.2.5-1.4-.1L5 13 3 11.5 21 5.5Z"
                      fill="currentColor"
                      opacity="0.95"
                    />
                    <path
                      d="M11 13 21 5.5 9.5 16.2"
                      stroke="currentColor"
                      strokeWidth="1.2"
                      strokeLinejoin="round"
                      opacity="0.5"
                    />
                  </svg>
                </div>
                <div className="cg-pv-head-text">
                  <div className="cg-pv-title-row">
                    <h2>Preview</h2>
                    {plan ? (
                      <span className="cg-pv-pill">{plan.lines.length} msgs</span>
                    ) : (
                      <span className="cg-pv-pill cg-pv-pill--muted">Empty</span>
                    )}
                    {plan ? (
                      <span className="cg-pv-pill cg-pv-pill--soft">
                        ~{plan.duration_min}p
                      </span>
                    ) : null}
                    {planWarnings.warnings.length ? (
                      <span className="cg-pv-pill cg-pv-pill--warn">
                        {planWarnings.warnings.length} warn
                      </span>
                    ) : null}
                    {job ? (
                      <span
                        className={`cg-pv-pill cg-pv-pill--run is-${job.status}`}
                      >
                        #{job.id} · {job.completed_lines}/{job.total_lines}
                      </span>
                    ) : null}
                  </div>
                  <p>
                    {plan
                      ? 'Link nhóm · Start gửi — chỉnh bubble bên dưới'
                      : 'Generate plan, rồi nhập link nhóm và Start tại đây'}
                  </p>
                </div>
              </div>
              {castForPlan.length ? (
                <div className="cg-pv-cast-mini" aria-hidden>
                  {castForPlan.slice(0, 5).map((s) => (
                    <SessionAvatar
                      key={s.id}
                      phone={s.phone}
                      label={s.label}
                      hasAvatar={getMeta(s.phone)?.has_avatar}
                      avatarUpdatedAt={getMeta(s.phone)?.avatar_updated_at}
                      size="sm"
                    />
                  ))}
                  {castForPlan.length > 5 ? (
                    <span className="cg-pv-cast-more">
                      +{castForPlan.length - 5}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="cg-pv-runbar" aria-label="Gửi chiến dịch">
              <label className="cg-pv-link">
                <span className="cg-pv-link-label">
                  <span className="cg-pv-link-ico" aria-hidden>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M10 13a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 0 0-7.07-7.07L10.5 5.43"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                      />
                      <path
                        d="M14 11a5 5 0 0 0-7.07 0L4.81 13.12a5 5 0 0 0 7.07 7.07L13.5 18.57"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                      />
                    </svg>
                  </span>
                  Group
                </span>
                <div
                  className={`cg-pv-link-field${
                    groupLink.trim() ? ' is-ok' : ' is-empty'
                  }`}
                >
                  <input
                    value={groupLink}
                    onChange={(e) => setGroupLink(e.target.value)}
                    placeholder="https://t.me/… hoặc peer_id"
                    spellCheck={false}
                    autoComplete="off"
                  />
                  {groupLink.trim() ? (
                    <span className="cg-pv-link-badge" title="Sẵn sàng gửi">
                      OK
                    </span>
                  ) : (
                    <span className="cg-pv-link-badge is-need">Cần</span>
                  )}
                </div>
              </label>

              <div className="cg-pv-actions">
                {!jobRunning && !starting && jobCanResume ? (
                  <button
                    type="button"
                    className="cg-pv-start"
                    onClick={() => void handleResume()}
                    title="Tiếp tục job đã dừng"
                  >
                    <span className="cg-pv-start-ico" aria-hidden>
                      ▶
                    </span>
                    Tiếp tục
                  </button>
                ) : null}
                {!jobRunning && !starting && !jobCanResume ? (
                  <button
                    type="button"
                    className="cg-pv-start"
                    onClick={() => void handleStart()}
                    disabled={!plan || !groupLink.trim() || cast.length < 2}
                    title={
                      !plan
                        ? 'Cần Generate plan trước'
                        : !groupLink.trim()
                          ? 'Cần link nhóm'
                          : cast.length < 2
                            ? 'Cần ≥ 2 acc'
                            : 'Chạy gửi tin theo plan'
                    }
                  >
                    <span className="cg-pv-start-ico" aria-hidden>
                      ▶
                    </span>
                    Start gửi
                  </button>
                ) : null}
                {starting && !jobRunning ? (
                  <button type="button" className="cg-pv-start" disabled>
                    <span className="cg-pv-start-spin" aria-hidden />
                    Đang chạy…
                  </button>
                ) : null}
                {jobRunning ? (
                  <button
                    type="button"
                    className="cg-pv-start cg-pv-start--stop"
                    onClick={() => void handleStop()}
                  >
                    Dừng
                  </button>
                ) : null}
                {!jobRunning && !starting && jobCanResume ? (
                  <button
                    type="button"
                    className="cg-pv-start cg-pv-start--ghost"
                    onClick={() => void handleStart()}
                    disabled={!plan || !groupLink.trim() || cast.length < 2}
                    title="Tạo job mới từ đầu"
                  >
                    Start lại
                  </button>
                ) : null}
                {job && !jobRunning && !jobCanResume ? (
                  <button
                    type="button"
                    className="cg-pv-start cg-pv-start--ghost"
                    onClick={scrollToTimeline}
                    title="Xem timeline tiến trình"
                  >
                    Timeline
                  </button>
                ) : null}
              </div>
            </div>

            {jobRunning && job ? (
              <div className="cg-pv-live" aria-live="polite">
                <div className="cg-pv-live-bar" aria-hidden>
                  <i
                    style={{
                      width: `${
                        job.total_lines
                          ? Math.min(
                              100,
                              (job.completed_lines / job.total_lines) * 100,
                            )
                          : 0
                      }%`,
                    }}
                  />
                </div>
                <span className="cg-pv-live-text">
                  Đang gửi · {job.completed_lines}/{job.total_lines}
                  {job.success_lines != null
                    ? ` · ok ${job.success_lines}`
                    : ''}
                  {job.error_lines ? ` · err ${job.error_lines}` : ''}
                </span>
                <button
                  type="button"
                  className="cg-pv-live-jump"
                  onClick={scrollToTimeline}
                >
                  Xem chi tiết ↓
                </button>
              </div>
            ) : null}
          </header>

          {plan?.lines?.length ? (
            <div className="cg-plan-qa" aria-label="Plan validation">
              <div className="cg-plan-qa-row">
                <strong>QA</strong>
                <div className="cg-plan-qa-actions">
                  <button type="button" className="cg-qa-btn" onClick={handleFixFacts}>
                    Fix facts
                  </button>
                  <button
                    type="button"
                    className="cg-qa-btn"
                    onClick={handleShortenMessages}
                  >
                    Shorten
                  </button>
                </div>
              </div>
              <div className="cg-plan-qa-meta">
                {plan?.lines?.length ? (
                  <span className="cg-plan-qa-replies">
                    Reply{' '}
                    <strong>
                      {
                        plan.lines.filter((l) => l.action === 'reply').length
                      }
                      /{plan.lines.length}
                    </strong>
                    {' · '}
                    {Math.round(
                      (plan.lines.filter((l) => l.action === 'reply').length /
                        plan.lines.length) *
                        100,
                    )}
                    % (mục tiêu {Math.round(replyRate * 100)}%)
                  </span>
                ) : null}
                {distPreview.length ? (
                  <div className="cg-plan-qa-chips">
                    {distPreview.map((d) => (
                      <span key={d.id} className="cg-plan-qa-chip">
                        {d.label}
                        <em>{d.count}</em>
                      </span>
                    ))}
                  </div>
                ) : null}
                {burstPreview.length ? (
                  <span className="cg-plan-qa-bursts">
                    {burstPreview.length} bursts
                  </span>
                ) : null}
              </div>
              {planWarnings.warnings.length ? (
                <ul className="cg-plan-warn-list">
                  {planWarnings.warnings.slice(0, 8).map((w, i) => (
                    <li key={`${w.code}-${i}`} className={`is-${w.level}`}>
                      {w.message}
                      {w.line_index != null ? (
                        <button
                          type="button"
                          className="cg-studio-link"
                          onClick={() =>
                            selectLineInPreview(w.line_index!, { fromUser: true })
                          }
                        >
                          {' '}
                          →#{w.line_index + 1}
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="cg-plan-qa-ok">No major warnings</p>
              )}
            </div>
          ) : null}

          <div className="cg-pv-body" ref={pvBodyRef}>
            {!plan?.lines?.length ? (
              <div className="cg-pv-empty">
                <div className="cg-pv-empty-phone" aria-hidden>
                  <div className="cg-pv-empty-phone-bar" />
                  <div className="cg-pv-empty-bubbles">
                    <i className="is-l" />
                    <i className="is-r" />
                    <i className="is-l" />
                  </div>
                </div>
                <strong>Chưa có plan</strong>
                <p>
                  Setup bên trái → <b>Generate</b> để xem Telegram preview.
                </p>
              </div>
            ) : (
              <div className="cg-tg">
                <div className="cg-tg-top">
                  <span className="cg-tg-top-title">
                    {campaignName.trim() || plan.title || 'Campaign chat'}
                  </span>
                  <span className="cg-tg-top-sub">
                    {castForPlan.length} members · preview
                    {job ? (
                      <>
                        {' · '}
                        <b className="cg-tg-top-live">
                          {jobRunning
                            ? nextSendIndex != null
                              ? `Đang tới #${nextSendIndex + 1}`
                              : 'Đang chạy'
                            : job.status === 'done'
                              ? 'Đã gửi xong'
                              : job.status}
                        </b>
                      </>
                    ) : castForPlan[0] ? (
                      <>
                        {' · '}
                        <b>Bạn</b> = {castForPlan[0].label || castForPlan[0].id}{' '}
                        (phải)
                      </>
                    ) : null}
                  </span>
                </div>
                <div className="cg-tg-thread">
                  {(() => {
                    // Acc đầu cast = "me" (bubble phải, kiểu Telegram outgoing)
                    const selfId = castForPlan[0]?.id || null
                    return plan.lines.map((line, index) => {
                      const label =
                        speakerLabel.get(line.speaker_id) || line.speaker_id
                      const phone = speakerPhoneById.get(line.speaker_id) || ''
                      const meta = phone ? getMeta(phone) : undefined
                      const isSelf = Boolean(selfId && line.speaker_id === selfId)
                      const isSelected = selectedLineIndex === index
                      const isReply =
                        line.action === 'reply' && line.reply_to_line != null
                      const prev = index > 0 ? plan.lines[index - 1] : null
                      const showHeader =
                        !prev || prev.speaker_id !== line.speaker_id
                      const replyText =
                        isReply && line.reply_to_line
                          ? plan.lines[line.reply_to_line - 1]?.text
                          : null
                      const lineSt = lineStatusById.get(index + 1)?.status
                      const isNext = nextSendIndex === index
                      const isLiveNext = Boolean(job && isNext)
                      const sendClass = lineSt
                        ? ` is-send-${lineSt}`
                        : job
                          ? isNext
                            ? ' is-send-next'
                            : ' is-send-queued'
                          : ''
                      const statusLabel = !job
                        ? null
                        : lineSt === 'success'
                          ? 'Đã gửi'
                          : lineSt === 'error'
                            ? 'Lỗi'
                            : lineSt === 'running'
                              ? 'Đang gửi'
                              : lineSt === 'skipped'
                                ? 'Bỏ qua'
                                : isNext
                                  ? jobRunning
                                    ? 'Sắp gửi'
                                    : 'Chờ'
                                  : lineSt === 'pending'
                                    ? 'Chờ'
                                    : jobRunning
                                      ? 'Chờ'
                                      : null
                      return (
                        <button
                          key={`${index}-${line.speaker_id}-${line.at_sec}`}
                          type="button"
                          data-line-index={index}
                          className={`cg-tg-row${isSelf ? ' is-out' : ' is-in'}${
                            isSelected ? ' is-selected' : ''
                          }${showHeader ? ' is-head' : ' is-cont'}${sendClass}${
                            isLiveNext ? ' is-next-send' : ''
                          }`}
                          onClick={() =>
                            selectLineInPreview(index, { fromUser: true })
                          }
                          title={
                            lineStatusById.get(index + 1)?.detail ||
                            (statusLabel ? statusLabel : undefined)
                          }
                        >
                          {!isSelf ? (
                            <div className="cg-tg-av-col">
                              {showHeader ? (
                                phone ? (
                                  <SessionAvatar
                                    phone={phone}
                                    label={String(label)}
                                    hasAvatar={meta?.has_avatar}
                                    avatarUpdatedAt={meta?.avatar_updated_at}
                                    size="sm"
                                  />
                                ) : (
                                  <span
                                    className={`cg-tg-av-fallback ${colorClass(line.speaker_id)}`}
                                  >
                                    {String(label).slice(0, 1).toUpperCase()}
                                  </span>
                                )
                              ) : (
                                <span className="cg-tg-av-spacer" />
                              )}
                            </div>
                          ) : null}
                          <div className="cg-tg-bubble">
                            {isLiveNext ? (
                              <span className="cg-tg-next-flag" aria-hidden>
                                {lineSt === 'running' ? '● Đang gửi' : '→ Sắp gửi'}
                              </span>
                            ) : null}
                            {showHeader && !isSelf ? (
                              <div className="cg-tg-name-row">
                                <strong className={colorClass(line.speaker_id)}>
                                  {label}
                                </strong>
                                <span>
                                  #{index + 1} · {formatAt(line.at_sec)}
                                </span>
                              </div>
                            ) : null}
                            {showHeader && isSelf ? (
                              <div className="cg-tg-name-row cg-tg-name-row--self">
                                <strong>Bạn</strong>
                                <span>
                                  #{index + 1} · {formatAt(line.at_sec)}
                                </span>
                              </div>
                            ) : null}
                            {isReply ? (
                              <div className="cg-tg-reply-quote">
                                <div className="cg-tg-reply-quote-head">
                                  <em>Reply ↩ #{line.reply_to_line}</em>
                                </div>
                                <span>
                                  {replyText
                                    ? replyText.slice(0, 80) +
                                      (replyText.length > 80 ? '…' : '')
                                    : '…'}
                                </span>
                              </div>
                            ) : null}
                            <p className="cg-tg-text">{line.text}</p>
                            <span className="cg-tg-meta-inline">
                              {isReply ? (
                                <span className="cg-tg-reply-badge">reply</span>
                              ) : null}
                              {statusLabel ? (
                                <span
                                  className={`cg-tg-send-st${
                                    lineSt ? ` is-${lineSt}` : isNext ? ' is-next' : ''
                                  }`}
                                >
                                  {lineSt === 'success' ? '✓ ' : ''}
                                  {lineSt === 'error' ? '! ' : ''}
                                  {lineSt === 'running' ? '… ' : ''}
                                  {statusLabel}
                                </span>
                              ) : null}
                              <span className="cg-tg-time-inline">
                                {formatAt(line.at_sec)}
                              </span>
                            </span>
                          </div>
                        </button>
                      )
                    })
                  })()}
                </div>
              </div>
            )}
          </div>

          {selectedLine && selectedLineIndex != null ? (
            <div className="cg-pv-dock" role="region" aria-label="Message editor">
              <div className="cg-pv-dock-bar">
                <div className="cg-pv-dock-title">
                  <strong>#{selectedLineIndex + 1}</strong>
                  <span>
                    {speakerLabel.get(selectedLine.speaker_id) ||
                      selectedLine.speaker_id}{' '}
                    · {formatAt(selectedLine.at_sec)}
                  </span>
                  {selectedPersona ? (
                    <em>
                      {'activity' in selectedPersona
                        ? `${(selectedPersona as PersonaParticipant).role}`
                        : `${(selectedPersona as CampaignSpeaker).role}`}
                    </em>
                  ) : null}
                </div>
                <div className="cg-pv-dock-actions">
                  <button
                    type="button"
                    className="cg-pv-dock-del"
                    onClick={() => deleteLine(selectedLineIndex)}
                    title="Delete line"
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    className="cg-pv-dock-close"
                    onClick={() => setSelectedLineIndex(null)}
                    title="Close editor"
                    aria-label="Close editor"
                  >
                    ×
                  </button>
                </div>
              </div>

              <div className="cg-pv-dock-controls">
                <label className="cg-pv-dock-field">
                  <span>Sender</span>
                  <select
                    value={selectedLine.speaker_id}
                    onChange={(e) =>
                      updateLine(selectedLineIndex, {
                        speaker_id: e.target.value,
                      })
                    }
                  >
                    {castForPlan.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label} ({s.id})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="cg-pv-dock-field cg-pv-dock-field--sm">
                  <span>Time</span>
                  <input
                    type="number"
                    min={0}
                    value={selectedLine.at_sec}
                    onChange={(e) =>
                      updateLine(selectedLineIndex, {
                        at_sec: Math.max(
                          0,
                          Math.trunc(Number(e.target.value) || 0),
                        ),
                      })
                    }
                  />
                </label>
                <label className="cg-pv-dock-field cg-pv-dock-field--sm">
                  <span>Action</span>
                  <select
                    value={selectedLine.action}
                    onChange={(e) =>
                      updateLine(selectedLineIndex, {
                        action: e.target.value as 'send' | 'reply',
                      })
                    }
                  >
                    <option value="send">send</option>
                    <option value="reply">reply</option>
                  </select>
                </label>
                {selectedLine.action === 'reply' ? (
                  <label className="cg-pv-dock-field cg-pv-dock-field--sm">
                    <span>Reply #</span>
                    <input
                      type="number"
                      min={1}
                      max={selectedLineIndex}
                      value={selectedLine.reply_to_line ?? ''}
                      onChange={(e) =>
                        updateLine(selectedLineIndex, {
                          reply_to_line: Math.trunc(Number(e.target.value) || 1),
                        })
                      }
                    />
                  </label>
                ) : null}
              </div>

              <textarea
                className="cg-pv-dock-text"
                rows={2}
                value={selectedLine.text}
                onChange={(e) =>
                  updateLine(selectedLineIndex, { text: e.target.value })
                }
                placeholder="Message text…"
              />

              {(() => {
                const fact = planWarnings.factIssues.find(
                  (f) => f.line_index === selectedLineIndex,
                )
                if (!fact) return null
                return (
                  <div className="cg-pv-dock-fact">
                    <span className="cg-pv-dock-fact-msg">{fact.message}</span>
                    <button
                      type="button"
                      className="cg-qa-btn"
                      onClick={() =>
                        handleApplyFactSuggestion(
                          selectedLineIndex,
                          fact.suggested_fix ||
                            softenNumericText(selectedLine.text),
                        )
                      }
                    >
                      Fix fact
                    </button>
                  </div>
                )
              })()}
            </div>
          ) : null}
        </section>
      </div>

      <footer
        ref={timelineRef}
        id="cg-timeline"
        className={`cg-tl${job ? ` is-job is-${job.status}` : ''}`}
        aria-label="Timeline & tiến trình"
      >
        <div className="cg-tl-head">
          <div className="cg-tl-head-left">
            <strong>{job ? 'Timeline · Tiến trình' : 'Timeline'}</strong>
            <span>
              {plan?.lines?.length
                ? `${plan.lines.length} msgs · ${plan.duration_min}p`
                : 'Empty'}
              {job
                ? ` · job #${job.id} ${job.status} · ${job.completed_lines}/${job.total_lines}`
                : ''}
            </span>
          </div>
          <div className="cg-tl-head-right">
            {job ? (
              <span
                className={`cg-tl-job-pct${
                  job.status === 'error' ? ' is-warn' : ''
                }`}
              >
                {job.total_lines
                  ? Math.round((job.completed_lines / job.total_lines) * 100)
                  : 0}
                %
              </span>
            ) : null}
            {jobRunning ? (
              <button
                type="button"
                className="cg-studio-btn cg-studio-btn--danger cg-studio-btn--sm"
                onClick={() => void handleStop()}
              >
                Stop
              </button>
            ) : null}
            {burstPreview.length && !job ? (
              <div className="cg-tl-burst-pills">
                {burstPreview.slice(0, 6).map((b, i) => (
                  <span key={`${b.start}-${i}`} className="cg-tl-burst-pill">
                    {b.start}–{b.end}
                    <em>{b.count}</em>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        {job ? (
          <div className="cg-tl-progress">
            <div className="cg-tl-progress-bar" aria-hidden>
              <i
                className="is-ok"
                style={{
                  width: `${
                    job.total_lines
                      ? Math.min(
                          100,
                          (job.success_lines / job.total_lines) * 100,
                        )
                      : 0
                  }%`,
                }}
              />
              <i
                className="is-err"
                style={{
                  width: `${
                    job.total_lines
                      ? Math.min(
                          100,
                          (job.error_lines / job.total_lines) * 100,
                        )
                      : 0
                  }%`,
                }}
              />
            </div>
            <div className="cg-tl-progress-meta">
              <span>
                ok {job.success_lines} · err {job.error_lines} · rest{' '}
                {Math.max(
                  0,
                  job.total_lines - job.completed_lines,
                )}
              </span>
              {job.error_message ? (
                <span className="is-err">{job.error_message}</span>
              ) : null}
            </div>
          </div>
        ) : null}

        {plan?.lines?.length ? (
          <>
            <div className="cg-tl-ruler" aria-hidden>
              <div className="cg-tl-ruler-bar">
                {plan.lines.map((line, index) => {
                  const pct = Math.min(
                    100,
                    (line.at_sec / timelineSpanSec) * 100,
                  )
                  const st = lineStatusById.get(index + 1)?.status
                  return (
                    <button
                      key={`dot-${index}`}
                      type="button"
                      className={`cg-tl-dot ${colorClass(line.speaker_id)}${
                        selectedLineIndex === index ? ' is-selected' : ''
                      }${st ? ` is-${st}` : ''}`}
                      style={{ left: `${pct}%` }}
                      title={`${formatAt(line.at_sec)} · ${
                        speakerLabel.get(line.speaker_id) || line.speaker_id
                      }${st ? ` · ${st}` : ''}`}
                      onClick={() =>
                        selectLineInPreview(index, { fromUser: true })
                      }
                    />
                  )
                })}
              </div>
              <div className="cg-tl-ruler-labels">
                <span>00:00</span>
                <span>{formatAt(timelineSpanSec)}</span>
              </div>
            </div>

            <div className="cg-tl-track">
              {plan.lines.map((line, index) => {
                const label =
                  speakerLabel.get(line.speaker_id) || line.speaker_id
                const phone = speakerPhoneById.get(line.speaker_id) || ''
                const meta = phone ? getMeta(phone) : undefined
                const prev = index > 0 ? plan.lines[index - 1] : null
                const gap =
                  prev != null ? Math.max(0, line.at_sec - prev.at_sec) : 0
                const isBurstGap = index > 0 && gap > 50
                const result = lineStatusById.get(index + 1)
                const st = result?.status
                return (
                  <div key={`tl-wrap-${index}`} className="cg-tl-item-wrap">
                    {isBurstGap ? (
                      <span className="cg-tl-gap" title={`Pause ${gap}s`}>
                        +{Math.round(gap / 60)}m
                      </span>
                    ) : null}
                    <button
                      type="button"
                      className={`cg-tl-chip ${colorClass(line.speaker_id)}${
                        selectedLineIndex === index ? ' is-selected' : ''
                      }${st ? ` is-${st}` : ''}`}
                      title={result?.detail || undefined}
                      onClick={() =>
                        selectLineInPreview(index, { fromUser: true })
                      }
                    >
                      {phone ? (
                        <SessionAvatar
                          phone={phone}
                          label={String(label)}
                          hasAvatar={meta?.has_avatar}
                          avatarUpdatedAt={meta?.avatar_updated_at}
                          size="sm"
                        />
                      ) : (
                        <span className="cg-tl-chip-av">
                          {String(label).slice(0, 1).toUpperCase()}
                        </span>
                      )}
                      <span className="cg-tl-chip-meta">
                        <span className="cg-tl-chip-time">
                          {formatAt(line.at_sec)}
                        </span>
                        <strong>{label}</strong>
                        {st ? (
                          <span className={`cg-tl-chip-st is-${st}`}>
                            {st === 'success'
                              ? '✓'
                              : st === 'error'
                                ? '!'
                                : st === 'running'
                                  ? '…'
                                  : st === 'pending'
                                    ? '⏳'
                                    : st}
                          </span>
                        ) : null}
                      </span>
                      <em>#{index + 1}</em>
                    </button>
                  </div>
                )
              })}
            </div>
          </>
        ) : (
          <div className="cg-tl-empty">Generate để xem timeline</div>
        )}
      </footer>
    </div>
  )
}
