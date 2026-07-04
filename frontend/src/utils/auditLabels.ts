const ACTION_LABELS: Record<string, string> = {
  'auth.login': 'Đăng nhập OTP',
  'sessions.import': 'Import session',
  'sessions.sync': 'Sync session',
  'sessions.delete': 'Xóa session',
  'sessions.profile.update': 'Cập nhật hồ sơ',
  'sessions.avatar.upload': 'Đổi avatar',
  'sessions.avatar.delete': 'Xóa avatar',
  'groups.join': 'Join nhóm',
  'groups.leave': 'Rời nhóm/kênh',
  'groups.leave_all': 'Rời tất cả nhóm',
  'groups.scan': 'Quét danh sách nhóm',
  'conversation.start': 'Bắt đầu hội thoại',
  'conversation.run': 'Chạy hội thoại',
}

const STATUS_LABELS: Record<string, string> = {
  success: 'Thành công',
  active: 'Hoạt động',
  error: 'Lỗi',
  info: 'Thông tin',
}

const DETAIL_KEY_LABELS: Record<string, string> = {
  telegram_user_id: 'Telegram ID',
  username: 'Username',
  source: 'Nguồn',
  total: 'Tổng',
  group_count: 'Nhóm',
  channel_count: 'Kênh',
  left_count: 'Đã rời',
  deleted_files: 'File đã xóa',
  job_id: 'Job',
  total_lines: 'Tổng dòng',
  completed_lines: 'Đã chạy',
  success_lines: 'Thành công',
  error_lines: 'Lỗi',
  final_status: 'Kết quả',
  only_line_id: 'Dòng chạy lại',
  delay_min_sec: 'Delay min',
  delay_max_sec: 'Delay max',
  speaker_change_delay_min_sec: 'Đổi người min',
  speaker_change_delay_max_sec: 'Đổi người max',
  typing_min_sec: 'Gõ min',
  typing_max_sec: 'Gõ max',
  speakers: 'Vai diễn',
  error_message: 'Lỗi',
}

export type AuditCategory = 'all' | 'auth' | 'sessions' | 'groups' | 'conversation'

export const AUDIT_CATEGORY_OPTIONS: { id: AuditCategory; label: string; prefix?: string }[] = [
  { id: 'all', label: 'Tất cả' },
  { id: 'auth', label: 'Đăng nhập', prefix: 'auth.' },
  { id: 'sessions', label: 'Session', prefix: 'sessions.' },
  { id: 'groups', label: 'Nhóm/kênh', prefix: 'groups.' },
  { id: 'conversation', label: 'Hội thoại', prefix: 'conversation.' },
]

export type AuditStatusFilter = 'all' | 'success' | 'error'

export const AUDIT_STATUS_OPTIONS: { id: AuditStatusFilter; label: string; value?: string }[] = [
  { id: 'all', label: 'Mọi trạng thái' },
  { id: 'success', label: 'Thành công', value: 'success' },
  { id: 'error', label: 'Lỗi', value: 'error' },
]

export function auditActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action
}

export function auditStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status
}

export function auditDetailKeyLabel(key: string): string {
  return DETAIL_KEY_LABELS[key] ?? key
}

export function auditActionCategory(action: string): Exclude<AuditCategory, 'all'> {
  if (action.startsWith('auth.')) return 'auth'
  if (action.startsWith('sessions.')) return 'sessions'
  if (action.startsWith('groups.')) return 'groups'
  if (action.startsWith('conversation.')) return 'conversation'
  return 'sessions'
}

export function auditActionToneClass(action: string): string {
  const category = auditActionCategory(action)
  return `audit-action-tone--${category}`
}

export function auditStatusClass(status: string): string {
  if (status === 'success' || status === 'active') return 'audit-status--success'
  if (status === 'error') return 'audit-status--error'
  if (status === 'info') return 'audit-status--info'
  return 'audit-status--muted'
}

export interface AuditDetailField {
  key: string
  label: string
  value: string
}

export function parseAuditDetail(detail: string | null): AuditDetailField[] {
  if (!detail) return []
  try {
    const parsed = JSON.parse(detail) as Record<string, unknown>
    return Object.entries(parsed).map(([key, value]) => ({
      key,
      label: auditDetailKeyLabel(key),
      value: String(value),
    }))
  } catch {
    return [{ key: 'detail', label: 'Chi tiết', value: detail }]
  }
}