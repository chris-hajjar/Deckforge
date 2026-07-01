/**
 * types.ts — the resolved geometry model.
 * The solver flattens the deck tree into absolutely-positioned primitive
 * boxes on a 1280×720 canvas. Both the web renderer and the pptx compiler
 * consume ONLY this — neither ever sees the tree — which is what makes
 * preview and export identical by construction.
 */
import type { FontId } from "@deckforge/schema";

export const CANVAS_W = 1280;
export const CANVAS_H = 720;

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
}

export interface RectBox extends BoxBase {
  kind: "rect";
  fill: string; // resolved hex
  radius: number;
}

export interface Paragraph {
  lines: string[];
  bullet: boolean;
}

export interface TextBox extends BoxBase {
  kind: "text";
  paragraphs: Paragraph[];
  fontId: FontId;
  bold: boolean;
  italic: boolean;
  /** Final size after autoshrink, px on the 1280×720 canvas. */
  size: number;
  lineHeight: number; // multiplier
  color: string; // resolved hex
  align: "left" | "center" | "right";
  /** Extra gap between paragraphs (px). */
  paragraphGap: number;
}

export interface ImageBox extends BoxBase {
  kind: "image";
  src: string;
  alt?: string;
}

export type ResolvedBox = RectBox | TextBox | ImageBox;

export interface ResolvedSlide {
  id: string;
  w: typeof CANVAS_W;
  h: typeof CANVAS_H;
  background: string; // resolved hex
  boxes: ResolvedBox[];
  warnings: string[];
}
