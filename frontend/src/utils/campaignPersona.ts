/**
 * Participant persona helpers — auto-generate diverse defaults per account slot.
 */

export type PersonaActivity = 'high' | 'medium' | 'low'
export type PersonaStyle = 'short' | 'mixed' | 'detailed'
export type PersonaSentiment = 'neutral' | 'bullish' | 'cautious' | 'curious' | 'skeptical'
export type PersonaKnowledge = 'newbie' | 'intermediate' | 'expert'

/** Frontend persona model (API still uses role on speaker). */
export interface CampaignPersona {
  name: string
  role: string
  activity: PersonaActivity
  style: PersonaStyle
  sentiment: PersonaSentiment
  knowledge: PersonaKnowledge
  favoriteAssets: string[]
  emojiHabit: string
  catchphrases: string[]
  canOpen: boolean
}

export interface PersonaParticipant extends CampaignPersona {
  phone: string
  speakerId: string
}

const ROLE_POOL = [
  'lead',
  'reactor',
  'echo',
  'member',
  'degen',
  'skeptic',
  'lurker',
] as const

const NAME_POOL_VI = [
  'Minh',
  'An',
  'Lan',
  'Huy',
  'Trang',
  'Khoa',
  'My',
  'Long',
]
const NAME_POOL_EN = [
  'Alex',
  'Sam',
  'Jordan',
  'Riley',
  'Casey',
  'Morgan',
  'Taylor',
  'Quinn',
]

const ACTIVITY_BY_ROLE: Record<string, PersonaActivity> = {
  lead: 'high',
  reactor: 'high',
  echo: 'medium',
  member: 'medium',
  degen: 'high',
  skeptic: 'medium',
  lurker: 'low',
}

const STYLE_BY_ROLE: Record<string, PersonaStyle> = {
  lead: 'mixed',
  reactor: 'short',
  echo: 'short',
  member: 'mixed',
  degen: 'short',
  skeptic: 'detailed',
  lurker: 'short',
}

const SENTIMENT_BY_ROLE: Record<string, PersonaSentiment> = {
  lead: 'neutral',
  reactor: 'curious',
  echo: 'neutral',
  member: 'curious',
  degen: 'bullish',
  skeptic: 'skeptical',
  lurker: 'cautious',
}

const KNOWLEDGE_BY_ROLE: Record<string, PersonaKnowledge> = {
  lead: 'expert',
  reactor: 'intermediate',
  echo: 'intermediate',
  member: 'newbie',
  degen: 'intermediate',
  skeptic: 'expert',
  lurker: 'newbie',
}

const ASSETS_ROTATION = [
  ['BTC', 'ETH'],
  ['SOL', 'meme coins'],
  ['ETH', 'alts'],
  ['BTC'],
  ['SOL', 'BTC'],
  ['ETH', 'SOL'],
  ['alts'],
  ['BTC', 'ETH', 'SOL'],
]

const EMOJI_BY_ROLE: Record<string, string> = {
  lead: 'rare',
  reactor: 'occasional 🔥😂',
  echo: 'occasional 👀',
  member: 'sometimes 🤔',
  degen: 'often 🚀😭',
  skeptic: 'rare',
  lurker: 'almost never',
}

function pickName(index: number, language: string, existingLabel?: string): string {
  if (existingLabel?.trim()) return existingLabel.trim().slice(0, 40)
  const pool = language === 'en' ? NAME_POOL_EN : NAME_POOL_VI
  return pool[index % pool.length]
}

export function defaultPersonaForSlot(
  index: number,
  opts?: {
    language?: string
    label?: string
    phone?: string
    forcedRole?: string
  },
): CampaignPersona {
  const role =
    opts?.forcedRole && ROLE_POOL.includes(opts.forcedRole as (typeof ROLE_POOL)[number])
      ? opts.forcedRole
      : ROLE_POOL[index % ROLE_POOL.length]
  return {
    name: pickName(index, opts?.language || 'vi', opts?.label),
    role,
    activity: ACTIVITY_BY_ROLE[role] || 'medium',
    style: STYLE_BY_ROLE[role] || 'mixed',
    sentiment: SENTIMENT_BY_ROLE[role] || 'neutral',
    knowledge: KNOWLEDGE_BY_ROLE[role] || 'intermediate',
    favoriteAssets: ASSETS_ROTATION[index % ASSETS_ROTATION.length],
    emojiHabit: EMOJI_BY_ROLE[role] || 'rare',
    catchphrases: [],
    canOpen: index === 0 || role === 'lead',
  }
}

/**
 * Build auto personas for N selected accounts.
 * First account is always lead + canOpen when auto-balancing.
 */
export function buildAutoPersonas(
  phones: string[],
  opts?: {
    language?: string
    labelsByPhone?: Record<string, string>
    balanceRoles?: boolean
  },
): PersonaParticipant[] {
  const balance = opts?.balanceRoles !== false
  return phones.map((phone, index) => {
    const forcedRole = balance
      ? index === 0
        ? 'lead'
        : ROLE_POOL[((index - 1) % (ROLE_POOL.length - 1)) + 1]
      : undefined
    const persona = defaultPersonaForSlot(index, {
      language: opts?.language,
      label: opts?.labelsByPhone?.[phone],
      phone,
      forcedRole,
    })
    return {
      ...persona,
      phone,
      speakerId: speakerIdFromIndex(index),
    }
  })
}

export function speakerIdFromIndex(index: number): string {
  // a, b, c ... then a2, b2
  if (index < 26) return String.fromCharCode(97 + index)
  return `${String.fromCharCode(97 + (index % 26))}${Math.floor(index / 26) + 1}`
}

/** Compact summary injected into user goal for the planner. */
export function summarizePersonas(personas: CampaignPersona[]): string {
  if (!personas.length) return ''
  return personas
    .map((p) => {
      const assets = p.favoriteAssets.join('/')
      return `${p.name}(${p.role}, ${p.activity} activity, ${p.style} msgs, ${p.sentiment}, likes ${assets}${p.canOpen ? ', may open' : ''})`
    })
    .join('; ')
}

/** Map persona → API speaker (rich priors for planner; phone for executor only). */
export function personaToSpeaker(p: PersonaParticipant): {
  id: string
  label: string
  phone: string
  role: string
  activity: string
  message_style: string
  sentiment: string
  knowledge_level: string
  preferred_assets: string[]
  can_open: boolean
  emoji_habit: string
} {
  return {
    id: p.speakerId,
    label: p.name.slice(0, 80),
    phone: p.phone,
    role: p.role,
    activity: p.activity,
    // Length mix lives on Nhịp (message_length_*), not per-acc style UI.
    message_style: '',
    sentiment: p.sentiment,
    knowledge_level: p.knowledge,
    // UI no longer exposes per-acc coin bias; keep field empty for API compat.
    preferred_assets: [],
    can_open: p.canOpen,
    emoji_habit: p.emojiHabit,
  }
}
