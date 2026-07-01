import { describe, expect, it } from "vitest";
import type { Slide } from "@deckforge/schema";
import { THEMES } from "@deckforge/themes";
import { normalizeDeck } from "@deckforge/validate";
import { newDeck } from "@deckforge/schema";
import {
  solveSlide,
  type ImageBox,
  type ShapeBox,
  type TableBox,
  type TextBox,
} from "@deckforge/layout";

const tokens = THEMES["corporate-bold"];
const slide = (partial: Partial<Slide> & { root: Slide["root"] }): Slide =>
  ({ id: "s1", ...partial }) as Slide;

describe("shapes", () => {
  it("resolves a labeled chevron with gradient, border and shadow", () => {
    const r = solveSlide(
      slide({
        root: {
          id: "root",
          type: "column",
          children: [
            {
              id: "sh",
              type: "shape",
              shape: "chevron",
              gradient: { from: "accent", to: "accent-alt", angle: 45 },
              border: { color: "text-primary", width: 3 },
              shadow: true,
              text: "Phase 1",
              sizing: { height: 120 },
            },
          ],
        },
      }),
      tokens,
    );
    const sh = r.boxes.find((b) => b.kind === "shape") as ShapeBox;
    expect(sh.geometry).toBe("chevron");
    expect(sh.gradient).toEqual({
      from: tokens.colors.accent,
      to: tokens.colors["accent-alt"],
      angle: 45,
    });
    expect(sh.stroke).toEqual({ color: tokens.colors["text-primary"], width: 3 });
    expect(sh.shadow).toBe(true);
    const label = r.boxes.find((b) => b.kind === "text") as TextBox;
    expect(label.paragraphs[0].lines[0]).toBe("Phase 1");
    expect(label.valign).toBe("middle");
    // label is centered within the shape
    expect(label.y).toBeGreaterThan(sh.y);
    expect(label.y + label.h).toBeLessThan(sh.y + sh.h + 1);
  });

  it("lines carry a stroke and no fill", () => {
    const r = solveSlide(
      slide({
        root: {
          id: "root",
          type: "column",
          children: [{ id: "ln", type: "shape", shape: "line", fill: "accent" }],
        },
      }),
      tokens,
    );
    const ln = r.boxes[0] as ShapeBox;
    expect(ln.fill).toBeUndefined();
    expect(ln.stroke?.color).toBe(tokens.colors.accent);
  });
});

describe("freeform overlays", () => {
  it("places overlay elements at their absolute frames, above flow content", () => {
    const r = solveSlide(
      slide({
        root: {
          id: "root",
          type: "column",
          children: [{ id: "h", type: "heading", text: "Under", level: 1 }],
        },
        overlays: [
          {
            id: "float",
            type: "shape",
            shape: "ellipse",
            fill: "accent-alt",
            frame: { x: 900, y: 500, w: 200, h: 150 },
          },
        ],
      }),
      tokens,
    );
    const sh = r.boxes.find((b) => b.nodeId === "float") as ShapeBox;
    expect({ x: sh.x, y: sh.y, w: sh.w, h: sh.h }).toEqual({ x: 900, y: 500, w: 200, h: 150 });
    const heading = r.boxes.find((b) => b.nodeId === "h")!;
    expect(sh.z).toBeGreaterThan(heading.z); // overlays paint on top
  });

  it("lays out container overlays inside their frame", () => {
    const r = solveSlide(
      slide({
        root: { id: "root", type: "column", children: [] },
        overlays: [
          {
            id: "card",
            type: "column",
            style: { background: "surface", padding: 16 },
            frame: { x: 100, y: 100, w: 400, h: 200 },
            children: [{ id: "t", type: "text", text: "floating card" }],
          },
        ],
      }),
      tokens,
    );
    const text = r.boxes.find((b) => b.kind === "text") as TextBox;
    expect(text.x).toBe(116); // frame.x + padding
    expect(text.y).toBe(116);
  });
});

describe("animations", () => {
  it("copies animation onto boxes and inherits it through containers", () => {
    const r = solveSlide(
      slide({
        root: {
          id: "root",
          type: "column",
          children: [
            {
              id: "grp",
              type: "row",
              animation: { effect: "flyIn", direction: "bottom", order: 2 },
              children: [
                { id: "m1", type: "metricCard", label: "A", value: "1" },
                { id: "m2", type: "metricCard", label: "B", value: "2" },
              ],
            },
            { id: "plain", type: "text", text: "static" },
          ],
        },
      }),
      tokens,
    );
    const animated = r.boxes.filter((b) => b.anim);
    // both cards' boxes (rect + label + value each) inherit the row's animation
    expect(animated.length).toBeGreaterThanOrEqual(6);
    expect(new Set(animated.map((b) => b.anim!.effect))).toEqual(new Set(["flyIn"]));
    const plain = r.boxes.find((b) => b.nodeId === "plain")!;
    expect(plain.anim).toBeUndefined();
  });

  it("passes transitions and notes through to the resolved slide", () => {
    const r = solveSlide(
      slide({
        root: { id: "root", type: "column", children: [] },
        transition: { type: "push", direction: "left" },
        notes: "Remember to pause here.",
      }),
      tokens,
    );
    expect(r.transition).toEqual({ type: "push", direction: "left" });
    expect(r.notes).toBe("Remember to pause here.");
  });
});

