import { describe, expect, it } from "vitest";
import type { Slide } from "@deckforge/schema";
import { THEMES } from "@deckforge/themes";
import {
  CANVAS_H,
  CANVAS_W,
  measureText,
  solveSlide,
  wrapText,
  type RectBox,
  type TextBox,
} from "@deckforge/layout";

const tokens = THEMES["corporate-bold"];

describe("text measurement", () => {
  it("measures wider text as wider and scales linearly with size", () => {
    const narrow = measureText("iii", "sans", false, 22);
    const wide = measureText("WWW", "sans", false, 22);
    expect(wide).toBeGreaterThan(narrow * 2);
    expect(measureText("Hello", "sans", false, 44)).toBeCloseTo(
      measureText("Hello", "sans", false, 22) * 2,
      5,
    );
  });

  it("bold is wider than regular", () => {
    expect(measureText("Revenue", "sans", true, 22)).toBeGreaterThan(
      measureText("Revenue", "sans", false, 22),
    );
  });

  it("wraps greedily and never exceeds max width", () => {
    const text = "The quick brown fox jumps over the lazy dog near the river bank";
    const lines = wrapText(text, "sans", false, 22, 300);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(measureText(line, "sans", false, 22)).toBeLessThanOrEqual(300);
    }
    expect(lines.join(" ")).toBe(text);
  });

  it("hard-breaks single words longer than the line", () => {
    const lines = wrapText("Antidisestablishmentarianism", "sans", false, 40, 120);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(measureText(line, "sans", false, 40)).toBeLessThanOrEqual(120);
    }
  });

  it("respects explicit newlines", () => {
    expect(wrapText("a\nb", "sans", false, 22, 500)).toEqual(["a", "b"]);
  });
});

function slide(root: Slide["root"], extra: Partial<Slide> = {}): Slide {
  return { id: "s1", root, ...extra } as Slide;
}

