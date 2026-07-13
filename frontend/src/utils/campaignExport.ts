/**
 * Map AI plan lines + speakers → portable script JSON for export.
 */

import type { CampaignPlan, CampaignPlanLine, CampaignSpeaker } from '../types/api'

export interface CampaignExportMessage {
  id: number
  account_id: string
  send_at_offset: number
  text: string
  reply_to: number | null
}

export interface CampaignExportPayload {
  campaign_id: string
  campaign_name: string
  duration_minutes: number
  messages: CampaignExportMessage[]
  speakers: Array<{
    id: string
    label: string
    phone: string
    role: string
  }>
  exported_at: string
}

export interface BuildCampaignExportInput {
  campaignId?: string
  campaignName?: string
  plan: Pick<CampaignPlan, 'duration_min' | 'lines' | 'title'>
  speakers?: CampaignSpeaker[]
  now?: Date
}

/** Stable slug-ish id from name + timestamp when not provided. */
export function makeCampaignId(name: string, now = new Date()): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  const ts = now.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
  return `cmp_${slug || 'campaign'}_${ts}`
}

/**
 * Convert plan lines to export messages.
 * - id is 1-based line order
 * - send_at_offset is at_sec (seconds from campaign start)
 * - reply_to maps reply_to_line (1-based plan line) when action is reply
 */
export function planLinesToExportMessages(
  lines: CampaignPlanLine[],
): CampaignExportMessage[] {
  return lines.map((line, index) => {
    const id = index + 1
    let replyTo: number | null = null
    if (line.action === 'reply' && line.reply_to_line != null) {
      const target = Math.trunc(line.reply_to_line)
      if (target >= 1 && target < id) replyTo = target
    }
    return {
      id,
      account_id: String(line.speaker_id || ''),
      send_at_offset: Math.max(0, Math.trunc(line.at_sec || 0)),
      text: String(line.text || ''),
      reply_to: replyTo,
    }
  })
}

export function buildCampaignExport(
  input: BuildCampaignExportInput,
): CampaignExportPayload {
  const now = input.now ?? new Date()
  const name =
    (input.campaignName || input.plan.title || 'Campaign').trim() || 'Campaign'
  const campaignId = input.campaignId?.trim() || makeCampaignId(name, now)
  const duration = Math.max(1, Math.trunc(input.plan.duration_min || 1))

  return {
    campaign_id: campaignId,
    campaign_name: name,
    duration_minutes: duration,
    messages: planLinesToExportMessages(input.plan.lines || []),
    speakers: (input.speakers || []).map((s) => ({
      id: s.id,
      label: s.label,
      phone: s.phone,
      role: s.role,
    })),
    exported_at: now.toISOString(),
  }
}

/** Serialize export payload for download. */
export function campaignExportToJson(
  payload: CampaignExportPayload,
  pretty = true,
): string {
  return pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload)
}
