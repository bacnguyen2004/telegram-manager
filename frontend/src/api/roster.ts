import type {
  RosterColumnItem,
  RosterData,
  RosterImportResult,
  RosterRowItem,
} from '../types/api'
import { request } from './http'

export const rosterApi = {
  getRoster() {
    return request<RosterData>('/roster')
  },

  patchRosterRow(phone: string, fields: Record<string, string>) {
    return request<RosterRowItem>(`/roster/${encodeURIComponent(phone)}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields }),
    })
  },

  createRosterColumn(label: string) {
    return request<RosterColumnItem>('/roster/columns', {
      method: 'POST',
      body: JSON.stringify({ label }),
    })
  },

  renameRosterColumn(columnKey: string, label: string) {
    return request<RosterColumnItem>(
      `/roster/columns/${encodeURIComponent(columnKey)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ label }),
      },
    )
  },

  deleteRosterColumn(columnKey: string) {
    return request<{ column_key: string }>(
      `/roster/columns/${encodeURIComponent(columnKey)}`,
      { method: 'DELETE' },
    )
  },

  importRoster(payload: {
    new_column_labels: string[]
    rows: { phone: string; fields: Record<string, string> }[]
  }) {
    return request<RosterImportResult>('/roster/import', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },
}
