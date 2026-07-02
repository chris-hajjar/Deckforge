/**
 * solve.ts — the deterministic layout solver.
 *
 * Walks a slide's tree and resolves it into absolute primitive boxes on the
 * 1280×720 canvas (see types.ts). Two layers:
 *
 *   flow:     column/row flexbox-lite (intrinsic heights, weights, grow,
 *             justify/align), exactly as v2.0;
 *   overlays: freeform elements with absolute frames, painted on top in
 *             order (z 200+), Google-Slides style.
 *
 * Entrance animations are inherited: animating a container animates every
 * box it produces, so "the group flies in" behaves like Slides.
 */
import type {
  ColumnNode,
  DeckNode,
  FontId,
  Gradient,
  RowNode,
  Slide,
  TextStyle,
  ThemeTokens,
} from "@deckforge/schema";
import { measureText, wrapText } from "./measure.js";
import {
  CANVAS_H,
  CANVAS_W,
  type Paragraph,
  type ResolvedAnim,
  type ResolvedBox,
  type ResolvedGradient,
  type ResolvedSlide,
  type ResolvedStroke,
  type TableBox,
  type TextBox,
} from "./types.js";

const MIN_FONT_SIZE = 10;
const CARD_PAD = 24;
const TABLE_CELL_PAD = 10;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Ctx {
  tokens: ThemeTokens;
  boxes: ResolvedBox[];
  warnings: string[];
  seq: number;
  /** Animation inherited from the nearest animated ancestor. */
  anim?: ResolvedAnim;
}

function color(ctx: Ctx, role: string | undefined, fallback: keyof ThemeTokens["colors"]): string {
  // raw hex passes through so pre-validation content (template previews)
  // renders faithfully; validated decks never carry raw hex here
  if (role?.startsWith("#")) return role;
  const roles = ctx.tokens.colors as Record<string, string>;
  return (role && roles[role]) || roles[fallback];
}

function gradient(ctx: Ctx, g: Gradient | undefined): ResolvedGradient | undefined {
  if (!g) return undefined;
  return {
    from: color(ctx, g.from, "surface"),
    to: color(ctx, g.to, "accent"),
    angle: g.angle ?? 90,
  };
}

function stroke(
  ctx: Ctx,
  b: { color: string; width: number } | undefined,
): ResolvedStroke | undefined {
  if (!b) return undefined;
  return { color: color(ctx, b.color, "accent"), width: b.width };
}

function animOf(ctx: Ctx, node: DeckNode): ResolvedAnim | undefined {
  const a = (node as { animation?: ResolvedAnim }).animation;
  return a ? { effect: a.effect, direction: a.direction, order: a.order ?? 1, byParagraph: a.byParagraph } : ctx.anim;
}

interface TextSpec {
  fontId: FontId;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  size: number;
  color: string;
  align: "left" | "center" | "right";
  lineHeight: number;
  letterSpacing?: number;
  uppercase: boolean;
}

function specFrom(ctx: Ctx, style: TextStyle, defaults: Partial<TextSpec> & { size: number; fontId: FontId }): TextSpec {
  return {
    fontId: style.font ?? defaults.fontId,
    bold: style.bold ?? defaults.bold ?? false,
    italic: style.italic ?? defaults.italic ?? false,
    underline: style.underline ?? false,
    size: style.fontSize ?? defaults.size,
    color: color(ctx, style.color, "text-primary"),
    align: style.align ?? defaults.align ?? "left",
    lineHeight: style.lineHeight ?? defaults.lineHeight ?? 1.35,
    letterSpacing: style.letterSpacing,
    uppercase: style.uppercase ?? false,
  };
}

function textSpec(ctx: Ctx, node: DeckNode): TextSpec {
  const t = ctx.tokens;
  const style: TextStyle = (node as { style?: TextStyle }).style ?? {};
  if (node.type === "heading") {
    const level = (node as { level?: 1 | 2 }).level ?? 1;
    return specFrom(ctx, style, {
      fontId: t.fonts.heading,
      bold: true,
      size: level === 1 ? t.fontSizes.h1 : t.fontSizes.h2,
      lineHeight: 1.15,
    });
  }
  return specFrom(ctx, style, { fontId: t.fonts.body, size: t.fontSizes.body });
}

/** Effective per-line advance including letter-spacing. */
function lineWidth(text: string, spec: TextSpec, size: number): number {
  const base = measureText(text, spec.fontId, spec.bold, size);
  return base + (spec.letterSpacing ?? 0) * Math.max(0, text.length - 1);
}

