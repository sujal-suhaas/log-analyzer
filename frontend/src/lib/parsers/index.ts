import { lineAt, type LogFile } from '../read-log-file'
import { access } from './access'
import { createCsvReader, csvRecord } from './csv'
import { jsonl } from './jsonl'
import { plain } from './plain'
import { syslog } from './syslog'
import { CORE_FIELDS, type ParsedDataset, type ParsedRecord, type ParserId } from './types'

export const PARSERS = [
  { id: 'plain', label: 'Plain text' },
  { id: 'jsonl', label: 'JSON Lines / NDJSON' },
  { id: 'csv', label: 'CSV (header row)' },
  { id: 'access', label: 'Apache / Nginx access' },
  { id: 'syslog', label: 'Syslog' },
] as const
export type { ParserId, ParsedDataset } from './types'

export function recordRaw(log: LogFile, row: number, endRow = row): string {
  if (row === endRow) return lineAt(log, row)
  return log.text.slice(log.starts[row], log.starts[endRow] + lineAt(log, endRow).length)
}

export async function parseDataset(log: LogFile, parser: ParserId, signal = new AbortController().signal, onProgress: (rows: number) => void = () => {}): Promise<ParsedDataset> {
  const result: ParsedDataset = { parser, records: [], extras: [], failed: 0, skipped: 0 }
  const extras = new Set<string>(), core = new Set<string>(CORE_FIELDS)
  const parseLine = { jsonl, access, syslog, plain }
  let csv = createCsvReader(), columns: string[] | undefined, headerError = '', start = 0
  let sliceStart = performance.now()
  for (let row = 0; row < log.starts.length; row++) {
    signal.throwIfAborted()
    const line = lineAt(log, row)
    let entry: ParsedRecord | undefined
    try {
      if (start === row && !line.trim()) { result.skipped++; start = row + 1 }
      else if (parser === 'csv') {
        const values = csv(line)
        if (values) {
          if (!columns) {
            columns = values.map(v => v.trim())
            if (columns.some(v => !v) || new Set(columns).size !== columns.length) {
              headerError = 'CSV header names must be nonempty and unique'
              throw new Error(headerError)
            }
            result.skipped++
          } else {
            if (headerError) throw new Error(headerError)
            entry = { row: start, endRow: row, record: csvRecord(columns, values, recordRaw(log, start, row)) }
          }
          start = row + 1
        } else if (row === log.starts.length - 1) throw new Error('Unclosed CSV quoted field')
      } else {
        const record = parseLine[parser](line)
        if (!record) throw new Error('Unrecognized format')
        entry = { row, endRow: row, record }
        start = row + 1
      }
    } catch (error) {
      entry = { row: start, endRow: row, record: { message: recordRaw(log, start, row) }, failed: error instanceof Error ? error.message : 'Parse error' }
      start = row + 1; csv = createCsvReader()
    }
    if (entry) {
      if (entry.failed) result.failed++
      else for (const key of Object.keys(entry.record)) if (!core.has(key)) extras.add(key)
      result.records.push(entry)
    }
    // ponytail: cooperative main-thread batches; single huge records can still pause UI. Worker in Phase 3.
    if (row % 100 === 0 && performance.now() - sliceStart > 8) {
      onProgress(row + 1)
      await new Promise(resolve => setTimeout(resolve, 0))
      sliceStart = performance.now()
    }
  }
  signal.throwIfAborted()
  onProgress(log.starts.length)
  result.extras = [...extras].sort()
  return result
}
