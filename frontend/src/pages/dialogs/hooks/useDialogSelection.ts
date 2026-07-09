import { useCallback, useState } from 'react'

/** Multi-select mode for bulk forward / bulk delete in the chat thread. */
export function useDialogSelection() {
  const [selectMode, setSelectMode] = useState(false)
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<number>>(
    () => new Set(),
  )

  const exitSelectionMode = useCallback(() => {
    setSelectMode(false)
    setSelectedMessageIds(new Set())
  }, [])

  const enterSelectMode = useCallback((initialMessageId?: number) => {
    setSelectMode(true)
    setSelectedMessageIds(
      initialMessageId ? new Set([initialMessageId]) : new Set(),
    )
  }, [])

  const toggleMessageSelection = useCallback((messageId: number) => {
    setSelectedMessageIds((prev) => {
      const next = new Set(prev)
      if (next.has(messageId)) next.delete(messageId)
      else next.add(messageId)
      return next
    })
  }, [])

  const clearSelectionIds = useCallback(() => {
    setSelectedMessageIds(new Set())
  }, [])

  return {
    selectMode,
    selectedMessageIds,
    setSelectedMessageIds,
    enterSelectMode,
    exitSelectionMode,
    toggleMessageSelection,
    clearSelectionIds,
  }
}
