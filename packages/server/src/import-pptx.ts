/**
 * import-pptx.ts — turn existing PowerPoint / Google Slides decks into
 * Deckforge templates.
 *
 * Google Slides exports .pptx (File → Download → Microsoft PowerPoint), so
 * one importer covers both. Each slide becomes a template whose elements are
 * freeform overlays at their exact pptx coordinates (EMU → px on the
 * 1280×720 canvas): text bodies, autoshapes, lines, embedded pictures and
 * solid backgrounds. Groups are flattened through their transforms.
 *
 * Colors and sizes import as raw values; Deckforge's auto-correction snaps
 * them to the active brand tokens the moment a template is instantiated into
 * a deck — importing a foreign template effectively re-brands it.
 *
 * Not imported (skipped with a note): charts, tables, gradients/pictures as
 * fills, WordArt, and master/layout inheritance (only what's on the slide
 * itself).
 */
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { CANVAS_H, CANVAS_W, type DeckNode, type Slide } from "@deckforge/schema";

const EMU_PER_PX = 9525; // 914400 EMU/in ÷ 96 px/in
const px = (emu: number) => Math.round(emu / EMU_PER_PX);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  removeNSPrefix: false,
  isArray: (name) =>
    ["p:sp", "p:pic", "p:grpSp", "p:graphicFrame", "p:cxnSp", "a:p", "a:r"].includes(name),
});

type XmlNode = Record<string, unknown>;

const arr = (v: unknown): XmlNode[] => (Array.isArray(v) ? (v as XmlNode[]) : v ? [v as XmlNode] : []);
const get = (o: unknown, ...path: string[]): unknown => {
  let cur: unknown = o;
  for (const p of path) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as XmlNode)[p];
  }
  return cur;
};

interface Transform {
  offX: number;
  offY: number;
  scaleX: number;
  scaleY: number;
}
const IDENTITY: Transform = { offX: 0, offY: 0, scaleX: 1, scaleY: 1 };

function frameOf(xfrm: unknown, t: Transform) {
  const off = get(xfrm, "a:off") as XmlNode | undefined;
  const ext = get(xfrm, "a:ext") as XmlNode | undefined;
  if (!off || !ext) return null;
  const x = Number(off["@x"]);
  const y = Number(off["@y"]);
  const w = Number(ext["@cx"]);
  const h = Number(ext["@cy"]);
  return {
    x: Math.max(0, Math.min(CANVAS_W - 8, px(t.offX + x * t.scaleX))),
    y: Math.max(0, Math.min(CANVAS_H - 8, px(t.offY + y * t.scaleY))),
    w: Math.max(8, px(w * t.scaleX)),
    h: Math.max(8, px(h * t.scaleY)),
  };
}

function solidHex(node: unknown): string | undefined {
  const val = get(node, "a:solidFill", "a:srgbClr", "@val");
  return typeof val === "string" ? `#${val.toLowerCase()}` : undefined;
}

const GEOM_MAP: Record<string, string> = {
  rect: "rect",
  roundRect: "roundRect",
  ellipse: "ellipse",
  triangle: "triangle",
  diamond: "diamond",
  chevron: "chevron",
  rightArrow: "rightArrow",
  homePlate: "chevron",
  pill: "pill",
  line: "line",
};

interface ImportCtx {
  notes: string[];
  media: Map<string, string>; // rel id → data URL
  seq: number;
}