function wrapSpec(text: string, spec: TextSpec, size: number, maxWidth: number): string[] {
  const t = spec.uppercase ? text.toUpperCase() : text;
  // letter-spacing shrinks the effective wrap width proportionally (approx.)
  const avgCharW = size * 0.5;
  const factor = spec.letterSpacing ? avgCharW / (avgCharW + spec.letterSpacing) : 1;
  return wrapText(t, spec.fontId, spec.bold, size, maxWidth * factor);
}

/** Wrap a text-like node into paragraphs at a given size. */
function paragraphsFor(
  node: DeckNode,
  spec: TextSpec,
  size: number,
  width: number,
): { paragraphs: Paragraph[]; paragraphGap: number } {
  if (node.type === "bulletList") {
    const indent = size * 1.4;
    return {
      paragraphs: node.items.map((item, i) => ({
        lines: wrapSpec(item, spec, size, Math.max(20, width - indent)),
        bullet: true,
        marker: node.ordered ? `${i + 1}.` : undefined,
      })),
      paragraphGap: Math.round(size * 0.45),
    };
  }
  const text = (node as { text: string }).text;
  return {
    paragraphs: [{ lines: wrapSpec(text, spec, size, width), bullet: false }],
    paragraphGap: 0,
  };
}

function paragraphsHeight(paragraphs: Paragraph[], size: number, lineHeight: number, gap: number): number {
  const lines = paragraphs.reduce((n, p) => n + p.lines.length, 0);
  return lines * size * lineHeight + gap * (paragraphs.length - 1);
}

/** Step a size down the theme's fontSizeScale. */
function shrink(ctx: Ctx, size: number): number | null {
  const scale = [...ctx.tokens.fontSizeScale].sort((a, b) => a - b);
  const smaller = scale.filter((s) => s < size);
  const next = smaller.length ? smaller[smaller.length - 1] : null;
  return next !== null && next >= MIN_FONT_SIZE ? next : null;
}

// ---------- tables ----------
interface TableMeasure {
  colW: number[];
  rowH: number[];
  size: number;
}

function measureTable(ctx: Ctx, node: Extract<DeckNode, { type: "table" }>, width: number): TableMeasure {
  const t = ctx.tokens;
  const size = node.style?.fontSize ?? t.fontSizes.small;
  const cols = node.rows[0].length;
  const weights = node.columns && node.columns.length === cols ? node.columns : Array(cols).fill(1);
  const wSum = weights.reduce((a: number, b: number) => a + b, 0);
  const colW = weights.map((w: number) => (w / wSum) * width);
  const rowH = node.rows.map((row) => {
    let maxLines = 1;
    row.forEach((cell, c) => {
      const lines = wrapText(cell, t.fonts.body, false, size, Math.max(20, colW[c] - TABLE_CELL_PAD * 2));
      maxLines = Math.max(maxLines, lines.length);
    });
    return maxLines * size * 1.35 + TABLE_CELL_PAD * 2;
  });
  return { colW, rowH, size };
}

/** Effective margin of a flow element (0 for overlays — frames are absolute). */
function marginOf(node: DeckNode): { top: number; bottom: number; left: number; right: number } {
  const m = (node as { sizing?: { margin?: Record<string, number> } }).sizing?.margin ?? {};
  return { top: m.top ?? 0, bottom: m.bottom ?? 0, left: m.left ?? 0, right: m.right ?? 0 };
}

/** Outer height = margins + content height at the margin-reduced width. */
function outerHeight(ctx: Ctx, node: DeckNode, slotWidth: number): number {
  const m = marginOf(node);
  return m.top + m.bottom + intrinsicHeight(ctx, node, Math.max(8, slotWidth - m.left - m.right));
}

/** Shrink a slot rect by the node's margin before laying it out. */
function innerRect(node: DeckNode, slot: Rect): Rect {
  const m = marginOf(node);
  return {
    x: slot.x + m.left,
    y: slot.y + m.top,
    w: Math.max(8, slot.w - m.left - m.right),
    h: Math.max(8, slot.h - m.top - m.bottom),
  };
}

