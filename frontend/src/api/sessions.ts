import type {
  CheckSessionsData,
  DeleteSessionData,
  RevokeAuthorizationData,
  SessionAuthorizationsData,
  SessionDetailData,
  SessionMeData,
  SessionsData,
  UpdateSessionAvatarData,
  UpdateSessionProfileData,
} from '../types/api'
import { request, requestForm } from './http'

export const sessionsApi = {
  listSessions() {
    return request<SessionsData>('/sessions')
  },

  getSession(phone: string) {
    return request<SessionDetailData>(`/sessions/${encodeURIComponent(phone)}`)
  },

  getSessionMe(phone: string) {
    return request<SessionMeData>(`/sessions/${encodeURIComponent(phone)}/me`)
  },

  sessionAvatarUrl(phone: string, updatedAt?: string | null) {
    const params = new URLSearchParams()
    if (updatedAt) params.set('v', updatedAt)
    const query = params.toString()
    const base = `/api/sessions/${encodeURIComponent(phone)}/avatar`
    return query ? `${base}?${query}` : base
  },

  updateSessionProfile(
    phone: string,
    body: { first_name: string; last_name: string; username: string; about: string },
  ) {
    return request<UpdateSessionProfileData>(
      `/sessions/${encodeURIComponent(phone)}/profile`,
      {
        method: 'PATCH',
        body: JSON.stringify(body),
      },
    )
  },

  uploadSessionAvatar(phone: string, file: File) {
    const formData = new FormData()
    formData.append('file', file)
    return requestForm<UpdateSessionAvatarData>(
      `/sessions/${encodeURIComponent(phone)}/avatar`,
      formData,
    )
  },

  deleteSessionAvatar(phone: string) {
    return request<UpdateSessionAvatarData>(
      `/sessions/${encodeURIComponent(phone)}/avatar`,
      { method: 'DELETE' },
    )
  },

  listSessionAuthorizations(phone: string) {
    return request<SessionAuthorizationsData>(
      `/sessions/${encodeURIComponent(phone)}/authorizations`,
    )
  },

  revokeSessionAuthorization(phone: string, authHash: string) {
    return request<RevokeAuthorizationData>(
      `/sessions/${encodeURIComponent(phone)}/authorizations/${encodeURIComponent(authHash)}`,
      { method: 'DELETE' },
    )
  },

  deleteSession(phone: string) {
    return request<DeleteSessionData>(`/sessions/${encodeURIComponent(phone)}`, {
      method: 'DELETE',
    })
  },

  checkSessions(phones?: string[], signal?: AbortSignal) {
    return request<CheckSessionsData>('/sessions/check', {
      method: 'POST',
      body: JSON.stringify(phones ? { phones } : {}),
      signal,
    })
  },
}
