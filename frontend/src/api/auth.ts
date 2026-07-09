import type {
  LoginCodeData,
  LoginData,
  PrivacyRuleType,
  RegisterData,
  SendCodeData,
  Update2faData,
  UpdatePrivacyData,
} from '../types/api'
import { request } from './http'

export const authApi = {
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
}
