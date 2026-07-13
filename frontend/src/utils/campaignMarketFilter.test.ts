import { describe, expect, it } from 'vitest'
import { filterMarketContext, marketSourcesActive } from './campaignMarketFilter'
import type { CampaignMarketContext } from '../types/api'
import { DEFAULT_MARKET_SOURCES } from './campaignDraft'

const sample: CampaignMarketContext = {
  fetched_at: '2026-07-11T10:00:00.000Z',
  source: 'binance+coingecko',
  coins: [
    { symbol: 'BTC', usd: 1, id: 'bitcoin' },
    { symbol: 'ETH', usd: 2, id: 'ethereum' },
    { symbol: 'SOL', usd: 3, id: 'solana' },
    { symbol: 'XRP', usd: 0.5, id: 'ripple' },
    { symbol: 'DOGE', usd: 0.1, id: 'dogecoin' },
  ],
  notes: [],
  news: [{ title: 'ETF flows', source: 'rss', published_at: '' }],
  gainers: [{ symbol: 'PEPE', usd: 0.1 }],
  losers: [{ symbol: 'XYZ', usd: 0.2 }],
  brief: 'x',
  ok: true,
}

describe('campaignMarketFilter', () => {
  it('filters coins and movers by toggles', () => {
    const filtered = filterMarketContext(sample, {
      btc: true,
      eth: false,
      sol: false,
      alts: false,
      gainers: false,
      losers: true,
      news: true,
    })
    expect(filtered?.coins.map((c) => c.symbol)).toEqual(['BTC'])
    expect(filtered?.gainers).toEqual([])
    expect(filtered?.losers).toHaveLength(1)
    expect(filtered?.news).toHaveLength(1)
  })

  it('default sources keep majors and alts', () => {
    const filtered = filterMarketContext(sample, DEFAULT_MARKET_SOURCES)
    expect(filtered?.coins.map((c) => c.symbol)).toEqual([
      'BTC',
      'ETH',
      'SOL',
      'XRP',
      'DOGE',
    ])
    expect(marketSourcesActive(DEFAULT_MARKET_SOURCES)).toBe(true)
  })

  it('alts toggle includes non-majors only', () => {
    const filtered = filterMarketContext(sample, {
      btc: false,
      eth: false,
      sol: false,
      alts: true,
      gainers: false,
      losers: false,
      news: false,
    })
    expect(filtered?.coins.map((c) => c.symbol)).toEqual(['XRP', 'DOGE'])
  })

  it('returns null for null market', () => {
    expect(filterMarketContext(null, DEFAULT_MARKET_SOURCES)).toBeNull()
  })
})
