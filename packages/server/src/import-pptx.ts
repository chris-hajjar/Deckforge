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
 * Approximated: mostly-transparent fills are dropped (closer to the original
 * than an opaque box), custom geometries map to the nearest preset by their
 * path's curve/line mix, and near-90° rotations swap the frame's w/h.
 *
 * Not imported (skipped with a note): charts, tables, gradients/pictures as
 * fills, WordArt, free rotation, and master/layout inheritance (only what's
 * on the slide itself).
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
  let x = t.offX + Number(off["@x"]) * t.scaleX;
  let y = t.offY + Number(off["@y"]) * t.scaleY;
  let w = Number(ext["@cx"]) * t.scaleX;
  let h = Number(ext["@cy"]) * t.scaleY;
  // Frames can't rotate; a shape turned (near) sideways at least keeps its
  // real footprint if we swap width/height around the center.
  const rot = (((Number(get(xfrm, "@rot") ?? 0) / 60000) % 360) + 360) % 360;
  const nearest = Math.round(rot / 90) * 90;
  if (nearest === 90 || nearest === 270) {
    const cx = x + w / 2;
    const cy = y + h / 2;
    [w, h] = [h, w];
    x = cx - w / 2;
    y = cy - h / 2;
  }
  return {
    x: Math.max(0, Math.min(CANVAS_W - 8, px(x))),
    y: Math.max(0, Math.min(CANVAS_H - 8, px(y))),
    w: Math.max(8, px(w)),
    h: Math.max(8, px(h)),
  };
}

/** Theme color scheme (accent1…6, dk/lt) resolved from ppt/theme/theme1.xml. */
type ColorScheme = Record<string, string>;

// default color map: bg/tx names alias the theme's lt/dk slots
const SCHEME_ALIASES: Record<string, string> = { bg1: "lt1", tx1: "dk1", bg2: "lt2", tx2: "dk2" };

function parseTheme(themeXml: unknown): ColorScheme {
  const scheme: ColorScheme = {};
  const clrScheme = get(themeXml, "a:theme", "a:themeElements", "a:clrScheme") as XmlNode | undefined;
  if (!clrScheme) return scheme;
  for (const [key, val] of Object.entries(clrScheme)) {
    if (!key.startsWith("a:")) continue;
    const name = key.slice(2);
    const srgb = get(val, "a:srgbClr", "@val");
    const sys = get(val, "a:sysClr", "@lastClr");
    const hex = typeof srgb === "string" ? srgb : typeof sys === "string" ? sys : undefined;
    if (hex) scheme[name] = `#${hex.toLowerCase()}`;
  }
  return scheme;
}

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

