import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Activity, ArrowUpFromLine, Check, ChevronRight, Copy, FileText, FolderOpen, HardDrive, Layers, ListFilter, Menu, ShieldCheck, Terminal, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { FileImport } from '@/components/file-import'
import { LogTable } from '@/components/log-table'
import { StructuredTable } from '@/components/structured-table'
import { PARSERS, parseDataset, recordRaw, type ParserId, type ParsedDataset } from '@/lib/parsers'
import { displayValue } from '@/lib/parsers/types'
import { ACCEPT, formatBytes, lineAt, readLogFile, type ImportProgress, type LogFile } from '@/lib/read-log-file'

function App() {
  const compact = useSyncExternalStore(
    on => {
      const query = window.matchMedia('(max-width: 1279px)')
      query.addEventListener('change', on)
      return () => query.removeEventListener('change', on)
    },
    () => window.matchMedia('(max-width: 1279px)').matches,
    () => false,
  )
  const [log, setLog] = useState<LogFile | null>(null)
  const [parser, setParser] = useState<ParserId>('plain')
  const [dataset, setDataset] = useState<ParsedDataset | null>(null)
  const [view, setView] = useState<'raw' | 'structured'>('structured')
  const [parsing, setParsing] = useState(false)
  const [parsedRows, setParsedRows] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [pending, setPending] = useState<{ name: string; size: number } | null>(null)
  const [progress, setProgress] = useState<ImportProgress>({ bytes: 0, lines: 0 })
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [copied, setCopied] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const picker = useRef<HTMLInputElement>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { controller.current?.abort(); if (copyTimer.current) clearTimeout(copyTimer.current) }, [])

  async function importFiles(files: File[]) {
    if (files.length !== 1) { setError('Choose one file at a time.'); return }
    const file = files[0]
    controller.current?.abort()
    const request = new AbortController()
    controller.current = request
    setPending({ name: file.name, size: file.size }); setProgress({ bytes: 0, lines: 0 }); setError(''); setNotice(''); setParsing(false); setParsedRows(0)
    try {
      const next = await readLogFile(file, request.signal, value => { if (controller.current === request) setProgress(value) })
      if (controller.current !== request) return
      setParsing(true)
      const parsed = await parseDataset(next, parser, request.signal, setParsedRows)
      if (controller.current !== request) return
      setLog(next); setDataset(parsed); setSelected(null); setDetailsOpen(false)
      setNotice(`Imported ${next.starts.length.toLocaleString()} lines. File stays in this browser tab.`)
    } catch (cause) {
      if (controller.current !== request) return
      if (request.signal.aborted) setNotice('Import cancelled. Previous file kept.')
      else setError(cause instanceof TypeError ? 'Could not decode this file. Use valid UTF-8 text.' : cause instanceof Error ? cause.message : 'Could not read file.')
    } finally {
      if (controller.current === request) { setPending(null); setParsing(false); controller.current = null }
    }
  }

  async function reparse(nextParser: ParserId) {
    if (!log) { setParser(nextParser); return }
    const request = new AbortController()
    controller.current?.abort(); controller.current = request
    setPending({ name: log.name, size: log.size }); setParsing(true); setParsedRows(0); setError(''); setNotice('')
    try {
      const parsed = await parseDataset(log, nextParser, request.signal, setParsedRows)
      if (controller.current !== request) return
      setParser(nextParser); setDataset(parsed); setSelected(null); setDetailsOpen(false)
      setNotice(`Parsed ${parsed.records.length.toLocaleString()} records; ${parsed.failed} failed.`)
    } catch (cause) {
      if (controller.current !== request) return
      if (request.signal.aborted) setNotice('Parsing cancelled. Previous dataset kept.')
      else setError(cause instanceof Error ? cause.message : 'Could not parse file.')
    } finally {
      if (controller.current === request) { setPending(null); setParsing(false); controller.current = null }
    }
  }

  function selectLine(index: number) { setSelected(index); setDetailsOpen(true); setCopied(false) }
  const entry = selected === null ? undefined : dataset?.records.find(record => record.row <= selected && record.endRow >= selected)
  const raw = log && selected !== null ? view === 'structured' && entry ? recordRaw(log, entry.row, entry.endRow) : lineAt(log, selected) : ''
  async function copyLine() {
    try { await navigator.clipboard.writeText(raw); setCopied(true); if (copyTimer.current) clearTimeout(copyTimer.current); copyTimer.current = setTimeout(() => setCopied(false), 2000) }
    catch { setError('Clipboard unavailable. Select and copy the raw text manually.') }
  }
  const navigation = <>
    <div className="flex h-[76px] items-center gap-3 px-6"><span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Layers size={19} /></span><span className="text-lg font-semibold tracking-tight">logline<span className="text-primary">.</span></span><Badge variant="outline" className="ml-auto text-[9px] text-muted-foreground">LOCAL</Badge></div>
    <div className="px-4"><div className="mb-7 flex items-center gap-3 rounded-lg border bg-white/[.025] p-3"><span className="flex size-8 items-center justify-center rounded bg-white/5"><Terminal size={16} /></span><div><p className="text-xs font-medium">Personal workspace</p><p className="mt-1 text-[10px] text-muted-foreground">Browser session</p></div></div>
      <p className="mb-3 px-2 text-[9px] font-medium tracking-[.15em] text-muted-foreground">WORKSPACE</p>
      <button onClick={() => setNavOpen(false)} aria-current="page" className="flex w-full items-center gap-3 rounded-md border border-primary/10 bg-primary/10 px-3 py-2.5 text-xs font-medium text-primary"><ListFilter size={16} />Log explorer<span className="ml-auto size-1.5 rounded-full bg-primary" /></button>
      <div className="mt-8 flex items-center justify-between px-2 text-[9px] font-medium tracking-[.15em] text-muted-foreground"><span>ACTIVE DATASET</span><span>{log ? '01' : '00'}</span></div>
      {log ? <div className="mt-3 flex items-center gap-2 rounded px-2 py-3 text-xs"><FileText size={15} className="shrink-0 text-primary" /><span className="truncate" title={log.name}>{log.name}</span></div> : <p className="px-2 py-4 text-xs text-muted-foreground">No file imported yet</p>}
    </div>
    <div className="mt-auto p-4"><div className="rounded-lg border border-primary/10 bg-primary/[.03] p-3"><ShieldCheck size={17} className="mb-2 text-primary" /><p className="text-xs font-medium">Your data. Your browser.</p><p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">No uploads. No server processing. Nothing leaves your device.</p></div><div className="mt-5 flex items-center gap-2 px-2 text-[10px] text-muted-foreground"><span className="size-1.5 rounded-full bg-primary" />Local mode<span className="ml-auto">v0.1.0</span></div></div>
  </>
  const details = <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex h-12 shrink-0 items-center justify-between border-b px-4"><span className="text-xs font-medium">Line details</span>{selected !== null && <Button variant="ghost" size="icon" aria-label="Close line details" onClick={() => { setSelected(null); setDetailsOpen(false) }}><X size={14} /></Button>}</div>
    {selected === null || !log ? <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center"><span className="rounded-xl border bg-white/[.02] p-4"><FileText size={23} className="text-muted-foreground" /></span><p className="text-xs font-medium">A closer look</p><p className="max-w-44 text-xs leading-relaxed text-muted-foreground">Select a log line to inspect its full raw content.</p></div> : <div className="min-h-0 flex-1 overflow-auto p-4"><Badge variant="outline" className="font-mono text-primary">LINE {selected + 1}</Badge><dl className="my-5 space-y-3 text-xs"><div className="flex justify-between gap-4"><dt className="text-muted-foreground">Source</dt><dd className="truncate" title={log.name}>{log.name}</dd></div><div className="flex justify-between"><dt className="text-muted-foreground">Characters</dt><dd>{raw.length.toLocaleString()}</dd></div><div className="flex justify-between"><dt className="text-muted-foreground">View</dt><dd>{view === 'raw' ? 'Raw text' : 'Structured'}</dd></div></dl>{entry?.failed && <p className="mb-4 rounded border border-red-400/25 p-2 text-xs text-red-300">Parse failed: {entry.failed}</p>}{entry && <dl aria-label="Parsed fields" className="mb-5 space-y-3 text-xs">{Object.entries(entry.record).map(([key, value]) => <div key={key}><dt className="text-muted-foreground">{key}</dt><dd className="mt-1 whitespace-pre-wrap break-all font-mono">{displayValue(value) || '—'}</dd></div>)}</dl>}<div className="mb-2 flex items-center justify-between"><span className="text-[10px] tracking-wider text-muted-foreground">RAW CONTENT</span><Button variant="ghost" size="sm" onClick={copyLine}>{copied ? <Check size={12} /> : <Copy size={12} />}{copied ? 'Copied' : 'Copy'}</Button></div><pre className="max-h-[65vh] overflow-auto whitespace-pre-wrap break-all rounded-lg border bg-background p-3 font-mono text-xs leading-6 text-zinc-300">{raw || '(empty line)'}</pre></div>}
    <div className="border-t px-4 py-3 text-[10px] text-muted-foreground">Original content · No transformations</div>
  </div>

  return (
    <div className="flex h-dvh min-h-[480px] bg-background text-foreground" onDragOver={e => e.preventDefault()} onDrop={e => e.preventDefault()}>
      <aside className="hidden w-[232px] shrink-0 flex-col border-r bg-[#101212] md:flex">{navigation}</aside>
      <Sheet open={navOpen} onOpenChange={setNavOpen}><SheetContent side="left" className="flex w-[270px] flex-col gap-0 p-0"><SheetHeader className="sr-only"><SheetTitle>Navigation</SheetTitle><SheetDescription>Local log workspace</SheetDescription></SheetHeader>{navigation}</SheetContent></Sheet>
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[64px] shrink-0 items-center justify-between border-b px-4 sm:px-7"><div className="flex items-center gap-3 text-xs"><Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation" onClick={() => setNavOpen(true)}><Menu size={18} /></Button><span className="hidden text-muted-foreground sm:inline">Workspace</span><ChevronRight size={12} className="hidden text-muted-foreground sm:block" /><span>Log explorer</span></div><div className="flex items-center gap-4"><span className="hidden items-center gap-1.5 text-[10px] text-muted-foreground sm:flex"><ShieldCheck size={13} />On-device processing</span><span className="flex size-7 items-center justify-center rounded-full border bg-white/5 text-[10px]">LW</span></div></header>
        <div className="px-4 pb-5 pt-6 sm:px-7"><div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-3"><h1 className="text-xl font-semibold tracking-tight">Log explorer</h1><Badge variant="outline" className="text-[9px] text-muted-foreground">PHASE 02</Badge></div><p className="mt-2 text-xs text-muted-foreground">Less noise. More context. Explore your logs locally.</p></div><Button disabled={!!pending} onClick={() => picker.current?.click()} size="sm"><ArrowUpFromLine size={14} />Import file</Button></div>
          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">{[
            { label: 'ACTIVE FILE', value: log ? '1 dataset' : 'No dataset', sub: log?.name ?? 'Import a file to get started', icon: FolderOpen },
            { label: 'FILE SIZE', value: log ? formatBytes(log.size) : '—', sub: '50 MB import limit', icon: HardDrive },
            { label: 'TOTAL LINES', value: log ? log.starts.length.toLocaleString() : '—', sub: 'Unmodified raw content', icon: FileText },
            { label: 'PROCESSING', value: 'Browser only', sub: 'Private, in-memory session', icon: Activity },
          ].map(stat => <div key={stat.label} className="min-w-0 rounded-lg border bg-card px-4 py-3"><div className="flex items-center justify-between text-[9px] tracking-wider text-muted-foreground"><span>{stat.label}</span><stat.icon size={13} /></div><p className="mt-3 text-lg font-medium tracking-tight">{stat.value}</p><p className="mt-1 truncate text-[10px] text-muted-foreground" title={stat.sub}>{stat.sub}</p></div>)}</div>
        </div>
        <input ref={picker} aria-label="Replace or import log file" className="hidden" type="file" accept={ACCEPT} onChange={e => { if (e.target.files) void importFiles(Array.from(e.target.files)); e.target.value = '' }} />
        {error && <div role="alert" className="mx-4 mb-3 flex items-center justify-between rounded-md border border-red-400/25 bg-red-400/10 px-4 py-2 text-xs text-red-300 sm:mx-7">{error}<Button variant="ghost" size="icon" aria-label="Dismiss error" onClick={() => setError('')}><X size={14} /></Button></div>}
        <div aria-live="polite" className="sr-only">{notice}</div>
        <div className="mx-4 mb-3 flex flex-wrap items-center gap-3 text-xs sm:mx-7"><label className="flex items-center gap-2">Parser<select aria-label="Parser" className="max-w-52 rounded border bg-background p-2" value={parser} disabled={!!pending} onChange={event => void reparse(event.target.value as ParserId)}>{PARSERS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>{log && <div role="group" aria-label="Log view" className="flex gap-1"><Button size="sm" variant={view === 'raw' ? 'secondary' : 'ghost'} aria-pressed={view === 'raw'} onClick={() => { setView('raw'); setSelected(null); setDetailsOpen(false) }}>Raw</Button><Button size="sm" variant={view === 'structured' ? 'secondary' : 'ghost'} aria-pressed={view === 'structured'} onClick={() => { setView('structured'); setSelected(null); setDetailsOpen(false) }}>Structured</Button></div>}{dataset && <span className={dataset.failed ? 'text-red-300' : 'text-muted-foreground'}>{dataset.failed.toLocaleString()} failed</span>}<span className="text-muted-foreground">{parser === 'syslog' ? 'Legacy timestamps retain unknown year/timezone.' : parser === 'access' ? 'Custom timing values retain source units.' : 'Choose format explicitly. Blank lines skipped.'}</span></div>
        {pending && <div className="mx-4 mb-4 rounded-lg border bg-card p-4 sm:mx-7"><div className="mb-3 flex items-center justify-between gap-3 text-xs"><span className="truncate">{parsing ? 'Parsing' : 'Reading'} {pending.name} · {(parsing ? parsedRows : progress.lines).toLocaleString()} lines</span><Button variant="outline" size="sm" onClick={() => controller.current?.abort()}>Cancel import</Button></div><Progress aria-label="File import progress" value={parsing ? (progress.lines || log?.starts.length) ? parsedRows / (progress.lines || log!.starts.length) * 100 : 0 : pending.size ? progress.bytes / pending.size * 100 : 0} /><p className="mt-2 text-[10px] text-muted-foreground">{parsing ? 'Parsing locally · previous dataset kept until complete' : `${formatBytes(progress.bytes)} / ${formatBytes(pending.size)}`}</p></div>}
        <section className="mx-4 mb-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card/30 sm:mx-7 sm:mb-6" aria-label="Log workspace">
          <div className="flex h-12 shrink-0 items-center justify-between border-b px-4"><div className="flex min-w-0 items-center gap-2 text-xs"><Terminal size={15} className="text-primary" /><span className="truncate">{log?.name ?? 'Raw log viewer'}</span><Badge variant="secondary" className="text-[9px]">{log ? view.toUpperCase() : 'READY'}</Badge></div>{log && <Button variant="ghost" size="sm" disabled={!!pending} onClick={() => { setLog(null); setDataset(null); setSelected(null); setDetailsOpen(false); setNotice('Dataset cleared.') }}><Trash2 size={13} />Clear</Button>}</div>
          {!log ? <div className="min-h-0 flex-1 overflow-auto px-5 py-8"><div className="mb-7 text-center"><h2 className="text-lg font-medium tracking-tight">Every investigation starts with a log.</h2><p className="mt-2 text-xs text-muted-foreground">Open a file to explore every line, right here in your browser.</p></div><FileImport onFiles={files => void importFiles(files)} disabled={!!pending} /></div> : <div className="flex min-h-0 flex-1"><div className="flex min-w-0 flex-1 flex-col">{view === 'structured' && dataset ? <StructuredTable key={dataset.parser + log.name + log.size} data={dataset} selected={selected} onSelect={selectLine} /> : log.starts.length ? <LogTable key={log.name + log.size + log.text.length} log={log} selected={selected} onSelect={selectLine} /> : <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">This file is empty. Import another file to begin.</div>}</div><aside className="hidden w-[300px] shrink-0 flex-col border-l xl:flex">{details}</aside></div>}
        </section>
        <Sheet open={detailsOpen && selected !== null && compact} onOpenChange={setDetailsOpen}><SheetContent className="flex flex-col gap-0 p-0"><SheetHeader className="sr-only"><SheetTitle>Selected log line</SheetTitle><SheetDescription>Inspect original raw log content</SheetDescription></SheetHeader>{details}</SheetContent></Sheet>
      </main>
    </div>
  )
}
export default App
