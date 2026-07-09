import type {
  AuditLogsData,
  GroupScansData,
  MetadataOverviewData,
  SessionMetaOverviewData,
} from '../types/api'
import { request } from './http'

export const metadataApi = {
  metadataOverview() {
    return request<MetadataOverviewData>('/metadata/overview')
  },

  listAuditLogs(options?: {
    phone?: string
    actionPrefix?: string
    status?: string
    limit?: number
    offset?: number
  }) {
    const limit = options?.limit ?? 50
    const offset = options?.offset ?? 0
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    })
    if (options?.phone?.trim()) params.set('phone', options.phone.trim())
    if (options?.actionPrefix?.trim()) {
      params.set('action_prefix', options.actionPrefix.trim())
    }
    if (options?.status?.trim()) params.set('status', options.status.trim())
    return request<AuditLogsData>(`/metadata/audit?${params}`)
  },

  listGroupScans(phone?: string, limit = 20) {
    const params = new URLSearchParams({ limit: String(limit) })
    if (phone?.trim()) params.set('phone', phone.trim())
    return request<GroupScansData>(`/metadata/group-scans?${params}`)
  },

  listSessionMetaOverview() {
    return request<SessionMetaOverviewData>('/metadata/sessions')
  },
}
