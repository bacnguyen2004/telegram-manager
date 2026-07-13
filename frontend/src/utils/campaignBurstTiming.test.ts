import { describe, expect, it } from 'vitest'
import {
  applyTimingOffsets,
  burstOffsets,
  evenOffsets,
  summarizeBursts,
  timingEvennessScore,
} from './campaignBurstTiming'

describe('campaignBurstTiming', () => {
  it('even offsets are nearly uniform', () => {
    const off = evenOffsets(10, 20)
    expect(off[0]).toBe(0)
    expect(off).toHaveLength(10)
    expect(timingEvennessScore(off)).toBeGreaterThanOrEqual(0.7)
  })

  it('natural bursts have irregular gaps and start at 0', () => {
    let i = 0
    const seq = [0.1, 0.9, 0.2, 0.8, 0.3, 0.7, 0.4, 0.6, 0.15, 0.85]
    const rng = () => seq[i++ % seq.length]
    const off = burstOffsets({
      lineCount: 20,
      durationMin: 22,
      pattern: 'natural_bursts',
      rng,
    })
    expect(off[0]).toBe(0)
    expect(off).toHaveLength(20)
    expect(off[off.length - 1]).toBeLessThanOrEqual(22 * 60 + 60)
    // Should not look as robotic as pure even
    const even = evenOffsets(20, 22)
    expect(timingEvennessScore(off)).toBeLessThanOrEqual(timingEvennessScore(even))
  })

  it('applyTimingOffsets rewrites at_sec', () => {
    const lines = [
      { at_sec: 0, text: 'a' },
      { at_sec: 10, text: 'b' },
      { at_sec: 20, text: 'c' },
    ]
    const next = applyTimingOffsets(lines, [0, 12, 90])
    expect(next.map((l) => l.at_sec)).toEqual([0, 12, 90])
  })

  it('summarizeBursts groups by long pauses', () => {
    const bursts = summarizeBursts([0, 10, 20, 200, 210, 220])
    expect(bursts.length).toBeGreaterThanOrEqual(2)
    expect(bursts[0].count).toBe(3)
  })
})
