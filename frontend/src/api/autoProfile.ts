import type {
  AutoProfileApplyData,
  AutoProfileApplyPayload,
  AutoProfilePreviewData,
  AutoProfilePreviewPayload,
} from '../types/api'
import { request } from './http'

export const autoProfileApi = {
  previewAutoProfiles(payload: AutoProfilePreviewPayload) {
    return request<AutoProfilePreviewData>('/auto-profile/preview', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  applyAutoProfile(payload: AutoProfileApplyPayload) {
    return request<AutoProfileApplyData>('/auto-profile/apply', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },
}