function textFromBody(txBody: unknown): {
  text: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  align?: "left" | "center" | "right";
} | null {
  const paras = arr(get(txBody, "a:p"));
  const lines: string[] = [];
  let fontSize: number | undefined;
  let bold: boolean | undefined;
  let italic: boolean | undefined;
  let color: string | undefined;
  let align: "left" | "center" | "right" | undefined;
  for (const p of paras) {
    const runs = arr(p["a:r"]);
    const line = runs
      .map((r) => {
        const t = r["a:t"];
        return typeof t === "string" ? t : typeof t === "number" ? String(t) : "";
      })
      .join("");
    lines.push(line);
    const rPr = runs.length ? (runs[0]["a:rPr"] as XmlNode | undefined) : undefined;
    if (rPr && fontSize === undefined && rPr["@sz"] !== undefined) {
      fontSize = Math.round((Number(rPr["@sz"]) / 100) * (96 / 72));
    }
    if (rPr && bold === undefined && rPr["@b"] !== undefined) bold = rPr["@b"] === "1";
    if (rPr && italic === undefined && rPr["@i"] !== undefined) italic = rPr["@i"] === "1";
    if (rPr && color === undefined) color = solidHex(rPr);
    const algn = get(p, "a:pPr", "@algn");
    if (align === undefined && (algn === "ctr" || algn === "r" || algn === "l")) {
      align = algn === "ctr" ? "center" : algn === "r" ? "right" : "left";
    }
  }
  const text = lines.join("\n").trim();
  if (!text) return null;
  return { text, fontSize, bold, italic, color, align };
}

function importShape(sp: XmlNode, t: Transform, ctx: ImportCtx): DeckNode | null {
  const frame = frameOf(get(sp, "p:spPr", "a:xfrm"), t);
  if (!frame) return null;
  const spPr = sp["p:spPr"] as XmlNode;
  const prst = get(spPr, "a:prstGeom", "@prst") as string | undefined;
  const fill = solidHex(spPr);
  const lineColor = solidHex(get(spPr, "a:ln"));
  const lineW = get(spPr, "a:ln", "@w");
  const body = sp["p:txBody"];
  const txt = body ? textFromBody(body) : null;

  // pure text box: no geometry fill → text element
  if (txt && !fill) {
    const style: Record<string, unknown> = {};
    if (txt.fontSize) style.fontSize = txt.fontSize;
    if (txt.bold) style.bold = true;
    if (txt.italic) style.italic = true;
    if (txt.color) style.color = txt.color;
    if (txt.align) style.align = txt.align;
    return {
      id: `imp-${ctx.seq++}`,
      type: "text",
      text: txt.text,
      ...(Object.keys(style).length ? { style } : {}),
      frame,
    } as DeckNode;
  }

  // shape (with optional label)
  const geometry = (prst && GEOM_MAP[prst]) || "rect";
  if (prst && !GEOM_MAP[prst]) ctx.notes.push(`geometry "${prst}" approximated as rect`);
  const node: Record<string, unknown> = {
    id: `imp-${ctx.seq++}`,
    type: "shape",
    shape: geometry,
    frame,
  };
  if (fill) node.fill = fill;
  if (lineColor) {
    node.border = {
      color: lineColor,
      width: Math.min(8, Math.max(1, lineW ? px(Number(lineW)) : 2)),
    };
  }
  if (txt) {
    node.text = txt.text;
    const ts: Record<string, unknown> = {};
    if (txt.fontSize) ts.fontSize = txt.fontSize;
    if (txt.color) ts.color = txt.color;
    if (Object.keys(ts).length) node.textStyle = ts;
  }
  return node as unknown as DeckNode;
}

function importPic(pic: XmlNode, t: Transform, ctx: ImportCtx): DeckNode | null {
  const frame = frameOf(get(pic, "p:spPr", "a:xfrm"), t);
  if (!frame) return null;
  const relId = get(pic, "p:blipFill", "a:blip", "@r:embed") as string | undefined;
  const data = relId ? ctx.media.get(relId) : undefined;
  if (!data) ctx.notes.push("a picture had no embeddable media; imported as placeholder");
  return {
    id: `imp-${ctx.seq++}`,
    type: "image",
    src: data ?? "",
    alt: (get(pic, "p:nvPicPr", "p:cNvPr", "@name") as string) ?? "imported image",
    frame,
  } as DeckNode;
}

