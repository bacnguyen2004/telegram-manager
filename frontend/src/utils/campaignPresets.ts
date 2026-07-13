/**
 * Campaign presets → default configuration for the MVP UI.
 * User prompt stays short; backend still receives a compiled goal + market.
 */

import type { CampaignDensity } from './campaignTiming'
import { suggestDurationFromLines } from './campaignTiming'

export type CampaignLanguage = 'vi' | 'en' | 'bilingual'

export type CampaignPresetId =
  | 'morning_market'
  | 'breaking_news'
  | 'btc_discussion'
  | 'altcoin_discussion'
  | 'weekend_casual'
  | 'ama_warmup'
  | 'quiet_revival'

export interface CampaignPresetDefaults {
  id: CampaignPresetId
  name: string
  label: string
  description: string
  prompt: string
  language: CampaignLanguage
  topic: string
  tone: string
  campaignType: string
  targetLines: number
  durationMin: number
  density: CampaignDensity
  replyRate: number
  /** Prefer news in market context */
  useNews: boolean
  /** Default market source toggles */
  marketSources: {
    btc: boolean
    eth: boolean
    sol: boolean
    alts?: boolean
    gainers: boolean
    losers: boolean
    news: boolean
  }
}

const PRESET_BASE: Omit<
  CampaignPresetDefaults,
  'durationMin' | 'id' | 'name' | 'label' | 'description'
>[] = []

// duration filled via helper below so tests exercise suggestDurationFromLines path

export const CAMPAIGN_PRESETS: CampaignPresetDefaults[] = (
  [
    {
      id: 'morning_market',
      name: 'Crypto Market Morning',
      label: 'Morning market chat',
      description: 'Thảo luận nhẹ về giá BTC/ETH buổi sáng',
      prompt: 'Thảo luận tự nhiên về thị trường crypto hôm nay',
      language: 'vi',
      topic: 'Market overview',
      tone: 'Casual',
      campaignType: 'Daily market discussion',
      targetLines: 24,
      density: 'normal',
      replyRate: 0.35,
      useNews: true,
      marketSources: {
        btc: true,
        eth: true,
        sol: true,
        alts: true,
        gainers: true,
        losers: true,
        news: true,
      },
    },
    {
      id: 'breaking_news',
      name: 'Breaking News Reaction',
      label: 'Breaking news reaction',
      description: 'Phản ứng nhanh với tin nóng',
      prompt: 'Phản ứng tự nhiên với tin crypto mới nhất, không giọng bản tin',
      language: 'vi',
      topic: 'Breaking news',
      tone: 'Reactive',
      campaignType: 'News reaction',
      targetLines: 18,
      density: 'dense',
      replyRate: 0.4,
      useNews: true,
      marketSources: {
        btc: true,
        eth: true,
        sol: false,
        gainers: false,
        losers: false,
        news: true,
      },
    },
    {
      id: 'btc_discussion',
      name: 'BTC Discussion',
      label: 'BTC discussion',
      description: 'Tập trung Bitcoin và ETF flow',
      prompt: 'Thảo luận về BTC hôm nay: giá, volume, cảm giác thị trường',
      language: 'en',
      topic: 'BTC',
      tone: 'Casual',
      campaignType: 'Asset discussion',
      targetLines: 20,
      density: 'normal',
      replyRate: 0.3,
      useNews: true,
      marketSources: {
        btc: true,
        eth: false,
        sol: false,
        gainers: false,
        losers: false,
        news: true,
      },
    },
    {
      id: 'altcoin_discussion',
      name: 'Altcoin Discussion',
      label: 'Altcoin discussion',
      description: 'Top gainer/loser và alts',
      prompt: 'Chat về altcoin và top movers hôm nay',
      language: 'vi',
      topic: 'Altcoins',
      tone: 'Casual',
      campaignType: 'Altcoin discussion',
      targetLines: 22,
      density: 'normal',
      replyRate: 0.35,
      useNews: false,
      marketSources: {
        btc: false,
        eth: true,
        sol: true,
        alts: true,
        gainers: true,
        losers: true,
        news: false,
      },
    },
    {
      id: 'weekend_casual',
      name: 'Weekend Casual Chat',
      label: 'Weekend casual chat',
      description: 'Chat cuối tuần thưa, ít data',
      prompt: 'Chat cuối tuần về crypto, nhẹ nhàng, ít số liệu',
      language: 'vi',
      topic: 'Weekend vibe',
      tone: 'Casual',
      campaignType: 'Casual chat',
      targetLines: 16,
      density: 'light',
      replyRate: 0.25,
      useNews: false,
      marketSources: {
        btc: true,
        eth: true,
        sol: false,
        gainers: false,
        losers: false,
        news: false,
      },
    },
    {
      id: 'ama_warmup',
      name: 'AMA Warm-up',
      label: 'AMA warm-up',
      description: 'Làm nóng group trước AMA',
      prompt: 'Warm-up group trước AMA: hỏi nhẹ, gợi tò mò, không spoiler',
      language: 'en',
      topic: 'AMA prep',
      tone: 'Friendly',
      campaignType: 'AMA warm-up',
      targetLines: 14,
      density: 'light',
      replyRate: 0.45,
      useNews: false,
      marketSources: {
        btc: true,
        eth: false,
        sol: false,
        gainers: false,
        losers: false,
        news: false,
      },
    },
    {
      id: 'quiet_revival',
      name: 'Quiet Group Revival',
      label: 'Quiet group revival',
      description: 'Đánh thức group im ắng',
      prompt: 'Group đang im: mở chuyện nhẹ về market rồi mời mọi người vào',
      language: 'vi',
      topic: 'Group revival',
      tone: 'Warm',
      campaignType: 'Quiet group revival',
      targetLines: 12,
      density: 'light',
      replyRate: 0.3,
      useNews: true,
      marketSources: {
        btc: true,
        eth: true,
        sol: false,
        gainers: true,
        losers: false,
        news: true,
      },
    },
  ] as const
).map((p) => ({
  ...p,
  durationMin: suggestDurationFromLines(p.targetLines, p.density),
}))

