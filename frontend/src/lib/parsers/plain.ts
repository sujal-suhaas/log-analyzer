import { sniffLevel, type LineParser } from './types'

// Generic text stays intact; only standalone level tokens are recognized.
export const plain: LineParser = message => ({ message, level: sniffLevel(message) })
