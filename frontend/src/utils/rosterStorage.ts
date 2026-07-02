const STORAGE_KEY = 'telegram-manager:roster-v1'

export interface RosterColumn {
  key: string
  label: string
}

export interface RosterStore {
  columns: RosterColumn[]
  /** phone → column key → cell value */
  rows: Record<string, Record<string, string>>
}

export const DEFAULT_ROSTER_COLUMNS: RosterColumn[] = [
  { key: 'btse_uid', label: 'BTSE UID' },
  { key: 'btse_email', label: 'BTSE email' },
  { key: 'binance_uid', label: 'Binance UID' },
  { key: 'note', label: 'Ghi chú' },
]

const FIXED_EXPORT_HEADERS = [
  { key: '__phone', label: 'Số ĐT' },
  { key: '__name', label: 'Tên' },
  { key: '__username', label: 'Username' },
  { key: '__status', label: 'Trạng thái' },
  { key: '__synced', label: 'Kiểm tra lần cuối' },
] as const

function defaultStore(): RosterStore {
  return {
    columns: [...DEFAULT_ROSTER_COLUMNS],
    rows: {},
  }
}

export function loadRosterStore(): RosterStore {
  if (typeof window === 'undefined') return defaultStore()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultStore()
    const parsed = JSON.parse(raw) as Partial<RosterStore>
    const columns = Array.isArray(parsed.columns)
      ? parsed.columns.filter(
          (col): col is RosterColumn =>
            Boolean(col && typeof col.key === 'string' && typeof col.label === 'string'),
        )
      : [...DEFAULT_ROSTER_COLUMNS]
    const rows =
      parsed.rows && typeof parsed.rows === 'object' && !Array.isArray(parsed.rows)
        ? (parsed.rows as Record<string, Record<string, string>>)
        : {}
    return { columns: columns.length > 0 ? columns : [...DEFAULT_ROSTER_COLUMNS], rows }
  } catch {
    return defaultStore()
  }
}

export function saveRosterStore(store: RosterStore): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
}

export function slugifyColumnKey(label: string, existing: Set<string>): string {
  const base =
    label
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '') || 'column'

  let key = base
  let index = 2
  while (existing.has(key)) {
    key = `${base}_${index}`
    index += 1
  }
  return key
}

export function getCellValue(
  store: RosterStore,
  phone: string,
  columnKey: string,
): string {
  return store.rows[phone]?.[columnKey] ?? ''
}

export function getMergedRowFields(
  store: RosterStore,
  phone: string,
  apiFields?: Record<string, string> | null,
): Record<string, string> {
  const fromApi = apiFields ?? {}
  const fromStore = store.rows[phone] ?? {}
  return { ...fromApi, ...fromStore }
}

export function getMergedCellValue(
  store: RosterStore,
  phone: string,
  columnKey: string,
  apiFields?: Record<string, string> | null,
): string {
  return getMergedRowFields(store, phone, apiFields)[columnKey]?.trim() ?? ''
}

export type RosterFillFilter = 'all' | 'filled' | 'empty'

export function rowMatchesFillFilter(
  store: RosterStore,
  phone: string,
  columns: RosterColumn[],
  fillFilter: RosterFillFilter,
  columnScope: string,
  apiFields?: Record<string, string> | null,
): boolean {
  if (fillFilter === 'all') return true

  const merged = getMergedRowFields(store, phone, apiFields)
  const hasAnyFilled = columns.some((col) => Boolean(merged[col.key]?.trim()))

  if (columnScope !== 'all') {
    const hasColumnValue = Boolean(merged[columnScope]?.trim())
    return fillFilter === 'filled' ? hasColumnValue : !hasColumnValue
  }

  return fillFilter === 'filled' ? hasAnyFilled : !hasAnyFilled
}

export function rowMatchesRosterSearch(
  store: RosterStore,
  phone: string,
  columns: RosterColumn[],
  query: string,
  columnScope: string,
  fields: {
    phone: string
    name: string
    username: string
    status: string
  },
  apiFields?: Record<string, string> | null,
): boolean {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true

  const merged = getMergedRowFields(store, phone, apiFields)
  const tokens = normalized.split(/\s+/).filter(Boolean)

  function fieldHaystack(): string[] {
    if (columnScope === 'all') {
      return [
        fields.phone,
        fields.name,
        fields.username,
        fields.status,
        ...columns.map((col) => merged[col.key] ?? ''),
      ]
    }
    return [fields.phone, merged[columnScope] ?? '']
  }

  const haystack = fieldHaystack().join(' ').toLowerCase()
  return tokens.every((token) => haystack.includes(token))
}

export function setCellValue(
  store: RosterStore,
  phone: string,
  columnKey: string,
  value: string,
): RosterStore {
  const nextRows = { ...store.rows }
  const row = { ...(nextRows[phone] ?? {}) }
  const trimmed = value
  if (!trimmed) {
    delete row[columnKey]
  } else {
    row[columnKey] = trimmed
  }
  if (Object.keys(row).length === 0) {
    delete nextRows[phone]
  } else {
    nextRows[phone] = row
  }
  return { ...store, rows: nextRows }
}

export function addRosterColumn(store: RosterStore, label: string): RosterStore {
  const trimmed = label.trim()
  if (!trimmed) return store
  const existing = new Set(store.columns.map((col) => col.key))
  const key = slugifyColumnKey(trimmed, existing)
  return {
    ...store,
    columns: [...store.columns, { key, label: trimmed }],
  }
}

