import type { ParsedTelegramLink } from '../utils/telegramLink'
import { isActionAllowed } from '../utils/telegramLink'

interface JoinLinkGuide {
  statusLabel: string
  statusTone: 'idle' | 'ready' | 'warn' | 'error'
  message: string
}

function resolveJoinLinkGuide(
  parsed: ParsedTelegramLink,
  hasInput: boolean,
): JoinLinkGuide {
  if (!hasInput) {
    return {
      statusLabel: 'Chờ',
      statusTone: 'idle',
      message: 'Dán invite hoặc @username',
    }
  }

  if (parsed.kind === 'invalid') {
    return {
      statusLabel: 'Lỗi',
      statusTone: 'error',
      message: parsed.label,
    }
  }

  if (parsed.kind === 'post') {
    return {
      statusLabel: 'Lỗi',
      statusTone: 'error',
      message: 'Link bài post — dùng invite hoặc @username',
    }
  }

  if (!isActionAllowed(parsed, 'join')) {
    return {
      statusLabel: 'Lỗi',
      statusTone: 'warn',
      message: 'Link không hỗ trợ Join',
    }
  }

  return {
    statusLabel: 'OK',
    statusTone: 'ready',
    message: parsed.label,
  }
}

export interface TasksJoinConfigProps {
  targetLink: string
  onTargetLinkChange: (value: string) => void
  parsedLink: ParsedTelegramLink
  disabled?: boolean
}

export function TasksJoinConfig({
  targetLink,
  onTargetLinkChange,
  parsedLink,
  disabled = false,
}: TasksJoinConfigProps) {
  const hasInput = Boolean(targetLink.trim())
  const guide = resolveJoinLinkGuide(parsedLink, hasInput)
  const showTargetLink = hasInput && guide.statusTone === 'ready'

  return (
    <div className="tasks-join-config">
      <div className={`tasks-join-card tasks-join-card--${guide.statusTone}`}>
        <label className="tasks-join-field">
          <span className="tasks-join-field__label">Link nhóm</span>
          <div className="tasks-join-input-wrap">
            <span className="tasks-join-input__icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="M10 13a5 5 0 0 1 0-7l1.5-1.5a5 5 0 0 1 7 7L17 13"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                />
                <path
                  d="M14 11a5 5 0 0 1 0 7L12.5 19.5a5 5 0 0 1-7-7L7 11"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <input
              type="text"
              className="tasks-join-input"
              placeholder="https://t.me/+invite hoặc @channel"
              value={targetLink}
              onChange={(event) => onTargetLinkChange(event.target.value)}
              disabled={disabled}
              spellCheck={false}
              autoComplete="off"
            />
          </div>
        </label>

        <div className={`tasks-join-status tasks-join-status--${guide.statusTone}`} role="status">
          <span
            className={`tasks-join-status__badge tasks-join-status__badge--${guide.statusTone}`}
          >
            {guide.statusLabel}
          </span>
          <div className="tasks-join-status__copy">
            <p className="tasks-join-status__title">{guide.message}</p>
            {showTargetLink ? (
              <p className="tasks-join-status__link mono">
                {parsedLink.groupLink || parsedLink.cleanLink}
              </p>
            ) : (
              <p className="tasks-join-status__hint muted">t.me/+… · t.me/username · @username</p>
            )}
          </div>
        </div>
      </div>

      <p className="tasks-join-foot muted">Đã join rồi → không tính lỗi</p>
    </div>
  )
}