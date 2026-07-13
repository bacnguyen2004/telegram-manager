import { describe, expect, it } from 'vitest'
import {
  SPEAKER_ORDER_PRESETS,
  maxConsecutiveRun,
  sameSpeakerPairRate,
} from './campaignSpeakerOrder'

describe('campaignSpeakerOrder', () => {
  it('natural allows doubles rate high on a b b c d d d a', () => {
    const seq = ['a', 'b', 'b', 'c', 'd', 'd', 'd', 'a']
    expect(sameSpeakerPairRate(seq)).toBeCloseTo(3 / 7, 5)
    expect(maxConsecutiveRun(seq)).toBe(3)
    expect(SPEAKER_ORDER_PRESETS.natural.max_consecutive).toBe(3)
  })

  it('rotate sequence has almost no doubles', () => {
    const seq = ['a', 'b', 'c', 'd', 'a', 'b', 'c', 'd']
    expect(sameSpeakerPairRate(seq)).toBe(0)
    expect(maxConsecutiveRun(seq)).toBe(1)
  })
})
