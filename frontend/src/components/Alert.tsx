interface AlertProps {
  type: 'error' | 'success' | 'info' | 'warning'
  message: string
  onDismiss?: () => void
  compact?: boolean
  onClick?: () => void
  disabled?: boolean
}

const icons: Record<AlertProps['type'], string> = {
  error: '✕',
  success: '✓',
  info: 'ℹ',
  warning: '!',
}

export function Alert({
  type,
  message,
  onDismiss,
  compact = false,
  onClick,
  disabled = false,
}: AlertProps) {
  if (!message) return null

  const className = [
    'alert',
    `alert--${type}`,
    compact ? 'alert--compact' : '',
    onClick ? 'alert--clickable' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const content = (
    <>
      <span className="alert-icon" aria-hidden>
        {icons[type]}
      </span>
      <span className="alert-text">{message}</span>
      {onDismiss ? (
        <button
          type="button"
          className="alert-dismiss"
          onClick={(event) => {
            event.stopPropagation()
            onDismiss()
          }}
          aria-label="Đóng thông báo"
        >
          ×
        </button>
      ) : null}
    </>
  )

  if (onClick) {
    return (
      <button
        type="button"
        className={className}
        onClick={onClick}
        disabled={disabled}
        role="alert"
      >
        {content}
      </button>
    )
  }

  return (
    <div className={className} role="alert">
      {content}
    </div>
  )
}