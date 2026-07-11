import type {
  CampaignAiStatusData,
  CampaignGoalDraftData,
  CampaignGoalDraftPayload,
  CampaignInjectData,
  CampaignInjectPayload,
  CampaignJobCreateData,
  CampaignJobCreatePayload,
  CampaignMarketContext,
  CampaignPlanData,
  CampaignPlanPayload,
} from '../types/api'
import type { ConversationJobData } from '../types/api'
import { request } from './http'

export const campaignApi = {
  campaignAiStatus() {
    return request<CampaignAiStatusData>('/campaign/ai-status')
  },

  campaignMarket(refresh = false, opts?: { q?: string; tags?: string[] }) {
    const params = new URLSearchParams()
    if (refresh) params.set('refresh', 'true')
    if (opts?.q?.trim()) params.set('q', opts.q.trim())
    if (opts?.tags?.length) params.set('tags', opts.tags.join(','))
    const qs = params.toString()
    return request<CampaignMarketContext>(`/campaign/market${qs ? `?${qs}` : ''}`)
  },

  planCampaign(payload: CampaignPlanPayload) {
    return request<CampaignPlanData>('/campaign/plan', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  goalDraft(payload: CampaignGoalDraftPayload) {
    return request<CampaignGoalDraftData>('/campaign/goal-draft', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  startCampaignJob(payload: CampaignJobCreatePayload) {
    return request<CampaignJobCreateData>('/campaign/jobs', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  getCampaignJob(jobId: number) {
    return request<ConversationJobData>(`/campaign/jobs/${jobId}`)
  },

  stopCampaignJob(jobId: number) {
    return request<ConversationJobData>(`/campaign/jobs/${jobId}/stop`, {
      method: 'POST',
    })
  },

  resumeCampaignJob(jobId: number) {
    return request<ConversationJobData>(`/campaign/jobs/${jobId}/resume`, {
      method: 'POST',
    })
  },

  retryCampaignLine(jobId: number, lineId: number) {
    return request<ConversationJobData>(
      `/campaign/jobs/${jobId}/lines/${lineId}/retry`,
      { method: 'POST' },
    )
  },

  injectCampaignJob(jobId: number, payload: CampaignInjectPayload) {
    return request<CampaignInjectData>(`/campaign/jobs/${jobId}/inject`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },
}
