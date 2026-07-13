import { describe, expect, it } from 'vitest'
import {
  buildCampaignExport,
  campaignExportToJson,
  makeCampaignId,
  planLinesToExportMessages,
} from './campaignExport'
import type { CampaignPlanLine } from '../types/api'

describe('campaignExport', () => {
  const lines: CampaignPlanLine[] = [
    {
      at_sec: 0,
      speaker_id: 'a',
      action: 'send',
      text: 'Market looks quiet',
      reply_to_line: null,
    },
    {
      at_sec: 75,
      speaker_id: 'c',
      action: 'reply',
      text: 'BTC still holding',
      reply_to_line: 1,
    },
    {
      at_sec: 120,
      speaker_id: 'b',
      action: 'send',
      text: 'Volume thin',
      reply_to_line: 99,
    },
  ]

  it('maps plan lines to export messages with offsets and replies', () => {
    const messages = planLinesToExportMessages(lines)
    expect(messages).toHaveLength(3)
    expect(messages[0]).toEqual({
      id: 1,
      account_id: 'a',
      send_at_offset: 0,
      text: 'Market looks quiet',
      reply_to: null,
    })
    expect(messages[1].reply_to).toBe(1)
    expect(messages[1].send_at_offset).toBe(75)
    // invalid reply_to_line is dropped
    expect(messages[2].reply_to).toBeNull()
  })

  it('builds full export payload with duration and speakers', () => {
    const fixed = new Date('2026-07-11T10:00:00.000Z')
    const payload = buildCampaignExport({
      campaignName: 'Crypto Market Morning',
      campaignId: 'cmp_001',
      plan: {
        title: 'Plan title',
        duration_min: 120,
        lines,
      },
      speakers: [
        { id: 'a', label: 'Alex', phone: '+84901', role: 'lead' },
        { id: 'c', label: 'Minh', phone: '+84902', role: 'member' },
      ],
      now: fixed,
    })
    expect(payload.campaign_id).toBe('cmp_001')
    expect(payload.campaign_name).toBe('Crypto Market Morning')
    expect(payload.duration_minutes).toBe(120)
    expect(payload.messages).toHaveLength(3)
    expect(payload.speakers).toHaveLength(2)
    expect(payload.exported_at).toBe(fixed.toISOString())
    const json = campaignExportToJson(payload)
    const parsed = JSON.parse(json) as typeof payload
    expect(parsed.messages[1].text).toBe('BTC still holding')
    expect(parsed.duration_minutes).toBe(120)
  })

  it('makeCampaignId embeds slug and is stable format', () => {
    const id = makeCampaignId('Crypto Market Morning', new Date('2026-01-02T03:04:05Z'))
    expect(id.startsWith('cmp_crypto-market-morning_')).toBe(true)
  })
})
