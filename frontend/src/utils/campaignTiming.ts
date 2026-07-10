/**
 * Suggest campaign duration from target message count (lượt).
 * Density: light ~70s/line, normal ~55s/line, dense ~40s/line.
 */

export type CampaignDensity = 'light' | 'normal' | 'dense'

/** Keep in sync with backend schemas.campaign.MAX_CAMPAIGN_* */
export const MAX_TARGET_LINES = 200
export const MAX_DURATION_MIN = 240
export const MIN_TARGET_LINES = 4
export const MIN_DURATION_MIN = 5

/** Average seconds between messages for each density. */
const SEC_PER_LINE: Record<CampaignDensity, number> = {
  light: 70,
  normal: 55,
  dense: 40,
}

export function clampTargetLines(n: number): number {
  if (!Number.isFinite(n)) return 20
  return Math.max(MIN_TARGET_LINES, Math.min(MAX_TARGET_LINES, Math.round(n)))
}

export function clampDurationMin(n: number): number {
  if (!Number.isFinite(n)) return 20
  return Math.max(MIN_DURATION_MIN, Math.min(MAX_DURATION_MIN, Math.round(n)))
}

/** Primary suggestion: duration (minutes) from number of turns. */
export function suggestDurationFromLines(
  targetLines: number,
  density: CampaignDensity = 'normal',
): number {
  const lines = clampTargetLines(targetLines)
  const sec = SEC_PER_LINE[density] ?? SEC_PER_LINE.normal
  // First message at t=0, so (lines-1) gaps; floor at lines * 0.7 min for very short plans
  const totalSec = Math.max(lines * 45, (lines - 1) * sec)
  return clampDurationMin(Math.ceil(totalSec / 60))
}

/** Reverse: suggested line count from duration. */
export function suggestLinesFromDuration(
  durationMin: number,
  density: CampaignDensity = 'normal',
): number {
  const mins = clampDurationMin(durationMin)
  const sec = SEC_PER_LINE[density] ?? SEC_PER_LINE.normal
  const lines = Math.round((mins * 60) / sec) + 1
  return clampTargetLines(lines)
}

export function densityLabel(d: CampaignDensity): string {
  if (d === 'light') return 'Thưa (~70s/tin)'
  if (d === 'dense') return 'Dày (~40s/tin)'
  return 'Vừa (~55s/tin)'
}

export function formatDurationHint(minutes: number): string {
  if (minutes < 60) return `~${minutes} phút`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `~${h}h${m}p` : `~${h} giờ`
}
