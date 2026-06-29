export interface ApiEnvelope<T> {
  success: boolean
  data: T | null
  error: string | null
}

export interface HealthData {
  status: 'ok' | 'degraded'
  app: string
  telegram_configured: boolean
  session_dir: string
  session_dir_exists: boolean
  session_dir_writable: boolean
  session_count: number
  message: string
}

export interface SessionsData {
  total: number
  sessions: string[]
}

export interface SendCodeData {
  status: 'success' | 'info' | 'error'
  message: string
  phone: string
}

export interface LoginData {
  status: 'success' | 'need_2fa' | 'error'
  message: string
  phone: string
  first_name: string
  last_name: string
  username: string
  session_file: string
}

export interface RegisterData {
  status: 'success' | 'error'
  message: string
  phone: string
  first_name: string
  last_name: string
  username: string
  session_file: string
}

export interface LoginCodeData {
  status: 'success' | 'error'
  phone: string
  code: string
  message: string
}

export interface Update2faData {
  status: 'success' | 'error'
  message: string
  phone: string
}

export interface UpdatePrivacyData {
  status: 'success' | 'error'
  message: string
  phone: string
  rule_type: string
}

export type PrivacyRuleType = 'all' | 'contacts' | 'nobody'

export interface SessionMeData {
  status: 'success' | 'unauthorized' | 'error'
  phone: string
  me_id: number | null
  first_name: string | null
  last_name: string | null
  username: string | null
  message: string
}

export interface SessionDetailData {
  status: 'success' | 'not_found'
  phone: string
  exists: boolean
  session_file: string
  size_bytes: number | null
  modified_at: string | null
  has_journal: boolean
  message: string
}

export interface DeleteSessionData {
  status: 'success' | 'error'
  phone: string
  deleted_files: string[]
  pending_auth_cleared: boolean
  message: string
}

export interface CheckSessionItem {
  phone: string
  status: string
  session_file: string
  me_id: number | null
  username: string | null
  message: string | null
}

export interface CheckSessionsData {
  total: number
  active: number
  unauthorized: number
  error: number
  sessions: CheckSessionItem[]
}

export interface GroupActionData {
  status: 'success' | 'info' | 'error'
  phone: string
  group_link: string
  message: string
}

export interface GroupItem {
  id: number
  title: string
  username: string
  link: string
  members_count: number
  is_channel: boolean
  type: string
}

export interface GroupsData {
  status: 'success' | 'error'
  phone: string
  total: number
  groups: GroupItem[]
  message: string
}