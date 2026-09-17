import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { CORE_FIELDS, displayValue, type ParsedDataset } from '@/lib/parsers/types'

export function StructuredTable({ data, selected, onSelect }: { data: ParsedDataset; selected: number | null; onSelect: (row: number) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtual = useVirtualizer({ count: data.records.length, getScrollElement: () => scrollRef.current, estimateSize: () => 34, overscan: 8 })
  const columns = [...CORE_FIELDS, ...data.extras]
  const active = Math.max(0, data.records.findIndex(record => record.row === selected))
  const template = `80px ${columns.map(key => key === 'message' ? '360px' : key === 'timestamp' ? '220px' : '160px').join(' ')}`
  return <div className="flex min-h-0 flex-1 flex-col">
    <div ref={scrollRef} role="grid" aria-label="Structured logs" aria-rowcount={data.records.length + 1} aria-colcount={columns.length + 1}
      tabIndex={0} aria-activedescendant={virtual.getVirtualItems().some(row => row.index === active) ? `record-${active}` : undefined}
      className="min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-1 focus-visible:ring-primary"
      onKeyDown={event => {
        const next = event.key === 'ArrowDown' ? Math.min(active + 1, data.records.length - 1) : event.key === 'ArrowUp' ? Math.max(active - 1, 0) : event.key === 'Home' ? 0 : event.key === 'End' ? data.records.length - 1 : event.key === 'Enter' ? active : null
        if (next !== null && data.records[next]) { event.preventDefault(); virtual.scrollToIndex(next); onSelect(data.records[next].row) }
      }}>
      <div className="w-max min-w-full">
        <div role="row" aria-rowindex={1} className="sticky top-0 z-10 grid h-10 items-center border-b bg-background text-[10px] text-muted-foreground" style={{ gridTemplateColumns: template }}>
          <span role="columnheader" className="px-3">LINE</span>{columns.map(key => <span role="columnheader" key={key} className="truncate px-3" title={key}>{key}</span>)}
        </div>
        <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
          {virtual.getVirtualItems().map(item => {
            const entry = data.records[item.index]
            return <div id={`record-${item.index}`} key={item.key} role="row" aria-rowindex={item.index + 2} aria-selected={entry.row === selected}
              onClick={() => onSelect(entry.row)} className={`absolute left-0 top-0 grid cursor-pointer items-center border-b border-white/5 font-mono text-xs hover:bg-white/5 ${entry.failed ? 'bg-red-400/5' : ''} ${entry.row === selected ? 'bg-primary/10' : ''}`}
              style={{ gridTemplateColumns: template, height: item.size, transform: `translateY(${item.start}px)` }}>
              <span role="gridcell" className="sticky left-0 bg-background px-3 text-muted-foreground">{entry.row + 1}{entry.failed && <span className="ml-1 text-red-300" title={entry.failed} aria-label={`Parse failed: ${entry.failed}`}>!</span>}</span>
              {columns.map(key => <span role="gridcell" key={key} className="truncate px-3" title={key === 'message' && entry.failed ? entry.failed : undefined}>
                {key === 'level' && entry.record.level ? <span className={`rounded px-1.5 py-0.5 ${/ERROR|FATAL|CRIT|EMERG|ALERT/.test(entry.record.level) ? 'bg-red-400/10 text-red-300' : entry.record.level === 'WARN' ? 'bg-amber-400/10 text-amber-300' : 'bg-primary/10 text-primary'}`}>{entry.record.level}</span> : displayValue(entry.record[key]).slice(0, 2000) || '—'}
              </span>)}
            </div>
          })}
        </div>
      </div>
      {!data.records.length && <p className="p-6 text-sm text-muted-foreground">No records. Blank lines and CSV headers are skipped.</p>}
    </div>
    <div className="border-t px-4 py-2 text-[11px] text-muted-foreground">{data.records.length.toLocaleString()} records · {data.failed.toLocaleString()} failed · {data.skipped.toLocaleString()} skipped</div>
  </div>
}
