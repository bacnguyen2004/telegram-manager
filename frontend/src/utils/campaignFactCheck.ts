/**
 * Validate numeric claims in plan lines against market snapshot.
 */

import type { CampaignMarketContext, CampaignPlanLine } from '../types/api'

export interface MarketFact {
  key: string
  symbol: string
  price?: number
  change_24h?: number | null
  kind: 'coin' | 'gainer' | 'loser'
}

export interface NumericClaim {
  raw: string
  value: number
  kind: 'percent' | 'price_k' | 'price'
  /** Nearby ticker if found in same message */
  symbol?: string
}

export interface FactCheckIssue {
  level: 'error' | 'warning'
  code: string
  message: string
  line_index: number
  text: string
  suggested_fix?: string
  expected?: string
  found?: string
}

const PCT_RE = /([+-]?\d+(?:\.\d+)?)\s*%/g
const PRICE_K_RE = /\b(\d{2,3}(?:\.\d+)?)\s*k\b/gi
const TICKER_RE = /\b([A-Z]{2,6})\b/g

const STOP_TICKERS = new Set([
  'BTC',
  'ETH',
  'SOL',
  'USD',
  'USDT',
  'USDC',
  'API',
  'CEO',
  'CFO',
  'ETF',
  'SEC',
  'AI',
  'OK',
  'FYI',
  'IMO',
  'TBH',
  'LOL',
  'WTF',
  'NFA',
  'ATH',
  'ATL',
  'APR',
  'APY',
])

export function extractMarketFacts(
  market: CampaignMarketContext | null | undefined,
): MarketFact[] {
  if (!market) return []
  const facts: MarketFact[] = []
  for (const c of market.coins || []) {
    const sym = (c.symbol || '').toUpperCase()
    if (!sym) continue
    facts.push({
      key: `coin_${sym}`,
      symbol: sym,
      price: c.usd,
      change_24h: c.usd_24h_change ?? null,
      kind: 'coin',
    })
  }
  for (const c of market.gainers || []) {
    const sym = (c.symbol || '').toUpperCase()
    if (!sym) continue
    facts.push({
      key: `mover_${sym}`,
      symbol: sym,
      price: c.usd,
      change_24h: c.usd_24h_change ?? null,
      kind: 'gainer',
    })
  }
  for (const c of market.losers || []) {
    const sym = (c.symbol || '').toUpperCase()
    if (!sym) continue
    facts.push({
      key: `loser_${sym}`,
      symbol: sym,
      price: c.usd,
      change_24h: c.usd_24h_change ?? null,
      kind: 'loser',
    })
  }
  return facts
}

export function extractNumericClaims(text: string): NumericClaim[] {
  const claims: NumericClaim[] = []
  const t = text || ''

  // tickers in message
  const tickers = new Set<string>()
  let m: RegExpExecArray | null
  const tr = new RegExp(TICKER_RE.source, 'g')
  while ((m = tr.exec(t)) !== null) {
    const sym = m[1].toUpperCase()
    if (!STOP_TICKERS.has(sym) || ['BTC', 'ETH', 'SOL'].includes(sym)) {
      if (sym.length >= 2) tickers.add(sym)
    }
  }
  // Always allow majors even if in STOP for majors
  for (const major of ['BTC', 'ETH', 'SOL']) {
    if (new RegExp(`\\b${major}\\b`, 'i').test(t)) tickers.add(major)
  }

  const pct = new RegExp(PCT_RE.source, 'g')
  while ((m = pct.exec(t)) !== null) {
    claims.push({
      raw: m[0],
      value: Number(m[1]),
      kind: 'percent',
      symbol: pickNearestTicker(t, m.index, tickers),
    })
  }

  const pk = new RegExp(PRICE_K_RE.source, 'gi')
  while ((m = pk.exec(t)) !== null) {
    claims.push({
      raw: m[0],
      value: Number(m[1]) * 1000,
      kind: 'price_k',
      symbol: pickNearestTicker(t, m.index, tickers) || 'BTC',
    })
  }

  return claims
}

function pickNearestTicker(
  text: string,
  index: number,
  tickers: Set<string>,
): string | undefined {
  if (!tickers.size) return undefined
  let best: string | undefined
  let bestDist = Infinity
  for (const sym of tickers) {
    const re = new RegExp(`\\b${sym}\\b`, 'gi')
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const d = Math.abs(m.index - index)
      if (d < bestDist) {
        bestDist = d
        best = sym
      }
    }
  }
  // Prefer ticker mentioned before the number within 40 chars
  return bestDist <= 48 ? best : [...tickers][0]
}

function findFact(
  facts: MarketFact[],
  symbol: string | undefined,
): MarketFact | undefined {
  if (!symbol) return undefined
  const sym = symbol.toUpperCase()
  return (
    facts.find((f) => f.symbol === sym && f.kind === 'gainer') ||
    facts.find((f) => f.symbol === sym && f.kind === 'loser') ||
    facts.find((f) => f.symbol === sym)
  )
}

/**
 * Soften a percent claim to non-numeric wording.
 */
export function softenNumericText(text: string): string {
  let t = text
  t = t.replace(
    /\b(like|around|about|near|~)?\s*[+-]?\d+(?:\.\d+)?\s*%/gi,
    (match) => {
      if (/[+-]/.test(match) && parseFloat(match) < 0) return 'down hard'
      return 'pumped hard'
    },
  )
  // Clean double spaces / awkward "like pumped"
  t = t.replace(/\blike\s+pumped/gi, 'pumped')
  t = t.replace(/\s{2,}/g, ' ').trim()
  return t
}

export function validatePlanFacts(
  lines: CampaignPlanLine[],
  market: CampaignMarketContext | null | undefined,
  opts?: { percentTolerance?: number },
): FactCheckIssue[] {
  const facts = extractMarketFacts(market)
  if (!facts.length) return []
  const tol = opts?.percentTolerance ?? 3 // absolute points
  const issues: FactCheckIssue[] = []

  lines.forEach((line, index) => {
    const claims = extractNumericClaims(line.text || '')
    for (const claim of claims) {
      if (claim.kind !== 'percent') continue
      const fact = findFact(facts, claim.symbol)
      if (!fact || fact.change_24h == null || !Number.isFinite(fact.change_24h)) {
        continue
      }
      const expected = fact.change_24h
      const diff = Math.abs(claim.value - expected)
      // Also try abs if signs differ but magnitude close to abs(expected)
      const diffAbs = Math.abs(Math.abs(claim.value) - Math.abs(expected))
      if (diff > tol && diffAbs > tol) {
        const suggested = softenNumericText(line.text)
        issues.push({
          level: 'error',
          code: 'numeric_mismatch',
          message: `${claim.symbol || 'Asset'} ${claim.raw} does not match snapshot ${expected >= 0 ? '+' : ''}${expected.toFixed(1)}%`,
          line_index: index,
          text: line.text,
          expected: `${expected >= 0 ? '+' : ''}${expected.toFixed(1)}%`,
          found: claim.raw,
          suggested_fix: suggested !== line.text ? suggested : undefined,
        })
      }
    }
  })

  return issues
}
