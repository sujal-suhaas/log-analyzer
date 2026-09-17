import { describe, expect, test } from 'bun:test'
import { lineAt, MAX_BYTES, readLogFile } from '../src/lib/read-log-file'

const load = (data: string | Uint8Array, name = 'test.log', chunk = 3) =>
  readLogFile(new File([data], name), new AbortController().signal, () => {}, chunk)

describe('local log reader', () => {
  test('UTF-8 split across chunks, CRLF, blank lines and final unterminated line', async () => {
    const log = await load('hello 🌍\r\n\r\nlast')
    expect(Array.from(log.starts, (_, i) => lineAt(log, i))).toEqual(['hello 🌍', '', 'last'])
  })
  test('empty file and trailing newline do not add phantom rows', async () => {
    expect((await load('')).starts.length).toBe(0)
    const log = await load('one\n\n')
    expect(Array.from(log.starts, (_, i) => lineAt(log, i))).toEqual(['one', ''])
    const crlf = await load('a\n\r\n')
    expect(Array.from(crlf.starts, (_, i) => lineAt(crlf, i))).toEqual(['a', ''])
    expect(lineAt(log, 99)).toBe('')
  })
  test('all supported formats are raw text', async () => {
    for (const ext of ['log', 'txt', 'json', 'csv', 'jsonl', 'ndjson']) {
      expect(lineAt(await load('{"x":1}', `test.${ext}`), 0)).toBe('{"x":1}')
    }
  })
  test('reject invalid type, binary, invalid UTF-8 and oversized files', async () => {
    await expect(load('test', 'test.exe')).rejects.toThrow('Choose')
    await expect(load('hello\0')).rejects.toThrow('Binary')
    await expect(load(new Uint8Array([255]))).rejects.toThrow()
    const file = new File([''], 'test.log')
    Object.defineProperty(file, 'size', { value: MAX_BYTES + 1 })
    await expect(readLogFile(file, new AbortController().signal, () => {})).rejects.toThrow('50 MB')
  })
  test('abort during import; monotonic actual byte progress', async () => {
    const controller = new AbortController()
    const bytes: number[] = []
    await expect(readLogFile(new File(['a\nb\nc'], 'test.log'), controller.signal, p => {
      bytes.push(p.bytes)
      controller.abort()
    }, 2)).rejects.toThrow()
    expect(bytes).toEqual([2])
  })
  test('100K lines and one long line', async () => {
    const log = await load('line\n'.repeat(100_000), 'large.log', 256 * 1024)
    expect(log.starts.length).toBe(100_000)
    expect(lineAt(log, 99_999)).toBe('line')
    expect(lineAt(await load('x'.repeat(600_000), 'long.log', 256 * 1024), 0).length).toBe(600_000)
  })
})
