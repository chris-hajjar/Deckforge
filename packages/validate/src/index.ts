/**
 * @deckforge/validate — the auto-correction engine.
 *
 * One pure function sits in every write path (AI tool call or canvas knob):
 *
 *   proposed deck ── parse(schema) ── snap(tokens/constraints) ──► corrected deck
 *                                                                + correction report
 *
 * If a value violates brand rules (raw hex color, off-scale padding, unknown
 * token role), it is forced to the nearest brand standard and the correction
 * is reported — the caller (and the AI's context) always sees what was
 * actually applied, never the rejected intent.
 */
import {
  CANVAS_H,
  CANVAS_W,
  COLOR_ROLES,
  DeckSchema,
  type ColorRole,
  type Deck,
  type ThemeTokens,
  walkDeck,
} from "@deckforge/schema";
import { resolveTheme } from "@deckforge/themes";

export interface Correction {
  /** JSON pointer to the corrected value. */
  pointer: string;
  field: string;
  from: unknown;
  to: unknown;
  reason: string;
}

export interface NormalizeResult {
  deck: Deck;
  tokens: ThemeTokens;
  corrections: Correction[];
}

export class DeckValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeckValidationError";
  }
}

// ---------- helpers ----------
function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** Nearest brand color role for a raw hex value (Euclidean RGB distance). */
export function nearestColorRole(hex: string, tokens: ThemeTokens): ColorRole | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  let best: ColorRole | null = null;
  let bestDist = Infinity;
  for (const role of COLOR_ROLES) {
    const trgb = hexToRgb(tokens.colors[role])!;
    const d =
      (rgb[0] - trgb[0]) ** 2 + (rgb[1] - trgb[1]) ** 2 + (rgb[2] - trgb[2]) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = role;
    }
  }
  return best;
}

export function nearestStep(value: number, scale: readonly number[]): number {
  let best = scale[0];
  for (const s of scale) if (Math.abs(s - value) < Math.abs(best - value)) best = s;
  return best;
}

const isRole = (v: unknown): v is ColorRole =>
  typeof v === "string" && (COLOR_ROLES as readonly string[]).includes(v);

