import { useEffect, useMemo, useRef, useState } from 'react'
import type { DialogMessageItem, DialogReactionsPolicy } from '../types/api'
import {
  buildReactionPickerGroups,
  canReactWith,
  reactionsHint,
} from '../utils/reactions'

interface MessageReactionBarProps {
  msg: DialogMessageItem
  reactionsPolicy: DialogReactionsPolicy | null
  reactingId: number | null
  sending: boolean
  onReact: (msg: DialogMessageItem, emoji: string) => void
}

function renderEmoji(emoji: string) {
  return emoji.startsWith('custom:') ? '⭐' : emoji
}

export function MessageReactionBar({
  msg,
  reactionsPolicy,
  reactingId,
  sending,
  onReact,
}: MessageReactionBarProps) {
  const [popoverOpen, setPopoverOpen] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)
  const chosenEmoji = (msg.reactions ?? []).find((reaction) => reaction.chosen)?.emoji
  const reactionPolicyHint = reactionsHint(reactionsPolicy)
  const { quick, more } = useMemo(
    () => buildReactionPickerGroups(reactionsPolicy),
    [reactionsPolicy],
  )
  const hasPicker = quick.length > 0 || more.length > 0
  const hasContent =
    (msg.reactions ?? []).length > 0 || hasPicker || Boolean(reactionPolicyHint)

  useEffect(() => {
    if (!popoverOpen) return

    function handlePointerDown(event: MouseEvent) {
      if (!popoverRef.current?.contains(event.target as Node)) {
        setPopoverOpen(false)
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setPopoverOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [popoverOpen])

  if (!hasContent) return null

  function handlePick(emoji: string) {
    void onReact(msg, emoji)
    setPopoverOpen(false)
  }

  function renderPickButton(emoji: string, key: string) {
    return (
      <button
        key={key}
        type="button"
        className={`message-reaction-pick${chosenEmoji === emoji ? ' message-reaction-pick--active' : ''}`}
        disabled={reactingId === msg.id || sending}
        onClick={() => handlePick(emoji)}
        title={chosenEmoji === emoji ? 'Bỏ reaction' : `React ${emoji}`}
      >
        {emoji}
      </button>
    )
  }

  return (
    <div className="message-reaction-bar">
      {(msg.reactions ?? []).map((reaction) => {
        const chipAllowed = canReactWith(
          reactionsPolicy,
          reaction.emoji,
          reaction.chosen,
        )
        return (
          <button
            key={`${msg.id}-${reaction.emoji}`}
            type="button"
            className={`message-reaction-chip${reaction.chosen ? ' message-reaction-chip--chosen' : ''}`}
            disabled={reactingId === msg.id || !chipAllowed}
            onClick={() => void onReact(msg, reaction.emoji)}
            title={
              !chipAllowed
                ? (reactionPolicyHint ?? 'Không thể dùng reaction này')
                : reaction.chosen
                  ? 'Bỏ reaction'
                  : 'Đổi sang reaction này'
            }
          >
            <span>{renderEmoji(reaction.emoji)}</span>
            <span>{reaction.count}</span>
          </button>
        )
      })}

      {hasPicker ? (
        <div
          ref={popoverRef}
          className={`message-reaction-controls${popoverOpen ? ' message-reaction-controls--open' : ''}`}
        >
          <div className="message-reaction-picker">
            {quick.map((emoji) => renderPickButton(emoji, `${msg.id}-pick-${emoji}`))}
          </div>
          {more.length > 0 ? (
            <>
              <button
                type="button"
                className="message-reaction-more-btn"
                disabled={reactingId === msg.id || sending}
                onClick={() => setPopoverOpen((open) => !open)}
                title={`Thêm reaction (${more.length})`}
                aria-expanded={popoverOpen}
                aria-haspopup="true"
              >
                +
              </button>
              {popoverOpen ? (
                <div className="message-reaction-popover" role="menu">
                  {more.map((emoji) => renderPickButton(emoji, `${msg.id}-more-${emoji}`))}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      ) : reactionPolicyHint ? (
        <span className="message-reaction-hint">{reactionPolicyHint}</span>
      ) : null}
    </div>
  )
}