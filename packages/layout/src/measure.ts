/**
 * measure.ts — deterministic text measurement from precomputed metrics.
 * No font files, no canvas, no browser: pure table lookups, so the layout
 * solver produces identical geometry on server, in tests, and in the canvas
 * app (which imports this same code).
 */
import type { FontId } from "@deckforge/schema";
import sansRegular from "./metrics/sans-regular.json" with { type: "json" };
import sansBold from "./metrics/sans-bold.json" with { type: "json" };
import serifRegular from "./metrics/serif-regular.json" with { type: "json" };
import serifBold from "./metrics/serif-bold.json" with { type: "json" };
import monoRegular from "./metrics/mono-regular.json" with { type: "json" };
import monoBold from "./metrics/mono-bold.json" with { type: "json" };

interface MetricsTable {
  family: string;
  unitsPerEm: number;
  ascender: number;
  descender: number;
  widths: Record<string, number>;
  defaultWidth: number;
  widthFactor: number;
}

const TABLES: Record<string, MetricsTable> = {
  "sans-regular": sansRegular as MetricsTable,
  "sans-bold": sansBold as MetricsTable,
  "serif-regular": serifRegular as MetricsTable,
  "serif-bold": serifBold as MetricsTable,
  "mono-regular": monoRegular as MetricsTable,
  "mono-bold": monoBold as MetricsTable,
};

export function fontFamily(fontId: FontId): string {
  return TABLES[`${fontId}-regular`].family;
}

function table(fontId: FontId, bold: boolean): MetricsTable {
  return TABLES[`${fontId}-${bold ? "bold" : "regular"}`];
}

/** Width in px of a single line of text at the given size. */
export function measureText(
  text: string,
  fontId: FontId,
  bold: boolean,
  sizePx: number,
): number {
  const t = table(fontId, bold);
  let units = 0;
  for (const ch of text) units += t.widths[ch] ?? t.defaultWidth;
  return (units / t.unitsPerEm) * sizePx * t.widthFactor;
}

/**
 * Greedy word-wrap into lines that fit maxWidth. Explicit \n is respected;
 * a single word longer than the line is hard-broken so nothing ever
 * escapes its box horizontally.
 */
export function wrapText(
  text: string,
  fontId: FontId,
  bold: boolean,
  sizePx: number,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  for (const rawLine of text.split("\n")) {
    const words = rawLine.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let current = "";
    for (let word of words) {
      // hard-break words that alone exceed the line
      while (measureText(word, fontId, bold, sizePx) > maxWidth && word.length > 1) {
        let cut = word.length - 1;
        while (cut > 1 && measureText(word.slice(0, cut), fontId, bold, sizePx) > maxWidth) {
          cut--;
        }
        const head = word.slice(0, cut);
        if (current) {
          lines.push(current);
          current = "";
        }
        lines.push(head);
        word = word.slice(cut);
      }
      const candidate = current ? `${current} ${word}` : word;
      if (measureText(candidate, fontId, bold, sizePx) <= maxWidth || !current) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    }
    lines.push(current);
  }
  return lines;
}
