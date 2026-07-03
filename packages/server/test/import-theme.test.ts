/**
 * Importer round 2: real-world templates (Canva/PowerPoint exports) define
 * colors through THEME REFERENCES, not literal hex. This reproduces the
 * "everything imports as giant accent-blue boxes" failure: a synthetic pptx
 * whose shapes use schemeClr fills, style fillRefs, tint transforms,
 * picture fills and invisible layout helpers.
 */
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { importPptx } from "../src/import-pptx.js";

const THEME = `<?xml version="1.0"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="T">
  <a:themeElements><a:clrScheme name="T">
    <a:dk1><a:srgbClr val="1A1A2E"/></a:dk1>
    <a:lt1><a:sysClr val="window" lastClr="FFF8F0"/></a:lt1>
    <a:dk2><a:srgbClr val="16213E"/></a:dk2>
    <a:lt2><a:srgbClr val="EEEEEE"/></a:lt2>
    <a:accent1><a:srgbClr val="0F3460"/></a:accent1>
    <a:accent2><a:srgbClr val="E94560"/></a:accent2>
    <a:accent3><a:srgbClr val="53354A"/></a:accent3>
    <a:accent4><a:srgbClr val="903749"/></a:accent4>
    <a:accent5><a:srgbClr val="2B2E4A"/></a:accent5>
    <a:accent6><a:srgbClr val="E84545"/></a:accent6>
    <a:hlink><a:srgbClr val="0000FF"/></a:hlink>
    <a:folHlink><a:srgbClr val="800080"/></a:folHlink>
  </a:clrScheme></a:themeElements>
</a:theme>`;

const sp = (inner: string) => `<p:sp>${inner}</p:sp>`;
const xfrm = (x: number, y: number, w: number, h: number) =>
  `<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm>`;

const SLIDE = `<?xml version="1.0"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<p:cSld>
<p:bg><p:bgPr><a:solidFill><a:schemeClr val="bg2"/></a:solidFill></p:bgPr></p:bg>
<p:spTree>
  ${sp(`<p:spPr>${xfrm(914400, 914400, 1828800, 914400)}<a:prstGeom prst="rect"/>
    <a:solidFill><a:schemeClr val="accent2"/></a:solidFill></p:spPr>`)}
  ${sp(`<p:spPr>${xfrm(0, 0, 914400, 914400)}<a:prstGeom prst="rect"/></p:spPr>
    <p:style><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef></p:style>`)}
  ${sp(`<p:spPr>${xfrm(0, 2743200, 914400, 914400)}<a:prstGeom prst="rect"/>
    <a:solidFill><a:schemeClr val="accent2"><a:tint val="50000"/></a:schemeClr></a:solidFill></p:spPr>`)}
  ${sp(`<p:spPr>${xfrm(4572000, 0, 914400, 914400)}<a:prstGeom prst="rect"/><a:noFill/></p:spPr>`)}
  ${sp(`<p:spPr>${xfrm(4572000, 2743200, 1828800, 914400)}<a:prstGeom prst="rect"/>
    <a:blipFill><a:blip r:embed="rId7"/></a:blipFill></p:spPr>`)}
  ${sp(`<p:spPr>${xfrm(914400, 3657600, 3657600, 914400)}</p:spPr>
    <p:txBody><a:p><a:r><a:rPr sz="2400"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill></a:rPr>
    <a:t>Scheme colored text</a:t></a:r></a:p></p:txBody>`)}
</p:spTree>
</p:cSld>
</p:sld>`;

const RELS = `<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
</Relationships>`;

// 1×1 transparent png
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

