import { useCallback, useState } from 'react'

/** Shared error/success banner state for the dialogs page. */
export function useDialogAlerts() {
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const resetAlerts = useCallback(() => {
    setError('')
    setSuccess('')
  }, [])

  return { error, success, setError, setSuccess, resetAlerts }
}
