import { api } from '../api/client'
import type { TaskAction, ParsedTelegramLink } from './telegramLink'

export type TaskRowStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'error'
  | 'skipped'
  | 'cancelled'

export interface TaskProgressRow {
  phone: string
  status: TaskRowStatus
  message: string
}

export interface TaskRunOptions {
  phones: string[]
  action: TaskAction
  parsed: ParsedTelegramLink
  emoji: string
  text: string
  delaySeconds: number
  signal?: AbortSignal
  onProgress: (rows: TaskProgressRow[]) => void
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Cancelled', 'AbortError'))
      return
    }
    const timer = window.setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer)
        reject(new DOMException('Cancelled', 'AbortError'))
      },
      { once: true },
    )
  })
}

function resultMessage(
  action: TaskAction,
  data: { status?: string; message?: string } | null | undefined,
  fallback: string,
): string {
  if (!data) return fallback
  if (data.message) return data.message
  if (data.status === 'success') {
    if (action === 'join') return 'Đã join'
    if (action === 'react') return 'Đã thả reaction'
    if (action === 'reply') return 'Đã reply'
    return 'Đã gửi tin'
  }
  return fallback
}

async function runSingleTask(
  phone: string,
  action: TaskAction,
  parsed: ParsedTelegramLink,
  emoji: string,
  text: string,
): Promise<{ ok: boolean; message: string }> {
  if (action === 'join') {
    const res = await api.joinGroup(phone, parsed.groupLink || parsed.raw)
    if (!res.success || !res.data) {
      return { ok: false, message: res.error ?? 'Join thất bại' }
    }
    if (res.data.status === 'error') {
      return { ok: false, message: res.data.message }
    }
    return {
      ok: true,
      message: resultMessage(action, res.data, res.data.message || 'Đã join'),
    }
  }

  if (action === 'react') {
    if (!parsed.messageId) {
      return { ok: false, message: 'Link post thiếu message ID' }
    }
    const res = await api.sendReaction(
      phone,
      parsed.peerId,
      parsed.messageId,
      emoji,
    )
    if (!res.success || !res.data) {
      return { ok: false, message: res.error ?? 'Reaction thất bại' }
    }
    if (res.data.status === 'error') {
      return { ok: false, message: res.data.message }
    }
    return {
      ok: true,
      message: resultMessage(action, res.data, res.data.message || 'Đã react'),
    }
  }

  if (action === 'reply') {
    if (!parsed.messageId) {
      return { ok: false, message: 'Link post thiếu message ID' }
    }
    const res = await api.replyMessage(
      phone,
      parsed.peerId,
      parsed.messageId,
      text,
    )
    if (!res.success || !res.data) {
      return { ok: false, message: res.error ?? 'Reply thất bại' }
    }
    if (res.data.status === 'error') {
      return { ok: false, message: res.data.message }
    }
    return {
      ok: true,
      message: resultMessage(action, res.data, res.data.message || 'Đã reply'),
    }
  }

  const res = await api.sendMessage(phone, parsed.peerId, text)
  if (!res.success || !res.data) {
    return { ok: false, message: res.error ?? 'Gửi tin thất bại' }
  }
  if (res.data.status === 'error') {
    return { ok: false, message: res.data.message }
  }
  return {
    ok: true,
    message: resultMessage(action, res.data, res.data.message || 'Đã gửi'),
  }
}

export async function runTaskQueue(options: TaskRunOptions): Promise<TaskProgressRow[]> {
  const {
    phones,
    action,
    parsed,
    emoji,
    text,
    delaySeconds,
    signal,
    onProgress,
  } = options

  const rows: TaskProgressRow[] = phones.map((phone) => ({
    phone,
    status: 'pending',
    message: 'Chờ…',
  }))
  onProgress([...rows])

  for (let index = 0; index < phones.length; index += 1) {
    if (signal?.aborted) {
      for (let j = index; j < phones.length; j += 1) {
        if (rows[j].status === 'pending') {
          rows[j] = { ...rows[j], status: 'cancelled', message: 'Đã dừng' }
        }
      }
      onProgress([...rows])
      return rows
    }

    const phone = phones[index]
    rows[index] = { phone, status: 'running', message: 'Đang chạy…' }
    onProgress([...rows])

    try {
      const result = await runSingleTask(phone, action, parsed, emoji, text)
      rows[index] = {
        phone,
        status: result.ok ? 'success' : 'error',
        message: result.message,
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        rows[index] = { phone, status: 'cancelled', message: 'Đã dừng' }
        for (let j = index + 1; j < phones.length; j += 1) {
          rows[j] = { ...rows[j], status: 'cancelled', message: 'Đã dừng' }
        }
        onProgress([...rows])
        return rows
      }
      rows[index] = {
        phone,
        status: 'error',
        message: err instanceof Error ? err.message : 'Lỗi không xác định',
      }
    }

    onProgress([...rows])

    if (index < phones.length - 1 && delaySeconds > 0) {
      try {
        await sleep(delaySeconds * 1000, signal)
      } catch {
        for (let j = index + 1; j < phones.length; j += 1) {
          if (rows[j].status === 'pending') {
            rows[j] = { ...rows[j], status: 'cancelled', message: 'Đã dừng' }
          }
        }
        onProgress([...rows])
        return rows
      }
    }
  }

  return rows
}