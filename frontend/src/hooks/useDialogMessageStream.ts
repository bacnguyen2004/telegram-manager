import { useEffect, useRef } from 'react'
import type { DialogMessageItem, DialogMessageReactionItem } from '../types/api'
import { api } from '../api/client'

export type DialogPreviewPatch = {
  peer_id: string
  last_message: string
  last_message_id: number | string
  date?: string
}

type UseDialogMessageStreamOptions = {
  phone: string
  peerId: string
  minId: number
  enabled?: boolean
  onMessages: (messages: DialogMessageItem[], preview: DialogPreviewPatch | null) => void
  onError?: () => void
  onResyncRequired?: (cursor: number) => void
  onMessageEdited?: (message: DialogMessageItem) => void
  onMessageDeleted?: (messageId: number) => void
  onReaction?: (messageId: number, reactions: DialogMessageReactionItem[]) => void
  onRead?: (maxId: number, unreadCount: number) => void
}

type StreamPayload = {
  type: string
  messages?: DialogMessageItem[]
  message?: DialogMessageItem | string
  message_id?: number
  reactions?: DialogMessageReactionItem[]
  dialog_preview?: DialogPreviewPatch | null
  cursor?: number
  max_id?: number
  unread_count?: number
}

const DIALOG_STREAM_TRANSPORT =
  (import.meta.env.VITE_DIALOG_STREAM_TRANSPORT as 'ws' | 'sse' | undefined) ?? 'ws'

const WS_RECONNECT_BASE_MS = 1000
const WS_RECONNECT_MAX_MS = 30_000

