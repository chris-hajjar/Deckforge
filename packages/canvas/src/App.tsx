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

const GOOGLE_G = (
  <svg width="15" height="15" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
);

export function App() {
  const { state, sendPatches } = useDeck();
  const [slideIndex, setSlideIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [presenting, setPresenting] = useState(false);
  const [tab, setTab] = useState<Tab>("deck");
  const [sideTab, setSideTab] = useState<"inspect" | "code">("inspect");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Array<{ name: string; description?: string }>>([]);
  const [googleSetup, setGoogleSetup] = useState(false);
  const [googleBusy, setGoogleBusy] = useState<string | null>(null);
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

  const openInSlides = async () => {
    const st = await fetch("/api/google/status").then((r) => r.json());
    if (!st.configured) {
      setGoogleSetup(true);
      return;
    }
    if (!st.connected) {
      window.open("/api/google/connect", "_blank");
      setGoogleBusy("waiting for Google sign-in…");
      for (let i = 0; i < 80; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const s = await fetch("/api/google/status").then((r) => r.json());
        if (s.connected) break;
        if (i === 79) {
          setGoogleBusy(null);
          alert("Sign-in wasn't completed — finish it in the Google tab, then click again.");
          return;
        }
      }
    }
    setGoogleBusy("uploading to Google Slides…");
    const res = await fetch("/api/google/open-in-slides", { method: "POST" });
    const d = await res.json();
    setGoogleBusy(null);
    if (!res.ok) alert(`Google Slides: ${d.error}`);
    else window.open(d.url, "_blank");
  };

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
        <button className="present-btn google-btn" onClick={openInSlides} disabled={googleBusy != null} title="Upload the deck to your Google Drive as a native Slides file and open it">
          {GOOGLE_G} {googleBusy ?? "Slides"}
        </button>
        <a className="export" href="/api/export.pptx">
          Export .pptx
        </a>
      </header>

      {googleSetup && (
        <div className="modal-backdrop" onClick={() => setGoogleSetup(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Connect Google Slides</h2>
            <p className="hint">
              One-time setup by the app owner — after this, anyone using this Deckforge can sign in
              with their own Google account, like any normal app:
            </p>
            <ol className="hint setup-steps">
              <li>Go to <b>console.cloud.google.com</b> → create (or pick) a project</li>
              <li>APIs &amp; Services → <b>Enable APIs</b> → enable <b>Google Drive API</b></li>
              <li>APIs &amp; Services → <b>OAuth consent screen</b> → External → add yourself as a test user</li>
              <li>Credentials → <b>Create credentials → OAuth client ID</b> → type <b>Web application</b>, and add <code>http://localhost:4820/api/google/callback</code> as an authorized redirect URI</li>
              <li>Paste the Client ID and Client Secret below</li>
            </ol>
            <label>Client ID</label>
            <input id="g-client-id" placeholder="xxxxx.apps.googleusercontent.com" />
            <label>Client secret</label>
            <input id="g-client-secret" placeholder="GOCSPX-…" />
            <div className="btn-row">
              <button
                className="primary"
                onClick={async () => {
                  const client_id = (document.getElementById("g-client-id") as HTMLInputElement).value;
                  const client_secret = (document.getElementById("g-client-secret") as HTMLInputElement).value;
                  const res = await fetch("/api/google/config", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ client_id, client_secret }),
                  });
                  if (!res.ok) alert((await res.json()).error);
                  else {
                    setGoogleSetup(false);
                    openInSlides();
                  }
                }}
              >
                Save &amp; sign in
              </button>
              <button onClick={() => setGoogleSetup(false)}>cancel</button>
            </div>
          </div>
        </div>
      )}

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
              title={s.name ?? s.id}
              onClick={() => {
                setSlideIndex(i);
                setSelectedId(null);
              }}
            >
              <SlideCanvas deck={deck} slide={s} tokens={tokens} scale={0.117} interactive={false} />
              <span className="thumb-num">{i + 1}</span>
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
