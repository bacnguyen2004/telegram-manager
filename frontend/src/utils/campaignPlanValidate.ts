/**
 * Rule-based plan warnings for MVP validation panel.
 */

import type { CampaignPlan, CampaignPlanLine, CampaignSpeaker } from '../types/api'
import { timingEvennessScore } from './campaignBurstTiming'
import { validatePlanFacts, type FactCheckIssue } from './campaignFactCheck'
import type { CampaignMarketContext } from '../types/api'

export interface PlanWarning {
  level: 'error' | 'warning' | 'info'
  code: string
  message: string
  line_index?: number
}

const TRANSITION_RE =
  /\b(switching gears|back to markets|overall|to summarize|alright,?\s+let'?s|in conclusion)\b/i

/** Pure ack / stall openers — weak if they never get a real follow-up take. */
const PURE_ACK_RE =
  /^(ok|okay|oke|okeee|yeah|yep|yup|true|lol|lmao|hmm+|hmmm+|wait|idk|haha|hi|hey|yo)\.?$/i

/** Overused greeting openers (esp. "Morning all"). */
const CLICHE_GREETING_RE =
  /^(morning(\s+all|\s+guys|\s+everyone|\s+folks)?|good\s+morning(\s+all)?|gm(\s+all|\s+guys|\s+everyone)?|hello(\s+everyone|\s+all)?|hi\s+all|chào\s+buổi\s+sáng|sáng\s+nay\s+(ae|mọi\s+người)|xin\s+chào)\b/i

function isPureAck(text: string): boolean {
  return PURE_ACK_RE.test((text || '').trim())
}

/**
 * Soft check that the first beats set a room (check-in / chart feel),
 * not bare "Ok" with no substance. Ending is intentionally not validated.
 */
export function validateOpeningStrength(lines: CampaignPlanLine[]): PlanWarning[] {
  if (!lines.length) return []
  const first = lines[0]
  const t0 = (first.text || '').trim()
  if (!t0) return []

  if (CLICHE_GREETING_RE.test(t0)) {
    return [
      {
        level: 'warning',
        code: 'cliche_opening',
        message:
          'Mở đầu kiểu chào máy (Morning/GM/Chào buổi sáng…) — Generate lại hoặc sửa line #1 thành chart/bag talk',
        line_index: 0,
      },
    ]
  }

  // Bare pure-ack as line 1
  if (isPureAck(t0)) {
    const second = lines[1]
    const sameSpeakerFollow =
      second &&
      second.speaker_id === first.speaker_id &&
      !isPureAck(second.text || '')

    if (!sameSpeakerFollow) {
      return [
        {
          level: 'warning',
          code: 'weak_opening',
          message:
            'Mở đầu yếu: line #1 chỉ là ack (ok/yeah/…) — nên check-in / chart vibe, hoặc bubble 2 cùng speaker có take thật',
          line_index: 0,
        },
      ]
    }

    // Ok → immediate price dump with zero scene words still feels host-y
    const follow = (second.text || '').trim()
    const hasScene =
      /\b(sáng|sang|morning|chart|chill|im|yên|online|thức|bag|hold|btc|eth|sol|thị trường|market|nhìn|check)\b/i.test(
        follow,
      ) || follow.split(/\s+/).length >= 4
    if (!hasScene && /[\d$%]|k\b|tăng|giảm|lên|xuống/i.test(follow)) {
      return [
        {
          level: 'warning',
          code: 'weak_opening',
          message:
            'Mở đầu hơi máy: "Ok" → dump giá ngay. Thêm check-in / cảm giác chart trước khi vào số',
          line_index: 0,
        },
      ]
    }
  }

  return []
}

export function validateOpeningSpeaker(
  lines: CampaignPlanLine[],
  speakers: CampaignSpeaker[],
): PlanWarning[] {
  if (!lines.length || !speakers.length) return []
  const first = lines[0]
  const sp = speakers.find((s) => s.id === first.speaker_id)
  if (!sp) return []
  // If any speaker has can_open true, first must be one of them
  const openers = speakers.filter((s) => s.can_open === true)
  if (openers.length && sp.can_open === false) {
    return [
      {
        level: 'error',
        code: 'opening_speaker_blocked',
        message: `First speaker «${sp.label || sp.id}» has can_open=false`,
        line_index: 0,
      },
    ]
  }
  if (openers.length && sp.can_open !== true) {
    return [
      {
        level: 'warning',
        code: 'opening_speaker_not_preferred',
        message: `First speaker «${sp.label || sp.id}» is not in opening_speakers (${openers.map((o) => o.label || o.id).join(', ')})`,
        line_index: 0,
      },
    ]
  }
  return []
}

export function validateTransitionPhrases(lines: CampaignPlanLine[]): PlanWarning[] {
  const out: PlanWarning[] = []
  lines.forEach((line, i) => {
    if (TRANSITION_RE.test(line.text || '')) {
      out.push({
        level: 'warning',
        code: 'host_transition',
        message: `Host-like transition in line #${i + 1}`,
        line_index: i,
      })
    }
  })
  return out
}

export function validateSpeakerBalance(
  lines: CampaignPlanLine[],
  speakers: CampaignSpeaker[],
): PlanWarning[] {
  if (lines.length < 6 || speakers.length < 2) return []
  const counts = new Map<string, number>()
  for (const s of speakers) counts.set(s.id, 0)
  for (const line of lines) {
    counts.set(line.speaker_id, (counts.get(line.speaker_id) || 0) + 1)
  }
  const vals = [...counts.values()]
  const max = Math.max(...vals)
  const min = Math.min(...vals)
  const lead = speakers.find((s) => s.role === 'lead')
  const warnings: PlanWarning[] = []
  if (max >= min * 2.2 && max - min >= 4) {
    warnings.push({
      level: 'warning',
      code: 'speaker_imbalance',
      message: `Speaker distribution uneven (max ${max}, min ${min})`,
    })
  }
  if (lead) {
    const leadN = counts.get(lead.id) || 0
    const avg = lines.length / speakers.length
    if (leadN < avg * 0.55) {
      warnings.push({
        level: 'warning',
        code: 'lead_underused',
        message: `Lead «${lead.label || lead.id}» only has ${leadN} messages`,
      })
    }
  }
  return warnings
}

export function validateTimingNaturalness(lines: CampaignPlanLine[]): PlanWarning[] {
  const score = timingEvennessScore(lines.map((l) => l.at_sec))
  if (score >= 0.7) {
    return [
      {
        level: 'warning',
        code: 'timing_too_even',
        message: 'Delays are too evenly distributed — use Natural bursts',
      },
    ]
  }
  return []
}

export function validateNewsDensity(
  lines: CampaignPlanLine[],
  selectedNewsCount: number,
): PlanWarning[] {
  if (selectedNewsCount <= 2 || lines.length < 8) return []
  // crude: long titles tokens
  let hits = 0
  for (const line of lines) {
    const t = (line.text || '').toLowerCase()
    if (
      /robinhood|bitclub|etf|sec |clarity|agent|chain|news|headline/.test(t)
    ) {
      hits++
    }
  }
  if (hits >= Math.max(4, Math.floor(lines.length * 0.35))) {
    return [
      {
        level: 'warning',
        code: 'news_overuse',
        message: `Many news themes packed into ${lines.length} messages — prefer 1–2 topics`,
      },
    ]
  }
  return []
}

/** Line looks like it re-states a price level / sideway print. */
const PRICE_LIKE_RE =
  /\b(btc|bitcoin|eth|ethereum|sol|solana)\b[^.\n]{0,40}(\d+\s*k|\d{2,6}|sideway|sideways|quanh|gần|near|around|hold|giữ|chưa break|flat)/i

const PRICE_COIN_RE = /\b(btc|bitcoin|eth|ethereum|sol|solana)\b/i

function priceCoinKey(text: string): 'btc' | 'eth' | 'sol' | null {
  const t = (text || '').toLowerCase()
  if (/\b(btc|bitcoin)\b/.test(t)) return 'btc'
  if (/\b(eth|ethereum)\b/.test(t)) return 'eth'
  if (/\b(sol|solana)\b/.test(t)) return 'sol'
  return null
}

export function isPriceLikeLine(text: string): boolean {
  const t = (text || '').trim()
  if (!t) return false
  if (PRICE_LIKE_RE.test(t)) return true
  // short "BTC 64k" / "eth ~1.8k"
  if (
    PRICE_COIN_RE.test(t) &&
    /(\d+\s*k|\d{1,3}([.,]\d+)?\s*k|\$\s*\d|tăng|giảm|\d+\s*%)/i.test(t)
  ) {
    return true
  }
  return false
}

/**
 * Soft checks: same coin price restated too often, or fact-heavy share of lines.
 * Topic recycling is OK; wording loops are not.
 */
export function validateFactOveruse(
  lines: CampaignPlanLine[],
  opts?: { marketIntensity?: 'low' | 'medium' | 'high' },
): PlanWarning[] {
  if (lines.length < 8) return []
  const intensity = opts?.marketIntensity || 'medium'
  const factShareCap =
    intensity === 'low' ? 0.3 : intensity === 'high' ? 0.5 : 0.38
  const perCoinCap = Math.max(3, Math.min(5, Math.ceil(lines.length * 0.1)))

  const byCoin: Record<string, number[]> = { btc: [], eth: [], sol: [] }
  let priceLike = 0

  lines.forEach((line, i) => {
    const text = line.text || ''
    if (!isPriceLikeLine(text)) return
    priceLike += 1
    const coin = priceCoinKey(text)
    if (coin) byCoin[coin].push(i)
  })

  const out: PlanWarning[] = []
  const share = priceLike / lines.length
  if (share >= factShareCap && priceLike >= 4) {
    out.push({
      level: 'warning',
      code: 'fact_overuse',
      message: `Quá nhiều dòng kiểu giá (~${Math.round(share * 100)}% · ${priceLike}/${lines.length}). Nên ~${Math.round((1 - factShareCap + 0.08) * 100)}% reaction (cảm xúc/ý kiến), không nhai lại số.`,
    })
  }

  for (const [coin, idxs] of Object.entries(byCoin)) {
    if (idxs.length >= perCoinCap) {
      out.push({
        level: 'warning',
        code: 'repeated_price_phrase',
        message: `${coin.toUpperCase()} bị nhắc giá/level ${idxs.length} lần (cap gợi ý ~${perCoinCap}). Xoay góc (chart/volume/chờ tin/bag) thay vì lặp “quanh Xk”.`,
        line_index: idxs[idxs.length - 1],
      })
    }
  }

  // Consecutive near-duplicate price lines
  let streak = 1
  for (let i = 1; i < lines.length; i++) {
    const a = isPriceLikeLine(lines[i - 1]?.text || '')
    const b = isPriceLikeLine(lines[i]?.text || '')
    const ca = priceCoinKey(lines[i - 1]?.text || '')
    const cb = priceCoinKey(lines[i]?.text || '')
    if (a && b && ca && ca === cb) {
      streak += 1
      if (streak >= 3) {
        out.push({
          level: 'warning',
          code: 'price_phrase_loop',
          message: `Chuỗi ${streak} tin liên tiếp cùng ${ca.toUpperCase()} kiểu giá — tách bằng reaction.`,
          line_index: i,
        })
        break
      }
    } else {
      streak = 1
    }
  }

  return out
}

/** Warn if any speaker exceeds max consecutive run (UI setting). */
export function validateMaxConsecutive(
  lines: CampaignPlanLine[],
  maxConsecutive: number,
): PlanWarning[] {
  if (!lines.length || maxConsecutive < 1) return []
  let run = 1
  let worst = 1
  let worstAt = 0
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].speaker_id === lines[i - 1].speaker_id) {
      run += 1
      if (run > worst) {
        worst = run
        worstAt = i
      }
    } else {
      run = 1
    }
  }
  if (worst > maxConsecutive) {
    return [
      {
        level: 'warning',
        code: 'max_consecutive_exceeded',
        message: `Có chuỗi ${worst} tin cùng 1 acc (max bạn set ${maxConsecutive}). Generate lại hoặc sửa speaker trên editor.`,
        line_index: worstAt,
      },
    ]
  }
  return []
}

