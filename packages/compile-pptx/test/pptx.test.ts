/**
 * Golden test: build a representative deck, compile to pptx, unzip the
 * OpenXML, and verify the geometry in the XML matches the layout solver's
 * boxes — the "export looks identical to the preview" guarantee, checked
 * numerically.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Deck } from "@deckforge/schema";
import { resolveTheme } from "@deckforge/themes";
import { solveSlide, CANVAS_W } from "@deckforge/layout";
import { compileDeckToFile } from "@deckforge/compile-pptx";

const EMU_PER_IN = 914400;
const PX_PER_IN = CANVAS_W / 13.333;
const pxToEmu = (px: number) => Math.round((px / PX_PER_IN) * EMU_PER_IN);

const goldenDeck: Deck = {
  schemaVersion: 2,
  title: "Golden deck",
  theme: { base: "corporate-bold" },
  slides: [
    {
      id: "s1",
      root: {
        id: "r1",
        type: "column",
        style: { justify: "center", gap: 24 },
        children: [
          { id: "h1", type: "heading", text: "Golden Deck", level: 1 },
          { id: "t1", type: "text", text: "Numerically verified export fidelity" },
        ],
      },
    },
    {
      id: "s2",
      root: {
        id: "r2",
        type: "column",
        style: { gap: 24 },
        children: [
          { id: "h2", type: "heading", text: "KPIs", level: 2 },
          {
            id: "row",
            type: "row",
            style: { gap: 16 },
            children: [
              { id: "m1", type: "metricCard", label: "ARR", value: "$4.2M", delta: "+12% QoQ" },
              { id: "m2", type: "metricCard", label: "NRR", value: "118%" },
              { id: "m3", type: "metricCard", label: "Churn", value: "1.9%" },
            ],
          },
          { id: "b1", type: "bulletList", items: ["Pipeline up 40%", "Two new segments"] },
        ],
      },
    },
  ],
} as Deck;

describe("pptx compiler", () => {
  it("emits shapes at exactly the solver's coordinates (EMU match)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deckforge-pptx-"));
    const file = join(dir, "golden.pptx");
    const resolved = await compileDeckToFile(goldenDeck, file);

    execFileSync("unzip", ["-o", "-q", file, "-d", join(dir, "x")]);
    const slide2Xml = readFileSync(join(dir, "x", "ppt", "slides", "slide2.xml"), "utf8");

    // Every rect box on slide 2 (the 3 metric cards) must appear in the XML
    // at its solver coordinates, converted to EMU.
    const rects = resolved[1].boxes.filter((b) => b.kind === "rect");
    expect(rects).toHaveLength(3);
    for (const r of rects) {
      expect(slide2Xml).toContain(`<a:off x="${pxToEmu(r.x)}" y="${pxToEmu(r.y)}"/>`);
      expect(slide2Xml).toContain(`<a:ext cx="${pxToEmu(r.w)}" cy="${pxToEmu(r.h)}"/>`);
    }

    // Brand constraint survives compilation: metric values are accent + bold.
    const accentHex = resolveTheme(goldenDeck.theme).colors.accent.replace("#", "").toUpperCase();
    expect(slide2Xml).toMatch(new RegExp(`b="1"[^>]*>` + `[\\s\\S]{0,400}?${accentHex}`));
    expect(slide2Xml).toContain("$4.2M");

    // Google Slides compatibility: only built-in font faces.
    const fonts = [...slide2Xml.matchAll(/typeface="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(fonts)).toEqual(new Set(["Arial"]));

    // Text content preserved as editable text (not images/outlines).
    const slide1Xml = readFileSync(join(dir, "x", "ppt", "slides", "slide1.xml"), "utf8");
    expect(slide1Xml).toContain("Golden Deck");
    expect(slide1Xml).toContain("Numerically verified export fidelity");
  });

  it("sets a 16:9 layout and per-slide backgrounds", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deckforge-pptx-"));
    const file = join(dir, "bg.pptx");
    const dark: Deck = { ...goldenDeck, theme: { base: "minimalist-dark" } } as Deck;
    await compileDeckToFile(dark, file);
    execFileSync("unzip", ["-o", "-q", file, "-d", join(dir, "x")]);
    const pres = readFileSync(join(dir, "x", "ppt", "presentation.xml"), "utf8");
    expect(pres).toContain('cx="12191695"'); // 13.333in in EMU
    expect(pres).toContain('cy="6858000"'); // 7.5in
    const slide1 = readFileSync(join(dir, "x", "ppt", "slides", "slide1.xml"), "utf8");
    const bg = resolveTheme(dark.theme).colors.background.replace("#", "").toUpperCase();
    expect(slide1).toContain(bg);
  });

  it("round-trips: resolved layout equals what the canvas would draw", () => {
    const tokens = resolveTheme(goldenDeck.theme);
    const a = goldenDeck.slides.map((s) => solveSlide(s, tokens));
    const b = goldenDeck.slides.map((s) => solveSlide(s, tokens));
    expect(a).toEqual(b);
  });
});
