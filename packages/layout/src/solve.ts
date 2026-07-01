/**
 * solve.ts — the deterministic layout solver.
 *
 * Walks a slide's tree and resolves it into absolute primitive boxes on the
 * 1280×720 canvas (see types.ts). Flexbox-lite rules:
 *
 *   column: children take full inner width; height is intrinsic (measured),
 *           `grow` children share leftover space; `justify` distributes slack.
 *   row:    widths split by `weight` (or pinned by `widthPct`); `align`
 *           controls cross-axis (default stretch → equal-height cards).
 *
 * Text that lands in a box shorter than its measured height autoshrinks down
 * the theme's fontSizeScale (PowerPoint-style) until it fits or bottoms out.
 */
import type {
  ColumnNode,
  DeckNode,
  FontId,
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
  type ResolvedBox,
  type ResolvedSlide,
  type TextBox,
} from "./types.js";

const MIN_FONT_SIZE = 10;
const CARD_PAD = 24;

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
}

function color(ctx: Ctx, role: string | undefined, fallback: keyof ThemeTokens["colors"]): string {
  const roles = ctx.tokens.colors as Record<string, string>;
  return (role && roles[role]) || roles[fallback];
}

interface TextSpec {
  fontId: FontId;
  bold: boolean;
  italic: boolean;
  size: number;
  color: string;
  align: "left" | "center" | "right";
  lineHeight: number;
}

