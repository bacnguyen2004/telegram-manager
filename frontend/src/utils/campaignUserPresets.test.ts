import { describe, expect, it } from 'vitest'
import {
  USER_PRESETS_STORAGE_KEY,
  deleteUserPreset,
  loadUserPresets,
  makeUserPresetId,
  upsertUserPreset,
  type UserCampaignPreset,
} from './campaignUserPresets'
import { DEFAULT_MARKET_SOURCES } from './campaignDraft'

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

function sample(partial?: Partial<UserCampaignPreset>): UserCampaignPreset {
  const now = new Date().toISOString()
  return {
    id: 'user_test_1',
    label: 'My morning',
    name: 'Morning run',
    prompt: 'Chat market sáng nay',
    language: 'vi',
    topic: 'Market overview',
    tone: 'Casual',
    campaignType: 'Daily',
    targetLines: 24,
    durationMin: 30,
    density: 'normal',
    replyRate: 0.35,
    useMarketContext: true,
    marketSources: { ...DEFAULT_MARKET_SOURCES },
    timingPattern: 'natural_bursts',
    marketIntensity: 'medium',
    numericDetail: 'approx',
    maxNewsTopics: 2,
    messageLengthMix: { short: 70, medium: 25, long: 5 },
    speakerOrder: 'natural',
    maxConsecutiveSpeaker: 3,
    createdAt: now,
    updatedAt: now,
    ...partial,
  }
}

describe('campaignUserPresets', () => {
  it('upsert and load round-trip', () => {
    const storage = memoryStorage()
    const p = sample()
    upsertUserPreset(p, storage)
    const list = loadUserPresets(storage)
    expect(list).toHaveLength(1)
    expect(list[0].label).toBe('My morning')
    expect(list[0].messageLengthMix.short).toBe(70)
    expect(storage._map.has(USER_PRESETS_STORAGE_KEY)).toBe(true)
  })

  it('delete removes preset', () => {
    const storage = memoryStorage()
    upsertUserPreset(sample(), storage)
    upsertUserPreset(sample({ id: 'user_test_2', label: 'Other' }), storage)
    expect(loadUserPresets(storage)).toHaveLength(2)
    deleteUserPreset('user_test_1', storage)
    const list = loadUserPresets(storage)
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('user_test_2')
  })

  it('makeUserPresetId is stable format', () => {
    const id = makeUserPresetId('Crypto Morning', new Date('2026-01-02T00:00:00Z'))
    expect(id.startsWith('user_crypto-morning_')).toBe(true)
  })
})