export function removeRosterColumn(store: RosterStore, columnKey: string): RosterStore {
  const nextRows: Record<string, Record<string, string>> = {}
  for (const [phone, row] of Object.entries(store.rows)) {
    if (!row[columnKey]) {
      nextRows[phone] = row
      continue
    }
    const copy = { ...row }
    delete copy[columnKey]
    if (Object.keys(copy).length > 0) nextRows[phone] = copy
  }
  return {
    columns: store.columns.filter((col) => col.key !== columnKey),
    rows: nextRows,
  }
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

export interface RosterExportRow {
  phone: string
  name: string
  username: string
  status: string
  synced: string
}

export function buildRosterCsv(
  store: RosterStore,
  rows: RosterExportRow[],
): string {
  const headers = [
    ...FIXED_EXPORT_HEADERS.map((col) => col.label),
    ...store.columns.map((col) => col.label),
  ]
  const headerKeys = [
    ...FIXED_EXPORT_HEADERS.map((col) => col.key),
    ...store.columns.map((col) => col.key),
  ]

  const lines = [headers.map(csvEscape).join(',')]
  for (const row of rows) {
    const values: Record<string, string> = {
      __phone: row.phone,
      __name: row.name,
      __username: row.username,
      __status: row.status,
      __synced: row.synced,
    }
    for (const col of store.columns) {
      values[col.key] = getCellValue(store, row.phone, col.key)
    }
    lines.push(headerKeys.map((key) => csvEscape(values[key] ?? '')).join(','))
  }
  return `${lines.join('\r\n')}\r\n`
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        current += ch
      }
      continue
    }
    if (ch === '"') {
      inQuotes = true
      continue
    }
    if (ch === ',') {
      cells.push(current)
      current = ''
      continue
    }
    current += ch
  }
  cells.push(current)
  return cells
}

export interface RosterCsvImportResult {
  store: RosterStore
  updatedPhones: number
  newColumns: number
}

export interface RosterApiImportPayload {
  new_column_labels: string[]
  rows: { phone: string; fields: Record<string, string> }[]
}

export function rosterDataToStore(
  columns: { column_key: string; label: string }[] | null | undefined,
  rows: { phone: string; custom_fields?: Record<string, string> | null }[] | null | undefined,
): RosterStore {
  const nextRows: Record<string, Record<string, string>> = {}
  for (const row of rows ?? []) {
    const fields = row.custom_fields ?? {}
    if (Object.keys(fields).length > 0) {
      nextRows[row.phone] = { ...fields }
    }
  }
  return {
    columns: (columns ?? []).map((col) => ({ key: col.column_key, label: col.label })),
    rows: nextRows,
  }
}

export function importRosterCsv(
  store: RosterStore,
  csvText: string,
  knownPhones: Set<string>,
): RosterCsvImportResult {
  const lines = csvText
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length < 2) {
    return { store, updatedPhones: 0, newColumns: 0 }
  }

  const headerCells = parseCsvLine(lines[0])
  const labelToKey = new Map<string, string>()
  for (const col of store.columns) {
    labelToKey.set(col.label.toLowerCase(), col.key)
  }
  for (const col of FIXED_EXPORT_HEADERS) {
    labelToKey.set(col.label.toLowerCase(), col.key)
  }

  let nextStore = { ...store, columns: [...store.columns], rows: { ...store.rows } }
  let newColumns = 0
  const columnKeys: (string | null)[] = headerCells.map((label) => {
    const normalized = label.trim().toLowerCase()
    const existing = labelToKey.get(normalized)
    if (existing) return existing
    const added = addRosterColumn(nextStore, label.trim())
    if (added.columns.length > nextStore.columns.length) newColumns += 1
    nextStore = added
    const created = added.columns[added.columns.length - 1]
    labelToKey.set(normalized, created.key)
    return created.key
  })

  const phoneIndex = columnKeys.indexOf('__phone')
  if (phoneIndex < 0) {
    return { store: nextStore, updatedPhones: 0, newColumns }
  }

  const updatedPhones = new Set<string>()
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line)
    const phone = (cells[phoneIndex] ?? '').trim()
    if (!phone || !knownPhones.has(phone)) continue

    for (let i = 0; i < columnKeys.length; i += 1) {
      const key = columnKeys[i]
      if (!key || key.startsWith('__')) continue
      const value = (cells[i] ?? '').trim()
      nextStore = setCellValue(nextStore, phone, key, value)
    }
    updatedPhones.add(phone)
  }

  return {
    store: nextStore,
    updatedPhones: updatedPhones.size,
    newColumns,
  }
}

export function parseRosterCsvForApi(
  store: RosterStore,
  csvText: string,
  knownPhones: Set<string>,
): RosterApiImportPayload {
  const parsed = importRosterCsv(store, csvText, knownPhones)
  const existingLabels = new Set(store.columns.map((col) => col.label.toLowerCase()))
  const newColumnLabels: string[] = []

  for (const col of parsed.store.columns) {
    if (!existingLabels.has(col.label.toLowerCase())) {
      newColumnLabels.push(col.label)
    }
  }

  const rows = Object.entries(parsed.store.rows).map(([phone, fields]) => ({
    phone,
    fields,
  }))

  return {
    new_column_labels: newColumnLabels,
    rows,
  }
}