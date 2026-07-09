import type { ApiEnvelope } from '../types/api'

export const API_BASE = '/api'

function toEnvelope<T>(response: Response, body: unknown): ApiEnvelope<T> {
  const data = body as ApiEnvelope<T> & { detail?: unknown }
  if (!response.ok) {
    const detail = data?.detail
    const message =
      typeof detail === 'string'
        ? detail
        : data?.error || `HTTP ${response.status}`
    return { success: false, data: null, error: message }
  }
  return data as ApiEnvelope<T>
}

export async function requestForm<T>(
  path: string,
  formData: FormData,
): Promise<ApiEnvelope<T>> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      body: formData,
    })
  } catch (err) {
    const hint =
      'Kiểm tra backend đang chạy và Vite proxy (vite.config.ts → VITE_API_PROXY_TARGET).'
    const msg = err instanceof Error ? err.message : 'Network error'
    throw new Error(`${msg}. ${hint}`)
  }

  try {
    return toEnvelope<T>(response, await response.json())
  } catch {
    throw new Error(
      `Phản hồi không hợp lệ từ API (HTTP ${response.status}). Có thể proxy trỏ sai port backend.`,
    )
  }
}

export async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<ApiEnvelope<T>> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      ...options,
    })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw err
    }
    const hint =
      'Kiểm tra backend đang chạy và Vite proxy (vite.config.ts → VITE_API_PROXY_TARGET).'
    const msg = err instanceof Error ? err.message : 'Network error'
    throw new Error(`${msg}. ${hint}`)
  }

  try {
    return toEnvelope<T>(response, await response.json())
  } catch {
    throw new Error(
      `Phản hồi không hợp lệ từ API (HTTP ${response.status}). Có thể proxy trỏ sai port backend.`,
    )
  }
}
