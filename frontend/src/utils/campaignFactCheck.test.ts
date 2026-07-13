import { describe, expect, it } from 'vitest'
import {
  extractNumericClaims,
  softenNumericText,
  validatePlanFacts,
} from './campaignFactCheck'
import type { CampaignMarketContext, CampaignPlanLine } from '../types/api'

const market: CampaignMarketContext = {
  fetched_at: '2026-07-11T10:00:00.000Z',
  source: 'test',
  coins: [{ symbol: 'BTC', usd: 64000, usd_24h_change: -0.5 }],
  notes: [],
  gainers: [{ symbol: 'PYR', usd: 1.2, usd_24h_change: 73.4 }],
  losers: [],
  brief: '',
  ok: true,
}

describe('campaignFactCheck', () => {
  it('extracts percent claims with nearby ticker', () => {
    const claims = extractNumericClaims('PYR pumped huge today, like +57%')
    expect(claims.some((c) => c.kind === 'percent' && c.value === 57)).toBe(true)
    const pyr = claims.find((c) => c.kind === 'percent')
    expect(pyr?.symbol).toBe('PYR')
  })

  it('flags PYR percent mismatch vs snapshot', () => {
    const lines: CampaignPlanLine[] = [
      {
        at_sec: 0,
        speaker_id: 'a',
        action: 'send',
        text: 'PYR pumped huge today, like +57%.',
        reply_to_line: null,
      },
    ]
    const issues = validatePlanFacts(lines, market)
    expect(issues.length).toBeGreaterThanOrEqual(1)
    expect(issues[0].code).toBe('numeric_mismatch')
    expect(issues[0].expected).toContain('73.4')
    expect(issues[0].suggested_fix?.toLowerCase()).toMatch(/pump|hard/)
  })

  it('softens invented percents', () => {
    const s = softenNumericText('PYR pumped huge today, like +57%.')
    expect(s).not.toMatch(/57/)
  })

  it('accepts matching percent within tolerance', () => {
    const lines: CampaignPlanLine[] = [
      {
        at_sec: 0,
        speaker_id: 'a',
        action: 'send',
        text: 'PYR is +73%',
        reply_to_line: null,
      },
    ]
    const issues = validatePlanFacts(lines, market, { percentTolerance: 3 })
    expect(issues).toHaveLength(0)
  })
})
