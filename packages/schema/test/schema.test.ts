import { describe, expect, it } from "vitest";
import { DeckSchema, newDeck, findNode, freshId, walkDeck } from "@deckforge/schema";
import { THEMES, resolveTheme } from "@deckforge/themes";
import { ThemeTokensSchema } from "@deckforge/schema";

describe("deck schema", () => {
  it("accepts the default deck", () => {
    const deck = newDeck();
    expect(() => DeckSchema.parse(deck)).not.toThrow();
  });

  it("rejects unknown element types", () => {
    const deck = newDeck() as any;
    deck.slides[0].root.children.push({ id: "x", type: "marquee", text: "nope" });
    expect(() => DeckSchema.parse(deck)).toThrow();
  });

  it("rejects extra properties (strict)", () => {
    const deck = newDeck() as any;
    deck.slides[0].root.children[0].jsx = "<div/>";
    expect(() => DeckSchema.parse(deck)).toThrow();
  });

  it("parses nested rows/columns with metric cards", () => {
    const deck = newDeck();
    deck.slides.push({
      id: "slide-2",
      root: {
        id: "r2",
        type: "column",
        children: [
          { id: "h", type: "heading", text: "KPIs", level: 2 },
          {
            id: "row",
            type: "row",
            style: { gap: 16 },
            children: [
              { id: "m1", type: "metricCard", label: "ARR", value: "$4.2M", delta: "+12%" },
              { id: "m2", type: "metricCard", label: "NRR", value: "118%" },
            ],
          },
        ],
      },
    });
    expect(() => DeckSchema.parse(deck)).not.toThrow();
  });

  it("walks the tree with JSON pointers and finds nodes by id", () => {
    const deck = newDeck();
    const visit = findNode(deck, "el-2");
    expect(visit?.pointer).toBe("/slides/0/root/children/1");
    expect([...walkDeck(deck)].length).toBe(3); // root + 2 children
    expect(freshId(deck, "el")).toBe("el-3");
  });
});

describe("themes", () => {
  it("ships two valid built-in themes", () => {
    expect(Object.keys(THEMES)).toEqual(["corporate-bold", "minimalist-dark"]);
    for (const t of Object.values(THEMES)) {
      expect(() => ThemeTokensSchema.parse(t)).not.toThrow();
    }
  });

  it("applies brand overrides on a base theme", () => {
    const t = resolveTheme({
      base: "corporate-bold",
      overrides: { colors: { accent: "#ff0055" }, fonts: { heading: "serif" } },
    });
    expect(t.colors.accent).toBe("#ff0055");
    expect(t.fonts.heading).toBe("serif");
    expect(t.colors.background).toBe("#ffffff"); // untouched roles remain
  });

  it("throws a clear error for unknown base themes", () => {
    expect(() => resolveTheme({ base: "vaporwave" })).toThrow(/Unknown theme/);
  });
});
