import { describe, expect, it } from 'vitest'
import {
  CAMPAIGN_PRESETS,
  applyCampaignPreset,
  compileUserGoal,
  getCampaignPreset,
} from './campaignPresets'
import { suggestDurationFromLines } from './campaignTiming'

describe('campaignPresets', () => {
  it('exposes all expected presets', () => {
    const ids = CAMPAIGN_PRESETS.map((p) => p.id)
    expect(ids).toContain('morning_market')
    expect(ids).toContain('breaking_news')
    expect(ids).toContain('btc_discussion')
    expect(ids).toContain('altcoin_discussion')
    expect(ids).toContain('weekend_casual')
    expect(ids).toContain('ama_warmup')
    expect(ids).toContain('quiet_revival')
    expect(CAMPAIGN_PRESETS.length).toBe(7)
  })

  it('applyCampaignPreset returns defaults with duration from timing helper', () => {
    const preset = applyCampaignPreset('morning_market')
    expect(preset).not.toBeNull()
    expect(preset!.prompt.length).toBeGreaterThan(8)
    expect(preset!.targetLines).toBeGreaterThanOrEqual(4)
    expect(preset!.durationMin).toBe(
      suggestDurationFromLines(preset!.targetLines, preset!.density),
    )
    expect(preset!.marketSources.btc).toBe(true)
  })

  it('getCampaignPreset returns null for unknown id', () => {
    expect(getCampaignPreset('nope')).toBeNull()
  })

  it('compileUserGoal states crypto chat + duration distribution from inputs', () => {
    const goal = compileUserGoal({
      prompt: 'Thảo luận về thị trường crypto hôm nay',
      language: 'vi',
      topic: 'Market overview',
      tone: 'Casual',
      campaignType: 'Daily market discussion',
      replyRate: 0.35,
      durationMin: 20,
      targetLines: 40,
      personaSummary: 'Alex(lead); Minh(newbie)',
    })
    expect(goal).toMatch(/crypto market/i)
    expect(goal).toContain('20 minutes')
    expect(goal).toContain('40 messages')
    expect(goal).toContain('1200')
    expect(goal).toContain('Thảo luận về thị trường crypto hôm nay')
    expect(goal).toContain('Vietnamese')
    expect(goal).toContain('Market overview')
    // No craft bans / reply quotas / persona dump
    expect(goal).not.toContain('35%')
    expect(goal).not.toContain('Alex(lead)')
    expect(goal).not.toContain('Do not invent')
    expect(goal).not.toContain('FORBIDDEN')
    expect(goal.length).toBeGreaterThanOrEqual(8)
  })
})
