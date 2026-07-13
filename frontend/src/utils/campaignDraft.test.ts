import { describe, expect, it } from 'vitest'
import {
  CAMPAIGN_DRAFT_STORAGE_KEY,
  createEmptyDraft,
  draftHasContent,
  loadCampaignDraftFromStorage,
  parseCampaignDraft,
  resolveMarketAfterFetch,
  saveCampaignDraftToStorage,
  serializeCampaignDraft,
  shouldAutoFetchMarketOnMount,
} from './campaignDraft'
import type { CampaignMarketContext } from '../types/api'

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null
    },
    setItem(key: string, value: string) {
      map.set(key, value)
    },
    _map: map,
  }
}

describe('campaignDraft', () => {
  it('round-trips serialize/parse with plan and market snapshot', () => {
    const draft = createEmptyDraft({
      campaignName: 'Morning',
      prompt: 'Talk market',
      language: 'vi',
      targetLines: 30,
      durationMin: 120,
      replyRate: 0.4,
      selectedPhones: ['+84901', '+84902'],
      plan: {
        title: 'Morning',
        duration_min: 120,
        lines: [
          {
            at_sec: 0,
            speaker_id: 'a',
            action: 'send',
            text: 'hi',
            reply_to_line: null,
          },
        ],
      },
      marketSnapshot: {
        fetched_at: '2026-07-11T10:00:00.000Z',
        source: 'binance',
        coins: [{ symbol: 'BTC', usd: 100 }],
        notes: [],
        brief: 'ok',
        ok: true,
      },
    })
    const raw = serializeCampaignDraft(draft)
    const parsed = parseCampaignDraft(raw)
    expect(parsed).not.toBeNull()
    expect(parsed!.campaignName).toBe('Morning')
    expect(parsed!.prompt).toBe('Talk market')
    expect(parsed!.plan?.lines).toHaveLength(1)
    expect(parsed!.marketSnapshot?.coins[0].symbol).toBe('BTC')
    expect(parsed!.selectedPhones).toEqual(['+84901', '+84902'])
  })

  it('save/load uses storage key and preserves draft', () => {
    const storage = memoryStorage()
    const draft = createEmptyDraft({
      campaignName: 'Saved',
      prompt: 'Prompt text long enough',
    })
    const saved = saveCampaignDraftToStorage(draft, storage)
    expect(saved.savedAt).toBeTruthy()
    expect(storage._map.has(CAMPAIGN_DRAFT_STORAGE_KEY)).toBe(true)
    const loaded = loadCampaignDraftFromStorage(storage)
    expect(loaded?.campaignName).toBe('Saved')
    expect(loaded?.prompt).toBe('Prompt text long enough')
  })

  it('parseCampaignDraft rejects invalid payload', () => {
    expect(parseCampaignDraft('not-json')).toBeNull()
    expect(parseCampaignDraft('{"version":2}')).toBeNull()
  })

  it('parseCampaignDraft accepts missing version', () => {
    const raw = JSON.stringify({
      campaignName: 'Legacy',
      prompt: 'hello world chat',
      plan: { title: 'T', duration_min: 10, lines: [] },
    })
    const parsed = parseCampaignDraft(raw)
    expect(parsed?.campaignName).toBe('Legacy')
    expect(parsed?.version).toBe(1)
  })

  it('draftHasContent detects real drafts', () => {
    expect(draftHasContent(null)).toBe(false)
    expect(draftHasContent(createEmptyDraft())).toBe(false)
    expect(
      draftHasContent(createEmptyDraft({ prompt: 'abcd', campaignName: '' })),
    ).toBe(true)
    expect(
      draftHasContent(
        createEmptyDraft({
          plan: {
            title: 'x',
            duration_min: 10,
            lines: [
              {
                at_sec: 0,
                speaker_id: 'a',
                action: 'send',
                text: 'hi',
                reply_to_line: null,
              },
            ],
          },
        }),
      ),
    ).toBe(true)
  })

  it('keeps draft market snapshot when initial API fetch races after reload', () => {
    const draftSnap: CampaignMarketContext = {
      fetched_at: '2026-07-11T09:00:00.000Z',
      source: 'draft-snapshot',
      coins: [{ symbol: 'BTC', usd: 999 }],
      notes: ['from-draft'],
      brief: 'draft',
      ok: true,
    }
    const apiFresh: CampaignMarketContext = {
      fetched_at: '2026-07-11T12:00:00.000Z',
      source: 'live-api',
      coins: [{ symbol: 'BTC', usd: 1 }],
      notes: [],
      brief: 'live',
      ok: true,
    }

    // Simulate: hydrate draft first, then async loadMarket(false) resolves
    const afterRace = resolveMarketAfterFetch({
      current: draftSnap,
      fetched: apiFresh,
      forceApply: false,
      protectDraftSnapshot: true,
    })
    expect(afterRace?.source).toBe('draft-snapshot')
    expect(afterRace?.coins[0].usd).toBe(999)
    expect(afterRace?.notes).toContain('from-draft')

    // User explicit Refresh must take API data
    const afterRefresh = resolveMarketAfterFetch({
      current: draftSnap,
      fetched: apiFresh,
      forceApply: true,
      protectDraftSnapshot: true,
    })
    expect(afterRefresh?.source).toBe('live-api')
    expect(afterRefresh?.coins[0].usd).toBe(1)
  })

  it('shouldAutoFetchMarketOnMount is false when draft has snapshot', () => {
    expect(
      shouldAutoFetchMarketOnMount({
        marketSnapshot: {
          fetched_at: 'x',
          source: 's',
          coins: [],
          notes: [],
          brief: '',
          ok: true,
        },
      }),
    ).toBe(false)
    expect(shouldAutoFetchMarketOnMount(null)).toBe(true)
    expect(shouldAutoFetchMarketOnMount({ marketSnapshot: null })).toBe(true)
  })

  it('reload path: save → load storage → snapshot wins over later fetch', () => {
    const storage = memoryStorage()
    const snap: CampaignMarketContext = {
      fetched_at: '2026-07-11T08:30:00.000Z',
      source: 'binance@save-time',
      coins: [{ symbol: 'ETH', usd: 42 }],
      notes: ['persisted'],
      brief: 'ok',
      ok: true,
    }
    saveCampaignDraftToStorage(
      createEmptyDraft({
        campaignName: 'Reload test',
        prompt: 'keep market',
        marketSnapshot: snap,
      }),
      storage,
    )
    const loaded = loadCampaignDraftFromStorage(storage)
    expect(loaded?.marketSnapshot?.source).toBe('binance@save-time')
    expect(shouldAutoFetchMarketOnMount(loaded)).toBe(false)

    const raced = resolveMarketAfterFetch({
      current: loaded!.marketSnapshot,
      fetched: {
        fetched_at: '2026-07-11T13:00:00.000Z',
        source: 'should-not-win',
        coins: [{ symbol: 'ETH', usd: 0 }],
        notes: [],
        brief: '',
        ok: true,
      },
      forceApply: false,
      protectDraftSnapshot: true,
    })
    expect(raced?.source).toBe('binance@save-time')
    expect(raced?.coins[0].usd).toBe(42)
  })
})