function importGroup(grp: XmlNode, t: Transform, ctx: ImportCtx): DeckNode[] {
  const xfrm = get(grp, "p:grpSpPr", "a:xfrm");
  const off = get(xfrm, "a:off") as XmlNode | undefined;
  const ext = get(xfrm, "a:ext") as XmlNode | undefined;
  const chOff = get(xfrm, "a:chOff") as XmlNode | undefined;
  const chExt = get(xfrm, "a:chExt") as XmlNode | undefined;
  let child = t;
  if (off && ext && chOff && chExt) {
    const sx = (Number(ext["@cx"]) / Math.max(1, Number(chExt["@cx"]))) * t.scaleX;
    const sy = (Number(ext["@cy"]) / Math.max(1, Number(chExt["@cy"]))) * t.scaleY;
    child = {
      scaleX: sx,
      scaleY: sy,
      offX: t.offX + Number(off["@x"]) * t.scaleX - Number(chOff["@x"]) * sx,
      offY: t.offY + Number(off["@y"]) * t.scaleY - Number(chOff["@y"]) * sy,
    };
  }
  return importShapeTree(grp, child, ctx);
}

function importShapeTree(container: XmlNode, t: Transform, ctx: ImportCtx): DeckNode[] {
  const out: DeckNode[] = [];
  for (const sp of arr(container["p:sp"])) {
    const node = importShape(sp, t, ctx);
    if (node) out.push(node);
  }
  for (const pic of arr(container["p:pic"])) {
    const node = importPic(pic, t, ctx);
    if (node) out.push(node);
  }
  for (const grp of arr(container["p:grpSp"])) out.push(...importGroup(grp, t, ctx));
  for (const cxn of arr(container["p:cxnSp"])) {
    const frame = frameOf(get(cxn, "p:spPr", "a:xfrm"), t);
    if (!frame) continue;
    out.push({
      id: `imp-${ctx.seq++}`,
      type: "shape",
      shape: "line",
      ...(solidHex(get(cxn, "p:spPr", "a:ln")) ? { fill: solidHex(get(cxn, "p:spPr", "a:ln")) } : {}),
      frame: { ...frame, h: Math.max(8, frame.h) },
    } as DeckNode);
  }
  const frames = arr(container["p:graphicFrame"]).length;
  if (frames > 0) ctx.notes.push(`${frames} chart/table graphicFrame(s) skipped (recreate with Deckforge chart/table elements)`);
  return out;
}

export interface ImportedSlide {
  slide: Slide;
  notes: string[];
}

/** Parse a .pptx buffer into overlay-based Deckforge slides (one per pptx slide). */
export async function importPptx(buffer: Buffer): Promise<ImportedSlide[]> {
  const zip = await JSZip.loadAsync(buffer);
  const slidePaths = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  if (slidePaths.length === 0) throw new Error("No slides found — is this a .pptx file?");

  const out: ImportedSlide[] = [];
  for (const path of slidePaths) {
    const n = path.match(/\d+/)![0];
    const xml = parser.parse(await zip.file(path)!.async("string"));
    const ctx: ImportCtx = { notes: [], media: new Map(), seq: 1 };

    // relationships → embedded media as data URLs
    const relsFile = zip.file(`ppt/slides/_rels/slide${n}.xml.rels`);
    if (relsFile) {
      const rels = parser.parse(await relsFile.async("string"));
      for (const rel of arr(get(rels, "Relationships", "Relationship"))) {
        const type = rel["@Type"] as string;
        if (!type?.endsWith("/image")) continue;
        const target = (rel["@Target"] as string).replace("..", "ppt");
        const media = zip.file(target);
        if (!media) continue;
        const ext = target.split(".").pop()!.toLowerCase();
        const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "gif" ? "image/gif" : "image/png";
        ctx.media.set(rel["@Id"] as string, `data:${mime};base64,${await media.async("base64")}`);
      }
    }

    const spTree = get(xml, "p:sld", "p:cSld", "p:spTree") as XmlNode | undefined;
    const overlays = spTree ? importShapeTree(spTree, IDENTITY, ctx) : [];
    const bg = solidHex(get(xml, "p:sld", "p:cSld", "p:bg", "p:bgPr"));

    out.push({
      slide: {
        id: `imported-${n}`,
        name: `Imported slide ${n}`,
        ...(bg ? { background: bg } : {}),
        padding: 0,
        root: { id: `imported-${n}-root`, type: "column", children: [] },
        overlays,
      } as Slide,
      notes: ctx.notes,
    });
  }
  return out;
}
