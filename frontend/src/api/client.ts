import type {
  ApiEnvelope,
  CheckSessionsData,
  GroupActionData,
  GroupsData,
  HealthData,
  LoginCodeData,
  LoginData,
  PrivacyRuleType,
  RegisterData,
  SendCodeData,
  DeleteSessionData,
  SessionDetailData,
  SessionMeData,
  SessionsData,
  Update2faData,
  UpdatePrivacyData,
} from '../types/api'

const API_BASE = '/api'

async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<ApiEnvelope<T>> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  })

  const body = (await response.json()) as ApiEnvelope<T>
  return body
}

export const api = {
  health() {
    return request<HealthData>('/health')
  },

  listSessions() {
    return request<SessionsData>('/sessions')
  },

  getSession(phone: string) {
    return request<SessionDetailData>(`/sessions/${encodeURIComponent(phone)}`)
  },

  getSessionMe(phone: string) {
    return request<SessionMeData>(`/sessions/${encodeURIComponent(phone)}/me`)
  },

  deleteSession(phone: string) {
    return request<DeleteSessionData>(`/sessions/${encodeURIComponent(phone)}`, {
      method: 'DELETE',
    })
  },

  checkSessions(phones?: string[]) {
    return request<CheckSessionsData>('/sessions/check', {
      method: 'POST',
      body: JSON.stringify(phones ? { phones } : {}),
    })
  },

  sendCode(phone: string) {
    return request<SendCodeData>('/auth/send-code', {
      method: 'POST',
      body: JSON.stringify({ phone }),
    })
  },

  login(phone: string, code: string, password?: string) {
    return request<LoginData>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ phone, code, password: password || null }),
    })
  },

  register(phone: string, code: string, firstName: string, lastName?: string) {
    return request<RegisterData>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        phone,
        code,
        first_name: firstName,
        last_name: lastName || '',
      }),
    })
  },

  getLoginCode(phone: string) {
    return request<LoginCodeData>(`/auth/login-code/${encodeURIComponent(phone)}`)
  },

  update2fa(
    phone: string,
    newPassword: string,
    currentPassword?: string,
    hint?: string,
  ) {
    return request<Update2faData>('/auth/2fa', {
      method: 'PUT',
      body: JSON.stringify({
        phone,
        new_password: newPassword,
        current_password: currentPassword || null,
        hint: hint || '',
      }),
    })
  },

  updatePrivacy(phone: string, ruleType: PrivacyRuleType) {
    return request<UpdatePrivacyData>('/auth/privacy', {
      method: 'PUT',
      body: JSON.stringify({ phone, rule_type: ruleType }),
    })
  },

  joinGroup(phone: string, groupLink: string) {
    return request<GroupActionData>('/groups/join', {
      method: 'POST',
      body: JSON.stringify({ phone, group_link: groupLink }),
    })
  },

  leaveGroup(phone: string, groupLink: string) {
    return request<GroupActionData>('/groups/leave', {
      method: 'POST',
      body: JSON.stringify({ phone, group_link: groupLink }),
    })
  },

  listGroups(phone: string, limit = 1000) {
    return request<GroupsData>(
      `/groups/${encodeURIComponent(phone)}?limit=${limit}`,
    )
  },
}