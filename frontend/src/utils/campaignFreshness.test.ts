import { describe, expect, it } from 'vitest'
import {
  ACCEPTABLE_MAX_MS,
  FRESH_MAX_MS,
  classifyMarketFreshness,
  formatAgeLabel,
  parseFetchedAt,
} from './campaignFreshness'

describe('campaignFreshness', () => {
  const now = new Date('2026-07-11T12:00:00.000Z').getTime()

  it('parses ISO timestamps', () => {
    const d = parseFetchedAt('2026-07-11T11:55:00.000Z')
    expect(d?.toISOString()).toBe('2026-07-11T11:55:00.000Z')
    expect(parseFetchedAt('')).toBeNull()
    expect(parseFetchedAt('not-a-date')).toBeNull()
  })

  it('classifies fresh under 10 minutes', () => {
    const fetched = new Date(now - 5 * 60 * 1000).toISOString()
    const r = classifyMarketFreshness(fetched, now)
    expect(r.status).toBe('fresh')
    expect(r.warn).toBe(false)
    expect(r.age_ms).toBeLessThan(FRESH_MAX_MS)
  })

  it('classifies acceptable under 1 hour', () => {
    const fetched = new Date(now - 30 * 60 * 1000).toISOString()
    const r = classifyMarketFreshness(fetched, now)
    expect(r.status).toBe('acceptable')
    expect(r.warn).toBe(false)
    expect(r.age_ms).toBeGreaterThanOrEqual(FRESH_MAX_MS)
    expect(r.age_ms!).toBeLessThan(ACCEPTABLE_MAX_MS)
  })

  it('classifies stale at 1 hour+', () => {
    const fetched = new Date(now - 90 * 60 * 1000).toISOString()
    const r = classifyMarketFreshness(fetched, now)
    expect(r.status).toBe('stale')
    expect(r.warn).toBe(true)
    expect(r.message.toLowerCase()).toContain('stale')
  })

  it('unknown when missing timestamp', () => {
    const r = classifyMarketFreshness(null, now)
    expect(r.status).toBe('unknown')
    expect(r.warn).toBe(true)
  })

  it('formatAgeLabel is human readable', () => {
    expect(formatAgeLabel(30_000)).toMatch(/s ago|just now/)
    expect(formatAgeLabel(5 * 60_000)).toContain('minute')
    expect(formatAgeLabel(2 * 60 * 60_000)).toContain('hour')
  })
})