// ---------- the engine ----------
export function normalizeDeck(input: unknown): NormalizeResult {
  const parsed = DeckSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new DeckValidationError(`Deck failed schema validation: ${issues}`);
  }
  const deck = parsed.data as Deck;
  const tokens = resolveTheme(deck.theme); // throws on unknown base theme
  const corrections: Correction[] = [];

  const fixColor = (
    holder: Record<string, unknown>,
    field: string,
    pointer: string,
    fallback: ColorRole,
  ) => {
    const v = holder[field];
    if (v === undefined || isRole(v)) return;
    const snapped =
      typeof v === "string" ? (nearestColorRole(v, tokens) ?? fallback) : fallback;
    corrections.push({
      pointer,
      field,
      from: v,
      to: snapped,
      reason:
        typeof v === "string" && hexToRgb(v)
          ? `raw color snapped to nearest brand token "${snapped}"`
          : `unknown color "${String(v)}" replaced with brand token "${snapped}"`,
    });
    holder[field] = snapped;
  };

  const fixScale = (
    holder: Record<string, unknown>,
    field: string,
    pointer: string,
    scale: readonly number[],
    what: string,
  ) => {
    const v = holder[field];
    if (typeof v !== "number") return;
    const snapped = nearestStep(v, scale);
    if (snapped === v) return;
    corrections.push({
      pointer,
      field,
      from: v,
      to: snapped,
      reason: `${what} snapped to brand scale`,
    });
    holder[field] = snapped;
  };

  const fixGradient = (holder: Record<string, unknown>, pointer: string) => {
    const g = holder.gradient as Record<string, unknown> | undefined;
    if (!g) return;
    fixColor(g, "from", `${pointer}/gradient`, "surface");
    fixColor(g, "to", `${pointer}/gradient`, "accent");
  };

  const fixBorder = (holder: Record<string, unknown>, pointer: string) => {
    const b = holder.border as Record<string, unknown> | undefined;
    if (!b) return;
    fixColor(b, "color", `${pointer}/border`, "accent");
  };

  const fixTextStyle = (style: Record<string, unknown> | undefined, pointer: string) => {
    if (!style) return;
    fixColor(style, "color", pointer, "text-primary");
    fixScale(style, "fontSize", pointer, tokens.fontSizeScale, "font size");
  };

  /** Overlay elements must sit inside the canvas; drift is clamped, not rejected. */
  const clampFrame = (node: Record<string, unknown>, pointer: string, isOverlayRoot: boolean) => {
    let frame = node.frame as Record<string, number> | undefined;
    if (!frame && isOverlayRoot) {
      frame = { x: CANVAS_W / 4, y: CANVAS_H / 4, w: CANVAS_W / 2, h: CANVAS_H / 4 };
      corrections.push({
        pointer,
        field: "frame",
        from: undefined,
        to: frame,
        reason: "overlay element was missing a frame; placed at canvas center",
      });
      node.frame = frame;
    }
    if (!frame) return;
    const clamped = {
      x: Math.min(Math.max(0, frame.x), CANVAS_W - 8),
      y: Math.min(Math.max(0, frame.y), CANVAS_H - 8),
      w: Math.max(8, Math.min(frame.w, CANVAS_W)),
      h: Math.max(8, Math.min(frame.h, CANVAS_H)),
    };
    clamped.w = Math.min(clamped.w, CANVAS_W - clamped.x);
    clamped.h = Math.min(clamped.h, CANVAS_H - clamped.y);
    if (
      clamped.x !== frame.x ||
      clamped.y !== frame.y ||
      clamped.w !== frame.w ||
      clamped.h !== frame.h
    ) {
      corrections.push({
        pointer,
        field: "frame",
        from: { ...frame },
        to: clamped,
        reason: "frame clamped to the 1280×720 canvas",
      });
      node.frame = clamped;
    }
  };

  // slide-level props
  const radiusScale = [tokens.radius.none, tokens.radius.sm, tokens.radius.md];
  deck.slides.forEach((slide, si) => {
    const sp = `/slides/${si}`;
    fixColor(slide as never, "background", sp, "background");
    fixGradient(slide as never, sp);
    fixScale(slide as never, "padding", sp, tokens.spacingScale, "slide padding");
  });

  // element-level props
  for (const { node, pointer } of walkDeck(deck)) {
    const style = (node as { style?: Record<string, unknown> }).style;
    clampFrame(node as never, pointer, /\/overlays\/\d+$/.test(pointer));
    switch (node.type) {
      case "heading":
      case "text":
      case "bulletList":
        fixTextStyle(style, pointer);
        break;
      case "metricCard":
        fixColor(node as never, "background", pointer, "surface");
        break;
      case "shape":
        fixColor(node as never, "fill", pointer, "accent");
        fixGradient(node as never, pointer);
        fixBorder(node as never, pointer);
        fixTextStyle((node as { textStyle?: Record<string, unknown> }).textStyle, pointer);
        break;
      case "image":
        fixScale(node as never, "radius", pointer, radiusScale, "corner radius");
        break;
      case "table":
        fixTextStyle(style, pointer);
        break;
      case "row":
      case "column":
        if (style) {
          fixColor(style, "background", pointer, "surface");
          fixGradient(style, pointer);
          fixBorder(style, pointer);
          fixScale(style, "padding", pointer, tokens.spacingScale, "padding");
          fixScale(style, "gap", pointer, tokens.spacingScale, "gap");
          fixScale(style, "radius", pointer, radiusScale, "corner radius");
        }
        break;
      case "spacer":
        fixScale(node as never, "size", pointer, tokens.spacingScale, "spacer size");
        break;
    }
  }

  return { deck, tokens, corrections };
}
