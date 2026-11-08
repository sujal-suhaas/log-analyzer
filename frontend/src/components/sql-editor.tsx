import { useEffect, useLayoutEffect, useRef } from "react";
import { basicSetup } from "codemirror";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { PostgreSQL, SQLDialect, sql } from "@codemirror/lang-sql";
import { oneDark } from "@codemirror/theme-one-dark";

// The engine is DuckDB, which is PostgreSQL-flavoured but has its own keywords.
// Reusing the PostgreSQL keyword set plus DuckDB's extras keeps highlighting and
// completion honest instead of suggesting syntax the engine would reject.
const DUCKDB_KEYWORDS = [
  "qualify",
  "pivot",
  "unpivot",
  "exclude",
  "replace",
  "sample",
  "asof",
  "semi",
  "anti",
  "describe",
  "summarize",
  "struct",
  "list",
  "map",
  "union",
  "macro",
  "unnest",
  "epoch_ms",
  "strftime",
  "regexp_matches",
  "list_transform",
  "list_filter",
].join(" ");
const DuckDB = SQLDialect.define({
  ...PostgreSQL.spec,
  keywords: `${PostgreSQL.spec.keywords} ${DUCKDB_KEYWORDS}`,
});

// Loaded on demand by the Query view so the main bundle stays free of the editor.
export default function SqlEditor({
  value,
  columns,
  onChange,
  onRun,
  dark,
}: {
  value: string;
  columns: readonly string[];
  onChange: (value: string) => void;
  onRun: () => void;
  dark: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const change = useRef(onChange);
  const run = useRef(onRun);
  const theme = useRef(new Compartment());
  // The editor owns the document; props describe only its initial value and schema.
  const initial = useRef({ value, columns, dark });
  useLayoutEffect(() => {
    change.current = onChange;
  }, [onChange]);
  useLayoutEffect(() => {
    run.current = onRun;
  }, [onRun]);
  useEffect(() => {
    if (!host.current) return;
    const instance = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initial.current.value,
        extensions: [
          basicSetup,
          theme.current.of(initial.current.dark ? oneDark : []),
          sql({
            dialect: DuckDB,
            schema: { logs: [...initial.current.columns] },
          }),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ "aria-label": "SQL query" }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) change.current(update.state.doc.toString());
          }),
          EditorView.theme({
            "&": { backgroundColor: "transparent", fontSize: "12px" },
            ".cm-scroller": { fontFamily: "var(--font-mono, monospace)" },
            ".cm-gutters": { backgroundColor: "transparent" },
          }),
        ],
      }),
    });
    view.current = instance;
    return () => {
      instance.destroy();
      view.current = null;
    };
  }, []);
  useEffect(() => {
    view.current?.dispatch({ effects: theme.current.reconfigure(dark ? oneDark : []) });
  }, [dark]);
  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    const current = instance.state.doc.toString();
    if (current !== value)
      instance.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
  }, [value]);
  return (
    <div
      ref={host}
      className="h-full overflow-auto"
      onKeyDown={(event) => {
        if (!((event.ctrlKey || event.metaKey) && event.key === "Enter"))
          return;
        event.preventDefault();
        run.current();
      }}
    />
  );
}
