interface AlertProps {
  type: 'error' | 'success' | 'info'
  message: string
}

const icons: Record<AlertProps['type'], string> = {
  error: '✕',
  success: '✓',
  info: 'ℹ',
}

export function Alert({ type, message }: AlertProps) {
  if (!message) return null

  return (
    <div className={`alert alert--${type}`} role="alert">
      <span className="alert-icon" aria-hidden>
        {icons[type]}
      </span>
      <span className="alert-text">{message}</span>
    </div>
  )
}