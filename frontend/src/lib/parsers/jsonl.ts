import type { LineParser } from './types'
import { normalize } from './types'

export const jsonl: LineParser = line => {
  const value: unknown = JSON.parse(line)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Expected a JSON object')
  return normalize(value as Record<string, unknown>, line)
}
