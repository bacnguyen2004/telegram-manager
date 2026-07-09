export interface ApiEnvelope<T> {
  success: boolean
  data: T | null
  error: string | null
}

export interface HealthData {
  status: 'ok' | 'degraded'
  app: string
  telegram_configured: boolean
  database_enabled: boolean
  database_ok: boolean
  database_message: string
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
  status: 'success' | 'need_2fa' | 'need_signup' | 'error'
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
  about: string
  has_avatar: boolean
  message: string
}

export interface UpdateSessionProfileData {
  status: 'success' | 'unauthorized' | 'error'
  phone: string
  me_id: number | null
  first_name: string | null
  last_name: string | null
  username: string | null
  about: string
  has_avatar: boolean
  message: string
}

export interface UpdateSessionAvatarData {
  status: 'success' | 'unauthorized' | 'error'
  phone: string
  has_avatar: boolean
  message: string
}

export interface SessionAuthorizationItem {
  hash: string
  current: boolean
  device_model: string
  platform: string
  system_version: string
  api_id: number | null
  app_name: string
  date_created: string | null
  date_active: string | null
  ip: string
  country: string
  region: string
}

export interface SessionAuthorizationsData {
  status: 'success' | 'unauthorized' | 'error'
  phone: string
  total: number
  items: SessionAuthorizationItem[]
  message: string
}

export interface RevokeAuthorizationData {
  status: 'success' | 'error'
  phone: string
  hash: string
  message: string
}

export interface SessionAuditItem {
  action: string
  resource: string | null
  status: string
  created_at: string
}

export interface SessionGroupScanSummary {
  total: number
  group_count: number
  channel_count: number
  scanned_at: string
}

export interface SessionDbMetadata {
  telegram_user_id: number | null
  username: string | null
  display_name: string | null
  source: string
  status: string
  imported_at: string | null
  last_synced_at: string | null
  last_error: string | null
  has_avatar: boolean
  avatar_path: string | null
  avatar_updated_at: string | null
  last_group_scan: SessionGroupScanSummary | null
  recent_audit: SessionAuditItem[]
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
  db_metadata: SessionDbMetadata | null
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
  last_synced_at: string | null
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
  read_inbox_max_id: number
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
  limit?: number
  counts: DialogCounts
  dialogs: DialogItem[]
  message: string
}

export interface DialogReactionsPolicy {
  enabled: boolean
  mode: 'all' | 'some' | 'none'
  allowed_emojis: string[]
  has_custom: boolean
}

export interface DialogMessageReactionItem {
  emoji: string
  count: number
  chosen: boolean
}

export interface DialogMessageItem {
  id: number
  date: string
  sender_id: string | number
  sender_name: string
  outgoing: boolean
  content_type: string
  has_media: boolean
  has_photo: boolean
  text: string
  pinned?: boolean
  is_poll?: boolean
  reply_to_msg_id?: number | null
  reply_to_text?: string
  reply_to_sender_name?: string
  media_file_name?: string
  edited?: boolean
  edited_date?: string
  reactions: DialogMessageReactionItem[]
}

export interface ReactMessageData {
  status: 'success' | 'error'
  phone: string
  peer_id: string
  message_id: number | null
  reply_to_msg_id: number | null
  emoji: string | null
  message: string
}

export interface ForwardMessageData {
  status: 'success' | 'error'
  phone: string
  peer_id: string
  from_peer_id: string
  to_peer_id: string
  message_id: number | null
  reply_to_msg_id: number | null
  message: string
}

export interface ForwardMessagesData extends ForwardMessageData {
  forwarded_count: number
  message_ids: number[]
}

export interface DeleteMessagesData {
  status: 'success' | 'error'
  phone: string
  peer_id: string
  message_id: number | null
  reply_to_msg_id: number | null
  deleted_count: number
  message_ids: number[]
  message: string
}

export interface PinMessageData {
  status: 'success' | 'error'
  phone: string
  peer_id: string
  message_id: number | null
  reply_to_msg_id: number | null
  pinned: boolean
  message: string
}

export interface CancelPollVoteData {
  status: 'success' | 'error'
  phone: string
  peer_id: string
  message_id: number | null
  reply_to_msg_id: number | null
  option: string | null
  message: string
}

export interface VotePollData {
  status: 'success' | 'error'
  phone: string
  peer_id: string
  message_id: number | null
  reply_to_msg_id: number | null
  option: string | null
  message: string
}

export interface AddPollOptionData {
  status: 'success' | 'error'
  phone: string
  peer_id: string
  message_id: number | null
  reply_to_msg_id: number | null
  label: string | null
  option_hex: string | null
  todo_item_id: number | null
  voted: boolean
  message: string
}

export interface PollOptionItem {
  index: number
  label: string
  option_hex: string
  todo_item_id: number | null
  chosen?: boolean
  voters?: number | null
}

export interface PollInfoData {
  status: 'success' | 'error'
  phone: string
  peer_id: string
  message_id: number | null
  question: string
  kind: 'poll' | 'todo'
  multiple_choice: boolean
  open_answers: boolean
  shuffle_answers: boolean
  revoting_allowed: boolean
  closed: boolean
  quiz: boolean
  public_voters: boolean
  close_date: string | null
  options: PollOptionItem[]
  suggested_option_index: number | null
  user_voted?: boolean
  total_voters?: number | null
  can_view_stats?: boolean
  message: string
}

