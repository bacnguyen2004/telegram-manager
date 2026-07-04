import './TaskDelayField.css'

export interface TaskDelayFieldProps {
  useRandomDelay: boolean
  onUseRandomDelayChange: (value: boolean) => void
  delaySeconds: number
  onDelaySecondsChange: (value: number) => void
  delayMinSeconds: number
  onDelayMinSecondsChange: (value: number) => void
  delayMaxSeconds: number
  onDelayMaxSecondsChange: (value: number) => void
  showPipelineDelay?: boolean
  pipelineStepDelaySeconds?: number
  onPipelineStepDelaySecondsChange?: (value: number) => void
  disabled?: boolean
}

export function TaskDelayField({
  useRandomDelay,
  onUseRandomDelayChange,
  delaySeconds,
  onDelaySecondsChange,
  delayMinSeconds,
  onDelayMinSecondsChange,
  delayMaxSeconds,
  onDelayMaxSecondsChange,
  showPipelineDelay = false,
  pipelineStepDelaySeconds = 3,
  onPipelineStepDelaySecondsChange,
  disabled = false,
}: TaskDelayFieldProps) {
  return (
    <div className="task-delay-panel">
      <span className="task-delay-panel__label">Delay</span>
      <div className="task-delay-mode" role="radiogroup" aria-label="Kiểu delay">
        <button
          type="button"
          role="radio"
          aria-checked={!useRandomDelay}
          className={`task-delay-mode-btn${!useRandomDelay ? ' task-delay-mode-btn--active' : ''}`}
          disabled={disabled}
          onClick={() => onUseRandomDelayChange(false)}
        >
          Cố định
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={useRandomDelay}
          className={`task-delay-mode-btn${useRandomDelay ? ' task-delay-mode-btn--active' : ''}`}
          disabled={disabled}
          onClick={() => onUseRandomDelayChange(true)}
        >
          Random
        </button>
      </div>

      {useRandomDelay ? (
        <div className="task-delay-inline">
          <input
            type="number"
            className="task-delay-inline__input"
            min={0}
            max={120}
            value={delayMinSeconds}
            onChange={(event) => onDelayMinSecondsChange(Number(event.target.value) || 0)}
            disabled={disabled}
            aria-label="Delay min"
          />
          <span className="task-delay-inline__sep">–</span>
          <input
            type="number"
            className="task-delay-inline__input"
            min={0}
            max={120}
            value={delayMaxSeconds}
            onChange={(event) => onDelayMaxSecondsChange(Number(event.target.value) || 0)}
            disabled={disabled}
            aria-label="Delay max"
          />
          <span className="task-delay-inline__unit">s</span>
        </div>
      ) : (
        <div className="task-delay-inline">
          <input
            type="number"
            className="task-delay-inline__input"
            min={0}
            max={120}
            value={delaySeconds}
            onChange={(event) => onDelaySecondsChange(Number(event.target.value) || 0)}
            disabled={disabled}
            aria-label="Delay cố định"
          />
          <span className="task-delay-inline__unit">s</span>
        </div>
      )}

      {showPipelineDelay ? (
        <div className="task-delay-pipeline">
          <span className="task-delay-pipeline__label">Pipeline</span>
          <input
            type="number"
            className="task-delay-inline__input"
            min={0}
            max={60}
            value={pipelineStepDelaySeconds}
            onChange={(event) =>
              onPipelineStepDelaySecondsChange?.(Number(event.target.value) || 0)
            }
            disabled={disabled}
            aria-label="Delay pipeline"
          />
          <span className="task-delay-inline__unit">s</span>
        </div>
      ) : null}
    </div>
  )
}