import { describe, expect, it } from 'vitest'
import type { DialogItem, DialogMessageItem } from '../types/api'
import {
  getUnreadMessagesInLoaded,
  inferHasMoreOlder,
  isStaleMessagesRequest,
  mergeDialogsWithStoredReadState,
  mergeNewMessages,
  messageCopyText,
  planPartialMarkRead,
  resolveReplyQuote,
} from './dialogMessages'

function stubMsg(id: number, text: string): DialogMessageItem {
  return {
    id,
    date: '2026-01-01T00:00:00Z',
    sender_id: '1',
    sender_name: 'A',
    outgoing: false,
    content_type: 'text',
    has_media: false,
    has_photo: false,
    text,
    reactions: [],
  }
}

const baseDialog: DialogItem = {
  id: '100',
  entity_id: '100',
  title: 'Test Group',
  username: '',
  kind: 'group',
  is_private: false,
  is_group: true,
  is_channel: false,
  is_bot: false,
  link: '',
  unread_count: 10,
  read_inbox_max_id: 50,
  pinned: false,
  muted: false,
  date: '',
  last_message_id: 120,
  last_message: 'hello',
}

describe('messageCopyText', () => {
  it('returns plain text when available', () => {
    expect(
      messageCopyText({
        text: 'Hello world',
        has_photo: false,
        has_media: false,
        content_type: 'text',
      }),
    ).toBe('Hello world')
  })

  it('returns empty for photo without caption', () => {
    expect(
      messageCopyText({
        text: '[photo]',
        has_photo: true,
        has_media: true,
        content_type: 'photo',
      }),
    ).toBe('')
  })

  it('returns media label for non-text media', () => {
    expect(
      messageCopyText({
        text: '',
        has_photo: false,
        has_media: true,
        content_type: 'video',
      }),
    ).toBe('Video')
  })
})

describe('inferHasMoreOlder', () => {
  it('uses API flag when provided', () => {
    expect(inferHasMoreOlder(10, 100, false)).toBe(false)
    expect(inferHasMoreOlder(10, 100, true)).toBe(true)
  })

  it('infers more pages when message count reaches limit', () => {
    expect(inferHasMoreOlder(100, 100)).toBe(true)
    expect(inferHasMoreOlder(40, 100)).toBe(false)
  })
})

describe('isStaleMessagesRequest', () => {
  it('detects stale sequence', () => {
    expect(isStaleMessagesRequest(1, 'a', 2, 'a')).toBe(true)
  })

  it('detects stale dialog id', () => {
    expect(isStaleMessagesRequest(2, 'a', 2, 'b')).toBe(true)
  })

  it('accepts current request', () => {
    expect(isStaleMessagesRequest(2, 'a', 2, 'a')).toBe(false)
  })
})

describe('getUnreadMessagesInLoaded', () => {
  const messages = [{ id: 101 }, { id: 150 }, { id: 200 }]

  it('returns messages newer than read pointer', () => {
    expect(getUnreadMessagesInLoaded(messages, 120)).toEqual([{ id: 150 }, { id: 200 }])
  })
})

describe('planPartialMarkRead', () => {
    const messages = Array.from({ length: 30 }, (_, index) => ({ id: 1401 + index }))

  it('keeps unread outside loaded batch when more unread exist on server', () => {
    const plan = planPartialMarkRead(messages, 1000, 500)

    expect(plan).toEqual({
      maxId: 1430,
      markedInBatch: 30,
      remainingUnread: 470,
      syncToServer: false,
    })
  })

  it('syncs to server when all unread fit in loaded batch', () => {
    const batch = Array.from({ length: 30 }, (_, index) => ({ id: 1481 + index }))
    const plan = planPartialMarkRead(batch, 1480, 20)

    expect(plan).toEqual({
      maxId: 1510,
      markedInBatch: 30,
      remainingUnread: 0,
      syncToServer: true,
    })
  })
})

describe('mergeNewMessages', () => {
  it('appends only new ids and keeps sort order', () => {
    const prev = [stubMsg(1, 'a'), stubMsg(2, 'b')]
    const incoming = [stubMsg(2, 'dup'), stubMsg(3, 'c')]
    const merged = mergeNewMessages(prev, incoming)
    expect(merged.map((msg) => msg.id)).toEqual([1, 2, 3])
    expect(merged[1].text).toBe('b')
  })
})

describe('resolveReplyQuote', () => {
  const messages = [stubMsg(10, 'parent text')]
  messages[0].sender_name = 'Alice'

  it('returns null when no reply id', () => {
    expect(resolveReplyQuote({ reply_to_msg_id: null }, [])).toBeNull()
  })

  it('uses API quote text when present', () => {
    const quote = resolveReplyQuote(
      {
        reply_to_msg_id: 10,
        reply_to_text: 'quoted',
        reply_to_sender_name: 'Bob',
      },
      [],
    )
    expect(quote).toEqual({ id: 10, text: 'quoted', senderName: 'Bob' })
  })

  it('falls back to loaded parent message', () => {
    const quote = resolveReplyQuote({ reply_to_msg_id: 10 }, messages)
    expect(quote).toEqual({ id: 10, text: 'parent text', senderName: 'Alice' })
  })
})

describe('mergeDialogsWithStoredReadState', () => {
  it('clears unread when local read state caught up', () => {
    const merged = mergeDialogsWithStoredReadState([baseDialog], {
      100: { readMaxId: 120, at: Date.now() },
    })

    expect(merged[0].unread_count).toBe(0)
    expect(merged[0].read_inbox_max_id).toBe(120)
  })

  it('keeps server unread when local read is behind', () => {
    const merged = mergeDialogsWithStoredReadState([baseDialog], {
      100: { readMaxId: 60, at: Date.now() },
    })

    expect(merged[0].unread_count).toBe(10)
    expect(merged[0].read_inbox_max_id).toBe(50)
  })
})