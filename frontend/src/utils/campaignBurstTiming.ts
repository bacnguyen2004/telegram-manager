/**
 * Natural burst timing for campaign messages (not even spacing).
 */

export type TimingPattern = 'even' | 'natural_bursts' | 'slow_group' | 'fast_chat'

export interface BurstTimingInput {
  lineCount: number
  durationMin: number
  pattern?: TimingPattern
  /** Deterministic seed for tests (0–1 random substitute). */
  rng?: () => number
}

function defaultRng(): number {
  return Math.random()
}

/** Even spacing (legacy / explicit). */
export function evenOffsets(lineCount: number, durationMin: number): number[] {
  const n = Math.max(1, Math.trunc(lineCount))
  const span = Math.max(1, Math.trunc(durationMin) * 60)
  if (n === 1) return [0]
  const out: number[] = []
  let last = -3
  for (let i = 0; i < n; i++) {
    let t = Math.round((i * span) / (n - 1))
    t = Math.max(t, last + 3)
    out.push(t)
    last = t
  }
  if (out[out.length - 1] > span) {
    const end = out[out.length - 1]
    return out.map((t, i) =>
      i === 0 ? 0 : Math.min(span, Math.round((t * span) / end)),
    )
  }
  return out
}

/**
 * Cluster messages into bursts of 3–6 with multi-minute pauses.
 * Pattern tweaks burst size and pause length.
 */
export function burstOffsets(input: BurstTimingInput): number[] {
  const n = Math.max(1, Math.trunc(input.lineCount))
  const span = Math.max(60, Math.trunc(input.durationMin) * 60)
  const pattern = input.pattern || 'natural_bursts'
  const rng = input.rng || defaultRng

  if (pattern === 'even') return evenOffsets(n, input.durationMin)
  if (n === 1) return [0]

  let minBurst = 3
  let maxBurst = 6
  let minPause = 60
  let maxPause = 300
  let gapInBurstMin = 5
  let gapInBurstMax = 35

  if (pattern === 'fast_chat') {
    minBurst = 4
    maxBurst = 8
    minPause = 30
    maxPause = 90
    gapInBurstMin = 3
    gapInBurstMax = 18
  } else if (pattern === 'slow_group') {
    minBurst = 2
    maxBurst = 4
    minPause = 120
    maxPause = 420
    gapInBurstMin = 12
    gapInBurstMax = 55
  }

  // Partition into burst sizes
  const sizes: number[] = []
  let left = n
  while (left > 0) {
    if (left <= maxBurst) {
      sizes.push(left)
      break
    }
    const room = Math.min(maxBurst, left - minBurst)
    const size = Math.max(
      minBurst,
      Math.min(maxBurst, minBurst + Math.floor(rng() * (room - minBurst + 1))),
    )
    // Ensure remainder can form a valid last burst
    if (left - size > 0 && left - size < minBurst) {
      sizes.push(left)
      break
    }
    sizes.push(size)
    left -= size
  }

  // Total pause budget ≈ 35–55% of span for natural_bursts
  const pauseShare =
    pattern === 'fast_chat' ? 0.25 : pattern === 'slow_group' ? 0.55 : 0.42
  const pauseCount = Math.max(0, sizes.length - 1)
  let pauseTotal = Math.floor(span * pauseShare)
  if (pauseCount === 0) pauseTotal = 0

  const pauses: number[] = []
  let pauseLeft = pauseTotal
  for (let i = 0; i < pauseCount; i++) {
    if (i === pauseCount - 1) {
      pauses.push(Math.max(minPause, pauseLeft))
      break
    }
    const remainingSlots = pauseCount - i
    const avg = pauseLeft / remainingSlots
    const lo = Math.max(minPause, Math.floor(avg * 0.5))
    const hi = Math.min(maxPause, Math.floor(avg * 1.6), pauseLeft - minPause * (remainingSlots - 1))
    const p = lo >= hi ? lo : lo + Math.floor(rng() * (hi - lo + 1))
    pauses.push(p)
    pauseLeft -= p
  }

  const offsets: number[] = []
  let t = 0
  let lineIdx = 0

  for (let b = 0; b < sizes.length; b++) {
    const size = sizes[b]
    for (let j = 0; j < size; j++) {
      if (lineIdx === 0) {
        offsets.push(0)
      } else if (j === 0) {
        // start of burst after pause — already advanced
        offsets.push(t)
      } else {
        const gap =
          gapInBurstMin +
          Math.floor(rng() * (gapInBurstMax - gapInBurstMin + 1))
        t += gap
        offsets.push(t)
      }
      lineIdx++
    }
    if (b < pauses.length) {
      t += pauses[b]
    }
  }

  // Fit into span if overshot
  const last = offsets[offsets.length - 1] || 0
  if (last > span && last > 0) {
    return offsets.map((x) => Math.min(span, Math.round((x * span) / last)))
  }
  // Stretch slightly if finished too early (keep burst shape)
  if (last < span * 0.75 && last > 0 && n > 3) {
    const scale = (span * 0.92) / last
    return offsets.map((x) => Math.round(x * scale))
  }
  return offsets
}

/** Apply offsets to plan lines (mutates copies). */
export function applyTimingOffsets<T extends { at_sec: number }>(
  lines: T[],
  offsets: number[],
): T[] {
  return lines.map((line, i) => ({
    ...line,
    at_sec: offsets[i] ?? line.at_sec,
  }))
}

/** Detect too-even spacing (robotic cadence). */
export function timingEvennessScore(atSecs: number[]): number {
  if (atSecs.length < 4) return 0
  const gaps: number[] = []
  for (let i = 1; i < atSecs.length; i++) {
    gaps.push(Math.max(0, atSecs[i] - atSecs[i - 1]))
  }
  if (!gaps.length) return 0
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length
  if (mean <= 0) return 1
  const variance =
    gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / gaps.length
  const cv = Math.sqrt(variance) / mean
  // Low coefficient of variation → even/robotic
  if (cv < 0.12) return 1
  if (cv < 0.25) return 0.7
  if (cv < 0.4) return 0.35
  return 0
}

export function summarizeBursts(
  offsets: number[],
): Array<{ start: string; end: string; count: number }> {
  if (!offsets.length) return []
  const fmt = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  }
  // Group by gaps > 50s
  const bursts: Array<{ start: number; end: number; count: number }> = []
  let start = offsets[0]
  let prev = offsets[0]
  let count = 1
  for (let i = 1; i < offsets.length; i++) {
    const gap = offsets[i] - prev
    if (gap > 50) {
      bursts.push({ start, end: prev, count })
      start = offsets[i]
      count = 1
    } else {
      count++
    }
    prev = offsets[i]
  }
  bursts.push({ start, end: prev, count })
  return bursts.map((b) => ({
    start: fmt(b.start),
    end: fmt(b.end),
    count: b.count,
  }))
}
