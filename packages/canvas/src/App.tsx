/**
 * App — Deckforge canvas shell: slide rail | 16:9 canvas | inspector.
 * All state lives on the server; this app renders it and emits patches.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Operation } from "fast-json-patch";
import { findNode, type Frame } from "@deckforge/schema";
import { solveSlide } from "@deckforge/layout";
import { SlideCanvas } from "./SlideCanvas.js";
import { Inspector } from "./Inspector.js";
import { CodePanel } from "./CodePanel.js";
import { Present } from "./Present.js";
import { DesignTab } from "./DesignTab.js";
import { TemplatesTab } from "./TemplatesTab.js";
import { useDeck } from "./useDeck.js";

type Tab = "deck" | "design" | "templates";

export function App() {
  const { state, sendPatches } = useDeck();
  const [slideIndex, setSlideIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [presenting, setPresenting] = useState(false);
  const [tab, setTab] = useState<Tab>("deck");
  const [sideTab, setSideTab] = useState<"inspect" | "code">("inspect");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Array<{ name: string; description?: string }>>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchTemplates = () =>
    fetch("/api/templates")
      .then((r) => r.json())
      .then((d) => setTemplates(d.templates ?? []))
      .catch(() => {});
  useEffect(() => {
    fetchTemplates();
  }, []);

  const importPptx = async (file: File) => {
    const res = await fetch(`/api/import?name=${encodeURIComponent(file.name.replace(/\.pptx$/i, ""))}`, {
      method: "POST",
      body: file,
    });
    const data = await res.json();
    if (!res.ok) alert(`Import failed: ${data.error}`);
    else alert(`Imported ${data.imported.length} template(s):\n${data.imported.join("\n")}`);
    fetchTemplates();
  };

  const addFromTemplate = async (name: string) => {
    await fetch("/api/slides", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template: name }),
    });
  };
  const mainRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.6);

  // re-attach whenever the Deck tab (re)mounts — a stale observer after a
  // tab round-trip left the preview with a bogus scale until refresh
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const update = () =>
      setScale(
        Math.max(0.05, Math.min((el.clientWidth - 48) / 1280, (el.clientHeight - 80) / 720)),
      );
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [state != null, tab]);

  // arrow keys step through slides (unless typing in a field)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (tab !== "deck" || presenting || !state) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) {
        return;
      }
      const last = state.deck.slides.length - 1;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        setSlideIndex((i) => Math.min(last, i + 1));
        setSelectedId(null);
        e.preventDefault();
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        setSlideIndex((i) => Math.max(0, i - 1));
        setSelectedId(null);
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab, presenting, state]);

  const warnings = useMemo(() => {
    if (!state) return [];
    const slide = state.deck.slides[slideIndex];
    return slide ? solveSlide(slide, state.tokens).warnings : [];
  }, [state, slideIndex]);

  if (!state) return <div className="boot">Connecting to Deckforge…</div>;
  const { deck, tokens, rev, lastCorrections, lastSource, connected } = state;
  const safeIndex = Math.min(slideIndex, deck.slides.length - 1);
  const slide = deck.slides[safeIndex];

  const editText = (nodeId: string, text: string) => {
    const visit = findNode(deck, nodeId);
    if (visit) sendPatches([{ op: "replace", path: `${visit.pointer}/text`, value: text }]);
  };

  const changeFrame = (nodeId: string, frame: Frame) => {
    const visit = findNode(deck, nodeId);
    if (visit) sendPatches([{ op: "replace", path: `${visit.pointer}/frame`, value: frame }]);
  };

  const activateTheme = (name: string) =>
    sendPatches([{ op: "replace", path: "/theme", value: { base: name } }]);

  if (presenting) {
    return (
      <Present deck={deck} tokens={tokens} startIndex={safeIndex} onExit={() => setPresenting(false)} />
    );
  }

  const addSlide = () => {
    const id = `slide-${Math.random().toString(36).slice(2, 8)}`;
    sendPatches([
      {
        op: "add",
        path: "/slides/-",
        value: {
          id,
          root: {
            id: `${id}-root`,
            type: "column",
            style: { gap: 24 },
            children: [{ id: `${id}-h`, type: "heading", text: "New slide", level: 2 }],
          },
        },
      } as Operation,
    ]);
    setSlideIndex(deck.slides.length);
  };

  const deleteSlide = (i: number) => {
    if (deck.slides.length <= 1) return;
    sendPatches([{ op: "remove", path: `/slides/${i}` } as Operation]);
    setSlideIndex(Math.max(0, i - 1));
    setSelectedId(null);
  };

  const moveSlide = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= deck.slides.length) return;
    sendPatches([
      { op: "move", from: `/slides/${i}`, path: `/slides/${j}` } as unknown as Operation,
    ]);
    setSlideIndex(j);
  };

  return (
    <div className="shell">
      <header>
        <span className="logo">⚒ Deckforge</span>
        <nav className="tabs">
          {(["deck", "design", "templates"] as const).map((t) => (
            <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
              {t === "deck" ? "Deck" : t === "design" ? "Design systems" : "Templates"}
            </button>
          ))}
        </nav>
        <input
          className="deck-title"
          key={deck.title}
          defaultValue={deck.title}
          onBlur={(e) =>
            e.target.value !== deck.title &&
            sendPatches([{ op: "replace", path: "/title", value: e.target.value }])
          }
        />
        <span className={`conn ${connected ? "on" : "off"}`}>
          {connected ? `live · rev ${rev}` : "reconnecting…"}
        </span>
        <button className="present-btn" onClick={() => fileRef.current?.click()} title="Import a PowerPoint or Google Slides .pptx as templates">
          ⬆ Import .pptx
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".pptx"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importPptx(f);
            e.target.value = "";
          }}
        />
        <button className="present-btn" onClick={() => setPresenting(true)}>
          ▶ Present
        </button>
        <a className="export" href="/api/export.pptx">
          Export .pptx
        </a>
      </header>

      {tab === "design" && <DesignTab onActivate={activateTheme} />}
      {tab === "templates" && (
        <TemplatesTab
          deck={deck}
          tokens={tokens}
          onAdded={() => {
            setTab("deck");
            setSlideIndex(deck.slides.length);
          }}
        />
      )}
      {tab === "deck" && (
      <div className="body">
        <nav className="rail">
          {deck.slides.map((s, i) => (
            <div
              key={s.id}
              className={`thumb ${i === safeIndex ? "active" : ""}`}
              onClick={() => {
                setSlideIndex(i);
                setSelectedId(null);
              }}
            >
              <SlideCanvas deck={deck} slide={s} tokens={tokens} scale={0.117} interactive={false} />
              <div className="thumb-meta">
                <span>
                  {i + 1}. {s.name ?? s.id}
                </span>
                <span className="thumb-actions">
                  <button onClick={(e) => (e.stopPropagation(), moveSlide(i, -1))}>↑</button>
                  <button onClick={(e) => (e.stopPropagation(), moveSlide(i, 1))}>↓</button>
                  <button onClick={(e) => (e.stopPropagation(), deleteSlide(i))}>✕</button>
                </span>
              </div>
            </div>
          ))}
          <button className="add-slide" onClick={addSlide}>
            + Slide
          </button>
          {templates.length > 0 && (
            <select
              className="tpl-select"
              value=""
              onFocus={fetchTemplates}
              onChange={(e) => {
                if (e.target.value) {
                  addFromTemplate(e.target.value);
                  setSlideIndex(deck.slides.length);
                }
              }}
            >
              <option value="">+ from template…</option>
              {templates.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
        </nav>

        <main ref={mainRef}>
          <SlideCanvas
            deck={deck}
            slide={slide}
            tokens={tokens}
            scale={scale}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onEditText={editText}
            onFrameChange={changeFrame}
            onHover={setHoveredId}
            hoveredId={sideTab === "code" ? hoveredId : null}
          />
          <div className="statusbar">
            {warnings.map((w, i) => (
              <span key={i} className="warn">
                ⚠ {w}
              </span>
            ))}
            {lastCorrections.length > 0 && (
              <span className="corrections">
                brand engine corrected {lastCorrections.length} value
                {lastCorrections.length > 1 ? "s" : ""} ({lastSource}):{" "}
                {lastCorrections
                  .map((c) => `${c.field} ${JSON.stringify(c.from)}→${JSON.stringify(c.to)}`)
                  .join(", ")}
              </span>
            )}
          </div>
        </main>

        <div className={`sidebar ${sideTab === "code" ? "wide" : ""}`}>
          <div className="side-tabs">
            <button className={sideTab === "inspect" ? "active" : ""} onClick={() => setSideTab("inspect")}>
              Inspect
            </button>
            <button className={sideTab === "code" ? "active" : ""} onClick={() => setSideTab("code")}>
              Code
            </button>
          </div>
          {sideTab === "inspect" ? (
            <Inspector
              deck={deck}
              tokens={tokens}
              slideIndex={safeIndex}
              selectedId={selectedId}
              sendPatches={sendPatches}
              onDeselect={() => setSelectedId(null)}
            />
          ) : (
            <CodePanel
              slide={slide}
              slideIndex={safeIndex}
              hoveredId={hoveredId}
              selectedId={selectedId}
              sendPatches={sendPatches}
              onSelectElement={setSelectedId}
            />
          )}
        </div>
      </div>
      )}
    </div>
  );
}
