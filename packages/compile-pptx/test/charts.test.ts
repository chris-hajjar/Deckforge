/**
 * Chart golden tests: charts compile to native OpenXML chart parts (editable
 * data in PowerPoint/Google Slides), with palette colors and token ink.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Deck } from "@deckforge/schema";
import { THEMES } from "@deckforge/themes";
import { compileDeckToFile } from "@deckforge/compile-pptx";

const deck: Deck = {
  schemaVersion: 2,
  title: "Charts golden",
  theme: { base: "corporate-bold" },
  slides: [
    {
      id: "s1",
      root: {
        id: "r",
        type: "column",
        style: { gap: 24 },
        children: [
          { id: "h", type: "heading", text: "ARR growth", level: 2 },
          {
            id: "ch1",
            type: "chart",
            chartType: "column",
            categories: ["FY24", "FY25", "FY26"],
            series: [
              { name: "ARR ($M)", values: [1.1, 2.4, 4.2] },
              { name: "Pipeline ($M)", values: [2.3, 4.0, 7.5] },
            ],
            sizing: { height: 300 },
          },
          {
            id: "ch2",
            type: "chart",
            chartType: "donut",
            categories: ["Enterprise", "Mid-market", "SMB"],
            series: [{ name: "Revenue mix", values: [55, 30, 15] }],
            sizing: { height: 180 },
          },
        ],
      },
    },
  ],
} as Deck;

describe("pptx charts", () => {
  it("emits native chart parts with palette colors and category data", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deckforge-chart-"));
    const file = join(dir, "charts.pptx");
    await compileDeckToFile(deck, file);
    execFileSync("unzip", ["-o", "-q", file, "-d", join(dir, "x")]);

    const chartsDir = join(dir, "x", "ppt", "charts");
    expect(existsSync(chartsDir)).toBe(true);
    const chartXmls = readdirSync(chartsDir).filter((f) => f.endsWith(".xml"));
    expect(chartXmls.length).toBeGreaterThanOrEqual(2);

    const all = chartXmls.map((f) => readFileSync(join(chartsDir, f), "utf8")).join("\n");
    // native chart types, not pictures of charts
    expect(all).toContain("<c:barChart>");
    expect(all).toContain("<c:doughnutChart>");
    // editable source data present
    expect(all).toContain("FY26");
    expect(all).toContain("Enterprise");
    // series colors come from the validated palette, slots 1 and 2
    const p = THEMES["corporate-bold"].chartPalette;
    expect(all.toUpperCase()).toContain(p[0].replace("#", "").toUpperCase());
    expect(all.toUpperCase()).toContain(p[1].replace("#", "").toUpperCase());
    // ink stays in text tokens (muted text-secondary on axes/legend)
    expect(all.toUpperCase()).toContain("5A6673");

    // slide references the charts as graphicFrames (animatable drawables)
    const slide1 = readFileSync(join(dir, "x", "ppt", "slides", "slide1.xml"), "utf8");
    expect((slide1.match(/<p:graphicFrame>/g) ?? []).length).toBe(2);
  }, 30000);

  it("LibreOffice parses a deck with charts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deckforge-chart-"));
    const file = join(dir, "charts.pptx");
    await compileDeckToFile(deck, file);
    // isolated profile: parallel soffice instances can't share a user dir
    execFileSync(
      "soffice",
      [`-env:UserInstallation=file://${dir}/lo-profile`, "--headless", "--convert-to", "pdf", file, "--outdir", dir],
      { timeout: 90000 },
    );
    expect(existsSync(join(dir, "charts.pdf"))).toBe(true);
  }, 120000);
});
