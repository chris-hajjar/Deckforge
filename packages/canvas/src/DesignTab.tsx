/**
 * DesignTab — visual design-system management.
 * Cards for every registered theme (activate / duplicate / edit / delete),
 * and a full-depth editor: every color role with a real picker, fonts, all
 * named font sizes, spacing & font-size scales, radii, and the 8-slot chart
 * palette — with a live sample slide that re-renders on every keystroke.
 * Saving re-brands any open deck that uses the theme, live.
 */
import { useEffect, useMemo, useState } from "react";
import type { Slide, ThemeTokens } from "@deckforge/schema";
import { COLOR_ROLES, FONT_IDS, ThemeTokensSchema } from "@deckforge/schema";
import { SlideCanvas } from "./SlideCanvas.js";
import type { Deck } from "@deckforge/schema";

/** Sample slide exercising every token group, for the live preview. */
const SAMPLE: Slide = {
  id: "preview",
  padding: 48,
  root: {
    id: "p-root",
    type: "column",
    style: { gap: 24 },
    children: [
      { id: "p-h", type: "heading", text: "Design system preview", level: 1 },
      {
        id: "p-t",
        type: "text",
        text: "Body copy in the brand voice — secondary ink below.",
      },
      { id: "p-t2", type: "text", text: "Secondary text and captions.", style: { color: "text-secondary" } },
      {
        id: "p-row",
        type: "row",
        style: { gap: 16 },
        children: [
          { id: "p-m1", type: "metricCard", label: "Metric", value: "$4.2M", delta: "+12%" },
          {
            id: "p-sh",
            type: "shape",
            shape: "chevron",
            fill: "accent",
            text: "Shape",
          },
          {
            id: "p-ch",
            type: "chart",
            chartType: "column",
            categories: ["A", "B", "C"],
            series: [
              { name: "One", values: [3, 5, 4] },
              { name: "Two", values: [2, 4, 6] },
            ],
          },
        ],
      },
      { id: "p-l", type: "bulletList", items: ["Bullets on the spacing scale", "Snapped, always"] },
    ],
  },
} as Slide;

const PREVIEW_DECK = { schemaVersion: 2, title: "", theme: { base: "corporate-bold" }, slides: [SAMPLE] } as Deck;

interface ThemesResponse {
  themes: ThemeTokens[];
  builtin: string[];
  custom: string[];
  active: string;
}

const FONT_SIZE_KEYS = ["display", "h1", "h2", "body", "small", "metricValue", "metricLabel"] as const;
const RADIUS_KEYS = ["none", "sm", "md"] as const;

