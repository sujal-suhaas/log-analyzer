import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { lineAt, type LogFile } from '@/lib/read-log-file'

export function LogTable({ log, selected, onSelect }: { log: LogFile; selected: number | null; onSelect: (index: number) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtual = useVirtualizer({ count: log.starts.length, getScrollElement: () => scrollRef.current, estimateSize: () => 32, overscan: 10 })
  const active = selected ?? 0
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center border-b bg-white/[.015] font-mono text-[10px] tracking-wider text-muted-foreground"><span className="w-20 shrink-0 text-center">LINE</span><span>RAW CONTENT</span><span className="ml-auto pr-4 font-sans tracking-normal">UTF-8</span></div>
      <div ref={scrollRef} role="listbox" aria-label="Raw log lines" aria-activedescendant={virtual.getVirtualItems().some(row => row.index === active) ? `log-line-${active}` : undefined}
        tabIndex={0} className="min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary"
        onKeyDown={e => {
          const next = e.key === 'ArrowDown' ? Math.min(active + 1, log.starts.length - 1) : e.key === 'ArrowUp' ? Math.max(active - 1, 0) : e.key === 'Home' ? 0 : e.key === 'End' ? log.starts.length - 1 : null
          if (next !== null && next >= 0) { e.preventDefault(); virtual.scrollToIndex(next); onSelect(next) }
          if (e.key === 'Enter' && log.starts.length) { e.preventDefault(); onSelect(active) }
        }}>
        <div style={{ height: virtual.getTotalSize(), position: 'relative', minWidth: '100%' }}>
          {virtual.getVirtualItems().map(row => {
            const raw = lineAt(log, row.index)
            return <div id={`log-line-${row.index}`} key={row.key} role="option" aria-selected={selected === row.index}
              onClick={() => onSelect(row.index)}
              className={`absolute left-0 top-0 flex w-max min-w-full cursor-pointer items-center border-b border-white/[.025] font-mono text-xs hover:bg-white/[.035] ${selected === row.index ? 'bg-primary/10 text-primary' : 'text-zinc-400'}`}
              style={{ height: row.size, transform: `translateY(${row.start}px)` }}>
              <span className="sticky left-0 w-20 shrink-0 bg-background/95 pr-5 text-right text-[10px] text-muted-foreground">{(row.index + 1).toLocaleString()}</span>
              {/* ponytail: preview capped at 2K chars; full line remains in detail panel. */}
              <span className="whitespace-pre pr-8">{raw.slice(0, 2000) || ' '}{raw.length > 2000 ? ' … [open full line]' : ''}</span>
            </div>
          })}
        </div>
      </div>
      <div className="flex h-9 shrink-0 items-center justify-between border-t px-4 text-[11px] text-muted-foreground"><span>{log.starts.length.toLocaleString()} lines · Virtual scrolling</span><span>↑ ↓ navigate · Enter inspect</span></div>
    </div>
  )
}
