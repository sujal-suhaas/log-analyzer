import { normalize, sniffLevel, type LineParser, type LogRecord } from './types'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const RE = /^(?:<(\d{1,3})>)?([A-Z][a-z]{2}\s+\d{1,2} \d{2}:\d{2}:\d{2}|\d{4}-\d{2}-\d{2}T\S+) (\S+) ([^:\s\[]+)(?:\[(\d+)\])?: (.*)$/

export const syslog: LineParser = line => {
  const match = RE.exec(line)
  if (!match) return null
  const [, pri, when, host, service, pid, message] = match
  const record: LogRecord = { host, message, service }
  if (pid) record.pid = Number(pid)
  if (when[4] === '-') record.timestamp = when
  else {
    const month = MONTHS.indexOf(when.slice(0, 3)) + 1
    if (!month) throw new Error('Invalid syslog month')
    const day = when.slice(3, -8).trim()
    // Legacy syslog has no year/timezone. Keep source timestamp rather than invent UTC.
    record.source_timestamp = when
    record.timestamp_note = `Year and timezone unknown (month ${month}, day ${day})`
  }
  if (pri !== undefined) {
    if (+pri > 191) throw new Error('Invalid syslog priority')
    record.priority = +pri
    record.level = ['EMERG', 'ALERT', 'CRIT', 'ERROR', 'WARN', 'NOTICE', 'INFO', 'DEBUG'][+pri % 8]
  } else record.level = sniffLevel(message)
  return normalize(record, line)
}
