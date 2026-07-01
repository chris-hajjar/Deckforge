/**
 * @deckforge/compile-pptx — ResolvedSlide[] → .pptx
 *
 * Because the layout solver already produced absolute boxes with resolved
 * (hex/px) styles, compilation is a mechanical walk: rect → native shape,
 * text → editable text frame, at the same coordinates the web canvas drew.
 *
 * Compatibility: output sticks to features Google Slides imports cleanly —
 * plain shapes, text boxes, standard bullets, and fonts that are built into
 * both PowerPoint and Google Slides (Arial, Georgia). No masters, no exotic
 * effects, so File → Import in Slides is lossless.
 */
import PptxGenJS from "pptxgenjs";
import type { Deck } from "@deckforge/schema";
import { resolveTheme } from "@deckforge/themes";
import {
  CANVAS_H,
  CANVAS_W,
  fontFamily,
  solveSlide,
  type ResolvedSlide,
  type TextBox,
} from "@deckforge/layout";

/** 16:9 slide is 13.333in × 7.5in; our canvas is 1280×720 px → 96 px/in. */
const PX_PER_IN = CANVAS_W / 13.333;

const inch = (px: number) => px / PX_PER_IN;
const hex = (c: string) => c.replace("#", "").toUpperCase();

function addTextBox(pptxSlide: PptxGenJS.Slide, box: TextBox) {
  const runs: PptxGenJS.TextProps[] = [];
  box.paragraphs.forEach((para, pi) => {
    const paraText = para.lines.join("\n");
    runs.push({
      text: paraText,
      options: {
        bullet: para.bullet ? { characterCode: "2022", indent: Math.round(box.size * 0.9) } : false,
        breakLine: true,
        paraSpaceAfter: pi < box.paragraphs.length - 1 ? box.paragraphGap * (72 / 96) : 0,
      },
    });
  });
  pptxSlide.addText(runs, {
    x: inch(box.x),
    y: inch(box.y),
    w: inch(box.w),
    h: inch(box.h),
    fontFace: fontFamily(box.fontId),
    // PowerPoint font size is in points; canvas px at 96dpi → pt at 72dpi.
    fontSize: Math.round(box.size * (72 / 96) * 10) / 10,
    bold: box.bold,
    italic: box.italic,
    color: hex(box.color),
    align: box.align,
    valign: "top",
    lineSpacingMultiple: box.lineHeight,
    inset: 0,
    margin: 0,
  });
}

export function compileResolved(
  slides: ResolvedSlide[],
  title: string,
): InstanceType<typeof PptxGenJS> {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "DF_16x9", width: 13.333, height: 7.5 });
  pptx.layout = "DF_16x9";
  pptx.title = title;

  for (const slide of slides) {
    const s = pptx.addSlide();
    s.background = { color: hex(slide.background) };
    for (const box of slide.boxes) {
      switch (box.kind) {
        case "rect":
          s.addShape(box.radius > 0 ? "roundRect" : "rect", {
            x: inch(box.x),
            y: inch(box.y),
            w: inch(box.w),
            h: inch(box.h),
            fill: { color: hex(box.fill) },
            line: { type: "none" },
            // rectRadius is in inches; radius px → in, clamped to half-height
            rectRadius: box.radius > 0 ? Math.min(inch(box.radius), inch(box.h) / 2) : 0,
          });
          break;
        case "text":
          addTextBox(s, box);
          break;
        case "image":
          // v2.0: images render as a labeled placeholder frame (same as canvas).
          s.addShape("rect", {
            x: inch(box.x),
            y: inch(box.y),
            w: inch(box.w),
            h: inch(box.h),
            fill: { color: "DDDDDD" },
            line: { color: "999999", width: 1, dashType: "dash" },
          });
          s.addText(box.alt ?? "image", {
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
          break;
      }
    }
  }
  return pptx;
}

/** Full pipeline: deck JSON → resolved layout → pptx file on disk. */
export async function compileDeckToFile(deck: Deck, outPath: string): Promise<ResolvedSlide[]> {
  const tokens = resolveTheme(deck.theme);
  const resolved = deck.slides.map((s) => solveSlide(s, tokens));
  const pptx = compileResolved(resolved, deck.title);
  await pptx.writeFile({ fileName: outPath });
  return resolved;
}

/** Same, but to a Buffer (for HTTP export). */
export async function compileDeckToBuffer(deck: Deck): Promise<Buffer> {
  const tokens = resolveTheme(deck.theme);
  const resolved = deck.slides.map((s) => solveSlide(s, tokens));
  const pptx = compileResolved(resolved, deck.title);
  return (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
}
