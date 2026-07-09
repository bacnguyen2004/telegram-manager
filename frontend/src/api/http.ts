import type { ApiEnvelope } from '../types/api'

export const API_BASE = '/api'

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
    return (await response.json()) as ApiEnvelope<T>
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
    return (await response.json()) as ApiEnvelope<T>
  } catch {
    throw new Error(
      `Phản hồi không hợp lệ từ API (HTTP ${response.status}). Có thể proxy trỏ sai port backend.`,
    )
  }
}
