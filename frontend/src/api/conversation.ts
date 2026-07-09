import type {
  ConversationJobData,
  ConversationJobListData,
  ConversationLineResult,
  ConversationParseRequestPayload,
  ConversationScript,
  ConversationValidateData,
} from '../utils/conversationScript'
import { request } from './http'

export const conversationApi = {
  parseConversation(payload: ConversationParseRequestPayload) {
    return request<ConversationValidateData>('/conversation/parse', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  createConversationJob(
    script: ConversationScript,
    options?: {
      startLineId?: number
      carriedLineResults?: ConversationLineResult[]
    },
  ) {
    return request<{ job_id: number; status: string; total_lines: number }>(
      '/conversation/jobs',
      {
        method: 'POST',
        body: JSON.stringify({
          script,
          start_line_id: options?.startLineId ?? null,
          carried_line_results: options?.carriedLineResults ?? [],
        }),
      },
    )
  },

  listConversationJobs(limit = 10, offset = 0) {
    return request<ConversationJobListData>(
      `/conversation/jobs?limit=${limit}&offset=${offset}`,
    )
  },

  getConversationJob(jobId: number) {
    return request<ConversationJobData>(`/conversation/jobs/${jobId}`)
  },

  stopConversationJob(jobId: number) {
    return request<ConversationJobData>(`/conversation/jobs/${jobId}/stop`, {
      method: 'POST',
    })
  },

  resumeConversationJob(jobId: number) {
    return request<ConversationJobData>(`/conversation/jobs/${jobId}/resume`, {
      method: 'POST',
    })
  },

  retryConversationLine(jobId: number, lineId: number) {
    return request<ConversationJobData>(
      `/conversation/jobs/${jobId}/lines/${lineId}/retry`,
      { method: 'POST' },
    )
  },
}
