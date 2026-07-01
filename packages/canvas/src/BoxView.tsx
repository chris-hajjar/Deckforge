/**
 * BoxView — renders one resolved box (rect/shape/text/image/table) as
 * absolutely-positioned DOM/SVG. Pure paint: geometry and colors come fully
 * resolved from the layout solver. Used by the editor canvas and by Present
 * mode (which passes reveal state for animations).
 */
import type { CSSProperties } from "react";
import type { ChartBox, ResolvedBox, ResolvedGradient, ShapeBox, TableBox, TextBox } from "@deckforge/layout";
import { ChartView } from "./ChartView.js";

export const FONT_STACKS: Record<string, string> = {
  sans: 'Arial, "Liberation Sans", Helvetica, sans-serif',
  serif: 'Georgia, "Liberation Serif", serif',
  mono: '"Courier New", "Liberation Mono", monospace',
};

/** DrawingML angle (0 = left→right) to CSS gradient direction. */
export function cssGradient(g: ResolvedGradient): string {
  const cssAngle = { 0: 90, 45: 135, 90: 180, 135: 225 }[g.angle] ?? 180;
  return `linear-gradient(${cssAngle}deg, ${g.from}, ${g.to})`;
}

const SHADOW_CSS = "0 3px 8px rgba(0,0,0,0.35)";

function shapePath(geometry: ShapeBox["geometry"], w: number, h: number): string {
  const t = Math.min(w, h) / 2; // chevron/arrow head depth
  switch (geometry) {
    case "triangle":
      return `M ${w / 2} 0 L ${w} ${h} L 0 ${h} Z`;
    case "diamond":
      return `M ${w / 2} 0 L ${w} ${h / 2} L ${w / 2} ${h} L 0 ${h / 2} Z`;
    case "chevron":
      return `M 0 0 L ${w - t} 0 L ${w} ${h / 2} L ${w - t} ${h} L 0 ${h} L ${t} ${h / 2} Z`;
    case "rightArrow": {
      const shaft = h * 0.28;
      return (
        `M 0 ${shaft} L ${w - t} ${shaft} L ${w - t} 0 L ${w} ${h / 2} ` +
        `L ${w - t} ${h} L ${w - t} ${h - shaft} L 0 ${h - shaft} Z`
      );
    }
    default:
      return "";
  }
}

interface Props {
  box: ResolvedBox;
  scale: number;
  /** Present mode: hide paragraphs whose reveal step is in the future. */
  paraVisible?: (paraIndex: number) => boolean;
  /** Present mode: CSS animation class for a just-revealed box/paragraph. */
  animClass?: (paraIndex?: number) => string;
  style?: CSSProperties;
}

