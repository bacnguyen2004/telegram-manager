/**
 * Message length mix presets for campaign generation.
 */

export type MessageLengthPreset = 'mostly_short' | 'mixed' | 'detailed'

export interface MessageLengthMix {
  short: number
  medium: number
  long: number
}

export const MESSAGE_LENGTH_PRESETS: Record<
  MessageLengthPreset,
  {
    id: MessageLengthPreset
    label: string
    hint: string
    mix: MessageLengthMix
  }
> = {
  mostly_short: {
    id: 'mostly_short',
    label: 'Chủ yếu ngắn',
    hint: 'Chat Telegram thật — 1–8 từ, ít câu dài',
    mix: { short: 70, medium: 25, long: 5 },
  },
  mixed: {
    id: 'mixed',
    label: 'Hỗn hợp',
    hint: 'Cân bằng ngắn / vừa / dài',
    mix: { short: 50, medium: 40, long: 10 },
  },
  detailed: {
    id: 'detailed',
    label: 'Chi tiết hơn',
    hint: 'Nhiều câu vừa–dài, vẫn tránh essay',
    mix: { short: 30, medium: 50, long: 20 },
  },
}

export function messageLengthMixLabel(mix: MessageLengthMix): string {
  return `Ngắn ${mix.short}% · Vừa ${mix.medium}% · Dài ${mix.long}%`
}

export function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n)))
}

/** Keep short+medium+long = 100 when user edits one slider. */
export function adjustMessageLengthMix(
  current: MessageLengthMix,
  key: keyof MessageLengthMix,
  nextValue: number,
): MessageLengthMix {
  const v = clampPct(nextValue)
  const otherKeys = (['short', 'medium', 'long'] as const).filter((k) => k !== key)
  const rest = 100 - v
  const a = current[otherKeys[0]]
  const b = current[otherKeys[1]]
  const sum = a + b
  let na: number
  let nb: number
  if (rest <= 0) {
    na = 0
    nb = 0
  } else if (sum <= 0) {
    na = Math.floor(rest / 2)
    nb = rest - na
  } else {
    na = Math.round((a / sum) * rest)
    nb = rest - na
  }
  return {
    short: key === 'short' ? v : otherKeys[0] === 'short' ? na : nb,
    medium: key === 'medium' ? v : otherKeys[0] === 'medium' ? na : nb,
    long: key === 'long' ? v : otherKeys[0] === 'long' ? na : nb,
  }
}

export function matchMessageLengthPreset(
  mix: MessageLengthMix,
): MessageLengthPreset | 'custom' {
  for (const p of Object.values(MESSAGE_LENGTH_PRESETS)) {
    if (
      p.mix.short === mix.short &&
      p.mix.medium === mix.medium &&
      p.mix.long === mix.long
    ) {
      return p.id
    }
  }
  return 'custom'
}

/** Word-count bands for post-checks / hints */
export function classifyMessageLength(text: string): 'short' | 'medium' | 'long' {
  const n = (text || '').trim().split(/\s+/).filter(Boolean).length
  if (n <= 8) return 'short'
  if (n <= 16) return 'medium'
  return 'long'
}

export function actualMessageLengthMix(
  texts: string[],
): MessageLengthMix & { total: number } {
  const total = texts.length || 1
  let short = 0
  let medium = 0
  let long = 0
  for (const t of texts) {
    const c = classifyMessageLength(t)
    if (c === 'short') short++
    else if (c === 'medium') medium++
    else long++
  }
  return {
    short: Math.round((short / total) * 100),
    medium: Math.round((medium / total) * 100),
    long: Math.round((long / total) * 100),
    total: texts.length,
  }
}
