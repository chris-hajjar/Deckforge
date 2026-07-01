/**
 * animate.ts — OpenXML post-processor.
 *
 * pptxgenjs can't express three things Deckforge needs, so we edit the
 * serialized zip directly, keeping output 100% standard OpenXML:
 *
 *   1. slide transitions   → <p:transition> (fade / push / wipe)
 *   2. entrance animations → <p:timing> click-sequence trees (appear / fade /
 *      fly-in / zoom / wipe, grouped by `order`, per-paragraph list builds)
 *   3. gradient fills      → swap the placeholder <a:solidFill> for
 *      <a:gradFill> on marked shapes and slide backgrounds
 *
 * Shape targeting: drawables appear in slide XML in emission order, so the
 * compiler's manifest index N maps to the Nth <p:sp|pic|graphicFrame|cxnSp>
 * — we read its actual <p:cNvPr id> and reference that spid in the timing.
 */
import JSZip from "jszip";
import type { Transition } from "@deckforge/schema";
import type { ResolvedAnim, ResolvedGradient } from "@deckforge/layout";

export interface DrawableRef {
  anim?: ResolvedAnim;
  gradient?: ResolvedGradient;
  /** Paragraph count (text boxes) — enables per-paragraph builds. */
  paraCount?: number;
}

export interface SlideAnimManifest {
  transition?: Transition;
  bgGradient?: ResolvedGradient;
  drawables: DrawableRef[];
}

const hex = (c: string) => c.replace("#", "").toUpperCase();

// DrawingML linear gradient angle is clockwise from +x, in 60000ths of a degree.
const GRAD_ANGLE: Record<number, number> = { 0: 0, 45: 2700000, 90: 5400000, 135: 8100000 };

function gradFillXml(g: ResolvedGradient): string {
  return (
    `<a:gradFill rotWithShape="1"><a:gsLst>` +
    `<a:gs pos="0"><a:srgbClr val="${hex(g.from)}"/></a:gs>` +
    `<a:gs pos="100000"><a:srgbClr val="${hex(g.to)}"/></a:gs>` +
    `</a:gsLst><a:lin ang="${GRAD_ANGLE[g.angle] ?? 5400000}" scaled="1"/></a:gradFill>`
  );
}

const TRANSITION_DIR: Record<string, string> = { left: "l", right: "r", top: "u", bottom: "d" };

function transitionXml(t: Transition): string {
  switch (t.type) {
    case "fade":
      return `<p:transition spd="med"><p:fade/></p:transition>`;
    case "push":
      return `<p:transition spd="med"><p:push dir="${TRANSITION_DIR[t.direction ?? "left"]}"/></p:transition>`;
    case "wipe":
      return `<p:transition spd="med"><p:wipe dir="${TRANSITION_DIR[t.direction ?? "left"]}"/></p:transition>`;
    default:
      return "";
  }
}

// ---------- timing tree ----------
interface Target {
  spid: string;
  anim: ResolvedAnim;
  paraCount?: number;
}

let idc = 0;
const nid = () => ++idc;

/** Target element XML; a paragraph range when `para` is given. */
function tgt(spid: string, para?: number): string {
  if (para === undefined) return `<p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl>`;
  return `<p:tgtEl><p:spTgt spid="${spid}"><p:txEl><p:pRg st="${para}" end="${para}"/></p:txEl></p:spTgt></p:tgtEl>`;
}

function setVisible(spid: string, para?: number): string {
  return (
    `<p:set><p:cBhvr><p:cTn id="${nid()}" dur="1" fill="hold">` +
    `<p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>${tgt(spid, para)}` +
    `<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr>` +
    `<p:to><p:strVal val="visible"/></p:to></p:set>`
  );
}

function animEffect(filter: string, spid: string, para?: number): string {
  return (
    `<p:animEffect transition="in" filter="${filter}"><p:cBhvr>` +
    `<p:cTn id="${nid()}" dur="500"/>${tgt(spid, para)}</p:cBhvr></p:animEffect>`
  );
}

