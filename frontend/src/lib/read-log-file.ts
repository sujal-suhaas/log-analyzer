export const MAX_BYTES = 50 * 1024 * 1024
export const MAX_LINES = 1_000_000
export const ACCEPT = '.log,.txt,.json,.csv,.jsonl,.ndjson'
export type LogFile = { name: string; size: number; text: string; starts: Uint32Array }
export type ImportProgress = { bytes: number; lines: number }

export function lineAt(log: LogFile, index: number): string {
  const start = log.starts[index]
  if (start === undefined) return ''
  let end = log.starts[index + 1] ?? log.text.length
  if (log.text[end - 1] === '\n') end--
  if (log.text[end - 1] === '\r') end--
  return log.text.slice(start, end)
}

export async function readLogFile(
  file: File,
  signal: AbortSignal,
  onProgress: (progress: ImportProgress) => void,
  chunkSize = 256 * 1024,
): Promise<LogFile> {
  if (!ACCEPT.split(',').some(ext => file.name.toLowerCase().endsWith(ext))) {
    throw new Error('Choose a .log, .txt, .json, .csv, .jsonl or .ndjson file.')
  }
  if (file.size > MAX_BYTES) throw new Error('File exceeds the 50 MB import limit.')
  if (chunkSize < 1) throw new Error('Chunk size must be positive.')
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const parts: string[] = []
  const starts = [0]
  let length = 0
  // ponytail: in-memory text + offsets, capped at 50 MB/1M lines; Worker/OPFS in later phases.
  for (let offset = 0; offset < file.size; offset += chunkSize) {
    signal.throwIfAborted()
    const end = Math.min(offset + chunkSize, file.size)
    const bytes = await file.slice(offset, end).arrayBuffer()
    signal.throwIfAborted()
    const text = decoder.decode(bytes, { stream: end < file.size })
    if (text.includes('\0')) throw new Error('Binary or UTF-16 content detected. Use UTF-8 text.')
    for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) {
      starts.push(length + i + 1)
      if (starts.length > MAX_LINES + 1) throw new Error('Phase 1 supports up to 1,000,000 lines per file.')
    }
    parts.push(text)
    length += text.length
    onProgress({ bytes: end, lines: starts.length - (starts.at(-1) === length ? 1 : 0) })
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  signal.throwIfAborted()
  if (starts.at(-1) === length) starts.pop()
  if (starts.length > MAX_LINES) throw new Error('Phase 1 supports up to 1,000,000 lines per file.')
  return { name: file.name, size: file.size, text: parts.join(''), starts: Uint32Array.from(starts) }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`
}
