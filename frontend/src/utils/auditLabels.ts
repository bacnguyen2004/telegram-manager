const ACTION_LABELS: Record<string, string> = {
  'auth.login': 'Đăng nhập OTP',
  'sessions.import': 'Import session',
  'sessions.sync': 'Sync session',
  'sessions.delete': 'Xóa session',
  'groups.join': 'Join nhóm',
  'groups.leave': 'Rời nhóm/kênh',
  'groups.leave_all': 'Rời tất cả nhóm',
  'groups.scan': 'Quét danh sách nhóm',
}

export function auditActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action
}

export function auditStatusClass(status: string): string {
  if (status === 'success' || status === 'active') return 'audit-status--success'
  if (status === 'error') return 'audit-status--error'
  if (status === 'info') return 'audit-status--info'
  return 'audit-status--muted'
}