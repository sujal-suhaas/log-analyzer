import type { Highlight } from "@/lib/filters";

export function HighlightText({
  text,
  ranges = [],
}: {
  text: string;
  ranges?: Highlight[];
}) {
  let end = 0;
  return (
    <>
      {ranges.map(([start, stop]) => {
        const before = text.slice(end, start);
        end = stop;
        return (
          <span key={`${start}-${stop}`}>
            {before}
            <mark className="rounded bg-amber-300/25 text-inherit">
              {text.slice(start, stop)}
            </mark>
          </span>
        );
      })}
      {text.slice(end)}
    </>
  );
}
