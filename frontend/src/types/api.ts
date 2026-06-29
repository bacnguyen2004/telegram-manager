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

export interface LeaveAllGroupsData {
  status: 'success' | 'error'
  phone: string
  left_count: number
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

export interface DialogCounts {
  private: number
  bot: number
  group: number
  channel: number
}

export interface DialogItem {
  id: string
  entity_id: string
  title: string
  username: string
  kind: string
  is_private: boolean
  is_group: boolean
  is_channel: boolean
  is_bot: boolean
  link: string
  unread_count: number
  pinned: boolean
  muted: boolean
  date: string
  last_message_id: string | number
  last_message: string
}

export interface DialogsData {
  status: 'success' | 'error'
  phone: string
  total: number
  counts: DialogCounts
  dialogs: DialogItem[]
  message: string
}

export interface DialogMessageItem {
  id: number
  date: string
  sender_id: string | number
  sender_name: string
  outgoing: boolean
  content_type: string
  has_media: boolean
  text: string
}

export interface DialogMessagesData {
  status: 'success' | 'error'
  phone: string
  peer_id: string
  title: string
  total: number
  messages: DialogMessageItem[]
  message: string
}

export interface SendMessageData {
  status: 'success' | 'error'
  phone: string
  peer_id: string
  message_id: number | null
  message: string
}