export function BoxView({ box, scale, paraVisible, animClass, style: extra }: Props) {
  const base: CSSProperties = {
    position: "absolute",
    left: box.x * scale,
    top: box.y * scale,
    width: box.w * scale,
    height: box.h * scale,
    boxSizing: "border-box",
    pointerEvents: "none",
    ...extra,
  };
  const cls = animClass?.();

  if (box.kind === "rect") {
    return (
      <div
        className={cls}
        style={{
          ...base,
          background: box.gradient ? cssGradient(box.gradient) : box.fill,
          borderRadius: box.radius * scale,
          border: box.stroke ? `${box.stroke.width * scale}px solid ${box.stroke.color}` : undefined,
          boxShadow: box.shadow ? SHADOW_CSS : undefined,
        }}
      />
    );
  }

  if (box.kind === "shape") {
    const w = box.w * scale;
    const h = box.h * scale;
    const gid = `grad-${box.id}`;
    const fill = box.gradient ? `url(#${gid})` : (box.fill ?? "none");
    const strokeProps = box.stroke
      ? { stroke: box.stroke.color, strokeWidth: box.stroke.width * scale }
      : { stroke: "none", strokeWidth: 0 };
    const gradStops = box.gradient && (
      <defs>
        <linearGradient
          id={gid}
          gradientTransform={`rotate(${{ 0: 0, 45: 45, 90: 90, 135: 135 }[box.gradient.angle] ?? 90}, 0.5, 0.5)`}
        >
          <stop offset="0%" stopColor={box.gradient.from} />
          <stop offset="100%" stopColor={box.gradient.to} />
        </linearGradient>
      </defs>
    );
    let inner: React.ReactNode;
    switch (box.geometry) {
      case "rect":
        inner = <rect width={w} height={h} fill={fill} {...strokeProps} />;
        break;
      case "roundRect":
        inner = <rect width={w} height={h} rx={Math.min(w, h) * 0.12} fill={fill} {...strokeProps} />;
        break;
      case "pill":
        inner = <rect width={w} height={h} rx={h / 2} fill={fill} {...strokeProps} />;
        break;
      case "ellipse":
        inner = <ellipse cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} fill={fill} {...strokeProps} />;
        break;
      case "line":
        inner = (
          <line
            x1={0}
            y1={h / 2}
            x2={w}
            y2={h / 2}
            stroke={box.stroke?.color ?? "#000"}
            strokeWidth={(box.stroke?.width ?? 2) * scale}
          />
        );
        break;
      default:
        inner = <path d={shapePath(box.geometry, w, h)} fill={fill} {...strokeProps} />;
    }
    return (
      <svg
        className={cls}
        style={{
          ...base,
          overflow: "visible",
          filter: box.shadow ? `drop-shadow(${SHADOW_CSS})` : undefined,
        }}
        width={w}
        height={h}
      >
        {gradStops}
        {inner}
      </svg>
    );
  }

  if (box.kind === "image") {
    return (
      <img
        className={cls}
        src={box.src}
        alt={box.alt ?? ""}
        style={{
          ...base,
          objectFit: box.fit,
          borderRadius: box.radius * scale,
          boxShadow: box.shadow ? SHADOW_CSS : undefined,
          background: "#dddddd",
        }}
      />
    );
  }

  if (box.kind === "chart") {
    return (
      <div className={cls} style={base}>
        <ChartView box={box as ChartBox} scale={scale} />
      </div>
    );
  }

  if (box.kind === "table") {
    const t = box as TableBox;
    let y = 0;
    return (
      <div className={cls} style={{ ...base, fontFamily: FONT_STACKS[t.fontId] }}>
        {t.cells.map((row, r) => {
          const rowTop = y;
          y += t.rowH[r];
          let x = 0;
          return (
            <div key={r}>
              {row.map((cell, c) => {
                const cellLeft = x;
                x += t.colW[c];
                return (
                  <div
                    key={c}
                    style={{
                      position: "absolute",
                      left: cellLeft * scale,
                      top: rowTop * scale,
                      width: t.colW[c] * scale,
                      height: t.rowH[r] * scale,
                      background: cell.fill,
                      color: cell.color,
                      fontWeight: cell.bold ? 700 : 400,
                      fontSize: t.size * scale,
                      textAlign: cell.align,
                      padding: t.cellPad * scale,
                      boxSizing: "border-box",
                      border: `${Math.max(0.5, 0.75 * scale)}px solid ${t.borderColor}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent:
                        cell.align === "center" ? "center" : cell.align === "right" ? "flex-end" : "flex-start",
                      overflow: "hidden",
                      lineHeight: 1.35,
                    }}
                  >
                    {cell.text}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    );
  }

  // text
  const t = box as TextBox;
  return (
    <div
      className={cls}
      style={{
        ...base,
        fontFamily: FONT_STACKS[t.fontId],
        fontSize: t.size * scale,
        fontWeight: t.bold ? 700 : 400,
        fontStyle: t.italic ? "italic" : "normal",
        textDecoration: t.underline ? "underline" : undefined,
        letterSpacing: t.letterSpacing ? t.letterSpacing * scale : undefined,
        lineHeight: t.lineHeight,
        color: t.color,
        textAlign: t.align,
        overflow: "hidden",
      }}
    >
      {t.paragraphs.map((p, pi) => {
        if (paraVisible && !paraVisible(pi)) {
          return <div key={pi} style={{ visibility: "hidden" }}>{p.lines.map((l, li) => <div key={li} style={{ whiteSpace: "pre" }}>{l || " "}</div>)}</div>;
        }
        return (
          <div
            key={pi}
            className={animClass?.(pi)}
            style={{
              marginBottom: pi < t.paragraphs.length - 1 ? t.paragraphGap * scale : 0,
              paddingLeft: p.bullet ? t.size * 1.4 * scale : 0,
              position: "relative",
            }}
          >
            {p.bullet && (
              <span style={{ position: "absolute", left: p.marker ? 0 : t.size * 0.3 * scale }}>
                {p.marker ?? "•"}
              </span>
            )}
            {p.lines.map((line, li) => (
              <div key={li} style={{ whiteSpace: "pre" }}>
                {line || " "}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
