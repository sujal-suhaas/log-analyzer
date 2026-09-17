import { normalize, type LineParser, type LogRecord } from './types'

// Apache/Nginx combined + common format:
//   addr ident user [time] "request" status bytes "referer" "agent" [duration]
// Common/combined format only; custom trailing timing units cannot be inferred safely.
const RE = /^(\S+) (\S+) (\S+) \[([^\]]+)\] "([^"]*)" (\d{3}) (\S+)(?: "([^"]*)" "([^"]*)")?(?: (\S+))?$/

export const access: LineParser = line => {
  const match = RE.exec(line)
  if (!match) return null
  const [, addr, ident, user, when, request, status, bytes, referer, agent, duration] = match
  const statusCode = Number(status)
  const record: LogRecord = { host: addr, status: statusCode, message: request || '-' }
  if (ident !== '-') record.ident = ident
  if (user !== '-') record.user = user
  record.timestamp = toIso(when)
  const [method, path, protocol] = request.split(' ')
  if (method && path) {
    record.method = method
    record.path = path
    if (protocol) record.protocol = protocol
  } else {
    record.message = request || '-'
  }
  if (bytes !== '-') {
    if (!/^\d+$/.test(bytes)) throw new Error('Invalid byte count')
    record.bytes = Number(bytes)
  }
  if (referer && referer !== '-') record.referer = referer
  if (agent && agent !== '-') record.user_agent = agent
  if (duration) record.duration_raw = duration
  record.level = statusCode >= 500 ? 'ERROR' : statusCode >= 400 ? 'WARN' : 'INFO'
  return normalize(record, line)
}

// '10/Oct/2023:13:55:36 -0700' → ISO 8601 UTC; unknown month → null.
function toIso(when: string): string | undefined {
  const match = /^(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-]\d{4})$/.exec(when)
  if (!match) throw new Error('Invalid access timestamp')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const month = months.indexOf(match[2])
  if (month < 0) throw new Error('Invalid access month')
  const [, day, , year, hour, minute, second, offset] = match
  return normalize({ timestamp: `${year}-${String(month + 1).padStart(2, '0')}-${day}T${hour}:${minute}:${second}${offset.slice(0, 3)}:${offset.slice(3)}` }, '').timestamp
}
