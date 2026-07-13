/**
 * Classify market snapshot age for UI badges and pre-generate warnings.
 *
 * Fresh: under 10 minutes
 * Acceptable: under 1 hour
 * Stale: 1 hour or older (or unparseable / missing timestamp)
 */

export type MarketFreshnessStatus = 'fresh' | 'acceptable' | 'stale' | 'unknown'

export const FRESH_MAX_MS = 10 * 60 * 1000
export const ACCEPTABLE_MAX_MS = 60 * 60 * 1000

export interface MarketFreshness {
  status: MarketFreshnessStatus
  age_ms: number | null
  age_label: string
  fetched_at: string
  warn: boolean
  message: string
}

export function parseFetchedAt(fetchedAt: string | null | undefined): Date | null {
  if (!fetchedAt || !String(fetchedAt).trim()) return null
  const d = new Date(fetchedAt)
  if (Number.isNaN(d.getTime())) return null
  return d
}

export function formatAgeLabel(ageMs: number | null): string {
  if (ageMs == null || !Number.isFinite(ageMs) || ageMs < 0) return 'unknown'
  if (ageMs < 60_000) {
    const s = Math.max(0, Math.floor(ageMs / 1000))
    return s <= 1 ? 'just now' : `${s}s ago`
  }
  if (ageMs < 60 * 60_000) {
    const m = Math.floor(ageMs / 60_000)
    return m === 1 ? '1 minute ago' : `${m} minutes ago`
  }
  const h = Math.floor(ageMs / (60 * 60_000))
  if (h < 48) return h === 1 ? '1 hour ago' : `${h} hours ago`
  const d = Math.floor(h / 24)
  return d === 1 ? '1 day ago' : `${d} days ago`
}

export function classifyMarketFreshness(
  fetchedAt: string | null | undefined,
  now: Date | number = Date.now(),
): MarketFreshness {
  const nowMs = typeof now === 'number' ? now : now.getTime()
  const parsed = parseFetchedAt(fetchedAt)
  if (!parsed) {
    return {
      status: 'unknown',
      age_ms: null,
      age_label: 'unknown',
      fetched_at: fetchedAt || '',
      warn: true,
      message: 'No fetch timestamp — refresh market data before generate.',
    }
  }
  const ageMs = Math.max(0, nowMs - parsed.getTime())
  const ageLabel = formatAgeLabel(ageMs)

  if (ageMs < FRESH_MAX_MS) {
    return {
      status: 'fresh',
      age_ms: ageMs,
      age_label: ageLabel,
      fetched_at: parsed.toISOString(),
      warn: false,
      message: `Fresh (${ageLabel})`,
    }
  }
  if (ageMs < ACCEPTABLE_MAX_MS) {
    return {
      status: 'acceptable',
      age_ms: ageMs,
      age_label: ageLabel,
      fetched_at: parsed.toISOString(),
      warn: false,
      message: `Acceptable (${ageLabel})`,
    }
  }
  return {
    status: 'stale',
    age_ms: ageMs,
    age_label: ageLabel,
    fetched_at: parsed.toISOString(),
    warn: true,
    message: `Stale data (${ageLabel}) — refresh before generate.`,
  }
}