describe("tables", () => {
  it("measures brand-styled tables with header and zebra rows", () => {
    const r = solveSlide(
      slide({
        root: {
          id: "root",
          type: "column",
          children: [
            {
              id: "tb",
              type: "table",
              header: true,
              columns: [2, 1, 1],
              rows: [
                ["Milestone", "Quarter", "Owner"],
                ["GA launch", "Q3", "Platform"],
                ["EU expansion", "Q4", "GTM"],
              ],
            },
          ],
        },
      }),
      tokens,
    );
    const tb = r.boxes.find((b) => b.kind === "table") as TableBox;
    expect(tb.colW).toHaveLength(3);
    expect(tb.colW[0]).toBeCloseTo(tb.colW[1] * 2, 4);
    expect(tb.rowH).toHaveLength(3);
    expect(tb.h).toBeCloseTo(tb.rowH.reduce((a, b) => a + b, 0), 5);
    expect(tb.cells[0][0].bold).toBe(true);
    expect(tb.cells[0][0].fill).toBe(tokens.colors.accent);
    expect(tb.cells[1][0].bold).toBe(false);
  });
});

describe("rich text styling", () => {
  it("honors lineHeight, letterSpacing, uppercase and per-element font", () => {
    const r = solveSlide(
      slide({
        root: {
          id: "root",
          type: "column",
          children: [
            {
              id: "t",
              type: "text",
              text: "kicker line",
              style: { uppercase: true, letterSpacing: 3, lineHeight: 1.8, font: "mono" },
            },
          ],
        },
      }),
      tokens,
    );
    const t = r.boxes[0] as TextBox;
    expect(t.paragraphs[0].lines[0]).toBe("KICKER LINE");
    expect(t.letterSpacing).toBe(3);
    expect(t.lineHeight).toBe(1.8);
    expect(t.fontId).toBe("mono");
  });

  it("numbers ordered lists via markers", () => {
    const r = solveSlide(
      slide({
        root: {
          id: "root",
          type: "column",
          children: [{ id: "l", type: "bulletList", ordered: true, items: ["a", "b"] }],
        },
      }),
      tokens,
    );
    const l = r.boxes[0] as TextBox;
    expect(l.paragraphs.map((p) => p.marker)).toEqual(["1.", "2."]);
  });
});

describe("validation of new fields", () => {
  it("snaps gradient stops, shape fills and border colors to brand tokens", () => {
    const d = newDeck();
    (d.slides[0].root as any).children.push({
      id: "sh",
      type: "shape",
      shape: "ellipse",
      fill: "#0a5fd9",
      gradient: { from: "#ffffff", to: "#0a5fd9", angle: 90 },
      border: { color: "#111111", width: 2 },
    });
    const { deck, corrections } = normalizeDeck(d);
    const sh: any = (deck.slides[0].root as any).children[2];
    expect(sh.fill).toBe("accent");
    expect(sh.gradient.from).toBe("background");
    expect(sh.gradient.to).toBe("accent");
    expect(sh.border.color).toBe("text-primary");
    expect(corrections.length).toBe(4);
  });

  it("clamps runaway frames and synthesizes missing overlay frames", () => {
    const d = newDeck();
    (d.slides[0] as any).overlays = [
      { id: "o1", type: "shape", shape: "rect", fill: "accent", frame: { x: 1400, y: -50, w: 4000, h: 100 } },
      { id: "o2", type: "text", text: "no frame" },
    ];
    const { deck, corrections } = normalizeDeck(d);
    const [o1, o2]: any[] = (deck.slides[0] as any).overlays;
    expect(o1.frame.x).toBeLessThanOrEqual(1272);
    expect(o1.frame.y).toBe(0);
    expect(o1.frame.x + o1.frame.w).toBeLessThanOrEqual(1280);
    expect(o2.frame).toBeDefined();
    expect(corrections.some((c) => c.reason.includes("clamped"))).toBe(true);
    expect(corrections.some((c) => c.reason.includes("missing a frame"))).toBe(true);
  });
});