// ---------- intrinsic heights ----------
function intrinsicHeight(ctx: Ctx, node: DeckNode, width: number): number {
  const fixed = (node as { sizing?: { height?: number } }).sizing?.height;
  if (fixed) return fixed;

  switch (node.type) {
    case "heading":
    case "text":
    case "bulletList": {
      const spec = textSpec(ctx, node);
      const { paragraphs, paragraphGap } = paragraphsFor(node, spec, spec.size, width);
      return paragraphsHeight(paragraphs, spec.size, spec.lineHeight, paragraphGap);
    }
    case "metricCard": {
      const t = ctx.tokens;
      const deltaH = node.delta ? t.fontSizes.small * 1.3 + 4 : 0;
      return (
        CARD_PAD * 2 + t.fontSizes.metricLabel * 1.3 + 8 + t.fontSizes.metricValue * 1.15 + deltaH
      );
    }
    case "image":
      return Math.round(width * (9 / 16));
    case "shape":
      return node.shape === "line" ? Math.max(4, node.border?.width ?? 2) : Math.round(width * 0.35);
    case "table": {
      const m = measureTable(ctx, node, width);
      return m.rowH.reduce((a, b) => a + b, 0);
    }
    case "chart":
      return Math.round(width * 0.5);
    case "spacer":
      return node.size;
    case "row": {
      const pad = node.style?.padding ?? 0;
      const widths = rowChildWidths(ctx, node, width - pad * 2);
      let max = 0;
      node.children.forEach((child, i) => {
        max = Math.max(max, outerHeight(ctx, child, widths[i]));
      });
      return max + pad * 2;
    }
    case "column": {
      const pad = node.style?.padding ?? 0;
      const gap = node.style?.gap ?? 16;
      const inner = width - pad * 2;
      let sum = 0;
      node.children.forEach((child, i) => {
        sum += outerHeight(ctx, child, inner);
        if (i < node.children.length - 1) sum += gap;
      });
      return sum + pad * 2;
    }
  }
}

function rowChildWidths(ctx: Ctx, row: RowNode, innerW: number): number[] {
  const gap = row.style?.gap ?? 16;
  const avail = innerW - gap * (row.children.length - 1);
  const pinned = row.children.map((c) => {
    const pct = (c as { sizing?: { widthPct?: number } }).sizing?.widthPct;
    return pct ? (pct / 100) * avail : null;
  });
  const pinnedTotal = pinned.reduce((s: number, p) => s + (p ?? 0), 0);
  const flexChildren = row.children.filter((_, i) => pinned[i] === null);
  const weightTotal = flexChildren.reduce(
    (s, c) => s + ((c as { sizing?: { weight?: number } }).sizing?.weight ?? 1),
    0,
  );
  const flexAvail = Math.max(0, avail - pinnedTotal);
  return row.children.map((c, i) => {
    if (pinned[i] !== null) return pinned[i]!;
    const w = (c as { sizing?: { weight?: number } }).sizing?.weight ?? 1;
    return (w / weightTotal) * flexAvail;
  });
}

// ---------- layout (emit boxes) ----------
function emitContainerRect(ctx: Ctx, node: RowNode | ColumnNode, rect: Rect, z: number) {
  const s = node.style;
  if (s?.background || s?.gradient || s?.border) {
    ctx.boxes.push({
      kind: "rect",
      id: `box-${ctx.seq++}`,
      nodeId: node.id,
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      z,
      anim: animOf(ctx, node),
      fill: s.gradient ? undefined : color(ctx, s.background, "surface"),
      gradient: gradient(ctx, s.gradient),
      stroke: stroke(ctx, s.border),
      shadow: s.shadow,
      radius: s.radius ?? 0,
    });
  }
}

function withAnim<T>(ctx: Ctx, node: DeckNode, fn: () => T): T {
  const prev = ctx.anim;
  ctx.anim = animOf(ctx, node);
  const out = fn();
  ctx.anim = prev;
  return out;
}