function animPos(attr: "ppt_x" | "ppt_y", from: string, spid: string, para?: number): string {
  return (
    `<p:anim calcmode="lin" valueType="num"><p:cBhvr additive="base">` +
    `<p:cTn id="${nid()}" dur="500" fill="hold"/>${tgt(spid, para)}` +
    `<p:attrNameLst><p:attrName>${attr}</p:attrName></p:attrNameLst></p:cBhvr>` +
    `<p:tavLst><p:tav tm="0"><p:val><p:strVal val="${from}"/></p:val></p:tav>` +
    `<p:tav tm="100000"><p:val><p:strVal val="#${attr}"/></p:val></p:tav></p:tavLst></p:anim>`
  );
}

function animScale(spid: string, para?: number): string {
  return (
    `<p:animScale><p:cBhvr><p:cTn id="${nid()}" dur="500" fill="hold"/>${tgt(spid, para)}</p:cBhvr>` +
    `<p:from x="10000" y="10000"/><p:to x="100000" y="100000"/></p:animScale>`
  );
}

const WIPE_FILTER: Record<string, string> = {
  bottom: "wipe(up)",
  top: "wipe(down)",
  left: "wipe(right)",
  right: "wipe(left)",
};
const FLY_SUBTYPE: Record<string, number> = { bottom: 4, left: 8, right: 2, top: 1 };

/** One entrance effect for one target (optionally one paragraph of it). */
function effectPar(t: Target, para?: number): string {
  const a = t.anim;
  const dir = a.direction ?? "bottom";
  let presetID = 1;
  let behaviors = setVisible(t.spid, para);
  switch (a.effect) {
    case "appear":
      presetID = 1;
      break;
    case "fade":
      presetID = 10;
      behaviors += animEffect("fade", t.spid, para);
      break;
    case "wipe":
      presetID = 22;
      behaviors += animEffect(WIPE_FILTER[dir], t.spid, para);
      break;
    case "flyIn": {
      presetID = 2;
      const fromX = dir === "left" ? "0-#ppt_w/2" : dir === "right" ? "1+#ppt_w/2" : "#ppt_x";
      const fromY = dir === "top" ? "0-#ppt_h/2" : dir === "bottom" ? "1+#ppt_h/2" : "#ppt_y";
      behaviors += animPos("ppt_x", fromX, t.spid, para) + animPos("ppt_y", fromY, t.spid, para);
      break;
    }
    case "zoom":
      presetID = 23;
      behaviors += animEffect("fade", t.spid, para) + animScale(t.spid, para);
      break;
  }
  const subtype = a.effect === "flyIn" ? FLY_SUBTYPE[dir] : 0;
  return (
    `<p:par><p:cTn id="${nid()}" presetID="${presetID}" presetClass="entr" ` +
    `presetSubtype="${subtype}" fill="hold" grpId="0" nodeType="withEffect">` +
    `<p:stCondLst><p:cond delay="0"/></p:stCondLst>` +
    `<p:childTnLst>${behaviors}</p:childTnLst></p:cTn></p:par>`
  );
}

/** A click step revealing a set of (target, paragraph) pairs together. */
function clickPar(steps: Array<{ t: Target; para?: number }>): string {
  const effects = steps.map((s) => effectPar(s.t, s.para)).join("");
  return (
    `<p:par><p:cTn id="${nid()}" fill="hold">` +
    `<p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst>` +
    `<p:par><p:cTn id="${nid()}" fill="hold">` +
    `<p:stCondLst><p:cond delay="0"/></p:stCondLst>` +
    `<p:childTnLst>${effects}</p:childTnLst></p:cTn></p:par>` +
    `</p:childTnLst></p:cTn></p:par>`
  );
}

function timingXml(targets: Target[]): string {
  idc = 2;
  // group by click order; byParagraph lists expand into one click per bullet
  const orders = [...new Set(targets.map((t) => t.anim.order))].sort((a, b) => a - b);
  const clicks: string[] = [];
  for (const order of orders) {
    const group = targets.filter((t) => t.anim.order === order);
    const together: Array<{ t: Target; para?: number }> = [];
    const followUps: string[] = [];
    for (const t of group) {
      if (t.anim.byParagraph && t.paraCount && t.paraCount > 1) {
        // first paragraph joins this click; the rest follow one click each
        together.push({ t, para: 0 });
        for (let p = 1; p < t.paraCount; p++) followUps.push(clickPar([{ t, para: p }]));
      } else {
        together.push({ t });
      }
    }
    if (together.length) clicks.push(clickPar(together));
    clicks.push(...followUps);
  }
  const builds = targets
    .filter((t) => t.anim.byParagraph && t.paraCount && t.paraCount > 1)
    .map((t) => `<p:bldP spid="${t.spid}" grpId="0" build="p"/>`)
    .join("");
  return (
    `<p:timing><p:tnLst><p:par>` +
    `<p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>` +
    `<p:seq concurrent="1" nextAc="seek">` +
    `<p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>` +
    clicks.join("") +
    `</p:childTnLst></p:cTn>` +
    `<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>` +
    `<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst>` +
    `</p:seq></p:childTnLst></p:cTn></p:par></p:tnLst>` +
    (builds ? `<p:bldLst>${builds}</p:bldLst>` : "") +
    `</p:timing>`
  );
}

