import type {
  DialogMessagesData,
  DialogPinnedMessagesData,
  DialogsData,
  MarkDialogReadData,
} from '../types/api'
import { request } from './http'

export const dialogsApi = {
  /** Mặc định 500 — backend cho phép tối đa 500; acc nhiều DM/group cần cao hơn 200. */
  listDialogs(phone: string, limit = 500) {
    return request<DialogsData>(
      `/dialogs/${encodeURIComponent(phone)}?limit=${limit}`,
    )
  },

  getPinnedMessages(phone: string, peerId: string, limit = 30, skip = 0) {
    const params = new URLSearchParams({
      peer_id: peerId,
      limit: String(limit),
    })
    if (skip > 0) params.set('skip', String(skip))
    return request<DialogPinnedMessagesData>(
      `/dialogs/${encodeURIComponent(phone)}/pinned?${params}`,
    )
  },

  getDialogMessages(
    phone: string,
    peerId: string,
    limit = 40,
    offsetId = 0,
    options?: { aroundId?: number; offsetDate?: string },
  ) {
    const params = new URLSearchParams({
      peer_id: peerId,
      limit: String(limit),
    })
    if (offsetId > 0) params.set('offset_id', String(offsetId))
    if (options?.aroundId && options.aroundId > 0) {
      params.set('around_id', String(options.aroundId))
    }
    if (options?.offsetDate?.trim()) {
      params.set('offset_date', options.offsetDate.trim())
    }
    return request<DialogMessagesData>(
      `/dialogs/${encodeURIComponent(phone)}/messages?${params}`,
    )
  },

  markDialogRead(phone: string, peerId: string, maxId = 0) {
    return request<MarkDialogReadData>(`/dialogs/${encodeURIComponent(phone)}/read`, {
      method: 'POST',
      body: JSON.stringify({ peer_id: peerId, max_id: maxId }),
    })
  },

  messagePhotoUrl(phone: string, peerId: string, messageId: number) {
    const params = new URLSearchParams({ peer_id: peerId })
    return `/api/dialogs/${encodeURIComponent(phone)}/messages/${messageId}/photo?${params}`
  },

  messageMediaUrl(phone: string, peerId: string, messageId: number) {
    const params = new URLSearchParams({ peer_id: peerId })
    return `/api/dialogs/${encodeURIComponent(phone)}/messages/${messageId}/media?${params}`
  },

  getNewDialogMessages(phone: string, peerId: string, minId: number, limit = 50) {
    const params = new URLSearchParams({
      peer_id: peerId,
      min_id: String(minId),
      limit: String(limit),
    })
    return request<DialogMessagesData>(
      `/dialogs/${encodeURIComponent(phone)}/messages/new?${params}`,
    )
  },

  searchDialogMessages(phone: string, peerId: string, query: string, limit = 50) {
    const params = new URLSearchParams({
      peer_id: peerId,
      q: query.trim(),
      limit: String(limit),
    })
    return request<DialogMessagesData>(
      `/dialogs/${encodeURIComponent(phone)}/messages/search?${params}`,
    )
  },

  dialogMessageStreamUrl(phone: string, peerId: string, minId: number) {
    const params = new URLSearchParams({
      peer_id: peerId,
      min_id: String(minId),
    })
    return `/api/dialogs/${encodeURIComponent(phone)}/messages/stream?${params}`
  },

  dialogMessageWsUrl(
    phone: string,
    peerId: string,
    minId: number,
    lastSeenId = 0,
  ) {
    const params = new URLSearchParams({
      peer_id: peerId,
      min_id: String(minId),
    })
    if (lastSeenId > 0) {
      params.set('last_seen_id', String(lastSeenId))
    }
    return `/api/dialogs/${encodeURIComponent(phone)}/messages/ws?${params}`
  },
}
