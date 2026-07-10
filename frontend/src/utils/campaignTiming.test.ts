import { describe, expect, it } from 'vitest'
import {
  clampTargetLines,
  suggestDurationFromLines,
  suggestLinesFromDuration,
} from './campaignTiming'

describe('campaignTiming', () => {
  it('suggests longer duration for more lines', () => {
    const d10 = suggestDurationFromLines(10, 'normal')
    const d30 = suggestDurationFromLines(30, 'normal')
    expect(d30).toBeGreaterThan(d10)
    expect(d10).toBeGreaterThanOrEqual(5)
    expect(d30).toBeLessThanOrEqual(240)
  })

  it('dense is shorter than light for same lines', () => {
    const light = suggestDurationFromLines(20, 'light')
    const dense = suggestDurationFromLines(20, 'dense')
    expect(dense).toBeLessThanOrEqual(light)
  })

  it('clamps target lines', () => {
    expect(clampTargetLines(1)).toBe(4)
    expect(clampTargetLines(100)).toBe(100)
    expect(clampTargetLines(500)).toBe(200)
  })

  it('reverse suggest lines from duration is sane', () => {
    const lines = suggestLinesFromDuration(20, 'normal')
    expect(lines).toBeGreaterThanOrEqual(10)
    expect(lines).toBeLessThanOrEqual(40)
  })
})
