/**
 * Local draft persistence for Campaign MVP (prompt, participants, settings, plan, market).
 */

import type {
  CampaignMarketContext,
  CampaignPlan,
  CampaignSpeaker,
} from '../types/api'
import type { CampaignLanguage } from './campaignPresets'
import type { CampaignDensity } from './campaignTiming'
import type { CampaignPersona } from './campaignPersona'
import type { CampaignPresetId } from './campaignPresets'

export const CAMPAIGN_DRAFT_STORAGE_KEY = 'tm_campaign_mvp_draft_v1'

export interface MarketSourceToggles {
  btc: boolean
  eth: boolean
  sol: boolean
  /** Non-major coins from snapshot (BNB, XRP, DOGE, …) for news grounding */
  alts: boolean
  gainers: boolean
  losers: boolean
  news: boolean
}

export interface CampaignDraftState {
  version: 1
  savedAt: string
  campaignName: string
  prompt: string
  language: CampaignLanguage | string
  topic: string
  tone: string
  campaignType: string
  presetId: CampaignPresetId | string | null
  groupLink: string
  targetLines: number
  durationMin: number
  density: CampaignDensity
  replyRate: number
  useMarketContext: boolean
  marketSources: MarketSourceToggles
  selectedPhones: string[]
  personaMode: 'auto' | 'manual'
  personasByPhone: Record<string, CampaignPersona>
  rolesByPhone: Record<string, string>
  selectedNewsKeys: string[]
  mustNewsKeys: string[]
  plan: CampaignPlan | null
  speakers: CampaignSpeaker[]
  marketSnapshot: CampaignMarketContext | null
  aiModel: string
}

export const DEFAULT_MARKET_SOURCES: MarketSourceToggles = {
  btc: true,
  eth: true,
  sol: true,
  alts: true,
  gainers: true,
  losers: true,
  news: true,
}

export function createEmptyDraft(
  partial?: Partial<CampaignDraftState>,
): CampaignDraftState {
  return {
    version: 1,
    savedAt: new Date(0).toISOString(),
    campaignName: '',
    prompt: '',
    language: 'vi',
    topic: 'Market overview',
    tone: 'Casual',
    campaignType: 'Daily market discussion',
    presetId: null,
    groupLink: '',
    targetLines: 22,
    durationMin: 20,
    density: 'normal',
    replyRate: 0.35,
    useMarketContext: true,
    marketSources: { ...DEFAULT_MARKET_SOURCES },
    selectedPhones: [],
    personaMode: 'auto',
    personasByPhone: {},
    rolesByPhone: {},
    selectedNewsKeys: [],
    mustNewsKeys: [],
    plan: null,
    speakers: [],
    marketSnapshot: null,
    aiModel: '',
    ...partial,
  }
}

export function serializeCampaignDraft(state: CampaignDraftState): string {
  const payload: CampaignDraftState = {
    ...state,
    version: 1,
    savedAt: state.savedAt || new Date().toISOString(),
    marketSources: { ...DEFAULT_MARKET_SOURCES, ...state.marketSources },
    selectedPhones: [...(state.selectedPhones || [])],
    selectedNewsKeys: [...(state.selectedNewsKeys || [])],
    mustNewsKeys: [...(state.mustNewsKeys || [])],
    speakers: [...(state.speakers || [])],
    personasByPhone: { ...(state.personasByPhone || {}) },
    rolesByPhone: { ...(state.rolesByPhone || {}) },
  }
  return JSON.stringify(payload)
}

export function parseCampaignDraft(raw: string | null | undefined): CampaignDraftState | null {
  if (!raw || !String(raw).trim()) return null
  try {
    const data = JSON.parse(raw) as Partial<CampaignDraftState>
    if (!data || typeof data !== 'object') return null
    // Accept version 1 or missing version (older partial saves)
    if (data.version != null && data.version !== 1) return null
    return createEmptyDraft({
      ...data,
      version: 1,
      savedAt:
        typeof data.savedAt === 'string' && data.savedAt
          ? data.savedAt
          : new Date().toISOString(),
      marketSources: {
        ...DEFAULT_MARKET_SOURCES,
        ...(data.marketSources || {}),
      },
      selectedPhones: Array.isArray(data.selectedPhones) ? data.selectedPhones : [],
      selectedNewsKeys: Array.isArray(data.selectedNewsKeys)
        ? data.selectedNewsKeys
        : [],
      mustNewsKeys: Array.isArray(data.mustNewsKeys) ? data.mustNewsKeys : [],
      speakers: Array.isArray(data.speakers) ? data.speakers : [],
      personasByPhone: data.personasByPhone || {},
      rolesByPhone: data.rolesByPhone || {},
      plan: data.plan ?? null,
      marketSnapshot: data.marketSnapshot ?? null,
      aiModel: typeof data.aiModel === 'string' ? data.aiModel : '',
    })
  } catch {
    return null
  }
}

export function saveCampaignDraftToStorage(
  state: CampaignDraftState,
  storage: Pick<Storage, 'setItem'> = globalThis.localStorage,
): CampaignDraftState {
  const next: CampaignDraftState = {
    ...state,
    version: 1,
    savedAt: new Date().toISOString(),
  }
  const raw = serializeCampaignDraft(next)
  try {
    storage.setItem(CAMPAIGN_DRAFT_STORAGE_KEY, raw)
  } catch (err) {
    // Quota / private mode — surface so UI can warn
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(
      `Không lưu được draft (localStorage): ${msg}. ` +
        'Thử Export JSON hoặc xóa site data cũ.',
    )
  }
  return next
}

export function loadCampaignDraftFromStorage(
  storage: Pick<Storage, 'getItem'> = globalThis.localStorage,
): CampaignDraftState | null {
  try {
    if (typeof storage?.getItem !== 'function') return null
    return parseCampaignDraft(storage.getItem(CAMPAIGN_DRAFT_STORAGE_KEY))
  } catch {
    return null
  }
}

/** True when draft has something worth restoring (not empty defaults only). */
export function draftHasContent(draft: CampaignDraftState | null | undefined): boolean {
  if (!draft) return false
  if (draft.plan?.lines?.length) return true
  if (draft.speakers?.length) return true
  if (draft.selectedPhones?.length) return true
  if ((draft.prompt || '').trim().length >= 4) return true
  if ((draft.groupLink || '').trim()) return true
  if ((draft.campaignName || '').trim()) return true
  return false
}

/**
 * Decide which market context to show after reload / fetch.
 *
 * On initial page load, a restored draft snapshot must win over a later
 * API response (async race). Explicit refresh always takes the API payload.
 */
export function resolveMarketAfterFetch(opts: {
  /** Market currently held in UI state (may already be draft snapshot). */
  current: CampaignMarketContext | null | undefined
  /** Fresh payload from GET /campaign/market */
  fetched: CampaignMarketContext | null | undefined
  /** true when user clicked Refresh (or generate returned market) */
  forceApply: boolean
  /** true when current market came from draft hydrate and must not be clobbered */
  protectDraftSnapshot: boolean
}): CampaignMarketContext | null {
  const fetched = opts.fetched ?? null
  const current = opts.current ?? null
  if (opts.forceApply) return fetched ?? current
  if (opts.protectDraftSnapshot && current) return current
  return fetched ?? current
}

/** Whether mount should auto-fetch market (skip when draft already has snapshot). */
export function shouldAutoFetchMarketOnMount(
  draft: Pick<CampaignDraftState, 'marketSnapshot'> | null | undefined,
): boolean {
  return !draft?.marketSnapshot
}
