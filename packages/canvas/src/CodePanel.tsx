/**
 * CodePanel — the DevTools-style code view of a slide.
 *
 * The slide's JSON is directly editable; Apply sends it through the same
 * validate → auto-correct pipeline as every other edit (hand-typed hex
 * still snaps to brand tokens). Hovering an element on the canvas — or
 * selecting one — highlights its JSON block here and scrolls it into view,
 * exactly like hovering DOM nodes in the Chrome inspector.
 *
 * Editor mechanics: a transparent-text <textarea> stacked on a <pre> that
 * renders the same text with the highlight span — the standard lightweight
 * highlight-inside-textarea technique, no editor dependency. Element →
 * character-range mapping comes from a string-aware brace scanner over the
 * canonical serialization; while the buffer is dirty (unsaved edits) the
 * mapping is suspended until Apply/Reset.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Operation } from "fast-json-patch";
import type { Slide } from "@deckforge/schema";

interface Props {
  slide: Slide;
  slideIndex: number;
  hoveredId: string | null;
  selectedId: string | null;
  sendPatches: (patches: Operation[]) => void;
  /** Reverse direction: caret inside a JSON block selects it on the canvas. */
  onSelectElement?: (nodeId: string) => void;
}

/**
 * Map every element id to the [start, end) character range of its enclosing
 * JSON object in `text`. String-aware: braces inside string literals are
 * ignored.
 */
function elementRanges(text: string): Map<string, [number, number]> {
  // one pass: record brace pair spans
  const opens: number[] = [];
  const pairs: Array<[number, number]> = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") opens.push(i);
    else if (ch === "}") {
      const start = opens.pop();
      if (start !== undefined) pairs.push([start, i + 1]);
    }
  }
  // for each `"id": "..."` occurrence, its element block is the SMALLEST
  // brace pair containing it
  const ranges = new Map<string, [number, number]>();
  const idRe = /"id":\s*"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = idRe.exec(text)) !== null) {
    const pos = m.index;
    let best: [number, number] | null = null;
    for (const [s, e] of pairs) {
      if (s <= pos && pos < e && (!best || e - s < best[1] - best[0])) best = [s, e];
    }
    if (best) ranges.set(m[1], best);
  }
  return ranges;
}

export function CodePanel({ slide, slideIndex, hoveredId, selectedId, sendPatches, onSelectElement }: Props) {
  const canonical = useMemo(() => JSON.stringify(slide, null, 2), [slide]);
  const [text, setText] = useState(canonical);
  const [error, setError] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);

  const dirty = text !== canonical;

  // stay live with AI/canvas edits while the buffer is clean: if the buffer
  // matched the previous canonical text, follow the new one
  const lastCanonical = useRef(canonical);
  useEffect(() => {
    setText((prev) => (prev === lastCanonical.current ? canonical : prev));
    lastCanonical.current = canonical;
  }, [canonical]);

  const ranges = useMemo(() => (dirty ? null : elementRanges(text)), [text, dirty]);
  const activeId = hoveredId ?? selectedId;
  const range = !dirty && activeId ? (ranges?.get(activeId) ?? null) : null;

  // scroll the highlighted block into view (top third)
  useEffect(() => {
    if (!range || !taRef.current) return;
    const lineHeight = 15.6; // 12px mono * 1.3
    const line = text.slice(0, range[0]).split("\n").length - 1;
    const target = Math.max(0, line * lineHeight - taRef.current.clientHeight / 3);
    taRef.current.scrollTop = target;
    if (preRef.current) preRef.current.scrollTop = target;
  }, [range, text]);

  const apply = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      setError(`Invalid JSON: ${(e as Error).message}`);
      return;
    }
    setError(null);
    sendPatches([{ op: "replace", path: `/slides/${slideIndex}`, value: parsed } as Operation]);
    // server echo will refresh `canonical`; clear local buffer to re-sync
    setText(JSON.stringify(parsed, null, 2));
  };

  /** Chrome-inspector reverse: the caret's enclosing element gets selected. */
  const selectAtCaret = () => {
    if (!ranges || !taRef.current || !onSelectElement) return;
    const pos = taRef.current.selectionStart;
    let best: string | null = null;
    let bestLen = Infinity;
    for (const [id, [s, e]] of ranges) {
      if (s <= pos && pos < e && e - s < bestLen) {
        best = id;
        bestLen = e - s;
      }
    }
    if (best) onSelectElement(best);
  };

  const syncScroll = () => {
    if (taRef.current && preRef.current) {
      preRef.current.scrollTop = taRef.current.scrollTop;
      preRef.current.scrollLeft = taRef.current.scrollLeft;
    }
  };

  return (
    <div className="code-panel">
      <div className="code-toolbar">
        <span className="mini">
          {dirty ? "edited — apply to run brand validation" : "live · hover the slide to locate code"}
        </span>
        <button className="primary" onClick={apply} disabled={!dirty} title="Apply (validates + brand-corrects)">
          apply
        </button>
        <button onClick={() => { setText(canonical); setError(null); }} disabled={!dirty}>
          reset
        </button>
      </div>
      {error && <p className="warn code-error">⚠ {error}</p>}
      <div className="code-editor">
        <pre ref={preRef} aria-hidden="true">
          {range ? (
            <>
              {text.slice(0, range[0])}
              <mark>{text.slice(range[0], range[1])}</mark>
              {text.slice(range[1])}
            </>
          ) : (
            text
          )}
        </pre>
        <textarea
          ref={taRef}
          value={text}
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          onScroll={syncScroll}
          onClick={selectAtCaret}
          onKeyUp={(e) => {
            if (e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End") selectAtCaret();
          }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") apply();
          }}
        />
      </div>
    </div>
  );
}