function buildWsUrl(path: string) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}${path}`
}

function trackLastSeenId(lastSeenIdRef: { current: number }, messages: DialogMessageItem[]) {
  for (const msg of messages) {
    if (msg.id > lastSeenIdRef.current) {
      lastSeenIdRef.current = msg.id
    }
  }
}

function handleStreamPayload(
  payload: StreamPayload,
  handlers: {
    onMessages: (messages: DialogMessageItem[], preview: DialogPreviewPatch | null) => void
    onError?: () => void
    onResyncRequired?: (cursor: number) => void
    onMessageEdited?: (message: DialogMessageItem) => void
    onMessageDeleted?: (messageId: number) => void
    onReaction?: (messageId: number, reactions: DialogMessageReactionItem[]) => void
    onRead?: (maxId: number, unreadCount: number) => void
  },
  lastSeenIdRef: { current: number },
): boolean {
  if (payload.type === 'messages') {
    const incoming = payload.messages ?? []
    if (incoming.length === 0) return false
    trackLastSeenId(lastSeenIdRef, incoming)
    handlers.onMessages(incoming, payload.dialog_preview ?? null)
    return true
  }
  if (payload.type === 'edited' && payload.message && typeof payload.message === 'object') {
    const edited = payload.message as DialogMessageItem
    if (edited.id > lastSeenIdRef.current) {
      lastSeenIdRef.current = edited.id
    }
    handlers.onMessageEdited?.(edited)
    return false
  }
  if (payload.type === 'deleted') {
    const messageId = Number(payload.message_id)
    if (Number.isFinite(messageId) && messageId > 0) {
      handlers.onMessageDeleted?.(messageId)
    }
    return false
  }
  if (payload.type === 'reaction') {
    const messageId = Number(payload.message_id)
    if (Number.isFinite(messageId) && messageId > 0) {
      handlers.onReaction?.(messageId, payload.reactions ?? [])
    }
    return false
  }
  if (payload.type === 'read') {
    const maxId = Number(payload.max_id)
    if (Number.isFinite(maxId) && maxId > 0) {
      handlers.onRead?.(maxId, Number(payload.unread_count) || 0)
    }
    return false
  }
  if (payload.type === 'resync_required') {
    const cursor = Number(payload.cursor)
    handlers.onResyncRequired?.(Number.isFinite(cursor) ? cursor : 0)
    return false
  }
  if (payload.type === 'error') {
    handlers.onError?.()
  }
  return false
}

export function useDialogMessageStream({
  phone,
  peerId,
  minId,
  enabled = true,
  onMessages,
  onError,
  onResyncRequired,
  onMessageEdited,
  onMessageDeleted,
  onReaction,
  onRead,
}: UseDialogMessageStreamOptions) {
  const onMessagesRef = useRef(onMessages)
  const onErrorRef = useRef(onError)
  const onResyncRequiredRef = useRef(onResyncRequired)
  const onMessageEditedRef = useRef(onMessageEdited)
  const onMessageDeletedRef = useRef(onMessageDeleted)
  const onReactionRef = useRef(onReaction)
  const onReadRef = useRef(onRead)

  useEffect(() => {
    onMessagesRef.current = onMessages
  }, [onMessages])
  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])
  useEffect(() => {
    onResyncRequiredRef.current = onResyncRequired
  }, [onResyncRequired])
  useEffect(() => {
    onMessageEditedRef.current = onMessageEdited
  }, [onMessageEdited])
  useEffect(() => {
    onMessageDeletedRef.current = onMessageDeleted
  }, [onMessageDeleted])
  useEffect(() => {
    onReactionRef.current = onReaction
  }, [onReaction])
  useEffect(() => {
    onReadRef.current = onRead
  }, [onRead])

  const minIdRef = useRef(minId)
  minIdRef.current = minId
  const lastSeenIdRef = useRef(0)

  useEffect(() => {
    if (minIdRef.current > lastSeenIdRef.current) {
      lastSeenIdRef.current = minIdRef.current
    }
  }, [minId])

  useEffect(() => {
    if (!enabled || !phone || !peerId || minIdRef.current < 1) return

    let cancelled = false
    let socket: WebSocket | null = null
    let source: EventSource | null = null
    let reconnectTimer: number | null = null
    let reconnectAttempt = 0

    const handlers = () => ({
      onMessages: onMessagesRef.current,
      onError: onErrorRef.current,
      onResyncRequired: onResyncRequiredRef.current,
      onMessageEdited: onMessageEditedRef.current,
      onMessageDeleted: onMessageDeletedRef.current,
      onReaction: onReactionRef.current,
      onRead: onReadRef.current,
    })

    const clearReconnect = () => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
    }

    const scheduleReconnect = () => {
      if (cancelled) return
      const delay = Math.min(
        WS_RECONNECT_MAX_MS,
        WS_RECONNECT_BASE_MS * 2 ** reconnectAttempt,
      )
      reconnectAttempt += 1
      reconnectTimer = window.setTimeout(connect, delay)
    }

    const sendResume = (ws: WebSocket) => {
      if (lastSeenIdRef.current < 1) return
      try {
        ws.send(
          JSON.stringify({
            type: 'resume',
            last_seen_id: lastSeenIdRef.current,
          }),
        )
      } catch {
        onErrorRef.current?.()
      }
    }

    const connectWebSocket = () => {
      if (cancelled) return

      const url = buildWsUrl(
        api.dialogMessageWsUrl(
          phone,
          peerId,
          minIdRef.current,
          lastSeenIdRef.current,
        ),
      )
      socket = new WebSocket(url)

      socket.onopen = () => {
        if (socket && socket.readyState === WebSocket.OPEN) {
          sendResume(socket)
        }
      }

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as StreamPayload
          const received = handleStreamPayload(payload, handlers(), lastSeenIdRef)
          if (received) reconnectAttempt = 0
        } catch {
          onErrorRef.current?.()
        }
      }

      socket.onerror = () => {
        onErrorRef.current?.()
      }

      socket.onclose = () => {
        socket = null
        if (!cancelled) scheduleReconnect()
      }
    }

    const connectEventSource = () => {
      if (cancelled) return

      const url = api.dialogMessageStreamUrl(phone, peerId, minIdRef.current)
      source = new EventSource(url)

      source.addEventListener('messages', (event) => {
        try {
          const payload = JSON.parse(event.data) as StreamPayload
          handleStreamPayload(payload, handlers(), lastSeenIdRef)
        } catch {
          onErrorRef.current?.()
        }
      })

      source.addEventListener('error', (event) => {
        try {
          const messageEvent = event as MessageEvent<string>
          if (!messageEvent.data) return
          const payload = JSON.parse(messageEvent.data) as StreamPayload
          if (payload.type === 'error' || payload.message) {
            onErrorRef.current?.()
          }
        } catch {
          onErrorRef.current?.()
        }
      })

      source.onerror = () => {
        onErrorRef.current?.()
      }
    }

    const connect = () => {
      if (DIALOG_STREAM_TRANSPORT === 'sse') {
        connectEventSource()
      } else {
        connectWebSocket()
      }
    }

    connect()

    return () => {
      cancelled = true
      clearReconnect()
      socket?.close()
      source?.close()
    }
  }, [enabled, phone, peerId])
}