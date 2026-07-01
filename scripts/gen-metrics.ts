/**
 * gen-metrics.ts — precompute font metrics tables from Liberation fonts.
 *
 * Liberation Sans is metric-compatible with Arial; Liberation Serif with
 * Times. Deckforge's "sans" token maps to Arial and "serif" to Georgia in
 * exports; Georgia is slightly wider than Times, so we apply a small width
 * factor to keep wrap estimates safe. Tables ship as committed JSON so
 * layout is deterministic everywhere (server, tests, browser) with no
 * font files or native deps at runtime.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import opentype from "opentype.js";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "packages", "layout", "src", "metrics");
mkdirSync(outDir, { recursive: true });

const FONT_DIR = "/usr/share/fonts/truetype/liberation";

// chars we precompute: ASCII printable + common typographic extras
const CHARS =
  " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~" +
  "–—‘’“”•… €£¥°±×÷≈–";

interface Table {
  family: string;
  unitsPerEm: number;
  ascender: number;
  descender: number;
  /** advance width per char, in font units */
  widths: Record<string, number>;
  defaultWidth: number;
  /** multiplier applied to all widths (e.g. Georgia ≈ 1.06 × Times) */
  widthFactor: number;
}

function build(file: string, family: string, widthFactor: number): Table {
  const font = opentype.parse(readFileSync(join(FONT_DIR, file)).buffer as ArrayBuffer);
  const widths: Record<string, number> = {};
  for (const ch of CHARS) {
    const glyph = font.charToGlyph(ch);
    if (glyph && glyph.advanceWidth) widths[ch] = glyph.advanceWidth;
  }
  const x = font.charToGlyph("x");
  return {
    family,
    unitsPerEm: font.unitsPerEm,
    ascender: font.ascender,
    descender: font.descender,
    widths,
    defaultWidth: x?.advanceWidth ?? font.unitsPerEm / 2,
    widthFactor,
  };
}

const tables = {
  "sans-regular": build("LiberationSans-Regular.ttf", "Arial", 1),
  "sans-bold": build("LiberationSans-Bold.ttf", "Arial", 1),
  // Georgia runs wider than Times; 1.07 keeps wrap estimates conservative.
  "serif-regular": build("LiberationSerif-Regular.ttf", "Georgia", 1.07),
  "serif-bold": build("LiberationSerif-Bold.ttf", "Georgia", 1.07),
};

for (const [name, table] of Object.entries(tables)) {
  writeFileSync(join(outDir, `${name}.json`), JSON.stringify(table));
  console.log(`${name}: ${Object.keys(table.widths).length} glyph widths, upem=${table.unitsPerEm}`);
}
