import type { DialogItem, DialogMessageItem } from '../types/api'
import { mediaTypeLabel } from './avatar'

export const PINNED_MESSAGES_PAGE_SIZE = 30

export function messageCopyText(
  msg: Pick<DialogMessageItem, 'text' | 'has_photo' | 'has_media' | 'content_type'>,
): string {
  const raw = msg.text?.trim() ?? ''
  if (raw && raw !== '[photo]') return raw
  if (msg.has_photo || msg.content_type === 'photo') return ''
  if (msg.has_media) return mediaTypeLabel(msg.content_type)
  return ''
}

export function getUnreadMessagesInLoaded(
  messages: Pick<DialogMessageItem, 'id'>[],
  readMaxId: number,
): Pick<DialogMessageItem, 'id'>[] {
  if (readMaxId <= 0) return [...messages]
  return messages.filter((msg) => msg.id > readMaxId)
}

export type PartialMarkReadPlan = {
  maxId: number
  markedInBatch: number
  remainingUnread: number
  syncToServer: boolean
}

export function planPartialMarkRead(
  messages: Pick<DialogMessageItem, 'id'>[],
  readMaxId: number,
  openingUnread: number,
  explicitMaxId?: number,
): PartialMarkReadPlan | null {
  const latestLoadedId = messages[messages.length - 1]?.id ?? 0
  if (latestLoadedId <= 0) return null

  const unreadLoaded = getUnreadMessagesInLoaded(messages, readMaxId)
  if (unreadLoaded.length === 0) {
    const maxId =
      explicitMaxId && explicitMaxId > 0 ? explicitMaxId : latestLoadedId
    return {
      maxId,
      markedInBatch: 0,
      remainingUnread: 0,
      syncToServer: true,
    }
  }

  const newestUnreadInBatch = unreadLoaded[unreadLoaded.length - 1].id
  const maxId =
    explicitMaxId && explicitMaxId > 0
      ? Math.min(explicitMaxId, newestUnreadInBatch)
      : newestUnreadInBatch

  const markedInBatch = unreadLoaded.filter((msg) => msg.id <= maxId).length
  const opening = Math.max(0, openingUnread)
  const remainingUnread =
    opening > unreadLoaded.length
      ? Math.max(0, opening - markedInBatch)
      : Math.max(0, opening - markedInBatch)

  return {
    maxId,
    markedInBatch,
    remainingUnread,
    syncToServer: opening <= unreadLoaded.length,
  }
}

export function inferHasMoreOlder(
  messageCount: number,
  limit: number,
  apiValue?: boolean,
): boolean {
  if (typeof apiValue === 'boolean') return apiValue
  return messageCount >= limit
}

export function isStaleMessagesRequest(
  requestSeq: number,
  dialogId: string,
  currentSeq: number,
  currentDialogId: string | null,
): boolean {
  return requestSeq !== currentSeq || dialogId !== currentDialogId
}

export type StoredDialogRead = {
  readMaxId: number
  at: number
}

export function mergeSearchMessageResults(
  server: DialogMessageItem[],
  local: DialogMessageItem[],
): DialogMessageItem[] {
  const byId = new Map<number, DialogMessageItem>()
  for (const msg of server) byId.set(msg.id, msg)
  for (const msg of local) {
    if (!byId.has(msg.id)) byId.set(msg.id, msg)
  }
  return [...byId.values()].sort((a, b) => a.id - b.id)
}

export function mergeNewMessages(
  prev: DialogMessageItem[],
  incoming: DialogMessageItem[],
): DialogMessageItem[] {
  if (incoming.length === 0) return prev
  const existingIds = new Set(prev.map((msg) => msg.id))
  const uniqueNew = incoming.filter((msg) => !existingIds.has(msg.id))
  if (uniqueNew.length === 0) return prev
  return [...prev, ...uniqueNew].sort((a, b) => a.id - b.id)
}

export function applyEditedMessage(
  prev: DialogMessageItem[],
  edited: DialogMessageItem,
): DialogMessageItem[] {
  const index = prev.findIndex((msg) => msg.id === edited.id)
  if (index < 0) return prev
  const next = [...prev]
  next[index] = { ...next[index], ...edited }
  return next
}

export function applyDeletedMessage(
  prev: DialogMessageItem[],
  messageId: number,
): DialogMessageItem[] {
  if (!messageId) return prev
  return prev.filter((msg) => msg.id !== messageId)
}

export function applyMessageReactions(
  prev: DialogMessageItem[],
  messageId: number,
  reactions: DialogMessageItem['reactions'],
): DialogMessageItem[] {
  const index = prev.findIndex((msg) => msg.id === messageId)
  if (index < 0) return prev
  const next = [...prev]
  next[index] = { ...next[index], reactions: [...reactions] }
  return next
}

export type ReplyQuotePreview = {
  id: number
  text: string
  senderName: string
}

export function resolveReplyQuote(
  msg: Pick<
    DialogMessageItem,
    'reply_to_msg_id' | 'reply_to_text' | 'reply_to_sender_name'
  >,
  messages: DialogMessageItem[],
): ReplyQuotePreview | null {
  const replyId = msg.reply_to_msg_id
  if (!replyId || replyId < 1) return null

  const parent = messages.find((item) => item.id === replyId)
  const text =
    msg.reply_to_text?.trim() ||
    (parent ? messageCopyText(parent) || parent.text?.trim() : '') ||
    ''
  const senderName =
    msg.reply_to_sender_name?.trim() ||
    (parent
      ? parent.outgoing
        ? 'Bạn'
        : parent.sender_name || '—'
      : '')

  return {
    id: replyId,
    text: text || '[media]',
    senderName: senderName || '—',
  }
}

export function mergeDialogsWithStoredReadState(
  dialogs: DialogItem[],
  stored: Record<string, StoredDialogRead>,
): DialogItem[] {
  return dialogs.map((dialog) => {
    const local = stored[dialog.id]
    if (!local) return dialog

    const serverReadMax = dialog.read_inbox_max_id ?? 0
    const serverLastId = Number(dialog.last_message_id) || 0
    const caughtUp =
      local.readMaxId >= serverReadMax &&
      (serverLastId <= 0 || local.readMaxId >= serverLastId)

    if (caughtUp) {
      return {
        ...dialog,
        unread_count: 0,
        read_inbox_max_id: Math.max(serverReadMax, local.readMaxId),
      }
    }
    return dialog
  })
}