/** Apply DrawingML color transforms (approximated in sRGB space). */
function applyTransforms(hex: string, clrNode: XmlNode): string {
  let [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const pct = (name: string): number | undefined => {
    const v = get(clrNode, name, "@val");
    return v !== undefined ? Number(v) / 100000 : undefined;
  };
  const lumMod = pct("a:lumMod");
  const lumOff = pct("a:lumOff");
  const shade = pct("a:shade");
  const tint = pct("a:tint");
  const map = (fn: (v: number) => number) => {
    r = clamp255(fn(r));
    g = clamp255(fn(g));
    b = clamp255(fn(b));
  };
  if (lumMod !== undefined) map((v) => v * lumMod);
  if (lumOff !== undefined) map((v) => v + 255 * lumOff);
  if (shade !== undefined) map((v) => v * shade);
  if (tint !== undefined) map((v) => v * tint + 255 * (1 - tint));
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Fill opacity of a color node. Frames can't be translucent, so callers drop
 * mostly-transparent fills — a 30%-alpha scrim over a photo reads far closer
 * to the original as "nothing" than as an opaque colored box.
 */
function alphaOf(clr: XmlNode): number {
  const v = get(clr, "a:alpha", "@val");
  return v !== undefined ? Number(v) / 100000 : 1;
}

/** Resolve any DrawingML color holder (srgbClr / schemeClr / sysClr). */
function colorOf(holder: unknown, scheme: ColorScheme): string | undefined {
  const srgb = get(holder, "a:srgbClr") as XmlNode | undefined;
  if (srgb && typeof srgb["@val"] === "string") {
    if (alphaOf(srgb) < 0.5) return undefined;
    return applyTransforms(`#${(srgb["@val"] as string).toLowerCase()}`, srgb);
  }
  const schemeClr = get(holder, "a:schemeClr") as XmlNode | undefined;
  if (schemeClr && typeof schemeClr["@val"] === "string") {
    if (alphaOf(schemeClr) < 0.5) return undefined;
    const name = schemeClr["@val"] as string;
    const base = scheme[name] ?? scheme[SCHEME_ALIASES[name]];
    if (base) return applyTransforms(base, schemeClr);
    return undefined;
  }
  const sys = get(holder, "a:sysClr") as XmlNode | undefined;
  if (sys && typeof sys["@lastClr"] === "string") {
    return `#${(sys["@lastClr"] as string).toLowerCase()}`;
  }
  return undefined;
}

/** Solid fill on a properties node, resolved through the theme. */
function solidHex(node: unknown, scheme: ColorScheme = {}): string | undefined {
  const fill = get(node, "a:solidFill");
  if (!fill) return undefined;
  return colorOf(fill, scheme);
}

/** Fallback fill/line color from a shape's <p:style> theme references. */
function styleRefColor(sp: XmlNode, ref: "a:fillRef" | "a:lnRef", scheme: ColorScheme): string | undefined {
  const refNode = get(sp, "p:style", ref);
  if (!refNode) return undefined;
  const idx = Number(get(refNode, "@idx") ?? 0);
  if (idx === 0) return undefined; // idx 0 = no style fill
  return colorOf(refNode, scheme);
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
  // nearest-preset approximations for common designer-template geometries
  round1Rect: "roundRect",
  round2SameRect: "pill", // the "arch" — pill's semicircular caps are the closest fit
  round2DiagRect: "roundRect",
  snipRoundRect: "roundRect",
  flowChartConnector: "ellipse",
  donut: "ellipse",
  blockArc: "ellipse",
  pie: "ellipse",
  chord: "ellipse",
  arc: "ellipse",
  teardrop: "ellipse",
  halfFrame: "rect",
  snip1Rect: "rect",
  snip2SameRect: "rect",
};

/**
 * Custom (hand-drawn) geometry: no preset name exists, but the path commands
 * tell us whether it's curvy or angular. Curve-dominated organic blobs and
 * arches read far better as ellipse/pill than as the old blanket "rect".
 */
function custGeomKind(spPr: XmlNode, frame: { w: number; h: number }): string | undefined {
  const pathLst = get(spPr, "a:custGeom", "a:pathLst");
  if (!pathLst) return undefined;
  const src = JSON.stringify(pathLst);
  const curves = (src.match(/a:(cubicBezTo|quadBezTo|arcTo)/g) ?? []).length;
  const straights = (src.match(/a:lnTo/g) ?? []).length;
  if (curves === 0) return "rect";
  if (curves >= straights) return frame.h > frame.w * 1.4 ? "pill" : "ellipse";
  return "roundRect";
}

interface ImportCtx {
  notes: string[];
  media: Map<string, string>; // rel id → data URL
  seq: number;
  /** theme color scheme from ppt/theme/theme1.xml */
  scheme: ColorScheme;
}

function textFromBody(txBody: unknown, scheme: ColorScheme): {
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
    const runs = [...arr(p["a:r"]), ...arr(p["a:fld"])];
    let line = runs
      .map((r) => {
        const t = r["a:t"];
        return typeof t === "string" ? t : typeof t === "number" ? String(t) : "";
      })
      .join("");
    // explicit line breaks (order within the paragraph is approximated)
    const brs = arr(p["a:br"]).length;
    for (let i = 0; i < brs; i++) line += "\n";
    lines.push(line);
    const rPr = runs.length ? (runs[0]["a:rPr"] as XmlNode | undefined) : undefined;
    if (rPr && fontSize === undefined && rPr["@sz"] !== undefined) {
      fontSize = Math.round((Number(rPr["@sz"]) / 100) * (96 / 72));
    }
    if (rPr && bold === undefined && rPr["@b"] !== undefined) bold = rPr["@b"] === "1";
    if (rPr && italic === undefined && rPr["@i"] !== undefined) italic = rPr["@i"] === "1";
    if (rPr && color === undefined) color = solidHex(rPr, scheme);
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
  const noFill = get(spPr, "a:noFill") !== undefined;
  // explicit solid fill → style fillRef (theme) → none
  const fill = noFill ? undefined : (solidHex(spPr, ctx.scheme) ?? styleRefColor(sp, "a:fillRef", ctx.scheme));
  // a picture-filled shape imports as an image at the shape's frame
  const picRel = get(spPr, "a:blipFill", "a:blip", "@r:embed") as string | undefined;
  if (picRel && ctx.media.get(picRel)) {
    return {
      id: `imp-${ctx.seq++}`,
      type: "image",
      src: ctx.media.get(picRel)!,
      alt: (get(sp, "p:nvSpPr", "p:cNvPr", "@name") as string) ?? "imported image",
      frame,
    } as DeckNode;
  }
  const lnNoFill = get(spPr, "a:ln", "a:noFill") !== undefined;
  const lineColor = lnNoFill
    ? undefined
    : (solidHex(get(spPr, "a:ln"), ctx.scheme) ??
       (get(spPr, "a:ln") ? styleRefColor(sp, "a:lnRef", ctx.scheme) : undefined));
  const lineW = get(spPr, "a:ln", "@w");
  const body = sp["p:txBody"];
  const txt = body ? textFromBody(body, ctx.scheme) : null;

  // nothing visible (no fill, no outline, no text) → layout helper, skip it
  if (!fill && !lineColor && !txt) return null;

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
  let geometry = prst ? GEOM_MAP[prst] : custGeomKind(spPr, frame);
  if (!geometry) {
    geometry = "rect";
    if (prst) ctx.notes.push(`geometry "${prst}" approximated as rect`);
  }
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
      ...(solidHex(get(cxn, "p:spPr", "a:ln"), ctx.scheme)
        ? { fill: solidHex(get(cxn, "p:spPr", "a:ln"), ctx.scheme) }
        : {}),
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

  // the theme's color scheme resolves schemeClr/fillRef references
  let scheme: ColorScheme = {};
  const themeFile = zip.file("ppt/theme/theme1.xml");
  if (themeFile) scheme = parseTheme(parser.parse(await themeFile.async("string")));

  const out: ImportedSlide[] = [];
  for (const path of slidePaths) {
    const n = path.match(/\d+/)![0];
    const xml = parser.parse(await zip.file(path)!.async("string"));
    const ctx: ImportCtx = { notes: [], media: new Map(), seq: 1, scheme };

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

    // background: solid (literal or theme), style ref, or full-bleed picture
    const bgPr = get(xml, "p:sld", "p:cSld", "p:bg", "p:bgPr");
    const bgRef = get(xml, "p:sld", "p:cSld", "p:bg", "p:bgRef");
    let bg = solidHex(bgPr, scheme) ?? (bgRef ? colorOf(bgRef, scheme) : undefined);
    const bgPicRel = get(bgPr, "a:blipFill", "a:blip", "@r:embed") as string | undefined;
    if (bgPicRel && ctx.media.get(bgPicRel)) {
      overlays.unshift({
        id: `imp-bg-${n}`,
        type: "image",
        src: ctx.media.get(bgPicRel)!,
        alt: "background",
        frame: { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H },
      } as never);
      bg = bg ?? undefined;
    }

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