export function collectPlanWarnings(opts: {
  plan: CampaignPlan | null
  speakers: CampaignSpeaker[]
  market: CampaignMarketContext | null
  selectedNewsCount?: number
  marketIntensity?: 'low' | 'medium' | 'high'
  maxConsecutiveSpeaker?: number
}): { warnings: PlanWarning[]; factIssues: FactCheckIssue[] } {
  const { plan, speakers, market } = opts
  if (!plan?.lines?.length) return { warnings: [], factIssues: [] }

  const factIssues = validatePlanFacts(plan.lines, market)
  const maxC = opts.maxConsecutiveSpeaker ?? 3
  const warnings: PlanWarning[] = [
    ...validateOpeningSpeaker(plan.lines, speakers),
    ...validateOpeningStrength(plan.lines),
    ...validateTimingNaturalness(plan.lines),
    ...validateTransitionPhrases(plan.lines),
    ...validateSpeakerBalance(plan.lines, speakers),
    ...validateNewsDensity(plan.lines, opts.selectedNewsCount || 0),
    ...validateFactOveruse(plan.lines, {
      marketIntensity: opts.marketIntensity,
    }),
    ...validateMaxConsecutive(plan.lines, maxC),
    ...factIssues.map(
      (f): PlanWarning => ({
        level: f.level,
        code: f.code,
        message: f.message,
        line_index: f.line_index,
      }),
    ),
  ]
  return { warnings, factIssues }
}

export function speakerDistribution(
  lines: CampaignPlanLine[],
  speakers: CampaignSpeaker[],
): Array<{ id: string; label: string; count: number }> {
  const counts = new Map<string, number>()
  for (const s of speakers) counts.set(s.id, 0)
  for (const line of lines) {
    counts.set(line.speaker_id, (counts.get(line.speaker_id) || 0) + 1)
  }
  return speakers.map((s) => ({
    id: s.id,
    label: s.label || s.id,
    count: counts.get(s.id) || 0,
  }))
}
