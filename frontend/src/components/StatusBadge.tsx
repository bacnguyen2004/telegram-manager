type StatusKind = 'active' | 'unauthorized' | 'error' | 'success' | 'info' | 'warn' | 'default'

const statusMap: Record<string, StatusKind> = {
  active: 'active',
  success: 'success',
  ok: 'success',
  unauthorized: 'unauthorized',
  degraded: 'warn',
  error: 'error',
  info: 'info',
}

interface StatusBadgeProps {
  status: string
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const kind = statusMap[status.toLowerCase()] ?? 'default'

  return <span className={`badge badge--${kind}`}>{status}</span>
}