/**
 * User-saved campaign presets (localStorage) — reuse full setup later.
 */

import type { MarketSourceToggles } from './campaignDraft'
import type { CampaignLanguage } from './campaignPresets'
import type { MessageLengthMix } from './campaignMessageLength'
import type { SpeakerOrderPattern } from './campaignSpeakerOrder'
import type { TimingPattern } from './campaignBurstTiming'
import type { CampaignDensity } from './campaignTiming'

export const USER_PRESETS_STORAGE_KEY = 'tm_campaign_user_presets_v1'

export interface UserCampaignPreset {
  id: string
  /** Display chip label */
  label: string
  name: string
  prompt: string
  language: CampaignLanguage | string
  topic: string
  tone: string
  campaignType: string
  groupLink?: string
  targetLines: number
  durationMin: number
  density: CampaignDensity
  replyRate: number
  useMarketContext: boolean
  marketSources: MarketSourceToggles
  timingPattern: TimingPattern
  marketIntensity: 'low' | 'medium' | 'high'
  numericDetail: 'none' | 'approx' | 'exact'
  maxNewsTopics: number
  messageLengthMix: MessageLengthMix
  speakerOrder: SpeakerOrderPattern
  maxConsecutiveSpeaker: number
  /** Multi-bubble intensity — speech style is per-acc persona */
  splitBubbles?: 'off' | 'sometimes' | 'often'
  /** 0–100 preferred; when set overrides splitBubbles */
  splitContinuePct?: number
  createdAt: string
  updatedAt: string
}

function safeStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    if (typeof globalThis.localStorage === 'undefined') return null
    return globalThis.localStorage
  } catch {
    return null
  }
}

export function loadUserPresets(
  storage: Pick<Storage, 'getItem'> | null = safeStorage(),
): UserCampaignPreset[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(USER_PRESETS_STORAGE_KEY)
    if (!raw) return []
    const data = JSON.parse(raw) as unknown
    if (!Array.isArray(data)) return []
    return data.filter(
      (p): p is UserCampaignPreset =>
        Boolean(p && typeof p === 'object' && typeof (p as UserCampaignPreset).id === 'string'),
    )
  } catch {
    return []
  }
}

export function saveUserPresets(
  presets: UserCampaignPreset[],
  storage: Pick<Storage, 'setItem'> | null = safeStorage(),
): void {
  if (!storage) return
  storage.setItem(USER_PRESETS_STORAGE_KEY, JSON.stringify(presets))
}

export function makeUserPresetId(label: string, now = new Date()): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  return `user_${slug || 'preset'}_${now.getTime().toString(36)}`
}

export function upsertUserPreset(
  preset: UserCampaignPreset,
  storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeStorage(),
): UserCampaignPreset[] {
  const list = loadUserPresets(storage)
  const idx = list.findIndex((p) => p.id === preset.id)
  const next = [...list]
  if (idx >= 0) next[idx] = preset
  else next.unshift(preset)
  saveUserPresets(next, storage ?? undefined)
  return next
}

export function deleteUserPreset(
  id: string,
  storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeStorage(),
): UserCampaignPreset[] {
  const next = loadUserPresets(storage).filter((p) => p.id !== id)
  saveUserPresets(next, storage ?? undefined)
  return next
}

export function getUserPreset(
  id: string,
  storage: Pick<Storage, 'getItem'> | null = safeStorage(),
): UserCampaignPreset | null {
  return loadUserPresets(storage).find((p) => p.id === id) ?? null
}
