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
}

export type AuditCategory = 'all' | 'auth' | 'sessions' | 'groups'

export const AUDIT_CATEGORY_OPTIONS: { id: AuditCategory; label: string; prefix?: string }[] = [
  { id: 'all', label: 'Tất cả' },
  { id: 'auth', label: 'Đăng nhập', prefix: 'auth.' },
  { id: 'sessions', label: 'Session', prefix: 'sessions.' },
  { id: 'groups', label: 'Nhóm/kênh', prefix: 'groups.' },
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