function layoutColumn(ctx: Ctx, node: ColumnNode, rect: Rect, z: number) {
  emitContainerRect(ctx, node, rect, z);
  const pad = node.style?.padding ?? 0;
  const gap = node.style?.gap ?? 16;
  const inner: Rect = {
    x: rect.x + pad,
    y: rect.y + pad,
    w: rect.w - pad * 2,
    h: rect.h - pad * 2,
  };
  const heights = node.children.map((c) => outerHeight(ctx, c, inner.w));
  const gapsTotal = gap * Math.max(0, node.children.length - 1);
  const growTotal = node.children.reduce(
    (s, c) => s + ((c as { sizing?: { grow?: number } }).sizing?.grow ?? 0),
    0,
  );
  let leftover = inner.h - heights.reduce((a, b) => a + b, 0) - gapsTotal;

  if (leftover < -1) {
    ctx.warnings.push(
      `column "${node.id}" content is ${Math.round(-leftover)}px taller than its box`,
    );
    leftover = 0;
  }

  const assigned = heights.map((h, i) => {
    const grow = (node.children[i] as { sizing?: { grow?: number } }).sizing?.grow ?? 0;
    return growTotal > 0 && leftover > 0 ? h + (grow / growTotal) * leftover : h;
  });

  const justify = node.style?.justify ?? "start";
  let y = inner.y;
  let between = gap;
  if (growTotal === 0 && leftover > 0) {
    if (justify === "center") y += leftover / 2;
    else if (justify === "end") y += leftover;
    else if (justify === "between" && node.children.length > 1) {
      between = gap + leftover / (node.children.length - 1);
    }
  }

  withAnim(ctx, node, () => {
    node.children.forEach((child, i) => {
      layoutNode(ctx, child, innerRect(child, { x: inner.x, y, w: inner.w, h: assigned[i] }), z + 1);
      y += assigned[i] + between;
    });
  });
}

function layoutRow(ctx: Ctx, node: RowNode, rect: Rect, z: number) {
  emitContainerRect(ctx, node, rect, z);
  const pad = node.style?.padding ?? 0;
  const gap = node.style?.gap ?? 16;
  const inner: Rect = {
    x: rect.x + pad,
    y: rect.y + pad,
    w: rect.w - pad * 2,
    h: rect.h - pad * 2,
  };
  const widths = rowChildWidths(ctx, node, inner.w);
  const align = node.style?.align ?? "stretch";
  withAnim(ctx, node, () => {
    let x = inner.x;
    node.children.forEach((child, i) => {
      let h = inner.h;
      let y = inner.y;
      if (align !== "stretch") {
        h = Math.min(inner.h, outerHeight(ctx, child, widths[i]));
        if (align === "center") y += (inner.h - h) / 2;
        else if (align === "end") y += inner.h - h;
      }
      layoutNode(ctx, child, innerRect(child, { x, y, w: widths[i], h }), z + 1);
      x += widths[i] + gap;
    });
  });
}

function layoutTextLike(ctx: Ctx, node: DeckNode, rect: Rect, z: number) {
  const spec = textSpec(ctx, node);
  let size = spec.size;
  let para = paragraphsFor(node, spec, size, rect.w);
  // Autoshrink: step down the brand size scale until the text fits its box.
  while (
    paragraphsHeight(para.paragraphs, size, spec.lineHeight, para.paragraphGap) > rect.h + 1
  ) {
    const next = shrink(ctx, size);
    if (next === null) {
      ctx.warnings.push(`text "${node.id}" overflows its box even at minimum size`);
      break;
    }
    size = next;
    para = paragraphsFor(node, spec, size, rect.w);
  }
  if (size !== spec.size) {
    ctx.warnings.push(`text "${node.id}" autoshrunk ${spec.size}→${size}px to fit`);
  }
  ctx.boxes.push({
    kind: "text",
    id: `box-${ctx.seq++}`,
    nodeId: node.id,
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    z: z + 100,
    anim: animOf(ctx, node),
    paragraphs: para.paragraphs,
    fontId: spec.fontId,
    bold: spec.bold,
    italic: spec.italic,
    underline: spec.underline,
    size,
    lineHeight: spec.lineHeight,
    letterSpacing: spec.letterSpacing,
    color: spec.color,
    align: spec.align,
    paragraphGap: para.paragraphGap,
  });
}

