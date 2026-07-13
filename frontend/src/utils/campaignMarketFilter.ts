/**
 * Filter market context by user-selected sources before display / optional trimming.
 */

import type { CampaignMarketContext, CampaignMarketCoin } from '../types/api'
import type { MarketSourceToggles } from './campaignDraft'

function symbolMatches(coin: CampaignMarketCoin, symbols: string[]): boolean {
  const sym = (coin.symbol || '').toUpperCase()
  const id = (coin.id || '').toLowerCase()
  return symbols.some(
    (s) => sym === s.toUpperCase() || id === s.toLowerCase() || id.includes(s.toLowerCase()),
  )
}

export function filterMarketContext(
  market: CampaignMarketContext | null | undefined,
  sources: MarketSourceToggles,
): CampaignMarketContext | null {
  if (!market) return null

  const majorSymbols = ['BTC', 'bitcoin', 'ETH', 'ethereum', 'SOL', 'solana']
  const allowedMajors: string[] = []
  if (sources.btc) allowedMajors.push('BTC', 'bitcoin')
  if (sources.eth) allowedMajors.push('ETH', 'ethereum')
  if (sources.sol) allowedMajors.push('SOL', 'solana')

  const coins = (market.coins || []).filter((c) => {
    const isMajor = symbolMatches(c, majorSymbols)
    if (isMajor) {
      if (!allowedMajors.length) return false
      return symbolMatches(c, allowedMajors)
    }
    // Alts: everything else in the snapshot (BNB, XRP, DOGE, …)
    return Boolean(sources.alts)
  })

  return {
    ...market,
    coins,
    gainers: sources.gainers ? market.gainers || [] : [],
    losers: sources.losers ? market.losers || [] : [],
    news: sources.news ? market.news || [] : [],
  }
}

export function marketSourcesActive(sources: MarketSourceToggles): boolean {
  return Boolean(
    sources.btc ||
      sources.eth ||
      sources.sol ||
      sources.alts ||
      sources.gainers ||
      sources.losers ||
      sources.news,
  )
}
