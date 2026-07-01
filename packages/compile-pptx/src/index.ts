/**
 * @deckforge/compile-pptx — ResolvedSlide[] → .pptx
 *
 * Because the layout solver already produced absolute boxes with resolved
 * (hex/px) styles, compilation is a mechanical walk: rect/shape → native
 * autoshape, text → editable text frame, table → native table, image →
 * embedded picture — at the same coordinates the web canvas drew.
 *
 * pptxgenjs cannot express slide transitions, entrance animations, or
 * gradient fills, so after it serializes the zip we post-process the slide
 * XML directly (see animate.ts) — output stays a fully standard OpenXML
 * package that PowerPoint and Google Slides both accept.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import PptxGenJS from "pptxgenjs";
import type { Deck, ShapeKind } from "@deckforge/schema";
import { resolveTheme } from "@deckforge/themes";
import {
  CANVAS_W,
  fontFamily,
  solveSlide,
  type ChartBox,
  type ImageBox,
  type ResolvedSlide,
  type TableBox,
  type TextBox,
} from "@deckforge/layout";
import { injectAnimations, type SlideAnimManifest } from "./animate.js";

// pptxgenjs is CJS with an ESM wrapper; under node/tsx the default import is
// the module object, under vite/vitest it's already the class. Unwrap once.
const PptxCtor: typeof PptxGenJS =
  (PptxGenJS as unknown as { default?: typeof PptxGenJS }).default ?? PptxGenJS;

/** 16:9 slide is 13.333in × 7.5in; our canvas is 1280×720 px → 96 px/in. */
const PX_PER_IN = CANVAS_W / 13.333;

const inch = (px: number) => px / PX_PER_IN;
const pt = (px: number) => px * (72 / 96);
const hex = (c: string) => c.replace("#", "").toUpperCase();

const SHAPE_MAP: Record<ShapeKind, string> = {
  rect: "rect",
  roundRect: "roundRect",
  ellipse: "ellipse",
  triangle: "triangle",
  diamond: "diamond",
  chevron: "chevron",
  rightArrow: "rightArrow",
  pill: "roundRect",
  line: "line",
};

const SHADOW: PptxGenJS.ShadowProps = {
  type: "outer",
  blur: 8,
  offset: 3,
  angle: 90,
  color: "000000",
  opacity: 0.35,
};

function addTextBox(pptxSlide: PptxGenJS.Slide, box: TextBox) {
  const runs: PptxGenJS.TextProps[] = box.paragraphs.map((para, pi) => ({
    text: para.lines.join("\n"),
    options: {
      bullet: para.bullet
        ? para.marker !== undefined
          ? { type: "number", indent: Math.round(pt(box.size * 0.9)) }
          : { characterCode: "2022", indent: Math.round(pt(box.size * 0.9)) }
        : false,
      breakLine: true,
      paraSpaceAfter: pi < box.paragraphs.length - 1 ? pt(box.paragraphGap) : 0,
    },
  }));
  pptxSlide.addText(runs, {
    x: inch(box.x),
    y: inch(box.y),
    w: inch(box.w),
    h: inch(box.h),
    fontFace: fontFamily(box.fontId),
    fontSize: Math.round(pt(box.size) * 10) / 10,
    bold: box.bold,
    italic: box.italic,
    underline: box.underline ? { style: "sng" } : undefined,
    charSpacing: box.letterSpacing ? Math.round(pt(box.letterSpacing) * 10) / 10 : undefined,
    color: hex(box.color),
    align: box.align,
    valign: box.valign === "middle" ? "middle" : "top",
    lineSpacingMultiple: box.lineHeight,
    inset: 0,
    margin: 0,
  });
}

function addTable(pptxSlide: PptxGenJS.Slide, box: TableBox) {
  const rows: PptxGenJS.TableRow[] = box.cells.map((row) =>
    row.map((cell) => ({
      text: cell.text,
      options: {
        bold: cell.bold,
        color: hex(cell.color),
        fill: cell.fill ? { color: hex(cell.fill) } : { color: "FFFFFF", transparency: 100 },
        align: cell.align,
        valign: "middle",
      },
    })),
  );
  pptxSlide.addTable(rows, {
    x: inch(box.x),
    y: inch(box.y),
    w: inch(box.w),
    colW: box.colW.map(inch),
    rowH: box.rowH.map(inch),
    fontFace: fontFamily(box.fontId),
    fontSize: Math.round(pt(box.size) * 10) / 10,
    border: { type: "solid", pt: 0.75, color: hex(box.borderColor) },
    margin: inch(box.cellPad),
    valign: "middle",
  });
}

/**
 * Native, fully editable PowerPoint chart. Colors are the theme's validated
 * categorical palette in slot order; ink stays in text tokens; one value
 * axis by construction. Geometry note: PowerPoint draws its own axes, so a
 * chart is semantically identical to the canvas preview (type, data, colors,
 * labels) rather than pixel-identical like every other element.
 */
