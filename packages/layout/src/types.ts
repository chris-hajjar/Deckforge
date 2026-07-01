/**
 * types.ts — the resolved geometry model.
 * The solver flattens the deck tree (flow layout + freeform overlays) into
 * absolutely-positioned primitive boxes on a 1280×720 canvas. Both the web
 * renderer and the pptx compiler consume ONLY this — neither ever sees the
 * tree — which is what makes preview and export identical by construction.
 */
import type { FontId, ShapeKind, Transition } from "@deckforge/schema";
import { CANVAS_H, CANVAS_W } from "@deckforge/schema";

export { CANVAS_H, CANVAS_W };

/** Entrance animation resolved onto a box (inherited from its source node). */
export interface ResolvedAnim {
  effect: "appear" | "fade" | "flyIn" | "zoom" | "wipe";
  direction?: "left" | "right" | "top" | "bottom";
  order: number;
  byParagraph?: boolean;
}

export interface ResolvedGradient {
  from: string; // hex
  to: string; // hex
  angle: 0 | 45 | 90 | 135;
}

export interface ResolvedStroke {
  color: string; // hex
  width: number;
}

interface BoxBase {
  /** Unique per box (a node may emit several boxes, e.g. metricCard). */
  id: string;
  /** Source element id in the deck tree — click-to-select maps through this. */
  nodeId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Paint order; lower first. */
  z: number;
  /** Entrance animation (drives Present mode and pptx timing injection). */
  anim?: ResolvedAnim;
}

export interface RectBox extends BoxBase {
  kind: "rect";
  fill?: string; // resolved hex; absent when gradient set
  gradient?: ResolvedGradient;
  stroke?: ResolvedStroke;
  shadow?: boolean;
  radius: number;
}

export interface ShapeBox extends BoxBase {
  kind: "shape";
  geometry: ShapeKind;
  fill?: string; // hex; lines have no fill
  gradient?: ResolvedGradient;
  stroke?: ResolvedStroke;
  shadow?: boolean;
}

export interface Paragraph {
  lines: string[];
  bullet: boolean;
  /** Ordered-list marker ("1." …); replaces the bullet dot when present. */
  marker?: string;
}

export interface TextBox extends BoxBase {
  kind: "text";
  paragraphs: Paragraph[];
  fontId: FontId;
  bold: boolean;
  italic: boolean;
  underline?: boolean;
  /** Final size after autoshrink, px on the 1280×720 canvas. */
  size: number;
  lineHeight: number; // multiplier
  letterSpacing?: number; // px
  color: string; // resolved hex
  align: "left" | "center" | "right";
  /** Vertical anchor inside the box (shape labels center). */
  valign?: "top" | "middle";
  /** Extra gap between paragraphs (px). */
  paragraphGap: number;
}

export interface ImageBox extends BoxBase {
  kind: "image";
  src: string;
  alt?: string;
  fit: "cover" | "contain";
  radius: number;
  shadow?: boolean;
}

export interface TableCell {
  text: string;
  bold: boolean;
  fill?: string; // hex
  color: string; // hex
  align: "left" | "center" | "right";
}

export interface TableBox extends BoxBase {
  kind: "table";
  /** Column widths / row heights in px; sum(colW)=w, sum(rowH)=h. */
  colW: number[];
  rowH: number[];
  cells: TableCell[][];
  fontId: FontId;
  size: number;
  borderColor: string; // hex hairline
  cellPad: number;
}

export type ResolvedBox = RectBox | ShapeBox | TextBox | ImageBox | TableBox;

export interface ResolvedSlide {
  id: string;
  w: typeof CANVAS_W;
  h: typeof CANVAS_H;
  background: string; // resolved hex
  gradient?: ResolvedGradient;
  transition?: Transition;
  notes?: string;
  boxes: ResolvedBox[];
  warnings: string[];
}
