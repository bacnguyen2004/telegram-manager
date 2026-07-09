import type { HealthData } from '../types/api'
import { request } from './http'

export const healthApi = {
  health() {
    return request<HealthData>('/health')
  },
}
