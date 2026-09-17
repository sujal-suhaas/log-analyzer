export type ParserId = 'jsonl' | 'access' | 'syslog' | 'plain' | 'csv'

// Raw text lives once in LogFile; source row ranges retain the original content.
export type LogRecord = {
  timestamp?: string
  level?: string
  service?: string
  host?: string
  status?: number
  duration_ms?: number
  message: string
  [key: string]: unknown
}
export type ParsedRecord = { row: number; endRow: number; record: LogRecord; failed?: string }
export type ParsedDataset = { parser: ParserId; records: ParsedRecord[]; extras: string[]; failed: number; skipped: number }
export type LineParser = (line: string) => LogRecord | null
export const CORE_FIELDS = ['timestamp', 'level', 'service', 'host', 'status', 'duration_ms', 'message'] as const

export function displayValue(value: unknown): string {
  if (value === undefined || value === null) return ''
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

export function sniffLevel(message: string): string | undefined {
  return /\b(FATAL|ERROR|WARNING|WARN|INFO|DEBUG|TRACE|CRITICAL|CRIT|NOTICE|ALERT|EMERG)\b/i.exec(message)?.[1].toUpperCase().replace('WARNING', 'WARN')
}

export function normalize(value: Record<string, unknown>, raw: string): LogRecord {
  const record: LogRecord = { ...value, message: value.message == null ? raw : displayValue(value.message) }
  for (const key of ['level', 'service', 'host'] as const) {
    if (record[key] == null || record[key] === '') { delete record[key]; continue }
    if (typeof record[key] !== 'string') throw new Error(`${key} must be text`)
  }
  if (record.level) record.level = record.level.toUpperCase().replace(/^WARNING$/, 'WARN').replace(/^ERR$/, 'ERROR')
  for (const key of ['status', 'duration_ms'] as const) {
    const input = value[key]
    if (input == null || input === '') { delete record[key]; continue }
    if ((typeof input !== 'number' && typeof input !== 'string') || String(input).trim() === '') throw new Error(`Invalid ${key}`)
    const n = Number(input)
    if (!Number.isFinite(n) || n < 0 || (key === 'status' && (!Number.isInteger(n) || n < 100 || n > 599))) throw new Error(`Invalid ${key}`)
    record[key] = n
  }
  if (value.timestamp == null || value.timestamp === '') delete record.timestamp
  else {
    // Never guess epoch units, timezone, or ambiguous locale date formats.
    const timestamp = String(value.timestamp)
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/.test(timestamp)) throw new Error('Timestamp must be ISO 8601 with timezone')
    const date = new Date(timestamp)
    const day = +timestamp.slice(8, 10), month = +timestamp.slice(5, 7), year = +timestamp.slice(0, 4)
    if (!Number.isFinite(date.getTime()) || month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) throw new Error('Invalid timestamp')
    record.timestamp = date.toISOString()
  }
  return record
}
