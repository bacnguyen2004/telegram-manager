import {
  type CSSProperties,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { Alert } from '../components/Alert'
import { ConvSetupAccountSelect } from '../components/ConvSetupAccountSelect'
import { SessionAvatar } from '../components/SessionAvatar'
import type { SessionMetaOverviewItem } from '../types/api'
import {
  CONVERSATION_TEMPLATE,
  type ConversationJobData,
  type ConversationJobSummary,
  type ConversationPreviewLine,
  type ConversationTiming,
  type ConversationValidateData,
  type DeckLogEntry,
  type MultiSpeakerRow,
  type SummarizedParseIssue,
  deckLogShowMeta,
  formatDeckLogMeta,
  previewLinePhase,
  summarizePreviewLineStats,
} from '../utils/conversationScript'

type PreviewFilter = 'all' | 'todo' | 'done' | 'error'

export type ConversationPageViewProps = {
  error: string
  success: string
  info: string
  setError: (v: string) => void
  setSuccess: (v: string) => void
  setInfo: (v: string) => void
  sessions: string[]
  sessionsLoading: boolean
  busy: boolean
  loadSessions: () => void
  currentStep: number
  promptMessageCount: number
  preview: ConversationValidateData | null
  sessionsCount: number
  jobProgress: string
  groupLink: string
  promptText: string
  promptModeLabel: string
  scriptModeLabel: string
  scriptSpeakersDetected: string[]
  scriptSpeakersMissing: string[]
  effectiveSpeakerCount: number
  promptPlaceholder: string
  effectivePrompt: string
  promptSpeakerCount: number
  speakerFormError: string | null
  multiSpeakers: MultiSpeakerRow[]
  scriptText: string
  timing: ConversationTiming
  enableDelay: boolean
  enableSpeakerDelay: boolean
  enableTypingDelay: boolean
  continueOnError: boolean
  previewFilter: PreviewFilter
  previewLines: ConversationPreviewLine[]
  filteredPreviewLines: ConversationPreviewLine[]
  activeLine: ConversationPreviewLine | undefined
  job: ConversationJobData | null
  jobHistory: ConversationJobSummary[]
  jobPercent: number
  pendingLineCount: number
  parseErrors: ConversationValidateData['issues']
  parseWarnings: ConversationValidateData['issues']
  parseErrorSummaries: SummarizedParseIssue[]
  parseWarningSummaries: SummarizedParseIssue[]
  runBlockReason: string
  runFromLineBlockReason: string
  resumeBlockReason: string
  retryBlockReason: string
  stopBlockReason: string
  canResume: boolean
  canRetryLine: boolean
  previewScrollRef: RefObject<HTMLDivElement | null>
  setGroupLink: (v: string) => void
  setPromptMessageCount: (v: number) => void
  setPromptSpeakerCount: (v: number) => void
  setPromptText: (v: string) => void
  setScriptText: (v: string) => void
  setMultiSpeakers: Dispatch<SetStateAction<MultiSpeakerRow[]>>
  setEnableDelay: (v: boolean) => void
  setEnableSpeakerDelay: (v: boolean) => void
  setEnableTypingDelay: (v: boolean) => void
  setContinueOnError: (v: boolean) => void
  setTiming: Dispatch<SetStateAction<ConversationTiming>>
  setPreviewFilter: (v: PreviewFilter) => void
  setActiveLineId: (id: number) => void
  syncMultiSpeakerCount: (n: number) => void
  resetCryptoPrompt: () => void
  clearScriptOverride: () => void
  copyPrompt: () => void
  getPickerLabel: (phone: string) => string
  getMeta: (phone: string) => SessionMetaOverviewItem | undefined
  accountOptionsForRow: (current: string, others: string[]) => string[]
  handleParse: () => void
  handleRun: (fromStart: boolean) => void
  handleResume: () => void
  handleRetryLine: () => void
  handleStop: () => void
  handleLoadJob: (id: number) => void
  handleDetectSpeakers: () => void
  addMultiSpeaker: () => void
  removeMultiSpeaker: (i: number) => void
  copyMessagesOnly: () => void
  resetProgress: () => void
  focusIssueLine: (id?: number | null) => void
  rowClass: (line: ConversationPreviewLine, activeId: number) => string
  statusBadgeClass: (status: string) => string
  lineStatusLabel: (status: string) => string
  jobStatusLabel: (status: string) => string
  speakerBadgeLabel: (name: string) => string
  formatJobTime: (iso: string) => string
  shortenGroupLink: (link: string) => string
}

const STEPS = [
  { n: 1, label: 'Chuẩn bị' },
  { n: 2, label: 'Kịch bản' },
  { n: 3, label: 'Chạy' },
] as const

function clampSpeakerCount(value: number): number {
  return Math.max(2, Math.min(value, 10))
}

function SpeakerCountField({
  value,
  onCommit,
}: {
  value: number
  onCommit: (count: number) => void
}) {
  const [draft, setDraft] = useState(String(value))

  useEffect(() => {
    setDraft(String(value))
  }, [value])

  function commit() {
    const count = clampSpeakerCount(Number(draft) || 2)
    setDraft(String(count))
    onCommit(count)
  }

  return (
    <input
      type="number"
      min={2}
      max={10}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          e.currentTarget.blur()
        }
      }}
      aria-label="Số vai"
    />
  )
}

function PanelTop({
  title,
  hint,
  aside,
  tone,
}: {
  title: string
  hint?: string
  aside?: ReactNode
  tone: 'prompt' | 'setup' | 'script' | 'preview' | 'deck'
}) {
  return (
    <header className={`conv-panel__top conv-panel__top--${tone}`}>
      <div>
        <h3>{title}</h3>
        {hint ? <p>{hint}</p> : null}
      </div>
      {aside}
    </header>
  )
}

