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
  COLOR_ROLES,
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

  const setField = (field: string, value: unknown) =>
    sendPatches([{ op: "replace", path: `${pointer}/${field}`, value } as Operation]);

  const mergeObj = (field: "style" | "sizing", key: string, value: unknown, debounced = false) => {
    const current = { ...((node as never as Record<string, Record<string, unknown>>)[field] ?? {}) };
    if (value === null) delete current[key];
    else current[key] = value;
    const op: Operation = { op: "replace", path: `${pointer}/${field}`, value: current };
    (debounced ? sendDebounced : sendPatches)([op]);
  };

  const slidePtr = `/slides/${slideIndex}`;
  const setSlideField = (field: string, value: unknown) =>
    sendPatches([{ op: "replace", path: `${slidePtr}/${field}`, value } as Operation]);

  const addChild = (containerPtr: string, child: Record<string, unknown>) =>
    sendPatches([{ op: "add", path: `${containerPtr}/children/-`, value: child } as Operation]);

  const spacingMax = Math.max(...tokens.spacingScale);
  const sizes = tokens.fontSizeScale;

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
              setField(
                "items",
                e.target.value.split("\n").filter((s) => s.trim().length > 0),
              )
            }
          />
        ) : (
          <textarea
            key={n.id}
            rows={3}
            defaultValue={n.text}
            onBlur={(e) => setField("text", e.target.value)}
          />
        )}
        {n.type === "heading" && (
          <>
            <label>Level</label>
            <div className="btn-row">
              {[1, 2].map((lv) => (
                <button
                  key={lv}
                  className={n.level === lv ? "active" : ""}
                  onClick={() => setField("level", lv)}
                >
                  H{lv}
                </button>
              ))}
            </div>
          </>
        )}
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
        <div className="btn-row">
          <button
            className={style.bold ? "active" : ""}
            onClick={() => mergeObj("style", "bold", !style.bold)}
          >
            B
          </button>
          <button
            className={style.italic ? "active" : ""}
            style={{ fontStyle: "italic" }}
            onClick={() => mergeObj("style", "italic", !style.italic)}
          >
            I
          </button>
          {(["left", "center", "right"] as const).map((a) => (
            <button
              key={a}
              className={(style.align ?? "left") === a ? "active" : ""}
              onClick={() => mergeObj("style", "align", a)}
            >
              {a === "left" ? "⇤" : a === "center" ? "≡" : "⇥"}
            </button>
          ))}
        </div>
      </>
    );
  };

  const containerPanel = (n: Extract<DeckNode, { type: "row" | "column" }>) => {
    const style = (n.style ?? {}) as Record<string, unknown>;
    return (
      <>
        <label>
          Padding <span className="val">{(style.padding as number) ?? 0}px</span>
        </label>
        <input
          type="range"
          min={0}
          max={spacingMax}
          value={(style.padding as number) ?? 0}
          onChange={(e) => mergeObj("style", "padding", Number(e.target.value), true)}
        />
        <label>
          Gap <span className="val">{(style.gap as number) ?? 16}px</span>
        </label>
        <input
          type="range"
          min={0}
          max={spacingMax}
          value={(style.gap as number) ?? 16}
          onChange={(e) => mergeObj("style", "gap", Number(e.target.value), true)}
        />
        <label>Background</label>
        <Swatches
          tokens={tokens}
          value={style.background as string | undefined}
          allowNone
          onPick={(role) => mergeObj("style", "background", role)}
        />
        <label>Corner radius</label>
        <div className="btn-row">
          {Object.entries(tokens.radius).map(([name, px]) => (
            <button
              key={name}
              className={(style.radius ?? 0) === px ? "active" : ""}
              onClick={() => mergeObj("style", "radius", px)}
            >
              {name}
            </button>
          ))}
        </div>
        <label>{n.type === "column" ? "Justify (vertical)" : "Align (vertical)"}</label>
        <div className="btn-row">
          {(n.type === "column"
            ? (["start", "center", "end", "between"] as const)
            : (["stretch", "start", "center", "end"] as const)
          ).map((j) => (
            <button
              key={j}
              className={
                (style[n.type === "column" ? "justify" : "align"] ??
                  (n.type === "column" ? "start" : "stretch")) === j
                  ? "active"
                  : ""
              }
              onClick={() => mergeObj("style", n.type === "column" ? "justify" : "align", j)}
            >
              {j}
            </button>
          ))}
        </div>
        <label>Add child</label>
        <div className="btn-row wrap">
          <button onClick={() => addChild(pointer!, { id: genId("heading"), type: "heading", text: "Heading", level: 2 })}>heading</button>
          <button onClick={() => addChild(pointer!, { id: genId("text"), type: "text", text: "Text" })}>text</button>
          <button onClick={() => addChild(pointer!, { id: genId("list"), type: "bulletList", items: ["Point"] })}>bullets</button>
          <button onClick={() => addChild(pointer!, { id: genId("metric"), type: "metricCard", label: "Metric", value: "0" })}>metric</button>
          <button onClick={() => addChild(pointer!, { id: genId("row"), type: "row", style: { gap: 16 }, children: [] })}>row</button>
          <button onClick={() => addChild(pointer!, { id: genId("col"), type: "column", style: { gap: 16 }, children: [] })}>column</button>
        </div>
      </>
    );
  };

  const metricPanel = (n: Extract<DeckNode, { type: "metricCard" }>) => (
    <>
      <label>Label</label>
      <input key={`${n.id}-l`} defaultValue={n.label} onBlur={(e) => setField("label", e.target.value)} />
      <label>Value</label>
      <input key={`${n.id}-v`} defaultValue={n.value} onBlur={(e) => setField("value", e.target.value)} />
      <label>Delta (optional)</label>
      <input
        key={`${n.id}-d`}
        defaultValue={n.delta ?? ""}
        placeholder="+12% QoQ"
        onBlur={(e) => setField("delta", e.target.value || undefined)}
      />
      <label>Card background</label>
      <Swatches
        tokens={tokens}
        value={n.background}
        onPick={(role) => role && setField("background", role)}
      />
      <p className="hint">Value color/weight is brand-locked (accent, bold).</p>
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
          {(node.type === "heading" || node.type === "text" || node.type === "bulletList") &&
            textPanel(node)}
          {(node.type === "row" || node.type === "column") && containerPanel(node)}
          {node.type === "metricCard" && metricPanel(node)}
          {node.type === "spacer" && (
            <>
              <label>
                Size <span className="val">{node.size}px</span>
              </label>
              <input
                type="range"
                min={0}
                max={spacingMax}
                value={node.size}
                onChange={(e) => sendDebounced([{ op: "replace", path: `${pointer}/size`, value: Number(e.target.value) } as Operation])}
              />
            </>
          )}
        </>
      ) : (
        <>
          <div className="panel-head">
            <span className="chip">slide</span>
            <code>{slide.id}</code>
          </div>
          <label>Name</label>
          <input
            key={slide.id}
            defaultValue={slide.name ?? ""}
            onBlur={(e) => setSlideField("name", e.target.value)}
          />
          <label>
            Padding <span className="val">{slide.padding ?? 64}px</span>
          </label>
          <input
            type="range"
            min={0}
            max={128}
            value={slide.padding ?? 64}
            onChange={(e) => sendDebounced([{ op: "replace", path: `${slidePtr}/padding`, value: Number(e.target.value) } as Operation])}
          />
          <label>Background</label>
          <Swatches
            tokens={tokens}
            value={slide.background}
            allowNone
            onPick={(role) =>
              role
                ? setSlideField("background", role)
                : sendPatches([{ op: "remove", path: `${slidePtr}/background` } as Operation])
            }
          />
          <p className="hint">Click any element on the canvas to inspect it. Double-click text to edit inline.</p>
        </>
      )}
    </aside>
  );
}
