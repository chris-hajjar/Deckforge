/**
 * Inspector — the Retool-style property panel.
 * Knobs are generated from what the selected component allows; color pickers
 * only offer brand token roles, and sliders land on server-side scales (the
 * auto-correction engine snaps anything else). Every control emits JSON
 * Patch ops through the same pipeline the AI uses.
 */
import { useRef } from "react";
import type { Operation } from "fast-json-patch";
import {
  CHART_TYPES,
  COLOR_ROLES,
  FONT_IDS,
  SHAPE_KINDS,
  findNode,
  type Deck,
  type DeckNode,
  type Slide,
  type ThemeTokens,
} from "@deckforge/schema";

interface Props {
  deck: Deck;
  tokens: ThemeTokens;
  slideIndex: number;
  selectedId: string | null;
  sendPatches: (patches: Operation[]) => void;
  onDeselect: () => void;
}

const genId = (type: string) => `${type}-${Math.random().toString(36).slice(2, 8)}`;

function Swatches({
  tokens,
  value,
  allowNone,
  onPick,
}: {
  tokens: ThemeTokens;
  value?: string;
  allowNone?: boolean;
  onPick: (role: string | null) => void;
}) {
  return (
    <div className="swatches">
      {COLOR_ROLES.map((role) => (
        <button
          key={role}
          title={role}
          className={`swatch ${value === role ? "active" : ""}`}
          style={{ background: tokens.colors[role] }}
          onClick={() => onPick(role)}
        />
      ))}
      {allowNone && (
        <button
          title="none"
          className={`swatch none ${value === undefined ? "active" : ""}`}
          onClick={() => onPick(null)}
        />
      )}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="btn-row wrap">{children}</div>;
}

/**
 * Number field with −/+ steppers. With a `scale`, the steppers walk the
 * brand scale itself (so padding never gets stuck between snap points);
 * typed values still snap server-side.
 */
function Stepper({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  scale,
  decimals = 0,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  scale?: readonly number[];
  decimals?: number;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const round = (v: number) => Number(v.toFixed(decimals));
  const bump = (dir: 1 | -1) => {
    if (scale && scale.length) {
      const sorted = [...scale].sort((a, b) => a - b);
      const next =
        dir === 1
          ? sorted.find((s) => s > value)
          : [...sorted].reverse().find((s) => s < value);
      if (next !== undefined) onChange(clamp(next));
      return;
    }
    onChange(round(clamp(value + dir * step)));
  };
  return (
    <>
      <label>{label}</label>
      <div className="stepper">
        <button onClick={() => bump(-1)} aria-label={`decrease ${label}`}>−</button>
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={scale ? undefined : step}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) onChange(round(clamp(v)));
          }}
        />
        <button onClick={() => bump(1)} aria-label={`increase ${label}`}>+</button>
      </div>
    </>
  );
}