function addChart(pptxSlide: PptxGenJS.Slide, box: ChartBox) {
  const isPieLike = box.chartType === "pie" || box.chartType === "donut";
  const data = isPieLike
    ? [
        {
          name: box.series[0]?.name ?? "Series",
          labels: box.categories,
          values: box.series[0]?.values ?? [],
        },
      ]
    : box.series.map((s) => ({ name: s.name, labels: box.categories, values: s.values }));

  const chartColors = isPieLike
    ? box.categories.map((_, i) => hex(box.palette[i % box.palette.length]))
    : box.series.map((s) => hex(s.color));

  const common: PptxGenJS.IChartOpts = {
    x: inch(box.x),
    y: inch(box.y),
    w: inch(box.w),
    h: inch(box.h),
    chartColors,
    fontFace: fontFamily(box.fontId),
    showLegend: box.legend,
    legendPos: "b",
    legendColor: hex(box.ink.muted),
    legendFontSize: 10,
    catAxisLabelColor: hex(box.ink.muted),
    catAxisLabelFontSize: 10,
    valAxisLabelColor: hex(box.ink.muted),
    valAxisLabelFontSize: 10,
    valGridLine: { color: hex(box.ink.grid), style: "solid", size: 0.5 },
    catGridLine: { style: "none" },
    valAxisLineShow: false,
    catAxisLineColor: hex(box.ink.grid),
    dataLabelColor: hex(box.ink.muted),
    dataLabelFontSize: 10,
    plotArea: { border: { none: true } as never },
  };

  switch (box.chartType) {
    case "column":
    case "bar":
      pptxSlide.addChart("bar" as PptxGenJS.CHART_NAME, data, {
        ...common,
        barDir: box.chartType === "column" ? "col" : "bar",
        barGapWidthPct: 60, // thin marks
        barOverlapPct: -8, // surface gap between adjacent bars in a group
        showValue: box.dataLabels,
        dataLabelPosition: "outEnd",
      });
      break;
    case "line":
      pptxSlide.addChart("line" as PptxGenJS.CHART_NAME, data, {
        ...common,
        lineSize: 2,
        lineDataSymbol: "circle",
        lineDataSymbolSize: 6, // ≥8px markers
        showValue: false, // selective labels: never a number on every point
      });
      break;
    case "area":
      pptxSlide.addChart("area" as PptxGenJS.CHART_NAME, data, {
        ...common,
        chartColorsOpacity: 35,
        showValue: false,
      });
      break;
    case "pie":
    case "donut":
      pptxSlide.addChart(
        (box.chartType === "pie" ? "pie" : "doughnut") as PptxGenJS.CHART_NAME,
        data,
        {
          ...common,
          holeSize: box.chartType === "donut" ? 60 : undefined,
          showValue: box.dataLabels,
          dataBorder: { pt: 1.5, color: hex(box.surface) }, // 2px surface gap
        } as PptxGenJS.IChartOpts,
      );
      break;
  }
}