// ---------- XML surgery ----------
/** Drawables (sp/pic/graphicFrame/cxnSp) in document order with their ids and spans. */
function findDrawables(xml: string): Array<{ id: string; start: number; end: number }> {
  const out: Array<{ id: string; start: number; end: number }> = [];
  const re = /<p:(sp|pic|graphicFrame|cxnSp)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const tag = m[1];
    const close = xml.indexOf(`</p:${tag}>`, m.index);
    const idm = /<p:cNvPr id="(\d+)"/.exec(xml.slice(m.index, close === -1 ? undefined : close));
    if (idm) out.push({ id: idm[1], start: m.index, end: close === -1 ? xml.length : close });
  }
  return out;
}

function applyToSlideXml(xml: string, manifest: SlideAnimManifest): string {
  const drawables = findDrawables(xml);

  // 3. gradient fills — swap the placeholder solid fill inside marked shapes
  //    (walk back-to-front so recorded offsets stay valid)
  for (let i = manifest.drawables.length - 1; i >= 0; i--) {
    const ref = manifest.drawables[i];
    if (!ref.gradient || !drawables[i]) continue;
    const { start, end } = drawables[i];
    const chunk = xml.slice(start, end);
    const solid = `<a:solidFill><a:srgbClr val="${hex(ref.gradient.from)}"/></a:solidFill>`;
    const at = chunk.indexOf(solid);
    if (at === -1) continue;
    xml =
      xml.slice(0, start) +
      chunk.slice(0, at) +
      gradFillXml(ref.gradient) +
      chunk.slice(at + solid.length) +
      xml.slice(end);
  }

  // background gradient — replace the bg solid fill
  if (manifest.bgGradient) {
    const bgRe = /(<p:bg><p:bgPr>)<a:solidFill>.*?<\/a:solidFill>/;
    xml = xml.replace(bgRe, `$1${gradFillXml(manifest.bgGradient)}`);
  }

  // 1+2. transition and timing go between </p:clrMapOvr> and </p:sld>
  const targets: Target[] = [];
  const seen = new Set<string>();
  manifest.drawables.forEach((ref, i) => {
    if (ref.anim && drawables[i] && !seen.has(drawables[i].id)) {
      seen.add(drawables[i].id);
      targets.push({ spid: drawables[i].id, anim: ref.anim, paraCount: ref.paraCount });
    }
  });
  let tail = "";
  if (manifest.transition && manifest.transition.type !== "none") {
    tail += transitionXml(manifest.transition);
  }
  if (targets.length > 0) tail += timingXml(targets);
  if (tail) xml = xml.replace("</p:sld>", `${tail}</p:sld>`);
  return xml;
}

/** Post-process the pptx zip: apply per-slide transitions/animations/gradients. */
export async function injectAnimations(
  pptxBuffer: Buffer,
  manifests: SlideAnimManifest[],
): Promise<Buffer> {
  const needsWork = manifests.some(
    (m) =>
      (m.transition && m.transition.type !== "none") ||
      m.bgGradient ||
      m.drawables.some((d) => d.anim || d.gradient),
  );
  if (!needsWork) return pptxBuffer;

  const zip = await JSZip.loadAsync(pptxBuffer);
  for (let i = 0; i < manifests.length; i++) {
    const path = `ppt/slides/slide${i + 1}.xml`;
    const file = zip.file(path);
    if (!file) continue;
    const xml = await file.async("string");
    zip.file(path, applyToSlideXml(xml, manifests[i]));
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }) as Promise<Buffer>;
}
