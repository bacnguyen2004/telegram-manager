import { describe, expect, it } from 'vitest'
import {
  getMergedCellValue,
  rowMatchesFillFilter,
  rowMatchesRosterSearch,
  type RosterStore,
} from './rosterStorage'

const store: RosterStore = {
  columns: [
    { key: 'btse_uid', label: 'BTSE UID' },
    { key: 'note', label: 'Ghi chú' },
  ],
  rows: {
    '+84111': { btse_uid: 'live-edit' },
  },
}

describe('roster filter helpers', () => {
  it('merges API fields with local store edits', () => {
    expect(
      getMergedCellValue(store, '+84111', 'btse_uid', { btse_uid: 'api', note: 'x' }),
    ).toBe('live-edit')
    expect(getMergedCellValue(store, '+84222', 'note', { note: 'from-api' })).toBe('from-api')
  })

  it('filters filled rows by any column or selected column', () => {
    expect(
      rowMatchesFillFilter(store, '+84111', store.columns, 'filled', 'all', {}),
    ).toBe(true)
    expect(
      rowMatchesFillFilter(store, '+84222', store.columns, 'filled', 'all', {}),
    ).toBe(false)
    expect(
      rowMatchesFillFilter(store, '+84111', store.columns, 'filled', 'note', {}),
    ).toBe(false)
    expect(
      rowMatchesFillFilter(store, '+84111', store.columns, 'empty', 'btse_uid', {}),
    ).toBe(false)
  })

  it('searches within a selected column scope', () => {
    const fields = {
      phone: '+84111',
      name: 'A',
      username: '@a',
      status: 'active',
    }

    expect(
      rowMatchesRosterSearch(store, '+84111', store.columns, 'live', 'btse_uid', fields, {}),
    ).toBe(true)
    expect(
      rowMatchesRosterSearch(store, '+84111', store.columns, 'missing', 'btse_uid', fields, {}),
    ).toBe(false)
    expect(
      rowMatchesRosterSearch(store, '+84111', store.columns, '84111 live', 'all', fields, {
        note: 'extra',
      }),
    ).toBe(true)
  })
})