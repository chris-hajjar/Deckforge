/**
 * TemplatesTab — visual template library.
 * Every template renders as a real thumbnail (the same solver that draws
 * slides draws these, with the active theme's tokens), with add-to-deck,
 * delete, .pptx import, and multi-select for bulk operations.
 */
import { useEffect, useRef, useState } from "react";
import type { Deck, Slide, ThemeTokens } from "@deckforge/schema";
import { SlideCanvas } from "./SlideCanvas.js";

interface FullTemplate {
  name: string;
  description?: string;
  tags?: string[];
  slide: Slide;
}

interface Props {
  deck: Deck;
  tokens: ThemeTokens;
  onAdded: () => void;
}

export function TemplatesTab({ deck, tokens, onAdded }: Props) {
  const [templates, setTemplates] = useState<FullTemplate[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () =>
    fetch("/api/templates?full=1")
      .then((r) => r.json())
      .then((d) => {
        const tpls: FullTemplate[] = d.templates ?? [];
        setTemplates(tpls);
        // drop selections for templates that no longer exist
        setSelected((prev) => new Set([...prev].filter((n) => tpls.some((t) => t.name === n))));
      })
      .catch(() => {});
  useEffect(() => {
    refresh();
  }, []);

  const toggle = (name: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const addToDeck = async (names: string[]) => {
    setBusy(true);
    // sequential keeps slides in library order
    for (const name of names) {
      await fetch("/api/slides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template: name }),
      });
    }
    setBusy(false);
    setSelected(new Set());
    onAdded();
  };

  const remove = async (names: string[]) => {
    const label = names.length === 1 ? `template "${names[0]}"` : `${names.length} templates`;
    if (!window.confirm(`Delete ${label}?`)) return;
    setBusy(true);
    for (const name of names) {
      await fetch(`/api/templates/${encodeURIComponent(name)}`, { method: "DELETE" });
    }
    setBusy(false);
    setSelected(new Set());
    refresh();
  };

  const importFile = async (file: File) => {
    const res = await fetch(
      `/api/import?name=${encodeURIComponent(file.name.replace(/\.pptx$/i, ""))}`,
      { method: "POST", body: file },
    );
    const data = await res.json();
    if (!res.ok) alert(`Import failed: ${data.error}`);
    refresh();
  };

  if (!templates) return <div className="boot">Loading templates…</div>;
  const selectedInOrder = templates.filter((t) => selected.has(t.name)).map((t) => t.name);

  return (
    <div className="tab-body">
      <div className="tpl-toolbar">
        <h2>Templates</h2>
        <span className="hint">
          Previewed with the active design system — the same template restyles per brand. Select
          multiple for bulk actions.
        </span>
        {selected.size > 0 ? (
          <span className="tpl-bulk">
            <span className="count">{selected.size} selected</span>
            <button className="primary" disabled={busy} onClick={() => addToDeck(selectedInOrder)}>
              + add {selected.size} to deck
            </button>
            <button className="danger" disabled={busy} onClick={() => remove(selectedInOrder)}>
              delete {selected.size}
            </button>
            <button disabled={busy} onClick={() => setSelected(new Set())}>
              clear
            </button>
          </span>
        ) : (
          templates.length > 0 && (
            <button onClick={() => setSelected(new Set(templates.map((t) => t.name)))}>
              select all
            </button>
          )
        )}
        <button onClick={() => fileRef.current?.click()}>⬆ Import .pptx</button>
        <input
          ref={fileRef}
          type="file"
          accept=".pptx"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importFile(f);
            e.target.value = "";
          }}
        />
      </div>
      {templates.length === 0 && (
        <p className="hint" style={{ padding: 24 }}>
          No templates yet. Save a slide as a template, register one via the AI, or import a
          PowerPoint/Google Slides .pptx.
        </p>
      )}
      <div className="tpl-grid">
        {templates.map((t) => (
          <div key={t.name} className={`tpl-card ${selected.has(t.name) ? "sel" : ""}`}>
            <input
              type="checkbox"
              className="tpl-check"
              checked={selected.has(t.name)}
              onChange={() => toggle(t.name)}
              title="Select for bulk actions"
            />
            <div className="tpl-thumb" onClick={() => toggle(t.name)}>
              <SlideCanvas deck={deck} slide={t.slide} tokens={tokens} scale={0.22} interactive={false} />
            </div>
            <div className="tpl-meta">
              <strong>{t.name}</strong>
              {t.description && <span className="mini">{t.description}</span>}
              {t.tags && t.tags.length > 0 && <span className="mini">#{t.tags.join(" #")}</span>}
              <div className="btn-row">
                <button className="primary" disabled={busy} onClick={() => addToDeck([t.name])}>
                  + add to deck
                </button>
                <button className="danger" disabled={busy} onClick={() => remove([t.name])}>
                  delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