function layoutMetricCard(
  ctx: Ctx,
  node: Extract<DeckNode, { type: "metricCard" }>,
  rect: Rect,
  z: number,
) {
  const t = ctx.tokens;
  const anim = animOf(ctx, node);
  ctx.boxes.push({
    kind: "rect",
    id: `box-${ctx.seq++}`,
    nodeId: node.id,
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    z,
    anim,
    fill: color(ctx, node.background, "surface"),
    radius: t.radius.md,
  });
  const innerX = rect.x + CARD_PAD;
  const innerW = rect.w - CARD_PAD * 2;
  let y = rect.y + CARD_PAD;

  const textBox = (
    text: string,
    size: number,
    colorHex: string,
    bold: boolean,
    lineHeight: number,
  ): TextBox => ({
    kind: "text",
    id: `box-${ctx.seq++}`,
    nodeId: node.id,
    x: innerX,
    y,
    w: innerW,
    h: size * lineHeight,
    z: z + 100,
    anim,
    paragraphs: [{ lines: [text], bullet: false }],
    fontId: t.fonts.body,
    bold,
    italic: false,
    size,
    lineHeight,
    color: colorHex,
    align: "left",
    paragraphGap: 0,
  });

  const label = textBox(node.label.toUpperCase(), t.fontSizes.metricLabel, t.colors["text-secondary"], false, 1.3);
  ctx.boxes.push(label);
  y += label.h + 8;

  // Brand constraint (registry rule): metric values are ALWAYS accent + bold.
  let valueSize = t.fontSizes.metricValue;
  while (
    measureText(node.value, t.fonts.body, true, valueSize) > innerW &&
    shrink(ctx, valueSize) !== null
  ) {
    valueSize = shrink(ctx, valueSize)!;
  }
  const value = textBox(node.value, valueSize, t.colors.accent, true, 1.15);
  ctx.boxes.push(value);
  y += value.h + 4;

  if (node.delta) {
    ctx.boxes.push(textBox(node.delta, t.fontSizes.small, t.colors["text-secondary"], false, 1.3));
  }
}

function layoutShape(ctx: Ctx, node: Extract<DeckNode, { type: "shape" }>, rect: Rect, z: number) {
  const anim = animOf(ctx, node);
  const isLine = node.shape === "line";
  ctx.boxes.push({
    kind: "shape",
    id: `box-${ctx.seq++}`,
    nodeId: node.id,
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    z: z + 10,
    anim,
    geometry: node.shape,
    fill: isLine || node.gradient ? undefined : color(ctx, node.fill, "accent"),
    gradient: isLine ? undefined : gradient(ctx, node.gradient),
    stroke:
      stroke(ctx, node.border) ?? (isLine ? { color: color(ctx, node.fill, "accent"), width: 2 } : undefined),
    shadow: node.shadow,
  });
  if (node.text && !isLine) {
    const spec = specFrom(ctx, node.textStyle ?? {}, {
      fontId: ctx.tokens.fonts.body,
      size: ctx.tokens.fontSizes.body,
      bold: true,
      align: "center",
      lineHeight: 1.2,
    });
    let size = spec.size;
    let lines = wrapSpec(node.text, spec, size, rect.w * 0.85);
    while (lines.length * size * spec.lineHeight > rect.h * 0.9 && shrink(ctx, size) !== null) {
      size = shrink(ctx, size)!;
      lines = wrapSpec(node.text, spec, size, rect.w * 0.85);
    }
    const textH = lines.length * size * spec.lineHeight;
    ctx.boxes.push({
      kind: "text",
      id: `box-${ctx.seq++}`,
      nodeId: node.id,
      x: rect.x + rect.w * 0.075,
      y: rect.y + (rect.h - textH) / 2,
      w: rect.w * 0.85,
      h: textH,
      z: z + 110,
      anim,
      paragraphs: [{ lines, bullet: false }],
      fontId: spec.fontId,
      bold: spec.bold,
      italic: spec.italic,
      underline: spec.underline,
      size,
      lineHeight: spec.lineHeight,
      letterSpacing: spec.letterSpacing,
      color: node.textStyle?.color
        ? color(ctx, node.textStyle.color, "background")
        : color(ctx, "background", "background"),
      align: spec.align,
      valign: "middle",
      paragraphGap: 0,
    });
  }
}

function layoutTable(ctx: Ctx, node: Extract<DeckNode, { type: "table" }>, rect: Rect, z: number) {
  const t = ctx.tokens;
  const m = measureTable(ctx, node, rect.w);
  const totalH = m.rowH.reduce((a, b) => a + b, 0);
  if (totalH > rect.h + 1) {
    ctx.warnings.push(`table "${node.id}" is ${Math.round(totalH - rect.h)}px taller than its box`);
  }
  const cells: TableBox["cells"] = node.rows.map((row, r) => {
    const isHeader = node.header !== false && r === 0;
    const zebra = !isHeader && (node.header !== false ? r % 2 === 0 : r % 2 === 1);
    return row.map((text) => ({
      text,
      bold: isHeader,
      fill: isHeader ? t.colors.accent : zebra ? t.colors.surface : undefined,
      color: isHeader ? t.colors.background : t.colors["text-primary"],
      align: node.style?.align ?? "left",
    }));
  });
  ctx.boxes.push({
    kind: "table",
    id: `box-${ctx.seq++}`,
    nodeId: node.id,
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: totalH,
    z: z + 50,
    anim: animOf(ctx, node),
    colW: m.colW,
    rowH: m.rowH,
    cells,
    fontId: t.fonts.body,
    size: m.size,
    borderColor: t.colors["surface-alt"],
    cellPad: TABLE_CELL_PAD,
  });
}