export function DesignTab({ onActivate }: { onActivate: (name: string) => void | Promise<void> }) {
  const [data, setData] = useState<ThemesResponse | null>(null);
  const [draft, setDraft] = useState<ThemeTokens | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const refresh = () =>
    fetch("/api/themes")
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  useEffect(() => {
    refresh();
  }, []);

  const previewTokens = useMemo(() => {
    if (!draft) return null;
    const parsed = ThemeTokensSchema.safeParse(draft);
    return parsed.success ? parsed.data : null;
  }, [draft]);

  if (!data) return <div className="boot">Loading design systems…</div>;

  const activate = async (name: string) => {
    await onActivate(name);
    // deck theme applies over WS; re-pull so the active badge follows
    setTimeout(refresh, 300);
  };

  /** Edit any theme in place (editing a built-in saves a project override). */
  const startEdit = (tokens: ThemeTokens) => {
    setDraft(structuredClone(tokens) as ThemeTokens);
    setIsNew(false);
    setError(null);
    setSaved(null);
  };

  /** New design system, seeded from the active theme's tokens. */
  const startNew = () => {
    const seed = data.themes.find((t) => t.name === data.active) ?? data.themes[0];
    setDraft(structuredClone({ ...seed, name: "" }) as ThemeTokens);
    setIsNew(true);
    setError(null);
    setSaved(null);
  };

  const save = async () => {
    const parsed = ThemeTokensSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).slice(0, 3).join(" · "));
      return;
    }
    const res = await fetch("/api/themes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed.data),
    });
    const body = await res.json();
    if (!res.ok) setError(body.error);
    else {
      setError(null);
      setSaved(parsed.data.name);
      setIsNew(false);
      refresh();
    }
  };

  const remove = async (name: string) => {
    if (!window.confirm(`Delete design system "${name}"?`)) return;
    const res = await fetch(`/api/themes/${encodeURIComponent(name)}`, { method: "DELETE" });
    if (!res.ok) alert((await res.json()).error);
    refresh();
  };

  const set = (fn: (d: ThemeTokens) => void) =>
    setDraft((d) => {
      if (!d) return d;
      const next = structuredClone(d) as ThemeTokens;
      fn(next);
      return next;
    });

  /** Ensure draft.brand (and optionally a sub-object) exists, then mutate. */
  const setBrand = (fn: (b: NonNullable<ThemeTokens["brand"]>) => void) =>
    set((d) => {
      d.brand = d.brand ?? {};
      fn(d.brand);
    });

  const listInput = (
    label: string,
    values: string[] | undefined,
    onChange: (v: string[] | undefined) => void,
    opts: { rows?: number; placeholder?: string } = {},
  ) => (
    <>
      <label>{label}</label>
      <textarea
        key={`${draft?.name}-${label}`}
        rows={opts.rows ?? 2}
        placeholder={opts.placeholder}
        defaultValue={(values ?? []).join("\n")}
        onBlur={(e) => {
          const items = e.target.value.split("\n").map((s) => s.trim()).filter(Boolean);
          onChange(items.length ? items : undefined);
        }}
      />
    </>
  );

  const textInput = (
    label: string,
    value: string | undefined,
    onChange: (v: string | undefined) => void,
    opts: { rows?: number; placeholder?: string } = {},
  ) => (
    <>
      <label>{label}</label>
      {opts.rows ? (
        <textarea
          key={`${draft?.name}-${label}`}
          rows={opts.rows}
          placeholder={opts.placeholder}
          defaultValue={value ?? ""}
          onBlur={(e) => onChange(e.target.value.trim() || undefined)}
        />
      ) : (
        <input
          key={`${draft?.name}-${label}`}
          placeholder={opts.placeholder}
          defaultValue={value ?? ""}
          onBlur={(e) => onChange(e.target.value.trim() || undefined)}
        />
      )}
    </>
  );

  const numListInput = (
    label: string,
    values: number[],
    onChange: (v: number[]) => void,
    hint?: string,
  ) => (
    <>
      <label>
        {label} {hint && <span className="val">{hint}</span>}
      </label>
      <input
        defaultValue={values.join(", ")}
        key={`${draft?.name}-${label}`}
        onBlur={(e) => {
          const nums = e.target.value
            .split(/[,\s]+/)
            .map(Number)
            .filter((n) => Number.isFinite(n));
          if (nums.length > 0) onChange(nums);
        }}
      />
    </>
  );

  return (
    <div className="tab-body design-tab">
      <section className="theme-list">
        <h2>Design systems</h2>
        <button className="primary new-ds" onClick={startNew}>
          + New design system
        </button>
        <p className="hint">
          Activate to restyle the whole deck. Edit anything — editing a built-in saves a project
          override you can revert. Everything here is also available to the AI
          (get_design_system / register_theme).
        </p>
        {data.themes.map((t) => {
          const isBuiltin = data.builtin.includes(t.name);
          const isCustom = data.custom.includes(t.name);
          const isActive = data.active === t.name;
          return (
            <div key={t.name} className={`theme-card ${isActive ? "active" : ""}`}>
              <div className="theme-card-head">
                <strong>{t.name}</strong>
                {isActive && <span className="chip">active</span>}
                {isBuiltin && <span className="mini">{isCustom ? "built-in · edited" : "built-in"}</span>}
              </div>
              <div className="swatches">
                {COLOR_ROLES.map((r) => (
                  <span key={r} className="swatch" title={`${r}: ${t.colors[r]}`} style={{ background: t.colors[r] }} />
                ))}
              </div>
              <div className="mini">
                {t.fonts.heading} headings · {t.fonts.body} body · h1 {t.fontSizes.h1}px
              </div>
              <div className="btn-row wrap">
                {!isActive && <button onClick={() => activate(t.name)}>activate</button>}
                <button onClick={() => startEdit(t)}>edit</button>
                {isCustom && !isActive && (
                  <button className="danger" onClick={() => remove(t.name)}>
                    {isBuiltin ? "revert" : "delete"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </section>

      {draft ? (
        <section className="theme-editor">
          <h2>{isNew ? "New design system" : `Editing ${draft.name}`}</h2>
          <label>Name</label>
          <input
            value={draft.name}
            disabled={!isNew}
            placeholder="my-brand"
            onChange={(e) => set((d) => (d.name = e.target.value.trim()))}
          />

          <h3>Brand identity</h3>
          <p className="hint">
            The half of a design system colors can't carry. The AI reads all of this and writes
            slide copy in your voice.
          </p>
          {textInput("Tagline", draft.brand?.tagline, (v) => setBrand((b) => (b.tagline = v)), { placeholder: "Robots that pay for themselves" })}
          {textInput("What the brand is", draft.brand?.description, (v) => setBrand((b) => (b.description = v)), { rows: 2 })}
          {textInput("Audience", draft.brand?.audience, (v) => setBrand((b) => (b.audience = v)), { placeholder: "Ops leaders at 3PLs and grocery retail" })}

          <h3>Voice &amp; tone</h3>
          {textInput("Tone", draft.brand?.voice?.tone, (v) => setBrand((b) => ((b.voice = b.voice ?? {}), (b.voice.tone = v))), { placeholder: "confident, concrete, zero hype" })}
          {listInput("Personality (one per line)", draft.brand?.voice?.personality, (v) => setBrand((b) => ((b.voice = b.voice ?? {}), (b.voice.personality = v))))}
          {listInput("Do (one per line)", draft.brand?.voice?.dos, (v) => setBrand((b) => ((b.voice = b.voice ?? {}), (b.voice.dos = v))), { placeholder: "lead with numbers\nshort declarative sentences" })}
          {listInput("Don't (one per line)", draft.brand?.voice?.donts, (v) => setBrand((b) => ((b.voice = b.voice ?? {}), (b.voice.donts = v))), { placeholder: "never say 'revolutionary'" })}
          {listInput("Preferred terms", draft.brand?.voice?.preferredTerms, (v) => setBrand((b) => ((b.voice = b.voice ?? {}), (b.voice.preferredTerms = v))))}
          {listInput("Avoid terms", draft.brand?.voice?.avoidTerms, (v) => setBrand((b) => ((b.voice = b.voice ?? {}), (b.voice.avoidTerms = v))))}
          {textInput("Example copy (a paragraph that sounds like you)", draft.brand?.voice?.exampleCopy, (v) => setBrand((b) => ((b.voice = b.voice ?? {}), (b.voice.exampleCopy = v))), { rows: 3 })}

          <h3>Logos</h3>
          {(draft.brand?.logos ?? []).map((logo, i) => (
            <div key={i} className="logo-row">
              {logo.src && <img src={logo.src} alt={logo.name} />}
              <input
                defaultValue={logo.name}
                placeholder="name"
                onBlur={(e) => setBrand((b) => (b.logos![i].name = e.target.value))}
              />
              <select
                value={logo.usage ?? "primary"}
                onChange={(e) => setBrand((b) => (b.logos![i].usage = e.target.value as never))}
              >
                {["primary", "mark", "light-bg", "dark-bg"].map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
              <button
                onClick={() => setBrand((b) => (b.logos = b.logos!.filter((_, j) => j !== i)))}
                className="danger"
              >
                ✕
              </button>
            </div>
          ))}
          <div className="btn-row">
            <button
              onClick={() => {
                const input = document.createElement("input");
                input.type = "file";
                input.accept = "image/*";
                input.onchange = () => {
                  const file = input.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () =>
                    setBrand((b) => {
                      b.logos = [
                        ...(b.logos ?? []),
                        { name: file.name.replace(/\.[a-z]+$/i, ""), src: String(reader.result), usage: "primary" },
                      ];
                    });
                  reader.readAsDataURL(file);
                };
                input.click();
              }}
            >
              + upload logo
            </button>
          </div>

          <h3>Imagery</h3>
          {textInput("Style", draft.brand?.imagery?.style, (v) => setBrand((b) => ((b.imagery = b.imagery ?? {}), (b.imagery.style = v))), { placeholder: "documentary photography, no stock clichés" })}
          {textInput("Guidance", draft.brand?.imagery?.guidance, (v) => setBrand((b) => ((b.imagery = b.imagery ?? {}), (b.imagery.guidance = v))), { rows: 2 })}

          <h3>Colors</h3>
          <div className="color-grid">
            {COLOR_ROLES.map((role) => (
              <label key={role} className="color-field">
                <input
                  type="color"
                  value={draft.colors[role]}
                  onChange={(e) => set((d) => (d.colors[role] = e.target.value))}
                />
                <span>{role}</span>
                <code>{draft.colors[role]}</code>
              </label>
            ))}
          </div>

          <h3>Typography</h3>
          <div className="btn-row">
            {(["heading", "body"] as const).map((slot) => (
              <span key={slot} className="font-slot">
                <span className="mini">{slot}</span>
                {FONT_IDS.map((f) => (
                  <button
                    key={f}
                    className={draft.fonts[slot] === f ? "active" : ""}
                    onClick={() => set((d) => (d.fonts[slot] = f))}
                  >
                    {f}
                  </button>
                ))}
              </span>
            ))}
          </div>
          <div className="color-grid">
            {FONT_SIZE_KEYS.map((k) => (
              <label key={k} className="color-field">
                <input
                  type="number"
                  value={draft.fontSizes[k]}
                  onChange={(e) => set((d) => (d.fontSizes[k] = Number(e.target.value)))}
                  style={{ width: 64 }}
                />
                <span>{k}</span>
              </label>
            ))}
          </div>

          <h3>Scales &amp; shape</h3>
          {numListInput("Spacing scale (px)", draft.spacingScale, (v) => set((d) => (d.spacingScale = v as never)), "padding/gap/margins snap to these")}
          {numListInput("Font size scale (px)", draft.fontSizeScale, (v) => set((d) => (d.fontSizeScale = v as never)), "free sizes snap to these")}
          <div className="color-grid">
            {RADIUS_KEYS.map((k) => (
              <label key={k} className="color-field">
                <input
                  type="number"
                  value={draft.radius[k]}
                  onChange={(e) => set((d) => (d.radius[k] = Number(e.target.value)))}
                  style={{ width: 64 }}
                />
                <span>radius {k}</span>
              </label>
            ))}
          </div>

          <h3>Chart palette (8 slots, fixed order)</h3>
          <div className="color-grid">
            {draft.chartPalette.map((c, i) => (
              <label key={i} className="color-field">
                <input
                  type="color"
                  value={c}
                  onChange={(e) => set((d) => (d.chartPalette[i] = e.target.value))}
                />
                <span>slot {i + 1}</span>
              </label>
            ))}
          </div>
          <p className="hint">
            Slot order is the colorblind-safety mechanism — series take slots in sequence. If you
            change these, re-validate (docs/chart-palettes.md).
          </p>

          <div className="btn-row">
            <button className="primary" onClick={save}>
              {isNew ? "Create design system" : "Save changes"}
            </button>
            <button onClick={() => setDraft(null)}>close</button>
          </div>
          {error && <p className="warn">⚠ {error}</p>}
          {saved && <p className="corrections">Saved "{saved}" — decks using it re-branded live.</p>}

          <h3>Live preview</h3>
          {previewTokens ? (
            <SlideCanvas deck={PREVIEW_DECK} slide={SAMPLE} tokens={previewTokens} scale={0.5} interactive={false} />
          ) : (
            <p className="warn">⚠ fix the highlighted issue to preview</p>
          )}
        </section>
      ) : (
        <section className="theme-editor empty">
          <p className="hint">
            Hit <b>+ New design system</b> to create your own, or <b>edit</b> any existing one —
            every token is adjustable, with a live preview.
          </p>
        </section>
      )}
    </div>
  );
}