// silence unused (kept for future extension hooks)
void PRESET_BASE

export function getCampaignPreset(id: CampaignPresetId | string | null | undefined) {
  if (!id) return null
  return CAMPAIGN_PRESETS.find((p) => p.id === id) ?? null
}

export function applyCampaignPreset(
  id: CampaignPresetId | string,
): CampaignPresetDefaults | null {
  return getCampaignPreset(id)
}

/**
 * Compile UI intent into a short goal for POST /campaign/plan.
 * Core ask: write crypto-market chat and pace it across duration_min.
 * Personas → speakers payload (not here). Market → market flags (not here).
 */
export function compileUserGoal(opts: {
  prompt: string
  language: CampaignLanguage | string
  topic?: string
  tone?: string
  campaignType?: string
  replyRate?: number
  /** Minutes from UI duration input — AI must distribute chat across this window */
  durationMin?: number
  /** Target message count from UI */
  targetLines?: number
  /** @deprecated Prefer speakers payload; ignored if empty */
  personaSummary?: string
}): string {
  const prompt = opts.prompt.trim()
  const parts: string[] = []

  const mins =
    typeof opts.durationMin === 'number' && opts.durationMin > 0
      ? Math.round(opts.durationMin)
      : null
  const lines =
    typeof opts.targetLines === 'number' && opts.targetLines > 0
      ? Math.round(opts.targetLines)
      : null
  const spanSec = mins != null ? mins * 60 : null

  // Primary instruction (what the model must do)
  if (mins != null && lines != null && spanSec != null) {
    parts.push(
      `Write a natural multi-person Telegram group chat about today's crypto market ` +
        `(${lines} messages) and distribute them reasonably across ${mins} minutes ` +
        `(at_sec from 0 to ~${spanSec}). Return only the script JSON.`,
    )
  } else if (mins != null && spanSec != null) {
    parts.push(
      `Write a natural multi-person Telegram group chat about today's crypto market ` +
        `and distribute messages reasonably across ${mins} minutes ` +
        `(at_sec from 0 to ~${spanSec}). Return only the script JSON.`,
    )
  } else {
    parts.push(
      `Write a natural multi-person Telegram group chat about today's crypto market ` +
        `and pace messages with realistic timing. Return only the script JSON.`,
    )
  }

  if (prompt) parts.push(`User intent: ${prompt}`)

  const lang =
    opts.language === 'vi'
      ? 'Vietnamese'
      : opts.language === 'bilingual'
        ? 'Bilingual Vietnamese and English'
        : 'English'
  parts.push(`Language: ${lang}.`)

  if (opts.topic?.trim()) parts.push(`Topic: ${opts.topic.trim()}.`)
  if (opts.tone?.trim()) parts.push(`Tone: ${opts.tone.trim()}.`)
  if (opts.campaignType?.trim()) parts.push(`Campaign type: ${opts.campaignType.trim()}.`)
  return parts.join(' ').trim()
}
