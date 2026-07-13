import { describe, expect, it } from 'vitest'
import {
  collectPlanWarnings,
  isPriceLikeLine,
  validateFactOveruse,
  validateMaxConsecutive,
  validateOpeningSpeaker,
  validateOpeningStrength,
} from './campaignPlanValidate'
import type { CampaignPlan, CampaignSpeaker } from '../types/api'

const speakers: CampaignSpeaker[] = [
  { id: 'a', label: 'Long', phone: '+1', role: 'lead', can_open: true },
  { id: 'b', label: 'Ian', phone: '+2', role: 'reactor', can_open: false },
]

describe('campaignPlanValidate', () => {
  it('flags opening speaker with can_open=false', () => {
    const issues = validateOpeningSpeaker(
      [
        {
          at_sec: 0,
          speaker_id: 'b',
          action: 'send',
          text: 'hi',
          reply_to_line: null,
        },
      ],
      speakers,
    )
    expect(issues.some((i) => i.code === 'opening_speaker_blocked')).toBe(true)
  })

  it('flags cliche Morning opening', () => {
    const issues = validateOpeningStrength([
      {
        at_sec: 0,
        speaker_id: 'a',
        action: 'send',
        text: 'Morning all',
        reply_to_line: null,
      },
    ])
    expect(issues.some((i) => i.code === 'cliche_opening')).toBe(true)
  })

  it('flags bare pure-ack opening without same-speaker take', () => {
    const issues = validateOpeningStrength([
      {
        at_sec: 0,
        speaker_id: 'a',
        action: 'send',
        text: 'Ok',
        reply_to_line: null,
      },
      {
        at_sec: 20,
        speaker_id: 'b',
        action: 'send',
        text: 'Sol ổn chứ?',
        reply_to_line: null,
      },
    ])
    expect(issues.some((i) => i.code === 'weak_opening')).toBe(true)
  })

  it('allows Ok + same-speaker chart take as open', () => {
    const issues = validateOpeningStrength([
      {
        at_sec: 0,
        speaker_id: 'a',
        action: 'send',
        text: 'Ok',
        reply_to_line: null,
      },
      {
        at_sec: 8,
        speaker_id: 'a',
        action: 'send',
        text: 'BTC vẫn giữ quanh 64k',
        reply_to_line: null,
      },
    ])
    expect(issues.some((i) => i.code === 'weak_opening')).toBe(false)
  })

  it('allows natural check-in open without ack', () => {
    const issues = validateOpeningStrength([
      {
        at_sec: 0,
        speaker_id: 'a',
        action: 'send',
        text: 'sáng nay chart im quá',
        reply_to_line: null,
      },
    ])
    expect(issues).toHaveLength(0)
  })

  it('collectPlanWarnings includes timing when even', () => {
    const plan: CampaignPlan = {
      title: 't',
      duration_min: 20,
      lines: Array.from({ length: 8 }, (_, i) => ({
        at_sec: i * 58,
        speaker_id: i % 2 === 0 ? 'a' : 'b',
        action: 'send' as const,
        text: i === 0 ? 'Switching gears to BTC' : `msg ${i}`,
        reply_to_line: null,
      })),
    }
    const { warnings } = collectPlanWarnings({
      plan,
      speakers,
      market: null,
      selectedNewsCount: 4,
    })
    const codes = warnings.map((w) => w.code)
    expect(codes).toContain('timing_too_even')
    expect(codes).toContain('host_transition')
  })

  it('detects price-like lines', () => {
    expect(isPriceLikeLine('BTC vẫn quanh 64k')).toBe(true)
    expect(isPriceLikeLine('chart hôm nay buồn ngủ thật')).toBe(false)
  })

  it('flags repeated BTC price phrases', () => {
    const lines = Array.from({ length: 12 }, (_, i) => ({
      at_sec: i * 30,
      speaker_id: i % 2 === 0 ? 'a' : 'b',
      action: 'send' as const,
      text:
        i < 5
          ? `BTC vẫn quanh 64k lần ${i}`
          : `reaction vibe only ${i}`,
      reply_to_line: null,
    }))
    const issues = validateFactOveruse(lines, { marketIntensity: 'medium' })
    expect(issues.some((i) => i.code === 'repeated_price_phrase')).toBe(true)
  })

  it('flags consecutive runs over max', () => {
    const lines = [
      { at_sec: 0, speaker_id: 'a', action: 'send' as const, text: '1', reply_to_line: null },
      { at_sec: 1, speaker_id: 'a', action: 'send' as const, text: '2', reply_to_line: null },
      { at_sec: 2, speaker_id: 'a', action: 'send' as const, text: '3', reply_to_line: null },
      { at_sec: 3, speaker_id: 'a', action: 'send' as const, text: '4', reply_to_line: null },
      { at_sec: 4, speaker_id: 'b', action: 'send' as const, text: '5', reply_to_line: null },
    ]
    const issues = validateMaxConsecutive(lines, 3)
    expect(issues.some((i) => i.code === 'max_consecutive_exceeded')).toBe(true)
  })

  it('allows diverse angles without price spam', () => {
    const texts = [
      'chart hôm nay buồn ngủ',
      'chưa chịu thoát vùng này',
      'chờ tin lớn thôi',
      'tưởng sáng nay break',
      'volume im quá',
      'đợi Mỹ mở cửa',
      'mình chưa dám long',
      'same ngồi nhìn chart',
      'bag hold tiếp',
      'ai online ko',
    ]
    const lines = texts.map((text, i) => ({
      at_sec: i * 40,
      speaker_id: i % 2 === 0 ? 'a' : 'b',
      action: 'send' as const,
      text,
      reply_to_line: null,
    }))
    const issues = validateFactOveruse(lines, { marketIntensity: 'medium' })
    expect(issues).toHaveLength(0)
  })
})