function ConvSteps({ current }: { current: number }) {
  return (
    <ol className="conv-steps" aria-label="Quy trình">
      {STEPS.map(({ n, label }, i) => (
        <li
          key={n}
          className={[
            'conv-steps__item',
            current === n ? 'conv-steps__item--active' : '',
            current > n ? 'conv-steps__item--done' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-current={current === n ? 'step' : undefined}
        >
          <span className="conv-steps__dot">{current > n ? '✓' : n}</span>
          <span className="conv-steps__label">{label}</span>
          {i < STEPS.length - 1 ? <span className="conv-steps__line" aria-hidden /> : null}
        </li>
      ))}
    </ol>
  )
}

function ConvPromptBlock({ p }: { p: ConversationPageViewProps }) {
  const hasOverride = p.promptText.trim().length > 0
  const speakerLabel = `${p.promptSpeakerCount} vai`

  return (
    <section className="conv-panel conv-panel--prompt conv-board__prompt">
      <PanelTop
        tone="prompt"
        title="1 · Prompt GPT"
        hint="Tạo prompt → sao chép → dán vào GPT"
        aside={
          <span className={`conv-chip${hasOverride ? ' conv-chip--accent' : ''}`}>
            {p.promptModeLabel}
          </span>
        }
      />
      <div className="conv-panel__body conv-prompt">
        <div className="conv-prompt__tuning" aria-label="Tuỳ chỉnh prompt">
          <label className="conv-prompt__knob">
            <span>Số tin</span>
            <input
              type="number"
              min={1}
              max={500}
              value={p.promptMessageCount}
              onChange={(e) => p.setPromptMessageCount(Number(e.target.value || 120))}
            />
          </label>
          <label className="conv-prompt__knob">
            <span>Số vai</span>
            <SpeakerCountField
              value={p.promptSpeakerCount}
              onCommit={p.syncMultiSpeakerCount}
            />
          </label>
          <div className="conv-prompt__knob conv-prompt__knob--stat">
            <span>Ký tự</span>
            <strong>{p.effectivePrompt.length.toLocaleString('vi-VN')}</strong>
          </div>
        </div>

        <div className={`conv-prompt__sheet${hasOverride ? ' conv-prompt__sheet--custom' : ''}`}>
          <header className="conv-prompt__sheet-head">
            <div className="conv-prompt__sheet-title">
              <strong>{hasOverride ? 'Nội dung tuỳ chỉnh' : 'Mẫu crypto sẵn có'}</strong>
              <p>
                {hasOverride
                  ? 'Sao chép sẽ dùng prompt này · đổi Số tin/vai sync khi sao chép'
                  : `${speakerLabel} · ${p.promptMessageCount} tin — chỉnh số rồi sao chép`}
              </p>
            </div>
          </header>
          <textarea
            className="conv-prompt__area"
            rows={12}
            value={p.promptText}
            onChange={(e) => p.setPromptText(e.target.value)}
            placeholder={p.promptPlaceholder}
            spellCheck={false}
            aria-label="Nội dung prompt GPT"
          />
        </div>

        <footer className="conv-prompt__foot">
          {hasOverride ? (
            <button type="button" className="btn btn--ghost btn--sm" onClick={p.resetCryptoPrompt}>
              Xóa ghi đè
            </button>
          ) : (
            <span className="conv-prompt__foot-hint">Dán vào GPT hoặc ghi đè trực tiếp</span>
          )}
          <button type="button" className="btn btn--primary" onClick={() => void p.copyPrompt()}>
            Sao chép prompt
          </button>
        </footer>
      </div>
    </section>
  )
}

function ConvScriptBlock({ p }: { p: ConversationPageViewProps }) {
  const scriptBody = p.scriptText.trim() ? p.scriptText : ''
  const scriptLines = scriptBody
    ? scriptBody.split('\n').filter((line) => line.trim()).length
    : 0
  const scriptChars = (p.scriptText.trim() ? p.scriptText : CONVERSATION_TEMPLATE).length
  const configuredKeys = new Set(
    p.multiSpeakers.map((row) => row.speaker.trim().toLowerCase()),
  )

  return (
    <section className="conv-panel conv-panel--script conv-board__script">
      <PanelTop
        tone="script"
        title="3 · Kịch bản"
        hint="Dán output GPT — mỗi câu một dòng"
        aside={
          <span className={`conv-chip${p.scriptText.trim() ? ' conv-chip--accent' : ''}`}>
            {p.scriptModeLabel}
          </span>
        }
      />
      <div className="conv-panel__body conv-script">
        <div className="conv-script__formats" aria-label="Định dạng hỗ trợ">
          <code className="conv-script__format">#1 Person A: …</code>
          <code className="conv-script__format">#6 Person B reply_to #1: …</code>
          <code className="conv-script__format">----</code>
        </div>

        {p.scriptSpeakersDetected.length ? (
          <div className="conv-script__cast">
            <span className="conv-script__cast-label">Vai trong kịch bản</span>
            <div className="conv-script__cast-tags">
              {p.scriptSpeakersDetected.map((name) => {
                const missing = !configuredKeys.has(name.trim().toLowerCase())
                return (
                  <span
                    key={name}
                    className={`conv-script__cast-tag${missing ? ' conv-script__cast-tag--missing' : ''}`}
                  >
                    {p.speakerBadgeLabel(name)}
                    <em>{name}</em>
                  </span>
                )
              })}
            </div>
          </div>
        ) : null}

        {p.scriptSpeakersMissing.length ? (
          <Alert
            type="warning"
            compact
            message={`Thiếu ${p.scriptSpeakersMissing.length} vai: ${p.scriptSpeakersMissing.join(', ')}. Bấm Tách nội dung để tự nhận diện, hoặc Nhận diện từ kịch bản ở mục Thiết lập.`}
          />
        ) : null}

        <div className={`conv-script__editor${p.scriptText.trim() ? ' conv-script__editor--filled' : ''}`}>
          <div className="conv-script__editor-head">
            <span className="conv-script__editor-label">
              {p.scriptText.trim() ? 'Nội dung đã dán' : 'Dán output GPT vào đây'}
            </span>
            <div className="conv-script__metrics">
              <span>
                <strong>{scriptLines}</strong> dòng
              </span>
              <span>
                <strong>{scriptChars.toLocaleString('vi-VN')}</strong> ký tự
              </span>
              {p.preview?.line_count ? (
                <span className="conv-script__metrics-parsed">
                  <strong>{p.preview.line_count}</strong> đã tách
                </span>
              ) : null}
            </div>
          </div>
          <textarea
            className="conv-script__area"
            rows={12}
            value={p.scriptText}
            onChange={(e) => p.setScriptText(e.target.value)}
            placeholder={CONVERSATION_TEMPLATE}
            spellCheck={false}
            aria-label="Nội dung kịch bản"
          />
        </div>

        <div className="conv-script__toolbar">
          <button
            type="button"
            className="btn btn--primary conv-script__parse"
            disabled={p.busy || p.sessionsLoading || Boolean(p.speakerFormError)}
            onClick={() => void p.handleParse()}
          >
            Tách nội dung
          </button>
          <div className="conv-script__toolbar-rest">
            {p.scriptSpeakersMissing.length ? (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={p.busy}
                onClick={p.handleDetectSpeakers}
              >
                Nhận diện vai
              </button>
            ) : null}
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => void p.copyMessagesOnly()}>
              Sao chép tin
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={p.resetProgress}>
              Làm lại
            </button>
            {p.scriptText.trim() ? (
              <button type="button" className="btn btn--ghost btn--sm" onClick={p.clearScriptOverride}>
                Xóa đã dán
              </button>
            ) : null}
          </div>
        </div>

        {p.preview?.line_count ? (
          <p className="conv-script__ready">
            Đã tách <strong>{p.preview.line_count}</strong> dòng — xem ở mục{' '}
            <strong>4 · Xem trước</strong>
          </p>
        ) : null}
      </div>
    </section>
  )
}

function ConvSetupMember({
  badge,
  speaker,
  phone,
  excludePhones,
  onSpeakerChange,
  onPhoneChange,
  onRemove,
  canRemove,
  p,
}: {
  badge: string
  speaker: string
  phone: string
  excludePhones: string[]
  onSpeakerChange: (value: string) => void
  onPhoneChange: (value: string) => void
  onRemove?: () => void
  canRemove?: boolean
  p: ConversationPageViewProps
}) {
  return (
    <article className={`conv-setup__member${phone ? ' conv-setup__member--ready' : ''}`}>
      <span className="conv-setup__member-badge" aria-hidden>
        {badge}
      </span>
      <div className="conv-setup__member-main">
        <input
          className="conv-setup__member-name"
          value={speaker}
          onChange={(e) => onSpeakerChange(e.target.value)}
          placeholder="Tên vai"
          aria-label="Tên vai"
        />
        <ConvSetupAccountSelect
          value={phone}
          onChange={onPhoneChange}
          options={p.accountOptionsForRow(phone, excludePhones)}
          getMeta={p.getMeta}
          disabled={p.sessionsLoading || p.busy}
          placeholder="Chọn account…"
        />
      </div>
      {onRemove ? (
        <button
          type="button"
          className="conv-setup__member-drop"
          disabled={!canRemove}
          aria-label={`Xóa vai ${speaker}`}
          onClick={onRemove}
        >
          ×
        </button>
      ) : (
        <span className="conv-setup__member-spacer" aria-hidden />
      )}
    </article>
  )
}

function ConvSetupBlock({ p }: { p: ConversationPageViewProps }) {
  const groupReady = p.groupLink.trim().length > 0
  const assignedCount = p.multiSpeakers.filter((row) => row.phone.trim()).length

  return (
    <section className="conv-panel conv-panel--setup conv-board__setup">
      <PanelTop
        tone="setup"
        title="2 · Thiết lập"
        hint="Nhóm · account · delay"
        aside={
          <span className={`conv-chip${groupReady ? ' conv-chip--setup' : ''}`}>
            {assignedCount}/{p.effectiveSpeakerCount} acc
          </span>
        }
      />
      <div className="conv-panel__body conv-setup">
        <Alert type="warning" message={p.speakerFormError ?? ''} compact />

        <div className={`conv-setup__sheet${groupReady ? ' conv-setup__sheet--ready' : ''}`}>
          <header className="conv-setup__head">
            <label className="conv-setup__group">
              <span className="conv-setup__group-kicker">
                <span className={`conv-setup__status${groupReady ? ' conv-setup__status--on' : ''}`} />
                Nhóm đích
              </span>
              <input
                className="conv-setup__group-input"
                value={p.groupLink}
                onChange={(e) => p.setGroupLink(e.target.value)}
                placeholder="https://t.me/group hoặc @username"
                spellCheck={false}
              />
            </label>
          </header>

          <section className="conv-setup__roster">
            <div className="conv-setup__roster-bar">
              <strong>Roster</strong>
              <label className="conv-setup__speaker-count">
                <span>Số vai</span>
                <SpeakerCountField
                  value={p.promptSpeakerCount}
                  onCommit={p.syncMultiSpeakerCount}
                />
              </label>
              <span className="conv-setup__roster-stat">{assignedCount} đã gán acc</span>
              <div className="conv-setup__roster-tools">
                <button type="button" className="conv-setup__tool" onClick={p.handleDetectSpeakers}>
                  Nhận diện
                </button>
                <button
                  type="button"
                  className="conv-setup__tool"
                  disabled={p.multiSpeakers.length >= 10}
                  onClick={p.addMultiSpeaker}
                >
                  + Vai
                </button>
              </div>
            </div>

            <div className="conv-setup__roster-list">
              {p.multiSpeakers.map((row, index) => (
                <ConvSetupMember
                  key={`${row.speaker}-${index}`}
                  badge={p.speakerBadgeLabel(row.speaker)}
                  speaker={row.speaker}
                  phone={row.phone}
                  excludePhones={p.multiSpeakers
                    .filter((_, i) => i !== index)
                    .map((item) => item.phone)}
                  onSpeakerChange={(value) =>
                    p.setMultiSpeakers((prev) =>
                      prev.map((item, i) => (i === index ? { ...item, speaker: value } : item)),
                    )
                  }
                  onPhoneChange={(value) =>
                    p.setMultiSpeakers((prev) =>
                      prev.map((item, i) => (i === index ? { ...item, phone: value } : item)),
                    )
                  }
                  onRemove={() => p.removeMultiSpeaker(index)}
                  canRemove={p.multiSpeakers.length > 2}
                  p={p}
                />
              ))}
            </div>
          </section>

          <footer className="conv-setup__foot">
            <div className="conv-setup__delays">
              <div className={`conv-setup__delay${p.enableDelay ? ' is-on' : ''}`}>
                <label className="conv-setup__delay-toggle">
                  <input
                    type="checkbox"
                    checked={p.enableDelay}
                    onChange={(e) => p.setEnableDelay(e.target.checked)}
                  />
                  <span>Giữa câu</span>
                </label>
                <div className="conv-setup__delay-values">
                  <input
                    type="number"
                    min={0}
                    disabled={!p.enableDelay}
                    value={p.timing.delay_min_sec}
                    onChange={(e) =>
                      p.setTiming((prev) => ({ ...prev, delay_min_sec: Number(e.target.value || 0) }))
                    }
                  />
                  <span>–</span>
                  <input
                    type="number"
                    min={0}
                    disabled={!p.enableDelay}
                    value={p.timing.delay_max_sec}
                    onChange={(e) =>
                      p.setTiming((prev) => ({ ...prev, delay_max_sec: Number(e.target.value || 0) }))
                    }
                  />
                  <em>s</em>
                </div>
              </div>
              <div className={`conv-setup__delay${p.enableSpeakerDelay ? ' is-on' : ''}`}>
                <label className="conv-setup__delay-toggle">
                  <input
                    type="checkbox"
                    checked={p.enableSpeakerDelay}
                    onChange={(e) => p.setEnableSpeakerDelay(e.target.checked)}
                  />
                  <span>Đổi vai</span>
                </label>
                <div className="conv-setup__delay-values">
                  <input
                    type="number"
                    min={0}
                    disabled={!p.enableSpeakerDelay}
                    value={p.timing.speaker_change_delay_min_sec}
                    onChange={(e) =>
                      p.setTiming((prev) => ({
                        ...prev,
                        speaker_change_delay_min_sec: Number(e.target.value || 0),
                      }))
                    }
                  />
                  <span>–</span>
                  <input
                    type="number"
                    min={0}
                    disabled={!p.enableSpeakerDelay}
                    value={p.timing.speaker_change_delay_max_sec}
                    onChange={(e) =>
                      p.setTiming((prev) => ({
                        ...prev,
                        speaker_change_delay_max_sec: Number(e.target.value || 0),
                      }))
                    }
                  />
                  <em>s</em>
                </div>
              </div>
              <div className={`conv-setup__delay${p.enableTypingDelay ? ' is-on' : ''}`}>
                <label className="conv-setup__delay-toggle">
                  <input
                    type="checkbox"
                    checked={p.enableTypingDelay}
                    onChange={(e) => p.setEnableTypingDelay(e.target.checked)}
                  />
                  <span>Đang gõ</span>
                </label>
                <div className="conv-setup__delay-values">
                  <input
                    type="number"
                    min={0}
                    disabled={!p.enableTypingDelay}
                    value={p.timing.typing_min_sec}
                    onChange={(e) =>
                      p.setTiming((prev) => ({
                        ...prev,
                        typing_min_sec: Number(e.target.value || 0),
                      }))
                    }
                  />
                  <span>–</span>
                  <input
                    type="number"
                    min={0}
                    disabled={!p.enableTypingDelay}
                    value={p.timing.typing_max_sec}
                    onChange={(e) =>
                      p.setTiming((prev) => ({
                        ...prev,
                        typing_max_sec: Number(e.target.value || 0),
                      }))
                    }
                  />
                  <em>s</em>
                </div>
              </div>
            </div>
            <div className="conv-setup__flags">
              <label className={`conv-setup__flag${p.continueOnError ? ' is-on' : ''}`}>
                <input
                  type="checkbox"
                  checked={p.continueOnError}
                  onChange={(e) => p.setContinueOnError(e.target.checked)}
                />
                <span>Lỗi vẫn chạy</span>
              </label>
            </div>
          </footer>
        </div>
      </div>
    </section>
  )
}

function ConvPreviewBlock({ p }: { p: ConversationPageViewProps }) {
  const lineStats = useMemo(
    () => summarizePreviewLineStats(p.previewLines),
    [p.previewLines],
  )

  const hasParsed = Boolean(p.preview?.line_count)
  const activeMeta = p.activeLine?.phone ? p.getMeta(p.activeLine.phone) : undefined
  const activePhase = p.activeLine ? previewLinePhase(p.activeLine.status) : null
  const progressPct = lineStats.total
    ? Math.min(100, Math.round((lineStats.done / lineStats.total) * 100))
    : 0

  const metrics = [
    { key: 'total', label: 'Tổng', value: lineStats.total, tone: 'total' as const },
    {
      key: 'todo',
      label: 'Cần gửi',
      value: lineStats.actionable,
      tone: 'todo' as const,
      hot: lineStats.actionable > 0,
    },
    { key: 'done', label: 'Đã gửi', value: lineStats.done, tone: 'done' as const, hot: lineStats.done > 0 },
    { key: 'skip', label: 'Không chạy', value: lineStats.skip, tone: 'skip' as const, hot: lineStats.skip > 0 },
  ]

  const filterOptions = [
    { value: 'all' as const, label: 'Tất cả', count: lineStats.total },
    { value: 'todo' as const, label: 'Cần gửi', count: lineStats.actionable },
    { value: 'done' as const, label: 'Đã gửi', count: lineStats.done },
    { value: 'error' as const, label: 'Lỗi', count: lineStats.fail },
  ]

  return (
    <section className="conv-panel conv-panel--preview conv-board__preview">
      <PanelTop
        tone="preview"
        title="4 · Xem trước & gửi"
        hint="Spotlight từng dòng · gửi có kiểm soát"
        aside={
          hasParsed ? (
            <span className="conv-chip conv-chip--preview">
              {p.preview?.line_count ?? lineStats.total} dòng
            </span>
          ) : (
            <span className="conv-chip">Chưa tách</span>
          )
        }
      />
      <div className="conv-panel__body conv-panel__body--preview">
        <div className="conv-preview">
          {p.parseErrorSummaries.map((item) => (
            <Alert
              key={item.message}
              type="error"
              compact
              message={item.message}
              disabled={!item.line_id}
              onClick={item.line_id ? () => p.focusIssueLine(item.line_id) : undefined}
            />
          ))}
          {p.parseWarningSummaries.map((item) => (
            <Alert
              key={item.message}
              type="warning"
              compact
              message={item.message}
              disabled={!item.line_id}
              onClick={item.line_id ? () => p.focusIssueLine(item.line_id) : undefined}
            />
          ))}

          <div className={`conv-preview__sheet${hasParsed ? ' conv-preview__sheet--ready' : ''}`}>
            {hasParsed ? (
              <div className="conv-preview__progress" aria-label="Tiến độ gửi">
                <span className="conv-preview__progress-fill" style={{ width: `${progressPct}%` }} />
              </div>
            ) : null}

            <header className="conv-preview__head">
              <div className="conv-preview__head-row">
                <div className="conv-preview__metrics" aria-label="Thống kê dòng">
                  {metrics.map((item) => (
                    <article
                      key={item.key}
                      className={[
                        'conv-preview__metric',
                        `conv-preview__metric--${item.tone}`,
                        item.hot ? 'is-hot' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <span className="conv-preview__metric-val">{item.value}</span>
                      <span className="conv-preview__metric-lbl">{item.label}</span>
                    </article>
                  ))}
                </div>
                {hasParsed && lineStats.done > 0 ? (
                  <div className="conv-preview__ring" style={{ '--pct': `${progressPct}%` } as CSSProperties}>
                    <span>{progressPct}%</span>
                  </div>
                ) : null}
              </div>
              <div className="conv-preview__filters" role="group" aria-label="Lọc dòng">
                {filterOptions.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className={p.previewFilter === item.value ? 'is-active' : ''}
                    onClick={() => p.setPreviewFilter(item.value)}
                  >
                    {item.label}
                    {item.count ? <em>{item.count}</em> : null}
                  </button>
                ))}
              </div>
            </header>

            <div className="conv-preview__stage">
              <div className="conv-preview__focus">
                <header className="conv-preview__focus-head">
                  <span>Dòng đang xem</span>
                  {p.activeLine ? (
                    <span className={`conv-preview__pill conv-preview__pill--${activePhase}`}>
                      {p.lineStatusLabel(p.activeLine.status)}
                    </span>
                  ) : null}
                </header>
                <article
                  className={[
                    'conv-preview__spotlight',
                    activePhase ? `conv-preview__spotlight--${activePhase}` : '',
                    p.activeLine ? 'conv-preview__spotlight--active' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {p.activeLine ? (
                    <div className="conv-preview__chat">
                      <div className="conv-preview__chat-head">
                        {p.activeLine.phone ? (
                          <SessionAvatar
                            phone={p.activeLine.phone}
                            label={p.activeLine.speakerLabel}
                            hasAvatar={activeMeta?.has_avatar}
                            avatarUpdatedAt={activeMeta?.avatar_updated_at}
                            size="sm"
                          />
                        ) : (
                          <span className="conv-preview__spotlight-badge" aria-hidden>
                            {p.speakerBadgeLabel(p.activeLine.speakerLabel)}
                          </span>
                        )}
                        <div className="conv-preview__chat-who">
                          <strong>{p.activeLine.speakerLabel}</strong>
                          <span>
                            {p.activeLine.phone
                              ? p.getPickerLabel(p.activeLine.phone)
                              : 'Chưa gán acc'}
                          </span>
                        </div>
                        <span className="conv-preview__line-id mono">#{p.activeLine.lineId}</span>
                      </div>
                      <div className="conv-preview__chat-tags">
                        {p.activeLine.round ? <span>{p.activeLine.round}</span> : null}
                        {p.activeLine.replyTo ? (
                          <span className="conv-preview__reply-tag">reply #{p.activeLine.replyTo}</span>
                        ) : null}
                      </div>
                      <div className="conv-preview__bubble-wrap">
                        <div className="conv-preview__bubble">
                          <p className="conv-preview__spotlight-text">{p.activeLine.message}</p>
                        </div>
                      </div>
                      {p.activeLine.status === 'success' ? (
                        <p className="conv-preview__spotlight-note conv-preview__spotlight-note--done">
                          Đã gửi — chỉ xem lại.
                        </p>
                      ) : null}
                      {p.activeLine.status === 'skipped' ? (
                        <p className="conv-preview__spotlight-note conv-preview__spotlight-note--skip">
                          Không chạy lần này — chọn dòng cần gửi.
                        </p>
                      ) : null}
                      {p.activeLine.status === 'error' && p.activeLine.detail ? (
                        <p className="conv-preview__spotlight-detail">{p.activeLine.detail}</p>
                      ) : null}
                    </div>
                  ) : (
                    <div className="conv-preview__spotlight-empty">
                      <span className="conv-preview__spotlight-empty-icon" aria-hidden>
                        ✦
                      </span>
                      <h4>Chưa có preview</h4>
                      <p>
                        Dán kịch bản ở mục <strong>2</strong>, rồi bấm <strong>Tách nội dung</strong>.
                      </p>
                    </div>
                  )}
                </article>
              </div>

              <section className="conv-preview__feed">
                <header className="conv-preview__feed-head">
                  <div>
                    <strong>Inbox kịch bản</strong>
                    <span>Chọn dòng để xem & gửi</span>
                  </div>
                  <em className="mono">
                    {p.filteredPreviewLines.length}
                    {lineStats.total ? `/${lineStats.total}` : ''}
                  </em>
                </header>
                <div className="conv-preview__feed-scroll" ref={p.previewScrollRef}>
                  {p.filteredPreviewLines.length ? (
                    p.filteredPreviewLines.map((line) => {
                      const meta = line.phone ? p.getMeta(line.phone) : undefined
                      const phase = previewLinePhase(line.status)

                      return (
                        <button
                          key={line.lineId}
                          type="button"
                          data-line-id={line.lineId}
                          className={p.rowClass(line, p.activeLine?.lineId ?? 0)}
                          onClick={() => p.setActiveLineId(line.lineId)}
                        >
                          <span className="conv-preview__feed-rail">
                            <span className="conv-preview__feed-idx mono">{line.lineId}</span>
                            {line.phone ? (
                              <SessionAvatar
                                phone={line.phone}
                                label={line.speakerLabel}
                                hasAvatar={meta?.has_avatar}
                                avatarUpdatedAt={meta?.avatar_updated_at}
                                size="sm"
                              />
                            ) : (
                              <span className="conv-preview__feed-badge" aria-hidden>
                                {p.speakerBadgeLabel(line.speakerLabel)}
                              </span>
                            )}
                          </span>
                          <span className="conv-preview__feed-main">
                            <span className="conv-preview__feed-who">
                              {line.speakerLabel}
                              {line.replyTo ? (
                                <em className="conv-preview__feed-reply">↩ #{line.replyTo}</em>
                              ) : null}
                            </span>
                            <span className="conv-preview__feed-msg">{line.message}</span>
                          </span>
                          <span className={`conv-preview__pill conv-preview__pill--${phase}`}>
                            {p.lineStatusLabel(line.status)}
                          </span>
                        </button>
                      )
                    })
                  ) : (
                    <p className="conv-preview__feed-empty">
                      {!p.previewLines.length
                        ? 'Chưa tách nội dung.'
                        : 'Không có dòng khớp bộ lọc.'}
                    </p>
                  )}
                </div>
              </section>
            </div>

            <footer className="conv-preview__dock">
              <div className="conv-preview__dock-main">
                <button
                  type="button"
                  className="btn btn--primary conv-preview__dock-cta"
                  disabled={Boolean(p.runBlockReason)}
                  title={p.runBlockReason || undefined}
                  onClick={() => void p.handleRun(true)}
                >
                  Chạy từ đầu
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm conv-preview__dock-secondary"
                  disabled={Boolean(p.runFromLineBlockReason)}
                  title={p.runFromLineBlockReason || undefined}
                  onClick={() => void p.handleRun(false)}
                >
                  Từ #{p.activeLine?.lineId ?? '…'}
                </button>
              </div>
              <div className="conv-preview__dock-job">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={!p.canResume}
                  title={p.resumeBlockReason || undefined}
                  onClick={() => void p.handleResume()}
                >
                  Resume
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={p.busy || !p.canRetryLine}
                  title={p.retryBlockReason || undefined}
                  onClick={() => void p.handleRetryLine()}
                >
                  Retry
                </button>
                <button
                  type="button"
                  className="btn btn--danger btn--sm"
                  disabled={Boolean(p.stopBlockReason)}
                  title={p.stopBlockReason || undefined}
                  onClick={() => void p.handleStop()}
                >
                  Dừng
                </button>
              </div>
              {p.runBlockReason ? (
                <p className="conv-preview__dock-hint conv-preview__dock-hint--warn">{p.runBlockReason}</p>
              ) : p.runFromLineBlockReason && hasParsed && !p.runBlockReason ? (
                <p className="conv-preview__dock-hint conv-preview__dock-hint--warn">
                  {p.runFromLineBlockReason}
                </p>
              ) : hasParsed ? (
                <p className="conv-preview__dock-foot">
                  <span>{lineStats.done} đã gửi</span>
                  {lineStats.skip ? <span>{lineStats.skip} không chạy</span> : null}
                  {lineStats.actionable ? <span>{lineStats.actionable} cần gửi</span> : null}
                  {lineStats.fail ? <span className="is-err">{lineStats.fail} lỗi</span> : null}
                </p>
              ) : null}
            </footer>
          </div>
        </div>
      </div>
    </section>
  )
}

type DeckLogFilter = 'all' | 'active' | 'error'

function deckLogCardClass(status: string, activeId: number, lineId: number): string {
  return [
    'conv-deck__log-card',
    `is-phase-${previewLinePhase(status)}`,
    lineId === activeId ? 'is-active' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

function ConvMonitorBlock({ p }: { p: ConversationPageViewProps }) {
  const [logFilter, setLogFilter] = useState<DeckLogFilter>('all')

  const isJobActive = Boolean(
    p.job && (p.job.status === 'pending' || p.job.status === 'running'),
  )

  const logLines = useMemo<DeckLogEntry[]>(() => {
    if (!p.job) return []

    const resultMap = new Map(p.job.line_results.map((item) => [item.line_id, item]))
    const script = p.job.script

    if (script?.lines?.length) {
      return [...script.lines]
        .sort((a, b) => a.id - b.id)
        .map((line) => {
          const result = resultMap.get(line.id)
          const speaker = script.speakers.find((item) => item.id === line.speaker_id)
          return {
            lineId: line.id,
            speakerLabel: speaker?.label ?? line.speaker_id,
            phone: result?.phone ?? speaker?.phone ?? '',
            message: line.text,
            status: result?.status ?? 'pending',
            detail: result?.detail ?? '',
            messageId: result?.message_id ?? null,
            replyToMsgId: result?.reply_to_msg_id ?? null,
            replyToLineId: line.reply_to ?? null,
          }
        })
    }

    return [...p.job.line_results]
      .sort((a, b) => a.line_id - b.line_id)
      .map((item) => ({
        lineId: item.line_id,
        speakerLabel: item.speaker_id,
        phone: item.phone,
        message: '',
        status: item.status,
        detail: item.detail ?? '',
        messageId: item.message_id ?? null,
        replyToMsgId: item.reply_to_msg_id ?? null,
        replyToLineId: null,
      }))
  }, [p.job])

  const logCounts = useMemo(() => {
    const active = logLines.filter(
      (line) => line.status === 'pending' || line.status === 'running',
    ).length
    const errors = logLines.filter((line) => line.status === 'error').length
    return { total: logLines.length, active, errors }
  }, [logLines])

  const filteredLogLines = useMemo(() => {
    if (logFilter === 'error') {
      return logLines.filter((line) => line.status === 'error')
    }
    if (logFilter === 'active') {
      return logLines.filter(
        (line) => line.status === 'pending' || line.status === 'running',
      )
    }
    return logLines
  }, [logFilter, logLines])

  const logFilterOptions = [
    { value: 'all' as const, label: 'Tất cả', count: logCounts.total },
    { value: 'active' as const, label: 'Đang xử lý', count: logCounts.active },
    { value: 'error' as const, label: 'Lỗi', count: logCounts.errors },
  ]

  const skipCount = logLines.filter((line) => line.status === 'skipped').length

  return (
    <section className="conv-panel conv-panel--deck conv-board__deck">
      <PanelTop
        tone="deck"
        title="5 · Tiến độ"
        hint="Theo dõi realtime · lịch sử job"
        aside={
          p.job ? (
            <span
              className={[
                p.statusBadgeClass(p.job.status),
                isJobActive ? 'conv-deck__live' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {p.jobStatusLabel(p.job.status)}
            </span>
          ) : (
            <span className="conv-chip">Chưa chạy</span>
          )
        }
      />
      <div className="conv-panel__body conv-panel__body--deck">
        <div className={`conv-deck__sheet${p.job ? ' conv-deck__sheet--ready' : ''}`}>
          {p.job ? (
            <>
              <header className="conv-deck__dash">
                <div className="conv-deck__dash-row">
                  <span className="conv-deck__dash-badge mono">#{p.job.id}</span>
                  {p.job.stop_requested ? (
                    <span className="conv-deck__stop-flag">Đang dừng…</span>
                  ) : null}
                  {isJobActive ? <span className="conv-deck__live-dot" aria-hidden /> : null}
                  <div className="conv-deck__dash-bar-track">
                    <span
                      className={`conv-deck__dash-bar-fill${isJobActive ? ' is-live' : ''}`}
                      style={{ width: `${p.jobPercent}%` }}
                    />
                  </div>
                  <span className="conv-deck__dash-pct mono">{p.jobPercent}%</span>
                </div>
                <p className="conv-deck__dash-sub muted">
                  <span>
                    {p.job.completed_lines}/{p.job.total_lines} dòng · {p.job.success_lines} gửi
                    {p.pendingLineCount ? ` · ${p.pendingLineCount} chờ` : ''}
                    {p.job.error_lines ? ` · ${p.job.error_lines} lỗi` : ''}
                    {skipCount ? ` · ${skipCount} bỏ qua` : ''}
                  </span>
                  <time>{p.formatJobTime(p.job.updated_at)}</time>
                </p>
              </header>

              <div className="conv-deck__body">
                <div className="conv-deck__tabs" role="tablist" aria-label="Lọc log">
                  {logFilterOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="tab"
                      aria-selected={logFilter === option.value}
                      className={logFilter === option.value ? 'is-active' : ''}
                      onClick={() => setLogFilter(option.value)}
                    >
                      {option.label}
                      <em>{option.count}</em>
                    </button>
                  ))}
                </div>

                <ul className="conv-deck__log-list">
                  {filteredLogLines.length ? (
                    filteredLogLines.map((line) => {
                      const phase = previewLinePhase(line.status)
                      const showMeta = deckLogShowMeta(line)

                      return (
                        <li key={line.lineId}>
                          <button
                            type="button"
                            className={deckLogCardClass(
                              line.status,
                              p.activeLine?.lineId ?? 0,
                              line.lineId,
                            )}
                            onClick={() => p.setActiveLineId(line.lineId)}
                          >
                            <span className="conv-deck__log-card-top">
                              <span className="conv-deck__log-id mono">#{line.lineId}</span>
                              <span className={`conv-deck__status conv-deck__status--${phase}`}>
                                {p.lineStatusLabel(line.status)}
                              </span>
                              <span className="conv-deck__log-speaker">{line.speakerLabel}</span>
                            </span>
                            <span className="conv-deck__log-card-msg">
                              {line.message || '—'}
                            </span>
                            {showMeta ? (
                              <span
                                className={`conv-deck__log-card-meta${
                                  line.status === 'error' ? ' is-err' : ''
                                }`}
                              >
                                {formatDeckLogMeta(line)}
                              </span>
                            ) : null}
                          </button>
                        </li>
                      )
                    })
                  ) : (
                    <li className="conv-deck__log-empty">
                      {logLines.length
                        ? 'Không có dòng khớp bộ lọc.'
                        : 'Chưa có log cho job này.'}
                    </li>
                  )}
                </ul>

                {p.jobHistory.length > 1 ? (
                  <div className="conv-deck__history-bar">
                    <span className="conv-deck__history-label">Job khác</span>
                    <div className="conv-deck__history-chips">
                      {p.jobHistory.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className={[
                            'conv-deck__history-chip',
                            p.job?.id === item.id ? 'is-active' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          onClick={() => void p.handleLoadJob(item.id)}
                        >
                          #{item.id} · {p.jobStatusLabel(item.status)}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <footer className="conv-deck__dock">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={p.resetProgress}
                  disabled={p.busy}
                >
                  Làm lại
                </button>
                {isJobActive ? (
                  <span className="conv-deck__live-hint">
                    <span className="conv-deck__live-dot" aria-hidden />
                    Live
                  </span>
                ) : null}
                {p.job.error_message ? (
                  <p className="conv-deck__dock-error">{p.job.error_message}</p>
                ) : null}
              </footer>
            </>
          ) : (
            <div className="conv-deck__empty-state">
              <span className="conv-deck__empty-icon mono" aria-hidden>
                &gt;_
              </span>
              <h4>Chưa có tiến độ</h4>
              <p>
                Tách kịch bản ở mục <strong>4 · Xem trước</strong>, rồi bấm{' '}
                <strong>Chạy từ đầu</strong> để bắt đầu gửi tin.
              </p>
              {p.jobHistory.length ? (
                <div className="conv-deck__empty-history">
                  <span>Lịch sử gần đây</span>
                  <div className="conv-deck__empty-pills">
                    {p.jobHistory.slice(0, 4).map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => void p.handleLoadJob(item.id)}
                      >
                        #{item.id} · {p.jobStatusLabel(item.status)}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

export function ConversationPageView(p: ConversationPageViewProps) {
  return (
    <div className="page page--conversation">
      <Alert type="error" message={p.error} onDismiss={() => p.setError('')} />
      <Alert type="success" message={p.success} onDismiss={() => p.setSuccess('')} />
      <Alert type="info" message={p.info} onDismiss={() => p.setInfo('')} />

      <div className="conv-page">
        <header className="conv-top">
          <div className="conv-top__main">
            <h1>Hội thoại tự nhiên</h1>
            <p>Tạo prompt → dán kịch bản GPT → gửi tự động vào nhóm Telegram</p>
          </div>
          <div className="conv-top__tools">
            <ConvSteps current={p.currentStep} />
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => void p.loadSessions()}
              disabled={p.sessionsLoading || p.busy}
            >
              {p.sessionsLoading ? 'Đang tải…' : 'Tải account'}
            </button>
          </div>
        </header>

        <div className="conv-stats">
          <article>
            <span>Tin mục tiêu</span>
            <strong>{p.promptMessageCount}</strong>
          </article>
          <article>
            <span>Đã tách</span>
            <strong>{p.preview?.line_count ?? 0}</strong>
          </article>
          <article className="conv-stats__ok">
            <span>Account</span>
            <strong>{p.sessionsLoading ? '—' : p.sessionsCount}</strong>
          </article>
          <article>
            <span>Tiến độ</span>
            <strong>{p.jobProgress}</strong>
          </article>
        </div>

        <div className="conv-board">
          <ConvPromptBlock p={p} />
          <ConvScriptBlock p={p} />
          <ConvSetupBlock p={p} />
          <ConvPreviewBlock p={p} />
          <ConvMonitorBlock p={p} />
        </div>
      </div>
    </div>
  )
}