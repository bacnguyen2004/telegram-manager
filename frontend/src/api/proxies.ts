import type {
  ProxyAssignmentsData,
  ProxyBulkAssignResult,
  ProxyCheckData,
  ProxyItem,
  ProxyListData,
} from '../types/api'
import { request } from './http'

export type ProxyCreateBody = {
  name: string
  proxy_type: string
  host: string
  port: number
  username?: string | null
  password?: string | null
  secret?: string | null
  enabled?: boolean
}

export type ProxyUpdateBody = Partial<ProxyCreateBody>

export const proxiesApi = {
  listProxies() {
    return request<ProxyListData>('/proxies')
  },

  createProxy(body: ProxyCreateBody) {
    return request<ProxyItem>('/proxies', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  },

  getProxy(id: number, reveal = false) {
    return request<ProxyItem>(`/proxies/${id}?reveal=${reveal ? 'true' : 'false'}`)
  },

  updateProxy(id: number, body: ProxyUpdateBody) {
    return request<ProxyItem>(`/proxies/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
  },

  deleteProxy(id: number) {
    return request<{ id: number; cleared_phones: string[] }>(`/proxies/${id}`, {
      method: 'DELETE',
    })
  },

  checkProxy(id: number) {
    return request<ProxyCheckData>(`/proxies/${id}/check`, { method: 'POST' })
  },

  listProxyAssignments() {
    return request<ProxyAssignmentsData>('/proxies/assignments')
  },

  assignProxy(phone: string, proxyId: number | null) {
    return request<{ status: string; phone: string; proxy_id: number | null }>(
      `/proxies/assignments/${encodeURIComponent(phone)}`,
      {
        method: 'PUT',
        body: JSON.stringify({ proxy_id: proxyId }),
      },
    )
  },

  assignProxyBulk(
    phones: string[],
    proxyId: number | null,
    options?: { mode?: 'same' | 'round_robin'; proxyIds?: number[] },
  ) {
    return request<ProxyBulkAssignResult>('/proxies/assignments/bulk', {
      method: 'POST',
      body: JSON.stringify({
        phones,
        proxy_id: proxyId,
        mode: options?.mode ?? 'same',
        proxy_ids: options?.proxyIds,
      }),
    })
  },
}
