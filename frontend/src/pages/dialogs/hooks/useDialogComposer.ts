import { useCallback, useEffect, useRef, useState } from 'react'
import { clearDraft, loadDraft, saveDraft } from '../../../utils/dialogDraftStorage'
import {
  CHAT_MEDIA_ACCEPT,
  chatMediaKindLabel,
  detectChatMediaKind,
  validateChatMediaFile,
  type ChatMediaKind,
} from '../../../utils/chatMedia'
import type { DialogMessageItem } from '../../../types/api'
import { messageCopyText } from '../../../utils/dialogMessages'

type Alerts = {
  setError: (msg: string) => void
  setSuccess: (msg: string) => void
  resetAlerts: () => void
}

/**
 * Draft text, reply/edit targets, and media attach for the compose bar.
 * Send/API actions stay in the page (need phone/selected/messages).
 */
export function useDialogComposer(
  phone: string,
  selectedId: string | null,
  alerts: Alerts,
) {
  const [draftText, setDraftText] = useState('')
  const [replyTo, setReplyTo] = useState<DialogMessageItem | null>(null)
  const [editingMessage, setEditingMessage] = useState<DialogMessageItem | null>(null)
  const [selectedMedia, setSelectedMedia] = useState<File | null>(null)
  const [selectedMediaKind, setSelectedMediaKind] = useState<ChatMediaKind | null>(null)
  const [mediaPreview, setMediaPreview] = useState<string | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const composeInputRef = useRef<HTMLTextAreaElement>(null)
  const draftSaveTimerRef = useRef<number | null>(null)

  const clearSelectedMedia = useCallback(() => {
    if (mediaPreview) URL.revokeObjectURL(mediaPreview)
    setSelectedMedia(null)
    setSelectedMediaKind(null)
    setMediaPreview(null)
    if (imageInputRef.current) imageInputRef.current.value = ''
  }, [mediaPreview])

  useEffect(() => {
    return () => {
      if (mediaPreview) URL.revokeObjectURL(mediaPreview)
    }
  }, [mediaPreview])

  useEffect(() => {
    if (!phone || !selectedId) return
    if (draftSaveTimerRef.current) window.clearTimeout(draftSaveTimerRef.current)
    draftSaveTimerRef.current = window.setTimeout(() => {
      saveDraft(phone, selectedId, draftText)
    }, 400)
    return () => {
      if (draftSaveTimerRef.current) window.clearTimeout(draftSaveTimerRef.current)
    }
  }, [phone, selectedId, draftText])

  useEffect(() => {
    return () => {
      if (draftSaveTimerRef.current) window.clearTimeout(draftSaveTimerRef.current)
    }
  }, [])

  const canEditMessage = useCallback((msg: DialogMessageItem) => {
    if (!msg.outgoing) return false
    return messageCopyText(msg).length > 0
  }, [])

  const clearSelectedMediaAndDraftMedia = useCallback(() => {
    clearSelectedMedia()
  }, [clearSelectedMedia])

  const startEditMessage = useCallback(
    (msg: DialogMessageItem) => {
      if (!canEditMessage(msg)) return
      setEditingMessage(msg)
      setReplyTo(null)
      setDraftText(messageCopyText(msg))
      clearSelectedMediaAndDraftMedia()
      alerts.resetAlerts()
      window.setTimeout(() => composeInputRef.current?.focus(), 0)
    },
    [alerts, canEditMessage, clearSelectedMediaAndDraftMedia],
  )

  const cancelEdit = useCallback(() => {
    setEditingMessage(null)
    if (phone && selectedId) {
      setDraftText(loadDraft(phone, selectedId))
    } else {
      setDraftText('')
    }
  }, [phone, selectedId])

  const handleReplyToMessage = useCallback(
    (msg: DialogMessageItem) => {
      setReplyTo(msg)
      setDraftText('')
      alerts.resetAlerts()
    },
    [alerts],
  )

  function applySelectedMediaFile(file: File) {
    const validationError = validateChatMediaFile(file)
    if (validationError) {
      alerts.setError(validationError)
      clearSelectedMedia()
      return false
    }
    const kind = detectChatMediaKind(file)
    if (!kind) {
      alerts.setError('Không nhận dạng được loại file.')
      clearSelectedMedia()
      return false
    }
    alerts.resetAlerts()
    if (mediaPreview) URL.revokeObjectURL(mediaPreview)
    setSelectedMedia(file)
    setSelectedMediaKind(kind)
    setMediaPreview(kind === 'image' ? URL.createObjectURL(file) : null)
    return true
  }

  function normalizePastedFile(file: File, mimeType: string): File {
    const type = (mimeType || file.type || 'image/png').split(';')[0].trim().toLowerCase()
    if (file.name && file.name !== 'image.png' && !file.name.startsWith('blob')) {
      return file
    }
    const ext =
      type === 'image/jpeg'
        ? 'jpg'
        : type === 'image/webp'
          ? 'webp'
          : type === 'image/gif'
            ? 'gif'
            : type === 'video/mp4'
              ? 'mp4'
              : type === 'video/webm'
                ? 'webm'
                : 'png'
    return new File([file], `paste-${Date.now()}.${ext}`, { type })
  }

  function handleMediaSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    applySelectedMediaFile(file)
  }

  function handleComposePaste(
    e: React.ClipboardEvent<HTMLTextAreaElement>,
    opts: { sending: boolean; loadingMessages: boolean },
  ) {
    if (opts.sending || opts.loadingMessages) return

    const items = e.clipboardData?.items
    if (!items?.length) return

    for (const item of items) {
      if (item.kind !== 'file') continue
      const raw = item.getAsFile()
      if (!raw) continue

      const mimeType = (item.type || raw.type || '').split(';')[0].trim().toLowerCase()
      const file = normalizePastedFile(raw, mimeType)
      if (!detectChatMediaKind(file)) continue

      if (editingMessage) {
        e.preventDefault()
        alerts.setError('Không sửa tin kèm file mới — chỉ sửa chữ')
        return
      }

      e.preventDefault()
      applySelectedMediaFile(file)
      return
    }
  }

  function loadDraftForDialog(nextPhone: string, dialogId: string) {
    setDraftText(loadDraft(nextPhone, dialogId))
    setReplyTo(null)
    setEditingMessage(null)
    clearSelectedMedia()
  }

  function clearComposerState() {
    setDraftText('')
    setReplyTo(null)
    setEditingMessage(null)
    clearSelectedMedia()
  }

  function afterSendSuccess() {
    setDraftText('')
    setReplyTo(null)
    setEditingMessage(null)
    clearSelectedMedia()
    if (phone && selectedId) clearDraft(phone, selectedId)
  }

  return {
    draftText,
    setDraftText,
    replyTo,
    setReplyTo,
    editingMessage,
    setEditingMessage,
    selectedMedia,
    selectedMediaKind,
    mediaPreview,
    imageInputRef,
    composeInputRef,
    CHAT_MEDIA_ACCEPT,
    chatMediaKindLabel,
    clearSelectedMedia,
    canEditMessage,
    startEditMessage,
    cancelEdit,
    handleReplyToMessage,
    handleMediaSelect,
    handleComposePaste,
    loadDraftForDialog,
    clearComposerState,
    afterSendSuccess,
  }
}