describe("layout solver", () => {
  it("centers a title slide vertically with justify:center", () => {
    const resolved = solveSlide(
      slide({
        id: "root",
        type: "column",
        style: { justify: "center" },
        children: [
          { id: "h", type: "heading", text: "Quarterly Review", level: 1 },
          { id: "t", type: "text", text: "FY26 Q2" },
        ],
      }),
    tokens);
    const [h, t] = resolved.boxes as TextBox[];
    expect(h.y).toBeGreaterThan(200); // pushed down from top padding (64)
    expect(t.y).toBeGreaterThan(h.y);
    expect(resolved.warnings).toEqual([]);
    expect(resolved.background).toBe(tokens.colors.background);
  });

  it("splits a row into weighted columns with gap", () => {
    const resolved = solveSlide(
      slide({
        id: "root",
        type: "row",
        style: { gap: 24 },
        children: [
          { id: "a", type: "text", text: "left" },
          { id: "b", type: "text", text: "right" },
        ],
      }),
    tokens);
    const [a, b] = resolved.boxes as TextBox[];
    const innerW = CANVAS_W - 64 * 2;
    expect(a.w).toBeCloseTo((innerW - 24) / 2, 5);
    expect(b.x).toBeCloseTo(a.x + a.w + 24, 5);
    expect(a.w + b.w + 24).toBeCloseTo(innerW, 5);
  });

  it("honors widthPct pins", () => {
    const resolved = solveSlide(
      slide({
        id: "root",
        type: "row",
        style: { gap: 0 },
        children: [
          { id: "a", type: "text", text: "x", sizing: { widthPct: 30 } },
          { id: "b", type: "text", text: "y" },
        ],
      }),
    tokens);
    const [a, b] = resolved.boxes as TextBox[];
    const innerW = CANVAS_W - 128;
    expect(a.w).toBeCloseTo(innerW * 0.3, 5);
    expect(b.w).toBeCloseTo(innerW * 0.7, 5);
  });

  it("flattens metricCard into rect + constrained texts (accent, bold)", () => {
    const resolved = solveSlide(
      slide({
        id: "root",
        type: "row",
        children: [
          { id: "m1", type: "metricCard", label: "ARR", value: "$4.2M", delta: "+12% QoQ" },
          { id: "m2", type: "metricCard", label: "NRR", value: "118%" },
        ],
      }),
    tokens);
    const rects = resolved.boxes.filter((b) => b.kind === "rect") as RectBox[];
    expect(rects).toHaveLength(2);
    // stretch align → equal-height cards
    expect(rects[0].h).toBeCloseTo(rects[1].h, 5);
    const values = resolved.boxes.filter(
      (b) => b.kind === "text" && b.color === tokens.colors.accent,
    ) as TextBox[];
    expect(values).toHaveLength(2);
    expect(values.every((v) => v.bold)).toBe(true);
    expect(values[0].paragraphs[0].lines[0]).toBe("$4.2M");
    // labels are uppercased by the component
    const labels = resolved.boxes.filter(
      (b) => b.kind === "text" && (b as TextBox).size === tokens.fontSizes.metricLabel,
    ) as TextBox[];
    expect(labels[0].paragraphs[0].lines[0]).toBe("ARR");
    // all sub-boxes carry the card's nodeId for click-mapping
    expect(new Set(resolved.boxes.map((b) => b.nodeId))).toEqual(new Set(["m1", "m2"]));
  });

  it("autoshrinks text pinned into a too-short box and records a warning", () => {
    const long = Array(40).fill("substantially verbose content").join(" ");
    const resolved = solveSlide(
      slide({
        id: "root",
        type: "column",
        children: [{ id: "t", type: "text", text: long, sizing: { height: 120 } }],
      }),
    tokens);
    const t = resolved.boxes[0] as TextBox;
    expect(t.size).toBeLessThan(tokens.fontSizes.body);
    expect(resolved.warnings.some((w) => w.includes("autoshrunk"))).toBe(true);
  });

  it("warns when slide content overflows the canvas", () => {
    const children = Array.from({ length: 30 }, (_, i) => ({
      id: `t${i}`,
      type: "text" as const,
      text: "line",
    }));
    const resolved = solveSlide(slide({ id: "root", type: "column", children }), tokens);
    expect(resolved.warnings.some((w) => w.includes("taller than the canvas"))).toBe(true);
  });

  it("emits container background rects behind text (z-order)", () => {
    const resolved = solveSlide(
      slide({
        id: "root",
        type: "column",
        style: { background: "surface", padding: 32, radius: 12 },
        children: [{ id: "t", type: "text", text: "hello" }],
      }),
    tokens);
    expect(resolved.boxes[0].kind).toBe("rect");
    expect(resolved.boxes[1].kind).toBe("text");
    const rect = resolved.boxes[0] as RectBox;
    expect(rect.fill).toBe(tokens.colors.surface);
    expect(rect.radius).toBe(12);
    const t = resolved.boxes[1] as TextBox;
    expect(t.x).toBe(rect.x + 32);
  });

  it("keeps every box inside the canvas for a well-formed slide", () => {
    const resolved = solveSlide(
      slide({
        id: "root",
        type: "column",
        style: { gap: 24 },
        children: [
          { id: "h", type: "heading", text: "KPIs", level: 2 },
          {
            id: "r",
            type: "row",
            style: { gap: 16 },
            children: [
              { id: "m1", type: "metricCard", label: "ARR", value: "$4.2M" },
              { id: "m2", type: "metricCard", label: "NRR", value: "118%" },
              { id: "m3", type: "metricCard", label: "Logos", value: "72", delta: "+9" },
            ],
          },
        ],
      }),
    tokens);
    for (const b of resolved.boxes) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(CANVAS_W + 0.01);
      expect(b.y + b.h).toBeLessThanOrEqual(CANVAS_H + 0.01);
    }
  });

  it("is deterministic: same input, same boxes", () => {
    const s = slide({
      id: "root",
      type: "column",
      children: [
        { id: "h", type: "heading", text: "Deterministic", level: 1 },
        { id: "l", type: "bulletList", items: ["one", "two", "three"] },
      ],
    });
    expect(solveSlide(s, tokens)).toEqual(solveSlide(s, tokens));
  });
});
