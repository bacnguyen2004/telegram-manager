/**
 * Speaker turn order — allow doubles/triples instead of strict A-B-C-D rotation.
 */

export type SpeakerOrderPattern =
  | 'natural' // a b b c d d d a
  | 'rotate' // a b c d a b c d
  | 'messy' // very uneven
  | 'lead_heavy'

export interface SpeakerOrderPreset {
  id: SpeakerOrderPattern
  label: string
  example: string
  /** Share of lines that should sit inside same-speaker consecutive runs */
  same_speaker_pair_min: number
  max_consecutive: number
}

export const SPEAKER_ORDER_PRESETS: Record<SpeakerOrderPattern, SpeakerOrderPreset> = {
  natural: {
    id: 'natural',
    label: 'Tự nhiên',
    example: 'a · b b · c · d d d · a',
    same_speaker_pair_min: 0.28,
    max_consecutive: 3,
  },
  rotate: {
    id: 'rotate',
    label: 'Xoay vòng',
    example: 'a · b · c · d · a · b · c',
    same_speaker_pair_min: 0,
    max_consecutive: 1,
  },
  messy: {
    id: 'messy',
    label: 'Lộn xộn',
    example: 'a a · c · b b b · d · a',
    same_speaker_pair_min: 0.38,
    max_consecutive: 4,
  },
  lead_heavy: {
    id: 'lead_heavy',
    label: 'Lead nói nhiều',
    example: 'lead lead · b · lead · c c · d',
    same_speaker_pair_min: 0.3,
    max_consecutive: 3,
  },
}

/** Count consecutive same-speaker pairs / total adjacent pairs */
export function sameSpeakerPairRate(speakerIds: string[]): number {
  if (speakerIds.length < 2) return 0
  let pairs = 0
  for (let i = 1; i < speakerIds.length; i++) {
    if (speakerIds[i] === speakerIds[i - 1]) pairs++
  }
  return pairs / (speakerIds.length - 1)
}

export function maxConsecutiveRun(speakerIds: string[]): number {
  if (!speakerIds.length) return 0
  let max = 1
  let cur = 1
  for (let i = 1; i < speakerIds.length; i++) {
    if (speakerIds[i] === speakerIds[i - 1]) {
      cur++
      max = Math.max(max, cur)
    } else {
      cur = 1
    }
  }
  return max
}
