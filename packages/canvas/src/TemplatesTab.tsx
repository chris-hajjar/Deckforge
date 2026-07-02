/**
 * TemplatesTab — visual template library.
 * Every template renders as a real thumbnail (the same solver that draws
 * slides draws these, with the active theme's tokens), with add-to-deck,
 * delete, and .pptx import.
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
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () =>
    fetch("/api/templates?full=1")
      .then((r) => r.json())
      .then((d) => setTemplates(d.templates ?? []))
      .catch(() => {});
  useEffect(() => {
    refresh();
  }, []);

  const addToDeck = async (name: string) => {
    await fetch("/api/slides", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template: name }),
    });
    onAdded();
  };

  const remove = async (name: string) => {
    if (!window.confirm(`Delete template "${name}"?`)) return;
    await fetch(`/api/templates/${encodeURIComponent(name)}`, { method: "DELETE" });
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

  return (
    <div className="tab-body">
      <div className="tpl-toolbar">
        <h2>Templates</h2>
        <span className="hint">
          Previewed with the active design system — the same template restyles per brand. Save any
          deck slide as a template from the Deck tab's inspector.
        </span>
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
          <div key={t.name} className="tpl-card">
            <div className="tpl-thumb">
              <SlideCanvas deck={deck} slide={t.slide} tokens={tokens} scale={0.22} interactive={false} />
            </div>
            <div className="tpl-meta">
              <strong>{t.name}</strong>
              {t.description && <span className="mini">{t.description}</span>}
              {t.tags && t.tags.length > 0 && <span className="mini">#{t.tags.join(" #")}</span>}
              <div className="btn-row">
                <button className="primary" onClick={() => addToDeck(t.name)}>
                  + add to deck
                </button>
                <button className="danger" onClick={() => remove(t.name)}>
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
