import { describe, expect, it } from "vitest";
import type { Slide } from "@deckforge/schema";
import { newDeck } from "@deckforge/schema";
import { THEMES } from "@deckforge/themes";
import { normalizeDeck } from "@deckforge/validate";
import { solveSlide, type ChartBox, type TextBox } from "@deckforge/layout";

const tokens = THEMES["corporate-bold"];
const slide = (root: Slide["root"]): Slide => ({ id: "s1", root }) as Slide;

describe("charts", () => {
  const chart = {
    id: "ch",
    type: "chart" as const,
    chartType: "column" as const,
    categories: ["Q1", "Q2", "Q3"],
    series: [
      { name: "ARR", values: [1.2, 2.1, 4.2] },
      { name: "Pipeline", values: [2.0, 3.4, 6.1] },
    ],
  };

  it("resolves series colors from the validated palette in fixed slot order", () => {
    const r = solveSlide(slide({ id: "root", type: "column", children: [chart] }), tokens);
    const c = r.boxes.find((b) => b.kind === "chart") as ChartBox;
    expect(c.series.map((s) => s.color)).toEqual([
      tokens.chartPalette[0],
      tokens.chartPalette[1],
    ]);
    expect(c.legend).toBe(true); // ≥2 series → legend on
    expect(c.dataLabels).toBe(true); // light-palette contrast relief default
    // ink stays in text tokens, never series colors
    expect(c.ink.muted).toBe(tokens.colors["text-secondary"]);
  });

  it("single-series charts default to no legend (the title names it)", () => {
    const r = solveSlide(
      slide({
        id: "root",
        type: "column",
        children: [{ ...chart, series: [chart.series[0]] }],
      }),
      tokens,
    );
    const c = r.boxes.find((b) => b.kind === "chart") as ChartBox;
    expect(c.legend).toBe(false);
  });

  it("validate pads/trims series to the category count and caps at 8 series", () => {
    const d = newDeck();
    (d.slides[0].root as any).children.push({
      id: "ch",
      type: "chart",
      chartType: "line",
      categories: ["a", "b", "c"],
      series: [
        { name: "s1", values: [1] }, // short → padded
        ...Array.from({ length: 9 }, (_, i) => ({ name: `s${i + 2}`, values: [1, 2, 3] })),
      ],
    });
    const { deck, corrections } = normalizeDeck(d);
    const ch: any = (deck.slides[0].root as any).children[2];
    expect(ch.series[0].values).toEqual([1, 0, 0]);
    expect(ch.series).toHaveLength(8);
    expect(corrections.some((c) => c.reason.includes("padded"))).toBe(true);
    expect(corrections.some((c) => c.reason.includes("8 series"))).toBe(true);
  });
});

describe("margins anywhere", () => {
  it("offsets a column child by its margin on all sides", () => {
    const r = solveSlide(
      slide({
        id: "root",
        type: "column",
        children: [
          { id: "a", type: "text", text: "above" },
          {
            id: "b",
            type: "text",
            text: "indented",
            sizing: { margin: { top: 24, left: 48, right: 96 } },
          },
        ],
      }),
      tokens,
    );
    const [a, b] = r.boxes as TextBox[];
    expect(b.x).toBe(a.x + 48);
    expect(b.w).toBeCloseTo(a.w - 48 - 96, 5);
    // gap(16) + margin.top(24) below the previous element
    expect(b.y).toBeCloseTo(a.y + a.h + 16 + 24, 5);
  });

  it("row children honor left/right margins inside their slot", () => {
    const r = solveSlide(
      slide({
        id: "root",
        type: "row",
        style: { gap: 0 },
        children: [
          { id: "a", type: "text", text: "x" },
          { id: "b", type: "text", text: "y", sizing: { margin: { left: 32, top: 8 } } },
        ],
      }),
      tokens,
    );
    const [a, b] = r.boxes as TextBox[];
    expect(b.x).toBeCloseTo(a.x + a.w + 32, 5);
    expect(b.y).toBeCloseTo(a.y + 8, 5);
  });

  it("margins participate in intrinsic height (no overlap with next sibling)", () => {
    const r = solveSlide(
      slide({
        id: "root",
        type: "column",
        style: { gap: 0 },
        children: [
          { id: "a", type: "text", text: "first", sizing: { margin: { bottom: 64 } } },
          { id: "b", type: "text", text: "second" },
        ],
      }),
      tokens,
    );
    const [a, b] = r.boxes as TextBox[];
    expect(b.y).toBeCloseTo(a.y + a.h + 64, 5);
  });

  it("validate snaps margin sides to the spacing scale", () => {
    const d = newDeck();
    (d.slides[0].root as any).children[0].sizing = { margin: { top: 30, left: 13 } };
    const { deck, corrections } = normalizeDeck(d);
    const m = (deck.slides[0].root as any).children[0].sizing.margin;
    expect(m.top).toBe(32);
    expect(m.left).toBe(12);
    expect(corrections).toHaveLength(2);
  });
});