function layoutChart(ctx: Ctx, node: Extract<DeckNode, { type: "chart" }>, rect: Rect, z: number) {
  const t = ctx.tokens;
  // categorical slots in fixed order, never cycled (validate caps series at 8)
  const series = node.series.map((s, i) => ({
    name: s.name,
    values: s.values,
    color: t.chartPalette[i],
  }));
  ctx.boxes.push({
    kind: "chart",
    id: `box-${ctx.seq++}`,
    nodeId: node.id,
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    z: z + 50,
    anim: animOf(ctx, node),
    chartType: node.chartType,
    categories: node.categories,
    series,
    palette: [...t.chartPalette],
    // legend defaults on for ≥2 series, off for one (the title names it) —
    // except pie/donut, where slice identity is color-alone without one
    legend:
      node.legend ??
      (node.series.length > 1 || node.chartType === "pie" || node.chartType === "donut"),
    // direct labels default on: the light palette's contrast-relief rule
    dataLabels: node.dataLabels ?? true,
    fontId: t.fonts.body,
    ink: {
      label: t.colors["text-primary"],
      muted: t.colors["text-secondary"],
      grid: t.colors["surface-alt"],
    },
    surface: t.colors.background,
  });
}

function layoutNode(ctx: Ctx, node: DeckNode, rect: Rect, z: number) {
  switch (node.type) {
    case "column":
      return layoutColumn(ctx, node, rect, z);
    case "row":
      return layoutRow(ctx, node, rect, z);
    case "heading":
    case "text":
    case "bulletList":
      return layoutTextLike(ctx, node, rect, z);
    case "metricCard":
      return layoutMetricCard(ctx, node, rect, z);
    case "shape":
      return layoutShape(ctx, node, rect, z);
    case "table":
      return layoutTable(ctx, node, rect, z);
    case "chart":
      return layoutChart(ctx, node, rect, z);
    case "image":
      ctx.boxes.push({
        kind: "image",
        id: `box-${ctx.seq++}`,
        nodeId: node.id,
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
        z: z + 50,
        anim: animOf(ctx, node),
        src: node.src,
        alt: node.alt,
        fit: node.fit ?? "cover",
        radius: node.radius ?? 0,
        shadow: node.shadow,
      });
      return;
    case "spacer":
      return; // occupies space, paints nothing
  }
}

export function solveSlide(slide: Slide, tokens: ThemeTokens): ResolvedSlide {
  const ctx: Ctx = { tokens, boxes: [], warnings: [], seq: 0 };
  const pad = slide.padding ?? 64;
  const rootRect: Rect = {
    x: pad,
    y: pad,
    w: CANVAS_W - pad * 2,
    h: CANVAS_H - pad * 2,
  };
  const rootIntrinsic = intrinsicHeight(ctx, slide.root, rootRect.w);
  if (rootIntrinsic > rootRect.h + 1) {
    ctx.warnings.push(
      `slide "${slide.id}" content is ${Math.round(rootIntrinsic - rootRect.h)}px taller than the canvas`,
    );
  }
  layoutNode(ctx, slide.root, rootRect, 1);

  // freeform layer: absolute frames, painted above the flow layout
  (slide.overlays ?? []).forEach((node, i) => {
    const f = (node as { frame?: Rect }).frame;
    if (!f) {
      ctx.warnings.push(`overlay "${node.id}" has no frame; skipped`);
      return;
    }
    layoutNode(ctx, node, f, 200 + i * 10);
  });

  ctx.boxes.sort((a, b) => a.z - b.z);
  return {
    id: slide.id,
    w: CANVAS_W,
    h: CANVAS_H,
    background: color(ctx, slide.background, "background"),
    gradient: gradient(ctx, slide.gradient),
    transition: slide.transition,
    notes: slide.notes,
    boxes: ctx.boxes,
    warnings: ctx.warnings,
  };
}
