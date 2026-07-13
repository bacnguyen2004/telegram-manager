/**
 * Telegram multi-bubble (short then continue).
 *
 * Real Telegram habit: same person sends a tiny bubble, then another right after
 * e.g. "ok" → "i love this market" — not one polished paragraph.
 *
 * Speech style (clean/casual/messy) lives on Acc persona, not Nhịp.
 */

/** How often same speaker splits thought across 2–3 bubbles */
export type SplitBubblesId = 'off' | 'sometimes' | 'often'

export interface SplitBubblesPreset {
  id: SplitBubblesId
  label: string
  /** example sequence for UI */
  example: string
  /** target share of lines that continue the previous same-speaker bubble */
  continue_rate: number
}

export const SPLIT_BUBBLES_PRESETS: Record<SplitBubblesId, SplitBubblesPreset> = {
  off: {
    id: 'off',
    label: 'Off',
    example: 'one full thought per turn',
    continue_rate: 0,
  },
  sometimes: {
    id: 'sometimes',
    label: 'Sometimes',
    example: 'ok  →  BTC still chill',
    continue_rate: 0.22,
  },
  often: {
    id: 'often',
    label: 'Often',
    example: 'wait  →  sol looks weak tho',
    continue_rate: 0.38,
  },
}

/** UI % → nearest legacy enum (API back-compat). */
export function splitIdFromPct(pct: number): SplitBubblesId {
  const p = Math.max(0, Math.min(100, Math.round(pct)))
  if (p < 15) return 'off'
  if (p < 48) return 'sometimes'
  return 'often'
}

export function splitPctFromId(id: SplitBubblesId): number {
  if (id === 'off') return 0
  if (id === 'sometimes') return 28
  return 65
}

export function splitPctLabel(pct: number): string {
  const p = Math.max(0, Math.min(100, Math.round(pct)))
  if (p < 15) return 'Gần không split'
  if (p < 48) return 'Thỉnh thoảng split'
  return 'Hay split (Telegram)'
}
