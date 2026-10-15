import { describe, expect, test } from 'bun:test'
import { lineAt, MAX_BYTES, MAX_LINES, readLogFile, validateLogFile } from '../src/lib/read-log-file'

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
  test('metadata-only preflight accepts the byte boundary and rejects before reading', async () => {
    expect(() => validateLogFile({ name: 'COMPACT.JSONL', size: MAX_BYTES })).not.toThrow()
    expect(() => validateLogFile({ name: 'bad.exe', size: 1 })).toThrow('Choose')
    expect(() => validateLogFile({ name: 'large.csv', size: MAX_BYTES + 1 })).toThrow('50 MB')
    const file = new File(['not read'], 'bad.exe')
    Object.defineProperty(file, 'slice', { value: () => { throw new Error('must not read') } })
    await expect(readLogFile(file, new AbortController().signal, () => {})).rejects.toThrow('Choose')
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
  test('1.1M compact JSONL source lines successfully fit below 50 MiB', async () => {
    const block = '{"level":"INFO","message":"ok"}\n'.repeat(9) + '{"level":"ERROR","message":"bad"}\n'
    const data = block.repeat(110_000)
    expect(new Blob([data]).size).toBeLessThan(MAX_BYTES)
    const log = await load(data, 'compact.jsonl', 256 * 1024)
    expect(log.starts.length).toBe(1_100_000)
    expect(lineAt(log, 0)).toBe('{"level":"INFO","message":"ok"}')
    expect(lineAt(log, 550_000)).toBe('{"level":"INFO","message":"ok"}')
    expect(lineAt(log, 1_099_999)).toBe('{"level":"ERROR","message":"bad"}')
  })
  test('physical line cap accepts exactly the boundary with or without final newline', async () => {
    const data = '\n'.repeat(MAX_LINES - 1) + 'last'
    for (const suffix of ['', '\n']) {
      const log = await load(data + suffix, 'boundary.log', 256 * 1024)
      expect(log.starts.length).toBe(MAX_LINES)
      expect(lineAt(log, MAX_LINES - 1)).toBe('last')
    }
    for (const data of ['\n'.repeat(MAX_LINES) + 'extra', '\n'.repeat(MAX_LINES + 1)]) {
      await expect(load(data, 'overcap.log', 256 * 1024)).rejects.toThrow('1,250,000 source lines')
    }
  })
  test('CSV header and blank lines count toward the source line cap', async () => {
    const atCap = 'level,message\n' + '\n'.repeat(MAX_LINES - 2) + 'INFO,last\n'
    const log = await load(atCap, 'boundary.csv', 256 * 1024)
    expect(log.starts.length).toBe(MAX_LINES)
    expect(lineAt(log, 0)).toBe('level,message')
    expect(lineAt(log, MAX_LINES - 1)).toBe('INFO,last')
    const overCap = 'level,message\n' + 'INFO,x\n'.repeat(MAX_LINES)
    expect(new Blob([overCap]).size).toBeLessThan(MAX_BYTES)
    await expect(load(overCap, 'overcap.csv', 256 * 1024)).rejects.toThrow('CSV headers')
  })
})
