import { describe, expect, it } from 'vitest'
import {
  MESSAGE_LENGTH_PRESETS,
  actualMessageLengthMix,
  adjustMessageLengthMix,
  classifyMessageLength,
  matchMessageLengthPreset,
  messageLengthMixLabel,
} from './campaignMessageLength'

describe('campaignMessageLength', () => {
  it('mostly_short is 70/25/5', () => {
    const m = MESSAGE_LENGTH_PRESETS.mostly_short.mix
    expect(m.short).toBe(70)
    expect(m.medium).toBe(25)
    expect(m.long).toBe(5)
    expect(m.short + m.medium + m.long).toBe(100)
  })

  it('classifies word bands', () => {
    expect(classifyMessageLength('BTC chill')).toBe('short')
    expect(
      classifyMessageLength('BTC still holding near this zone for now today ok'),
    ).toBe('medium') // 10 words
    expect(
      classifyMessageLength(
        'Looks like BTC is steady near sixty four k down slightly today but still holding strong this July overall market',
      ),
    ).toBe('long') // 19+ words
  })

  it('actual mix prefers short when texts are short', () => {
    const mix = actualMessageLengthMix([
      'yeah',
      'sol weak tho',
      'BTC chill',
      'not touching that',
      'ok',
      'true',
      'lol',
      'same',
      'wait what',
      'ETH flat again',
    ])
    expect(mix.short).toBeGreaterThanOrEqual(70)
    expect(messageLengthMixLabel(mix)).toContain('Ngắn')
  })

  it('user can adjust mix and keep total 100', () => {
    const base = { short: 70, medium: 25, long: 5 }
    const next = adjustMessageLengthMix(base, 'short', 40)
    expect(next.short).toBe(40)
    expect(next.short + next.medium + next.long).toBe(100)
    expect(matchMessageLengthPreset(next)).toBe('custom')
    expect(matchMessageLengthPreset(MESSAGE_LENGTH_PRESETS.mixed.mix)).toBe(
      'mixed',
    )
  })
})

