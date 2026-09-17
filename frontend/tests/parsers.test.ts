import { expect, test } from 'bun:test'
import { parseDataset, recordRaw } from '../src/lib/parsers'
import { readLogFile } from '../src/lib/read-log-file'

const log = (text: string) => readLogFile(new File([text], 'test.log'), new AbortController().signal, () => {})

test('JSONL normalizes types, keeps nested extras, skips blanks and marks invalid rows', async () => {
  const data = await parseDataset(await log('{"timestamp":"2026-01-01T01:00:00+01:00","level":"warning","status":"200","duration_ms":0,"message":{"why":"timeout"},"extra":{"a":1}}\n\n{bad}\n[]\n{"status":true}\n{"timestamp":"2026-02-30T00:00:00Z"}'), 'jsonl')
  expect(data.records[0].record).toMatchObject({ timestamp: '2026-01-01T00:00:00.000Z', level: 'WARN', status: 200, duration_ms: 0, message: '{"why":"timeout"}', extra: { a: 1 } })
  expect(data.extras).toEqual(['extra'])
  expect(data.skipped).toBe(1)
  expect(data.failed).toBe(4)
  expect(data.records[1].row).toBe(2)
})

test('access common/combined, explicit offset, unknown duration units preserved', async () => {
  const data = await parseDataset(await log('192.168.1.1 - alice [10/Oct/2023:13:55:36 -0700] "GET /api HTTP/1.1" 200 2326 "-" "Mozilla" 0.123\n10.0.0.9 - - [01/Feb/2024:10:00:00 +0000] "POST /login HTTP/2" 502 -\nbad'), 'access')
  expect(data.records[0].record).toMatchObject({ timestamp: '2023-10-10T20:55:36.000Z', status: 200, method: 'GET', path: '/api', duration_raw: '0.123', message: 'GET /api HTTP/1.1' })
  expect(data.records[0].record.duration_ms).toBeUndefined()
  expect(data.records[1].record.level).toBe('ERROR')
  expect(data.failed).toBe(1)
})

test('syslog priority wins; no invented year/timezone or level', async () => {
  const data = await parseDataset(await log('<34>Jan  1 00:00:00 web-01 sshd[4123]: Failed password\n2026-03-05T10:00:00Z db-01 postgres: checkpoint complete\nrandom'), 'syslog')
  expect(data.records[0].record).toMatchObject({ service: 'sshd', pid: 4123, host: 'web-01', level: 'CRIT', source_timestamp: 'Jan  1 00:00:00' })
  expect(data.records[0].record.timestamp).toBeUndefined()
  expect(data.records[1].record.timestamp).toBe('2026-03-05T10:00:00.000Z')
  expect(data.records[1].record.level).toBeUndefined()
  expect(data.failed).toBe(1)
})

test('plain uses standalone level tokens, no ERROR inferred from TERROR', async () => {
  const data = await parseDataset(await log('TERROR is not a level\n[error] broken\n\n'), 'plain')
  expect(data.records[0].record.level).toBeUndefined()
  expect(data.records[1].record.level).toBe('ERROR')
  expect(data.skipped).toBe(1)
})

test('CSV header, multiline/escaped quotes, zero duration, raw range and errors', async () => {
  const source = await log('level,duration_ms,message\r\nWARN,0,"timeout,\r\nretry ""now"""\r\nINFO,2,ok\r\nshort,row\r\nERROR,3,"unfinished')
  const data = await parseDataset(source, 'csv')
  expect(data.records[0]).toMatchObject({ row: 1, endRow: 2, record: { level: 'WARN', duration_ms: 0, message: 'timeout,\nretry "now"' } })
  expect(recordRaw(source, 1, 2)).toBe('WARN,0,"timeout,\r\nretry ""now"""')
  expect(data.records[1].row).toBe(3)
  expect(data.failed).toBe(2)
  expect(data.skipped).toBe(1)
})

test('invalid CSV header/quoting and prototype-named keys remain data', async () => {
  const invalid = await parseDataset(await log('message,message\na,b'), 'csv')
  expect(invalid.failed).toBe(2)
  const data = await parseDataset(await log('__proto__,message\nhello,ok\nx,"ok"junk\nx,good'), 'csv')
  expect(Object.hasOwn(data.records[0].record, '__proto__')).toBe(true)
  expect(data.failed).toBe(1)
  expect(data.records[2].record.message).toBe('good')
})

test('100K records, progress, abort during parse, and empty dataset', async () => {
  const source = await log('INFO request completed\n'.repeat(100_000))
  const progress: number[] = []
  const data = await parseDataset(source, 'plain', undefined, rows => progress.push(rows))
  expect(data.records.length).toBe(100_000)
  expect(progress.at(-1)).toBe(100_000)
  const controller = new AbortController()
  await expect(parseDataset(source, 'plain', controller.signal, () => controller.abort())).rejects.toThrow()
  expect((await parseDataset(await log(''), 'plain')).records).toEqual([])
})
