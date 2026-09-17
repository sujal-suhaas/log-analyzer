import { normalize } from './types'

// Stateful RFC 4180 cells: preserves quoted newlines, escaped quotes and empty fields.
export function createCsvReader() {
  let values: string[] = [], cell = '', state: 'start' | 'plain' | 'quoted' | 'closed' = 'start'
  return (line: string): string[] | null => {
    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      if (state === 'quoted') {
        if (char === '"') {
          if (line[i + 1] === '"') { cell += '"'; i++ } else state = 'closed'
        } else cell += char
      } else if (char === ',') {
        values.push(cell); cell = ''; state = 'start'
      } else if (char === '"' && state === 'start') state = 'quoted'
      else if (state === 'closed' || char === '"') throw new Error('Invalid CSV quoting')
      else { cell += char; state = 'plain' }
    }
    if (state === 'quoted') { cell += '\n'; return null }
    values.push(cell)
    const result = values
    values = []; cell = ''; state = 'start'
    return result
  }
}

export function csvRecord(columns: string[], values: string[], raw: string) {
  if (values.length !== columns.length) throw new Error(`Expected ${columns.length} CSV fields; found ${values.length}`)
  return normalize(Object.fromEntries(columns.map((column, i) => [column, values[i]])), raw)
}