function textSpec(ctx: Ctx, node: DeckNode): TextSpec {
  const t = ctx.tokens;
  const style: TextStyle = (node as { style?: TextStyle }).style ?? {};
  switch (node.type) {
    case "heading": {
      const level = (node as { level?: 1 | 2 }).level ?? 1;
      return {
        fontId: t.fonts.heading,
        bold: style.bold ?? true,
        italic: style.italic ?? false,
        size: style.fontSize ?? (level === 1 ? t.fontSizes.h1 : t.fontSizes.h2),
        color: color(ctx, style.color, "text-primary"),
        align: style.align ?? "left",
        lineHeight: 1.15,
      };
    }
    default:
      return {
        fontId: t.fonts.body,
        bold: style.bold ?? false,
        italic: style.italic ?? false,
        size: style.fontSize ?? t.fontSizes.body,
        color: color(ctx, style.color, "text-primary"),
        align: style.align ?? "left",
        lineHeight: 1.35,
      };
  }
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
      paragraphs: node.items.map((item) => ({
        lines: wrapText(item, spec.fontId, spec.bold, size, Math.max(20, width - indent)),
        bullet: true,
      })),
      paragraphGap: Math.round(size * 0.45),
    };
  }
  const text = (node as { text: string }).text;
  return {
    paragraphs: [{ lines: wrapText(text, spec.fontId, spec.bold, size, width) }].map((p) => ({
      ...p,
      bullet: false,
    })),
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
        CARD_PAD * 2 +
        t.fontSizes.metricLabel * 1.3 +
        8 +
        t.fontSizes.metricValue * 1.15 +
        deltaH
      );
    }
    case "image":
      return Math.round(width * (9 / 16));
    case "spacer":
      return node.size;
    case "row": {
      const pad = node.style?.padding ?? 0;
      const widths = rowChildWidths(ctx, node, width - pad * 2);
      let max = 0;
      node.children.forEach((child, i) => {
        max = Math.max(max, intrinsicHeight(ctx, child, widths[i]));
      });
      return max + pad * 2;
    }
    case "column": {
      const pad = node.style?.padding ?? 0;
      const gap = node.style?.gap ?? 16;
      const inner = width - pad * 2;
      let sum = 0;
      node.children.forEach((child, i) => {
        sum += intrinsicHeight(ctx, child, inner);
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
  if (node.style?.background) {
    ctx.boxes.push({
      kind: "rect",
      id: `box-${ctx.seq++}`,
      nodeId: node.id,
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      z,
      fill: color(ctx, node.style.background, "surface"),
      radius: node.style.radius ?? 0,
    });
  }
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
  const heights = node.children.map((c) => intrinsicHeight(ctx, c, inner.w));
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

  node.children.forEach((child, i) => {
    layoutNode(ctx, child, { x: inner.x, y, w: inner.w, h: assigned[i] }, z + 1);
    y += assigned[i] + between;
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
  let x = inner.x;
  node.children.forEach((child, i) => {
    let h = inner.h;
    let y = inner.y;
    if (align !== "stretch") {
      h = Math.min(inner.h, intrinsicHeight(ctx, child, widths[i]));
      if (align === "center") y += (inner.h - h) / 2;
      else if (align === "end") y += inner.h - h;
    }
    layoutNode(ctx, child, { x, y, w: widths[i], h }, z + 1);
    x += widths[i] + gap;
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
  const box: TextBox = {
    kind: "text",
    id: `box-${ctx.seq++}`,
    nodeId: node.id,
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    z: z + 100,
    paragraphs: para.paragraphs,
    fontId: spec.fontId,
    bold: spec.bold,
    italic: spec.italic,
    size,
    lineHeight: spec.lineHeight,
    color: spec.color,
    align: spec.align,
    paragraphGap: para.paragraphGap,
  };
  ctx.boxes.push(box);
}

function layoutMetricCard(
  ctx: Ctx,
  node: Extract<DeckNode, { type: "metricCard" }>,
  rect: Rect,
  z: number,
) {
  const t = ctx.tokens;
  ctx.boxes.push({
    kind: "rect",
    id: `box-${ctx.seq++}`,
    nodeId: node.id,
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    z,
    fill: color(ctx, node.background, "surface"),
    radius: t.radius.md,
  });
  const innerX = rect.x + CARD_PAD;
  const innerW = rect.w - CARD_PAD * 2;
  let y = rect.y + CARD_PAD;

  const label: TextBox = {
    kind: "text",
    id: `box-${ctx.seq++}`,
    nodeId: node.id,
    x: innerX,
    y,
    w: innerW,
    h: t.fontSizes.metricLabel * 1.3,
    z: z + 100,
    paragraphs: [{ lines: [node.label.toUpperCase()], bullet: false }],
    fontId: t.fonts.body,
    bold: false,
    italic: false,
    size: t.fontSizes.metricLabel,
    lineHeight: 1.3,
    color: t.colors["text-secondary"],
    align: "left",
    paragraphGap: 0,
  };
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
  const value: TextBox = {
    kind: "text",
    id: `box-${ctx.seq++}`,
    nodeId: node.id,
    x: innerX,
    y,
    w: innerW,
    h: valueSize * 1.15,
    z: z + 100,
    paragraphs: [{ lines: [node.value], bullet: false }],
    fontId: t.fonts.body,
    bold: true,
    italic: false,
    size: valueSize,
    lineHeight: 1.15,
    color: t.colors.accent,
    align: "left",
    paragraphGap: 0,
  };
  ctx.boxes.push(value);
  y += value.h + 4;

  if (node.delta) {
    ctx.boxes.push({
      kind: "text",
      id: `box-${ctx.seq++}`,
      nodeId: node.id,
      x: innerX,
      y,
      w: innerW,
      h: t.fontSizes.small * 1.3,
      z: z + 100,
      paragraphs: [{ lines: [node.delta], bullet: false }],
      fontId: t.fonts.body,
      bold: false,
      italic: false,
      size: t.fontSizes.small,
      lineHeight: 1.3,
      color: t.colors["text-secondary"],
      align: "left",
      paragraphGap: 0,
    });
  }
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
        src: node.src,
        alt: node.alt,
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
  ctx.boxes.sort((a, b) => a.z - b.z);
  return {
    id: slide.id,
    w: CANVAS_W,
    h: CANVAS_H,
    background: color(ctx, slide.background, "background"),
    boxes: ctx.boxes,
    warnings: ctx.warnings,
  };
}
