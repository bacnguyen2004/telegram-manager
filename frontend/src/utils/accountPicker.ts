import type { SessionMetaOverviewItem } from '../types/api'
import { formatUsername, resolveSessionName } from './sessionDisplay'

export type AccountStatusFilter = 'all' | 'active' | 'unauthorized' | 'error' | 'unchecked'

export const ACCOUNT_STATUS_FILTER_OPTIONS: { id: AccountStatusFilter; label: string }[] = [
  { id: 'all', label: 'Tất cả' },
  { id: 'active', label: 'Live' },
  { id: 'unauthorized', label: 'Die' },
  { id: 'error', label: 'Lỗi' },
  { id: 'unchecked', label: 'Chưa rõ' },
]

export function resolveAccountStatus(meta: SessionMetaOverviewItem | undefined): string | null {
  if (meta?.status && meta.status !== 'unknown') return meta.status
  return null
}

export function resolveAccountPickerLabels(
  phone: string,
  meta: SessionMetaOverviewItem | undefined,
): { primary: string; secondary: string | null } {
  const name = resolveSessionName(meta)
  const username = formatUsername(meta?.username)
  if (name && username) return { primary: name, secondary: username }
  if (name) return { primary: name, secondary: phone }
  if (username) return { primary: username, secondary: phone }
  return { primary: phone, secondary: null }
}

export function accountMatchesSearch(
  phone: string,
  query: string,
  meta: SessionMetaOverviewItem | undefined,
): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const fields = [phone, meta?.username ?? '', meta?.display_name ?? '']
  return fields.some((field) => field.toLowerCase().includes(q))
}

export function accountMatchesStatusFilter(
  filter: AccountStatusFilter,
  meta: SessionMetaOverviewItem | undefined,
): boolean {
  if (filter === 'all') return true
  const status = resolveAccountStatus(meta)
  if (filter === 'unchecked') return !status
  return status === filter
}

export function filterAccountPhones(
  sessions: string[],
  search: string,
  statusFilter: AccountStatusFilter,
  getMeta: (phone: string) => SessionMetaOverviewItem | undefined,
): string[] {
  return sessions.filter((phone) => {
    const meta = getMeta(phone)
    return accountMatchesSearch(phone, search, meta) && accountMatchesStatusFilter(statusFilter, meta)
  })
}

export function computeAccountFilterCounts(
  sessions: string[],
  search: string,
  getMeta: (phone: string) => SessionMetaOverviewItem | undefined,
): Record<AccountStatusFilter, number> {
  const counts: Record<AccountStatusFilter, number> = {
    all: 0,
    active: 0,
    unauthorized: 0,
    error: 0,
    unchecked: 0,
  }
  const searchMatched = sessions.filter((phone) => accountMatchesSearch(phone, search, getMeta(phone)))
  for (const phone of searchMatched) {
    counts.all += 1
    const status = resolveAccountStatus(getMeta(phone))
    if (!status) {
      counts.unchecked += 1
      continue
    }
    if (status === 'active') counts.active += 1
    else if (status === 'unauthorized') counts.unauthorized += 1
    else if (status === 'error') counts.error += 1
  }
  return counts
}