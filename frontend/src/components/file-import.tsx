// Adapted from Watermelon file-upload-1 (MIT); see THIRD_PARTY_NOTICES.md.
// Replaced simulated upload with local reading; retained drop-zone composition and drag counter.
import { useRef, useState } from 'react'
import { ArrowUpFromLine, FileText, ShieldCheck } from 'lucide-react'
import { ACCEPT } from '@/lib/read-log-file'

export function FileImport({ onFiles, disabled }: { onFiles: (files: File[]) => void; disabled: boolean }) {
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const dragCounter = useRef(0)
  return (
    <div className="mx-auto w-full max-w-xl">
      <button type="button" disabled={disabled} aria-label="Import log file"
        className={`group relative flex w-full cursor-pointer flex-col items-center justify-center gap-5 rounded-xl border border-dashed px-6 py-12 transition-colors focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50 ${isDragging ? 'border-primary bg-primary/10' : 'border-white/20 bg-white/[.02] hover:border-primary/60 hover:bg-primary/[.03]'}`}
        onClick={() => inputRef.current?.click()}
        onDragEnter={e => { e.preventDefault(); dragCounter.current++; setIsDragging(true) }}
        onDragLeave={e => { e.preventDefault(); if (--dragCounter.current === 0) setIsDragging(false) }}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); dragCounter.current = 0; setIsDragging(false); if (!disabled) onFiles(Array.from(e.dataTransfer.files)) }}>
        <span className="flex size-14 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary"><ArrowUpFromLine size={25} /></span>
        <span className="space-y-2 text-center"><span className="block text-base font-medium">{isDragging ? 'Drop to open your file' : 'Drop your log file here'}</span><span className="block text-sm text-muted-foreground">or <span className="text-primary">browse files</span> on your computer</span></span>
        <span className="flex flex-wrap justify-center gap-2">{['LOG', 'TXT', 'JSON', 'CSV'].map(ext => <span key={ext} className="rounded border bg-background px-2 py-1 font-mono text-[10px] text-muted-foreground">{ext}</span>)}</span>
        <span className="text-xs text-muted-foreground">UTF-8 text · Up to 50 MB per file · Multiple files welcome</span>
      </button>
      <input ref={inputRef} type="file" accept={ACCEPT} multiple className="hidden" aria-label="Choose log file" disabled={disabled} onChange={e => { if (e.target.files) onFiles(Array.from(e.target.files)); e.target.value = '' }} />
      <div className="mt-5 flex items-center justify-center gap-2 text-xs text-muted-foreground"><ShieldCheck size={14} /><span>Private by design. Your logs never leave this browser.</span></div>
      <div className="mt-8 flex items-start gap-3 rounded-lg border bg-card px-4 py-3 text-xs leading-relaxed text-muted-foreground"><FileText size={16} className="mt-0.5 shrink-0" /><p>Start with raw logs. JSON and CSV are shown line by line—no parsing, transformations, or changes to your file.</p></div>
    </div>
  )
}