export interface DialogMessagesData {
  status: 'success' | 'error'
  phone: string
  peer_id: string
  title: string
  total: number
  messages: DialogMessageItem[]
  has_more_older: boolean
  reactions_policy: DialogReactionsPolicy
  pinned_messages?: DialogMessageItem[]
  message: string
}

export interface DialogPinnedMessagesData {
  status: 'success' | 'error'
  phone: string
  peer_id: string
  total: number
  messages: DialogMessageItem[]
  has_more_pinned?: boolean
  message: string
}

export interface MarkDialogReadData {
  status: 'success' | 'error'
  phone: string
  peer_id: string
  read_inbox_max_id: number
  unread_count: number
  message: string
}

export interface SendMessageData {
  status: 'success' | 'error'
  phone: string
  peer_id: string
  message_id: number | null
  reply_to_msg_id: number | null
  message: string
}

export interface AuditLogItem {
  id: number
  phone: string
  action: string
  resource: string | null
  status: string
  detail: string | null
  created_at: string
}

export interface AuditLogsData {
  database_enabled: boolean
  total: number
  limit: number
  offset: number
  items: AuditLogItem[]
}

export interface GroupScanItem {
  id: number
  phone: string
  total: number
  group_count: number
  channel_count: number
  scanned_at: string
}

export interface GroupScansData {
  database_enabled: boolean
  total: number
  limit: number
  items: GroupScanItem[]
}

export interface SessionMetaOverviewItem {
  phone: string
  username: string | null
  display_name: string | null
  status: string
  source: string
  has_avatar: boolean
  avatar_updated_at: string | null
  imported_at: string | null
  last_synced_at: string | null
  last_group_scan: SessionGroupScanSummary | null
}

export interface SessionMetaOverviewData {
  database_enabled: boolean
  total: number
  items: SessionMetaOverviewItem[]
}

export interface MetadataOverviewData {
  database_enabled: boolean
  session_meta_count: number
  audit_log_count: number
  group_scan_count: number
  recent_audit: AuditLogItem[]
}

export interface RosterColumnItem {
  column_key: string
  label: string
  sort_order: number
  created_at: string | null
}

export interface RosterRowItem {
  phone: string
  display_name: string | null
  username: string | null
  status: string | null
  last_synced_at: string | null
  imported_at: string | null
  custom_fields: Record<string, string>
}

export interface RosterData {
  database_enabled: boolean
  columns: RosterColumnItem[]
  rows: RosterRowItem[]
}

export interface RosterImportResult {
  updated_phones: number
  new_columns: number
}


export type ProxyType = 'socks5' | 'http' | 'mtproto'

export interface ProxyItem {
  id: number
  name: string
  proxy_type: string
  host: string
  port: number
  username: string
  password_set: boolean
  secret_set: boolean
  enabled: boolean
  last_check_status: string | null
  last_check_at: string | null
  last_check_message: string
  assigned_count: number
  created_at: string | null
  updated_at: string | null
  password?: string | null
  secret?: string | null
}

export interface ProxyListData {
  database_enabled: boolean
  total: number
  proxies: ProxyItem[]
}

export interface ProxyAssignmentItem {
  phone: string
  proxy_id: number | null
  proxy_name: string | null
  proxy_type: string | null
  proxy_host: string | null
  proxy_port: number | null
}

export interface ProxyAssignmentsData {
  database_enabled: boolean
  assignments: ProxyAssignmentItem[]
}

export interface ProxyCheckData {
  id: number
  status: string
  message: string
  last_check_at: string | null
}

export interface ProxyBulkAssignPair {
  phone: string
  proxy_id: number
  proxy_name?: string
}

export interface ProxyBulkAssignResult {
  status: string
  proxy_id: number | null
  updated: number
  phones: string[]
  message?: string
  mode?: 'same' | 'round_robin' | string
  proxy_count?: number
  pairs?: ProxyBulkAssignPair[]
}

export type AutoProfileRegion = 'global' | 'vietnam' | 'mix'
export type AutoProfileAvatarMode = 'keep' | 'delete' | 'url'

export interface AutoProfileRow {
  phone: string
  region: string
  first_name: string
  last_name: string
  username: string
  about: string
  avatar_mode: AutoProfileAvatarMode
  avatar_url: string
  avatar_label: string
}

export interface AutoProfilePreviewPayload {
  phones: string[]
  region: AutoProfileRegion
  delete_old_avatar: boolean
}

export interface AutoProfilePreviewData {
  total: number
  items: AutoProfileRow[]
}

export interface AutoProfileApplyPayload {
  phone: string
  first_name: string
  last_name: string
  username: string
  about: string
  avatar_mode: AutoProfileAvatarMode
  avatar_url: string
  region?: string
  avatar_label?: string
}

export interface AutoProfileApplyData {
  status: string
  phone: string
  message: string
  applied_username?: string | null
  profile?: Record<string, unknown> | null
  avatar?: Record<string, unknown> | null
}