async function makePptx(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("ppt/theme/theme1.xml", THEME);
  zip.file("ppt/slides/slide1.xml", SLIDE);
  zip.file("ppt/slides/_rels/slide1.xml.rels", RELS);
  zip.file("ppt/media/image1.png", PNG);
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("theme-referenced imports", () => {
  it("resolves schemeClr, fillRef, tints, picture fills and drops invisible shapes", async () => {
    const [imported] = await importPptx(await makePptx());
    const overlays = imported.slide.overlays ?? [];
    const shapes = overlays.filter((o) => o.type === "shape") as Array<{ fill?: string }>;
    const images = overlays.filter((o) => o.type === "image") as Array<{ src: string }>;
    const texts = overlays.filter((o) => o.type === "text") as Array<{ style?: { color?: string } }>;

    // schemeClr accent2 → theme hex, NOT a fallback
    expect(shapes.some((s) => s.fill === "#e94560")).toBe(true);
    // style fillRef accent1 → theme hex
    expect(shapes.some((s) => s.fill === "#0f3460")).toBe(true);
    // accent2 with 50% tint → lightened toward white
    expect(
      shapes.some((s) => s.fill && s.fill !== "#e94560" && parseInt(s.fill.slice(1, 3), 16) > 0xe9),
    ).toBe(true);
    // noFill helper shape with no text/border is dropped entirely
    expect(shapes).toHaveLength(3);
    // picture-filled shape became an image with embedded data
    expect(images.some((i) => i.src.startsWith("data:image/png;base64,"))).toBe(true);
    // text run color resolved through the scheme (tx2 → dk2)
    expect(texts[0]?.style?.color).toBe("#16213e");
    // background resolved via scheme alias (bg2 → lt2)
    expect((imported.slide as { background?: string }).background).toBe("#eeeeee");
  });

  it("drops transparent scrims, maps arches/organic custGeom, swaps rotated frames", async () => {
    const slide = `<?xml version="1.0"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld><p:spTree>
  ${sp(`<p:spPr>${xfrm(0, 0, 9144000, 5143500)}<a:prstGeom prst="rect"/>
    <a:solidFill><a:srgbClr val="000000"><a:alpha val="30000"/></a:srgbClr></a:solidFill></p:spPr>`)}
  ${sp(`<p:spPr>${xfrm(914400, 914400, 1828800, 3657600)}<a:prstGeom prst="round2SameRect"/>
    <a:solidFill><a:srgbClr val="AA5544"/></a:solidFill></p:spPr>`)}
  ${sp(`<p:spPr>${xfrm(4572000, 914400, 1828800, 3657600)}
    <a:custGeom><a:pathLst><a:path><a:moveTo/><a:cubicBezTo/><a:cubicBezTo/><a:cubicBezTo/><a:lnTo/><a:close/></a:path></a:pathLst></a:custGeom>
    <a:solidFill><a:srgbClr val="112233"/></a:solidFill></p:spPr>`)}
  ${sp(`<p:spPr><a:xfrm rot="5400000"><a:off x="914400" y="4572000"/><a:ext cx="1828800" cy="914400"/></a:xfrm>
    <a:prstGeom prst="rect"/><a:solidFill><a:srgbClr val="445566"/></a:solidFill></p:spPr>`)}
</p:spTree></p:cSld></p:sld>`;
    const zip = new JSZip();
    zip.file("ppt/slides/slide1.xml", slide);
    const [imported] = await importPptx(await zip.generateAsync({ type: "nodebuffer" }));
    const shapes = (imported.slide.overlays ?? []) as Array<{
      shape?: string; fill?: string; frame: { w: number; h: number };
    }>;

    // 30%-alpha black scrim over the whole slide → dropped, not an opaque box
    expect(shapes.some((s) => s.fill === "#000000")).toBe(false);
    // arch preset (round2SameRect) → pill, the closest native geometry
    expect(shapes.find((s) => s.fill === "#aa5544")?.shape).toBe("pill");
    // curve-dominated tall custGeom → pill (not the old blanket rect)
    expect(shapes.find((s) => s.fill === "#112233")?.shape).toBe("pill");
    // 90° rotation (5400000/60000): 1828800×914400 EMU frame swaps to tall
    const rotated = shapes.find((s) => s.fill === "#445566")!;
    expect(rotated.frame.w).toBe(96);
    expect(rotated.frame.h).toBe(192);
  });

  it("keeps working without any theme part (literal-hex decks)", async () => {
    const zip = new JSZip();
    zip.file(
      "ppt/slides/slide1.xml",
      SLIDE.replace('<a:schemeClr val="accent2"/>', '<a:srgbClr val="112233"/>'),
    );
    zip.file("ppt/slides/_rels/slide1.xml.rels", RELS);
    zip.file("ppt/media/image1.png", PNG);
    const [imported] = await importPptx(await zip.generateAsync({ type: "nodebuffer" }));
    const shapes = (imported.slide.overlays ?? []).filter((o) => o.type === "shape") as Array<{ fill?: string }>;
    expect(shapes.some((s) => s.fill === "#112233")).toBe(true);
  });
});