/** Prefetch remote images to base64 so the pptx embeds real pixels. */
async function fetchImages(slides: ResolvedSlide[]): Promise<Map<string, string>> {
  const cache = new Map<string, string>();
  const srcs = new Set<string>();
  for (const s of slides) {
    for (const b of s.boxes) {
      if (b.kind === "image" && /^https?:\/\//.test(b.src)) srcs.add(b.src);
    }
  }
  await Promise.all(
    [...srcs].map(async (src) => {
      try {
        const res = await fetch(src);
        if (!res.ok) return;
        const mime = res.headers.get("content-type") ?? "image/png";
        const b64 = Buffer.from(await res.arrayBuffer()).toString("base64");
        cache.set(src, `data:${mime};base64,${b64}`);
      } catch {
        /* placeholder fallback below */
      }
    }),
  );
  return cache;
}

function addImage(
  pptxSlide: PptxGenJS.Slide,
  box: ImageBox,
  images: Map<string, string>,
): boolean {
  const data = box.src.startsWith("data:") ? box.src : images.get(box.src);
  if (!data) {
    // unresolved image → same labeled placeholder the canvas shows
    pptxSlide.addShape("rect", {
      x: inch(box.x),
      y: inch(box.y),
      w: inch(box.w),
      h: inch(box.h),
      fill: { color: "DDDDDD" },
      line: { color: "999999", width: 1, dashType: "dash" },
    });
    pptxSlide.addText(box.alt ?? "image", {
      x: inch(box.x),
      y: inch(box.y),
      w: inch(box.w),
      h: inch(box.h),
      align: "center",
      valign: "middle",
      fontFace: "Arial",
      fontSize: 12,
      color: "666666",
    });
    return false; // emitted 2 drawables (rect + text)
  }
  pptxSlide.addImage({
    data,
    x: inch(box.x),
    y: inch(box.y),
    w: inch(box.w),
    h: inch(box.h),
    sizing: { type: box.fit, w: inch(box.w), h: inch(box.h) },
    shadow: box.shadow ? SHADOW : undefined,
  });
  return true;
}

export interface CompiledDeck {
  pptx: InstanceType<typeof PptxGenJS>;
  manifests: SlideAnimManifest[];
  resolved: ResolvedSlide[];
}

export function compileResolved(
  slides: ResolvedSlide[],
  title: string,
  images: Map<string, string> = new Map(),
): CompiledDeck {
  const pptx = new PptxCtor();
  pptx.defineLayout({ name: "DF_16x9", width: 13.333, height: 7.5 });
  pptx.layout = "DF_16x9";
  pptx.title = title;

  const manifests: SlideAnimManifest[] = [];

  for (const slide of slides) {
    const s = pptx.addSlide();
    s.background = { color: hex(slide.background) };
    if (slide.notes) s.addNotes(slide.notes);

    // manifest tracks every drawable in emission order so the XML injector
    // can map animations/gradients onto the right shape ids afterwards.
    const manifest: SlideAnimManifest = {
      transition: slide.transition,
      bgGradient: slide.gradient,
      drawables: [],
    };

    for (const box of slide.boxes) {
      switch (box.kind) {
        case "rect": {
          s.addShape(box.radius > 0 ? "roundRect" : "rect", {
            x: inch(box.x),
            y: inch(box.y),
            w: inch(box.w),
            h: inch(box.h),
            // gradient placeholder: solid `from` color, swapped in post-process
            fill: { color: hex(box.gradient ? box.gradient.from : (box.fill ?? "#ffffff")) },
            line: box.stroke
              ? { color: hex(box.stroke.color), width: pt(box.stroke.width) }
              : { type: "none" },
            shadow: box.shadow ? SHADOW : undefined,
            rectRadius: box.radius > 0 ? Math.min(inch(box.radius), inch(box.h) / 2) : 0,
          });
          manifest.drawables.push({ anim: box.anim, gradient: box.gradient });
          break;
        }
        case "shape": {
          if (box.geometry === "line") {
            s.addShape("line", {
              x: inch(box.x),
              y: inch(box.y + box.h / 2),
              w: inch(box.w),
              h: 0,
              line: {
                color: hex(box.stroke?.color ?? "#000000"),
                width: pt(box.stroke?.width ?? 2),
              },
            });
            manifest.drawables.push({ anim: box.anim });
            break;
          }
          s.addShape(SHAPE_MAP[box.geometry] as PptxGenJS.SHAPE_NAME, {
            x: inch(box.x),
            y: inch(box.y),
            w: inch(box.w),
            h: inch(box.h),
            fill: { color: hex(box.gradient ? box.gradient.from : (box.fill ?? "#ffffff")) },
            line: box.stroke
              ? { color: hex(box.stroke.color), width: pt(box.stroke.width) }
              : { type: "none" },
            shadow: box.shadow ? SHADOW : undefined,
            rectRadius: box.geometry === "pill" ? inch(box.h) / 2 : undefined,
          });
          manifest.drawables.push({ anim: box.anim, gradient: box.gradient });
          break;
        }
        case "text":
          addTextBox(s, box);
          manifest.drawables.push({
            anim: box.anim,
            paraCount: box.paragraphs.length,
          });
          break;
        case "table":
          addTable(s, box);
          manifest.drawables.push({ anim: box.anim });
          break;
        case "chart":
          addChart(s, box);
          manifest.drawables.push({ anim: box.anim });
          break;
        case "image": {
          const single = addImage(s, box, images);
          manifest.drawables.push({ anim: box.anim });
          if (!single) manifest.drawables.push({ anim: box.anim }); // placeholder label
          break;
        }
      }
    }
    manifests.push(manifest);
  }
  return { pptx, manifests, resolved: slides };
}

async function compileDeck(deck: Deck): Promise<{ buffer: Buffer; resolved: ResolvedSlide[] }> {
  const tokens = resolveTheme(deck.theme);
  const resolved = deck.slides.map((s) => solveSlide(s, tokens));
  const images = await fetchImages(resolved);
  const { pptx, manifests } = compileResolved(resolved, deck.title, images);
  const raw = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  const buffer = await injectAnimations(raw, manifests);
  return { buffer, resolved };
}

/** Full pipeline: deck JSON → resolved layout → pptx file on disk. */
export async function compileDeckToFile(deck: Deck, outPath: string): Promise<ResolvedSlide[]> {
  const { buffer, resolved } = await compileDeck(deck);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, buffer);
  return resolved;
}

/** Same, but to a Buffer (for HTTP export). */
export async function compileDeckToBuffer(deck: Deck): Promise<Buffer> {
  return (await compileDeck(deck)).buffer;
}
