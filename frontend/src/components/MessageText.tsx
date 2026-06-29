import { useState } from 'react'

const MAX_CHARS = 280
const MAX_LINES = 5

function needsCollapse(text: string): boolean {
  return text.length > MAX_CHARS || text.split('\n').length > MAX_LINES
}

interface MessageTextProps {
  text: string
}

export function MessageText({ text }: MessageTextProps) {
  const [expanded, setExpanded] = useState(false)
  const collapsible = needsCollapse(text)

  if (!collapsible) {
    return <p className="message-text">{text}</p>
  }

  return (
    <div className="message-text-wrap">
      <p className={`message-text${expanded ? '' : ' message-text--collapsed'}`}>{text}</p>
      <button
        type="button"
        className="message-expand-btn"
        onClick={() => setExpanded((prev) => !prev)}
      >
        {expanded ? 'Thu gọn' : 'Xem thêm'}
      </button>
    </div>
  )
}