import { describe, expect, it } from "vitest";
import { newDeck, type Deck } from "@deckforge/schema";
import { DeckValidationError, nearestStep, normalizeDeck } from "@deckforge/validate";

function deckWith(mutate: (d: Deck) => void): Deck {
  const d = newDeck();
  mutate(d);
  return d;
}

describe("auto-correction engine", () => {
  it("passes a clean deck through untouched", () => {
    const { deck, corrections } = normalizeDeck(newDeck());
    expect(corrections).toEqual([]);
    expect(deck.slides).toHaveLength(1);
  });

  it("snaps raw hex colors to the nearest brand token", () => {
    const d = deckWith((d) => {
      (d.slides[0].root as any).children[0].style = { color: "#0a5fd9" }; // near accent #0b62e4
    });
    const { deck, corrections } = normalizeDeck(d);
    expect((deck.slides[0].root as any).children[0].style.color).toBe("accent");
    expect(corrections).toHaveLength(1);
    expect(corrections[0].reason).toMatch(/nearest brand token/);
    expect(corrections[0].pointer).toBe("/slides/0/root/children/0");
  });

  it("replaces nonsense color strings with the component fallback", () => {
    const d = deckWith((d) => {
      (d.slides[0].root as any).children[0].style = { color: "hotpink" };
    });
    const { deck, corrections } = normalizeDeck(d);
    expect((deck.slides[0].root as any).children[0].style.color).toBe("text-primary");
    expect(corrections[0].reason).toMatch(/unknown color/);
  });

  it("snaps padding/gap to the spacing scale and fontSize to the size scale", () => {
    const d = deckWith((d) => {
      (d.slides[0].root as any).style = { padding: 30, gap: 13 };
      (d.slides[0].root as any).children[1].style = { fontSize: 23 };
    });
    const { deck, corrections } = normalizeDeck(d);
    const root: any = deck.slides[0].root;
    expect(root.style.padding).toBe(32);
    expect(root.style.gap).toBe(12);
    expect(root.children[1].style.fontSize).toBe(22);
    expect(corrections).toHaveLength(3);
  });

  it("keeps token roles as-is (accepted vocabulary)", () => {
    const d = deckWith((d) => {
      (d.slides[0].root as any).children[0].style = { color: "accent-alt" };
    });
    const { corrections } = normalizeDeck(d);
    expect(corrections).toEqual([]);
  });

  it("corrects metricCard backgrounds but never lets style leak onto values", () => {
    const d = deckWith((d) => {
      (d.slides[0].root as any).children.push({
        id: "m1",
        type: "metricCard",
        label: "ARR",
        value: "$4.2M",
        background: "#111111",
      });
    });
    const { deck, corrections } = normalizeDeck(d);
    const card: any = (deck.slides[0].root as any).children[2];
    expect(["surface", "text-primary", "background"]).toContain(card.background);
    expect(corrections).toHaveLength(1);
  });

  it("respects brand overrides when snapping", () => {
    const d = deckWith((d) => {
      d.theme = { base: "corporate-bold", overrides: { colors: { accent: "#ff0055" } } };
      (d.slides[0].root as any).children[0].style = { color: "#f8104f" }; // near new accent
    });
    const { deck } = normalizeDeck(d);
    expect((deck.slides[0].root as any).children[0].style.color).toBe("accent");
  });

  it("throws DeckValidationError with readable issues on malformed input", () => {
    expect(() => normalizeDeck({ schemaVersion: 2, slides: "nope" })).toThrow(
      DeckValidationError,
    );
  });

  it("nearestStep picks the closest scale entry", () => {
    expect(nearestStep(30, [0, 8, 16, 24, 32])).toBe(32);
    expect(nearestStep(27, [0, 8, 16, 24, 32])).toBe(24);
  });
});