export function Inspector({ deck, tokens, slideIndex, selectedId, sendPatches, onDeselect }: Props) {
  const debounce = useRef<ReturnType<typeof setTimeout>>();
  const sendDebounced = (patches: Operation[]) => {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => sendPatches(patches), 180);
  };

  const slide: Slide | undefined = deck.slides[slideIndex];
  if (!slide) return <aside className="inspector" />;

  const visit = selectedId ? findNode(deck, selectedId) : undefined;
  const node = visit?.node;
  const pointer = visit?.pointer;
  const isOverlayRoot = pointer ? /\/overlays\/\d+$/.test(pointer) : false;

  const setField = (field: string, value: unknown) =>
    sendPatches(
      value === undefined
        ? [{ op: "remove", path: `${pointer}/${field}` } as Operation]
        : [{ op: "replace", path: `${pointer}/${field}`, value } as Operation],
    );

  const mergeObj = (
    field: "style" | "sizing" | "textStyle" | "border" | "gradient" | "frame" | "animation",
    key: string,
    value: unknown,
    debounced = false,
  ) => {
    const current = { ...((node as never as Record<string, Record<string, unknown>>)[field] ?? {}) };
    if (value === null) delete current[key];
    else current[key] = value;
    const op: Operation = { op: "replace", path: `${pointer}/${field}`, value: current };
    (debounced ? sendDebounced : sendPatches)([op]);
  };

  const slidePtr = `/slides/${slideIndex}`;
  const setSlideField = (field: string, value: unknown) =>
    sendPatches(
      value === undefined
        ? [{ op: "remove", path: `${slidePtr}/${field}` } as Operation]
        : [{ op: "replace", path: `${slidePtr}/${field}`, value } as Operation],
    );

  const addChild = (containerPtr: string, child: Record<string, unknown>) =>
    sendPatches([{ op: "add", path: `${containerPtr}/children/-`, value: child } as Operation]);

  const addOverlay = (element: Record<string, unknown>, frame: Record<string, number>) =>
    sendPatches([
      slide.overlays
        ? ({ op: "add", path: `${slidePtr}/overlays/-`, value: { ...element, frame } } as Operation)
        : ({ op: "add", path: `${slidePtr}/overlays`, value: [{ ...element, frame }] } as Operation),
    ]);

  const spacingMax = Math.max(...tokens.spacingScale);
  const sizes = tokens.fontSizeScale;

  // ---------- shared sections ----------
  const animSection = (n: DeckNode) => {
    const a = n.animation;
    return (
      <>
        <label>Animate in</label>
        <Row>
          {(["none", "appear", "fade", "flyIn", "zoom", "wipe"] as const).map((eff) => (
            <button
              key={eff}
              className={(a?.effect ?? "none") === eff ? "active" : ""}
              onClick={() =>
                eff === "none"
                  ? setField("animation", undefined)
                  : setField("animation", { ...(a ?? { order: 1 }), effect: eff })
              }
            >
              {eff}
            </button>
          ))}
        </Row>
        {a && (a.effect === "flyIn" || a.effect === "wipe") && (
          <Row>
            {(["left", "right", "top", "bottom"] as const).map((d) => (
              <button
                key={d}
                className={(a.direction ?? "bottom") === d ? "active" : ""}
                onClick={() => mergeObj("animation", "direction", d)}
              >
                {d}
              </button>
            ))}
          </Row>
        )}
        {a && (
          <>
            <label>
              Click order <span className="val">{a.order ?? 1}</span>
            </label>
            <input
              type="range"
              min={1}
              max={8}
              value={a.order ?? 1}
              onChange={(e) => mergeObj("animation", "order", Number(e.target.value), true)}
            />
            {n.type === "bulletList" && (
              <Row>
                <button
                  className={a.byParagraph ? "active" : ""}
                  onClick={() => mergeObj("animation", "byParagraph", !a.byParagraph)}
                >
                  one bullet per click
                </button>
              </Row>
            )}
          </>
        )}
      </>
    );
  };

  /** Margin knobs on every flow element — spacing anywhere you need it. */
  const marginSection = (n: DeckNode) => {
    if (isOverlayRoot) return null; // overlays position by frame, not margin
    const sizing = ((n as { sizing?: Record<string, unknown> }).sizing ?? {}) as Record<string, unknown>;
    const margin = (sizing.margin ?? {}) as Record<string, number>;
    const setSide = (side: string, v: number) => {
      const next = { ...margin, [side]: v };
      if (v === 0) delete next[side];
      const nextSizing = { ...sizing, margin: Object.keys(next).length ? next : undefined };
      if (!nextSizing.margin) delete nextSizing.margin;
      sendDebounced([
        { op: "replace", path: `${pointer}/sizing`, value: nextSizing } as Operation,
      ]);
    };
    return (
      <>
        <label>Margin (snaps to brand scale)</label>
        <div className="frame-grid">
          {(["top", "bottom", "left", "right"] as const).map((side) => (
            <label key={side} className="frame-field">
              {side[0].toUpperCase()}
              <input
                type="number"
                min={0}
                value={margin[side] ?? 0}
                onChange={(e) => setSide(side, Math.max(0, Number(e.target.value)))}
              />
            </label>
          ))}
        </div>
      </>
    );
  };

  const chartPanel = (n: Extract<DeckNode, { type: "chart" }>) => (
    <>
      <label>Chart type</label>
      <Row>
        {CHART_TYPES.map((t) => (
          <button key={t} className={n.chartType === t ? "active" : ""} onClick={() => setField("chartType", t)}>
            {t}
          </button>
        ))}
      </Row>
      <label>Data (line 1: categories | … — then one series per line: Name | v1 | v2 …)</label>
      <textarea
        key={n.id}
        rows={6}
        defaultValue={[
          n.categories.join(" | "),
          ...n.series.map((s) => [s.name, ...s.values].join(" | ")),
        ].join("\n")}
        onBlur={(e) => {
          const lines = e.target.value.split("\n").map((l) => l.split("|").map((c) => c.trim())).filter((l) => l.some((c) => c));
          if (lines.length < 2) return;
          const categories = lines[0].filter((c) => c.length > 0);
          const series = lines.slice(1).map((l) => ({
            name: l[0] || "Series",
            values: l.slice(1).map((v) => Number(v) || 0),
          }));
          sendPatches([
            { op: "replace", path: `${pointer}/categories`, value: categories } as Operation,
            { op: "replace", path: `${pointer}/series`, value: series } as Operation,
          ]);
        }}
      />
      <Row>
        <button
          className={(n.legend ?? n.series.length > 1) ? "active" : ""}
          onClick={() => setField("legend", !(n.legend ?? n.series.length > 1))}
        >
          legend
        </button>
        <button className={(n.dataLabels ?? true) ? "active" : ""} onClick={() => setField("dataLabels", !(n.dataLabels ?? true))}>
          value labels
        </button>
      </Row>
      <p className="hint">
        Series colors follow the theme's validated chart palette in fixed order (colorblind-safe by
        construction). Exports as a native, editable PowerPoint chart.
      </p>
    </>
  );

  const frameSection = (n: DeckNode) => {
    if (!isOverlayRoot || !n.frame) return null;
    const f = n.frame;
    const num = (key: "x" | "y" | "w" | "h", label: string) => (
      <label className="frame-field">
        {label}
        <input
          type="number"
          value={Math.round(f[key])}
          onChange={(e) => mergeObj("frame", key, Number(e.target.value), true)}
        />
      </label>
    );
    return (
      <>
        <label>Position &amp; size (drag on canvas, or exact)</label>
        <div className="frame-grid">
          {num("x", "x")}
          {num("y", "y")}
          {num("w", "w")}
          {num("h", "h")}
        </div>
      </>
    );
  };

  const gradientSection = (
    holder: { gradient?: { from: string; to: string; angle?: number } },
    field: "style" | "gradient",
    directOnNode: boolean,
  ) => {
    const g = directOnNode ? (node as { gradient?: typeof holder.gradient }).gradient : holder.gradient;
    const set = (key: string, value: unknown) =>
      directOnNode ? mergeObj("gradient", key, value) : mergeObjStyle("gradient", { ...(g ?? {}), [key]: value });
    const mergeObjStyle = (key: string, value: unknown) => mergeObj("style", key, value);
    return (
      <>
        <label>Gradient</label>
        {g ? (
          <>
            <Row>
              <span className="mini">from</span>
              <Swatches tokens={tokens} value={g.from} onPick={(r) => r && set("from", r)} />
            </Row>
            <Row>
              <span className="mini">to</span>
              <Swatches tokens={tokens} value={g.to} onPick={(r) => r && set("to", r)} />
            </Row>
            <Row>
              {[0, 45, 90, 135].map((ang) => (
                <button key={ang} className={(g.angle ?? 90) === ang ? "active" : ""} onClick={() => set("angle", ang)}>
                  {ang}°
                </button>
              ))}
              <button
                onClick={() =>
                  directOnNode ? setField("gradient", undefined) : mergeObjStyle("gradient", null)
                }
              >
                clear
              </button>
            </Row>
          </>
        ) : (
          <Row>
            <button
              onClick={() =>
                directOnNode
                  ? setField("gradient", { from: "surface", to: "accent", angle: 90 })
                  : mergeObjStyle("gradient", { from: "surface", to: "accent", angle: 90 })
              }
            >
              + add gradient
            </button>
          </Row>
        )}
      </>
    );
  };

  // ---------- element panels ----------
  const textPanel = (n: Extract<DeckNode, { type: "heading" | "text" | "bulletList" }>) => {
    const style = (n.style ?? {}) as Record<string, unknown>;
    return (
      <>
        <label>{n.type === "bulletList" ? "Items (one per line)" : "Text"}</label>
        {n.type === "bulletList" ? (
          <textarea
            key={n.id}
            rows={5}
            defaultValue={n.items.join("\n")}
            onBlur={(e) =>
              setField("items", e.target.value.split("\n").filter((s) => s.trim().length > 0))
            }
          />
        ) : (
          <textarea key={n.id} rows={3} defaultValue={n.text} onBlur={(e) => setField("text", e.target.value)} />
        )}
        {n.type === "bulletList" && (
          <Row>
            <button className={!n.ordered ? "active" : ""} onClick={() => setField("ordered", undefined)}>• bullets</button>
            <button className={n.ordered ? "active" : ""} onClick={() => setField("ordered", true)}>1. numbered</button>
          </Row>
        )}
        {n.type === "heading" && (
          <Row>
            {[1, 2].map((lv) => (
              <button key={lv} className={n.level === lv ? "active" : ""} onClick={() => setField("level", lv)}>
                H{lv}
              </button>
            ))}
          </Row>
        )}
        <label>Font</label>
        <Row>
          {FONT_IDS.map((f) => (
            <button
              key={f}
              className={(style.font ?? "") === f ? "active" : ""}
              onClick={() => mergeObj("style", "font", style.font === f ? null : f)}
            >
              {f}
            </button>
          ))}
        </Row>
        <label>
          Font size <span className="val">{(style.fontSize as number) ?? "auto"}</span>
        </label>
        <input
          type="range"
          min={sizes[0]}
          max={sizes[sizes.length - 1]}
          value={(style.fontSize as number) ?? tokens.fontSizes.body}
          onChange={(e) => mergeObj("style", "fontSize", Number(e.target.value), true)}
        />
        <label>Color</label>
        <Swatches
          tokens={tokens}
          value={style.color as string | undefined}
          allowNone
          onPick={(role) => mergeObj("style", "color", role)}
        />
        <Row>
          <button className={style.bold ? "active" : ""} onClick={() => mergeObj("style", "bold", !style.bold)}>B</button>
          <button className={style.italic ? "active" : ""} style={{ fontStyle: "italic" }} onClick={() => mergeObj("style", "italic", !style.italic)}>I</button>
          <button className={style.underline ? "active" : ""} style={{ textDecoration: "underline" }} onClick={() => mergeObj("style", "underline", !style.underline)}>U</button>
          <button className={style.uppercase ? "active" : ""} onClick={() => mergeObj("style", "uppercase", !style.uppercase)}>AA</button>
          {(["left", "center", "right"] as const).map((a) => (
            <button key={a} className={(style.align ?? "left") === a ? "active" : ""} onClick={() => mergeObj("style", "align", a)}>
              {a === "left" ? "⇤" : a === "center" ? "≡" : "⇥"}
            </button>
          ))}
        </Row>
        <Stepper
          label="Line height"
          value={(style.lineHeight as number) ?? 1.35}
          min={0.9}
          max={2.5}
          step={0.05}
          decimals={2}
          onChange={(v) => mergeObj("style", "lineHeight", v, true)}
        />
        <Stepper
          label="Letter spacing (px)"
          value={(style.letterSpacing as number) ?? 0}
          min={0}
          max={12}
          step={0.5}
          decimals={1}
          onChange={(v) => mergeObj("style", "letterSpacing", v, true)}
        />
      </>
    );
  };

  const containerPanel = (n: Extract<DeckNode, { type: "row" | "column" }>) => {
    const style = (n.style ?? {}) as Record<string, unknown>;
    return (
      <>
        <Stepper
          label="Padding (px)"
          value={(style.padding as number) ?? 0}
          min={0}
          max={spacingMax}
          scale={tokens.spacingScale}
          onChange={(v) => mergeObj("style", "padding", v, true)}
        />
        <Stepper
          label="Gap (px)"
          value={(style.gap as number) ?? 16}
          min={0}
          max={spacingMax}
          scale={tokens.spacingScale}
          onChange={(v) => mergeObj("style", "gap", v, true)}
        />
        <label>Background</label>
        <Swatches tokens={tokens} value={style.background as string | undefined} allowNone
          onPick={(role) => mergeObj("style", "background", role)} />
        {gradientSection(style as never, "style", false)}
        <label>Border &amp; shadow</label>
        <Row>
          {style.border ? (
            <>
              <Swatches tokens={tokens} value={(style.border as { color: string }).color}
                onPick={(r) => r && mergeObj("style", "border", { ...(style.border as object), color: r })} />
              <button onClick={() => mergeObj("style", "border", null)}>clear border</button>
            </>
          ) : (
            <button onClick={() => mergeObj("style", "border", { color: "accent", width: 2 })}>+ border</button>
          )}
          <button className={style.shadow ? "active" : ""} onClick={() => mergeObj("style", "shadow", !style.shadow)}>
            shadow
          </button>
        </Row>
        <label>Corner radius</label>
        <Row>
          {Object.entries(tokens.radius).map(([name, px]) => (
            <button key={name} className={(style.radius ?? 0) === px ? "active" : ""} onClick={() => mergeObj("style", "radius", px)}>
              {name}
            </button>
          ))}
        </Row>
        <label>{n.type === "column" ? "Justify (vertical)" : "Align (vertical)"}</label>
        <Row>
          {(n.type === "column"
            ? (["start", "center", "end", "between"] as const)
            : (["stretch", "start", "center", "end"] as const)
          ).map((j) => (
            <button key={j}
              className={(style[n.type === "column" ? "justify" : "align"] ?? (n.type === "column" ? "start" : "stretch")) === j ? "active" : ""}
              onClick={() => mergeObj("style", n.type === "column" ? "justify" : "align", j)}>
              {j}
            </button>
          ))}
        </Row>
        <label>Add child</label>
        <Row>
          <button onClick={() => addChild(pointer!, { id: genId("heading"), type: "heading", text: "Heading", level: 2 })}>heading</button>
          <button onClick={() => addChild(pointer!, { id: genId("text"), type: "text", text: "Text" })}>text</button>
          <button onClick={() => addChild(pointer!, { id: genId("list"), type: "bulletList", items: ["Point"] })}>bullets</button>
          <button onClick={() => addChild(pointer!, { id: genId("metric"), type: "metricCard", label: "Metric", value: "0" })}>metric</button>
          <button onClick={() => addChild(pointer!, { id: genId("shape"), type: "shape", shape: "roundRect", fill: "accent", text: "Label" })}>shape</button>
          <button onClick={() => addChild(pointer!, { id: genId("table"), type: "table", rows: [["Col A", "Col B"], ["", ""]] })}>table</button>
          <button onClick={() => addChild(pointer!, { id: genId("chart"), type: "chart", chartType: "column", categories: ["A", "B", "C"], series: [{ name: "Series 1", values: [3, 5, 4] }] })}>chart</button>
          <button onClick={() => addChild(pointer!, { id: genId("img"), type: "image", src: "", alt: "image" })}>image</button>
          <button onClick={() => addChild(pointer!, { id: genId("row"), type: "row", style: { gap: 16 }, children: [] })}>row</button>
          <button onClick={() => addChild(pointer!, { id: genId("col"), type: "column", style: { gap: 16 }, children: [] })}>column</button>
        </Row>
      </>
    );
  };

  const shapePanel = (n: Extract<DeckNode, { type: "shape" }>) => (
    <>
      <label>Geometry</label>
      <Row>
        {SHAPE_KINDS.map((k) => (
          <button key={k} className={n.shape === k ? "active" : ""} onClick={() => setField("shape", k)}>
            {k}
          </button>
        ))}
      </Row>
      <label>Label</label>
      <input key={n.id} defaultValue={n.text ?? ""} onBlur={(e) => setField("text", e.target.value || undefined)} />
      <label>Fill</label>
      <Swatches tokens={tokens} value={n.fill} onPick={(r) => r && setField("fill", r)} />
      {gradientSection(n as never, "gradient", true)}
      <label>Border &amp; shadow</label>
      <Row>
        {n.border ? (
          <>
            <Swatches tokens={tokens} value={n.border.color} onPick={(r) => r && mergeObj("border", "color", r)} />
            <button onClick={() => setField("border", undefined)}>clear border</button>
          </>
        ) : (
          <button onClick={() => setField("border", { color: "text-primary", width: 2 })}>+ border</button>
        )}
        <button className={n.shadow ? "active" : ""} onClick={() => setField("shadow", !n.shadow)}>shadow</button>
      </Row>
    </>
  );

  const metricPanel = (n: Extract<DeckNode, { type: "metricCard" }>) => (
    <>
      <label>Label</label>
      <input key={`${n.id}-l`} defaultValue={n.label} onBlur={(e) => setField("label", e.target.value)} />
      <label>Value</label>
      <input key={`${n.id}-v`} defaultValue={n.value} onBlur={(e) => setField("value", e.target.value)} />
      <label>Delta (optional)</label>
      <input key={`${n.id}-d`} defaultValue={n.delta ?? ""} placeholder="+12% QoQ"
        onBlur={(e) => setField("delta", e.target.value || undefined)} />
      <label>Card background</label>
      <Swatches tokens={tokens} value={n.background} onPick={(role) => role && setField("background", role)} />
      <p className="hint">Value color/weight is brand-locked (accent, bold).</p>
    </>
  );

  const imagePanel = (n: Extract<DeckNode, { type: "image" }>) => (
    <>
      <label>Image URL</label>
      <input key={n.id} defaultValue={n.src} placeholder="https://…"
        onBlur={(e) => setField("src", e.target.value)} />
      <label>Alt text</label>
      <input key={`${n.id}-alt`} defaultValue={n.alt ?? ""} onBlur={(e) => setField("alt", e.target.value || undefined)} />
      <Row>
        {(["cover", "contain"] as const).map((f) => (
          <button key={f} className={(n.fit ?? "cover") === f ? "active" : ""} onClick={() => setField("fit", f)}>
            {f}
          </button>
        ))}
        <button className={n.shadow ? "active" : ""} onClick={() => setField("shadow", !n.shadow)}>shadow</button>
      </Row>
    </>
  );

  const tablePanel = (n: Extract<DeckNode, { type: "table" }>) => (
    <>
      <label>Cells (one row per line, columns split by |)</label>
      <textarea
        key={n.id}
        rows={6}
        defaultValue={n.rows.map((r) => r.join(" | ")).join("\n")}
        onBlur={(e) => {
          const rows = e.target.value
            .split("\n")
            .map((line) => line.split("|").map((c) => c.trim()))
            .filter((r) => r.length > 0 && r.some((c) => c.length > 0));
          if (rows.length > 0) {
            const cols = Math.max(...rows.map((r) => r.length));
            setField("rows", rows.map((r) => [...r, ...Array(cols - r.length).fill("")]));
          }
        }}
      />
      <Row>
        <button className={n.header !== false ? "active" : ""} onClick={() => setField("header", n.header === false ? true : false)}>
          header row
        </button>
      </Row>
      <p className="hint">Header/zebra colors are brand-locked to the theme.</p>
    </>
  );

  return (
    <aside className="inspector">
      {node && pointer ? (
        <>
          <div className="panel-head">
            <span className="chip">{node.type}</span>
            <code>{node.id}</code>
            <button
              className="danger"
              title="Delete element"
              onClick={() => {
                onDeselect();
                sendPatches([{ op: "remove", path: pointer } as Operation]);
              }}
              disabled={pointer.endsWith("/root")}
            >
              ✕
            </button>
          </div>
          {frameSection(node)}
          {(node.type === "heading" || node.type === "text" || node.type === "bulletList") && textPanel(node)}
          {(node.type === "row" || node.type === "column") && containerPanel(node)}
          {node.type === "metricCard" && metricPanel(node)}
          {node.type === "shape" && shapePanel(node)}
          {node.type === "image" && imagePanel(node)}
          {node.type === "table" && tablePanel(node)}
          {node.type === "chart" && chartPanel(node)}
          {node.type === "spacer" && (
            <Stepper
              label="Size (px)"
              value={node.size}
              min={0}
              max={spacingMax}
              scale={tokens.spacingScale}
              onChange={(v) => sendDebounced([{ op: "replace", path: `${pointer}/size`, value: v } as Operation])}
            />
          )}
          <hr />
          {marginSection(node)}
          {animSection(node)}
        </>
      ) : (
        <>
          <div className="panel-head">
            <span className="chip">slide</span>
            <code>{slide.id}</code>
          </div>
          <label>Name</label>
          <input key={slide.id} defaultValue={slide.name ?? ""} onBlur={(e) => setSlideField("name", e.target.value)} />
          <Stepper
            label="Padding (px)"
            value={slide.padding ?? 64}
            min={0}
            max={128}
            scale={tokens.spacingScale}
            onChange={(v) => sendDebounced([{ op: "replace", path: `${slidePtr}/padding`, value: v } as Operation])}
          />
          <label>Background</label>
          <Swatches tokens={tokens} value={slide.background} allowNone
            onPick={(role) => (role ? setSlideField("background", role) : setSlideField("background", undefined))} />
          <label>Background gradient</label>
          {slide.gradient ? (
            <>
              <Row>
                <span className="mini">from</span>
                <Swatches tokens={tokens} value={slide.gradient.from}
                  onPick={(r) => r && setSlideField("gradient", { ...slide.gradient, from: r })} />
              </Row>
              <Row>
                <span className="mini">to</span>
                <Swatches tokens={tokens} value={slide.gradient.to}
                  onPick={(r) => r && setSlideField("gradient", { ...slide.gradient, to: r })} />
              </Row>
              <Row>
                <button onClick={() => setSlideField("gradient", undefined)}>clear gradient</button>
              </Row>
            </>
          ) : (
            <Row>
              <button onClick={() => setSlideField("gradient", { from: "background", to: "surface-alt", angle: 90 })}>
                + add gradient
              </button>
            </Row>
          )}
          <label>Transition</label>
          <Row>
            {(["none", "fade", "push", "wipe"] as const).map((t) => (
              <button key={t} className={(slide.transition?.type ?? "none") === t ? "active" : ""}
                onClick={() => (t === "none" ? setSlideField("transition", undefined) : setSlideField("transition", { type: t, direction: slide.transition?.direction ?? "left" }))}>
                {t}
              </button>
            ))}
          </Row>
          {slide.transition && slide.transition.type !== "fade" && (
            <Row>
              {(["left", "right", "top", "bottom"] as const).map((d) => (
                <button key={d} className={(slide.transition?.direction ?? "left") === d ? "active" : ""}
                  onClick={() => setSlideField("transition", { ...slide.transition, direction: d })}>
                  {d}
                </button>
              ))}
            </Row>
          )}
          <label>Add floating element (drag to place)</label>
          <Row>
            <button onClick={() => addOverlay({ id: genId("shape"), type: "shape", shape: "roundRect", fill: "accent", text: "Shape" }, { x: 480, y: 280, w: 320, h: 160 })}>shape</button>
            <button onClick={() => addOverlay({ id: genId("text"), type: "text", text: "Floating text" }, { x: 480, y: 320, w: 320, h: 80 })}>text</button>
            <button onClick={() => addOverlay({ id: genId("img"), type: "image", src: "", alt: "image" }, { x: 480, y: 240, w: 320, h: 240 })}>image</button>
            <button onClick={() => addOverlay({ id: genId("line"), type: "shape", shape: "line", fill: "accent" }, { x: 320, y: 360, w: 640, h: 8 })}>line</button>
          </Row>
          <label>Template</label>
          <Row>
            <button
              onClick={async () => {
                const name = window.prompt("Save this slide as a template named:", slide.name ?? slide.id);
                if (!name) return;
                const res = await fetch("/api/templates", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ slideId: slide.id, name }),
                });
                if (!res.ok) alert((await res.json()).error);
              }}
            >
              save slide as template
            </button>
          </Row>
          <label>Presenter notes</label>
          <textarea key={`${slide.id}-notes`} rows={4} defaultValue={slide.notes ?? ""}
            onBlur={(e) => setSlideField("notes", e.target.value || undefined)} />
          <p className="hint">Click any element on the canvas to inspect it. Double-click text to edit inline. Drag floating elements to move them.</p>
        </>
      )}
    </aside>
  );
}
