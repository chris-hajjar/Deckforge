/**
 * Template intelligence + brand sections: facet derivation, ranked search
 * with deck-vocabulary synonyms, cross-template element copying, and
 * brand voice/logos on themes.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { newDeck, type Deck } from "@deckforge/schema";
import { THEMES, mergeTheme } from "@deckforge/themes";
import { Library } from "../src/library.js";

const tempLib = () => new Library(mkdtempSync(join(tmpdir(), "deckforge-intel-")));

function seed(lib: Library) {
  lib.saveTemplate(
    "quarterly numbers",
    {
      root: {
        type: "column",
        children: [
          { type: "heading", text: "Numbers", level: 2 },
          {
            type: "row",
            children: [
              { type: "metricCard", label: "ARR", value: "$1M" },
              { type: "metricCard", label: "NRR", value: "120%" },
            ],
          },
        ],
      },
    },
    "Headline metrics for exec reviews",
    ["exec", "review"],
  );
  lib.saveTemplate(
    "growth trend",
    {
      root: {
        type: "column",
        children: [
          { type: "heading", text: "Trend", level: 2 },
          {
            type: "chart",
            chartType: "line",
            categories: ["Q1", "Q2"],
            series: [{ name: "ARR", values: [1, 2] }],
          },
        ],
      },
    },
    "Line chart over time",
  );
  lib.saveTemplate(
    "big opener",
    {
      root: {
        type: "column",
        style: { justify: "center" },
        children: [{ type: "heading", text: "Title", level: 1 }],
      },
    },
    "Cover slide",
    ["cover"],
  );
}

describe("template facets & search", () => {
  it("derives layout facets at registration", () => {
    const lib = tempLib();
    seed(lib);
    const byName = Object.fromEntries(lib.list().map((t) => [t.name, t.facets!]));
    expect(byName["quarterly numbers"].layout).toBe("metrics");
    expect(byName["quarterly numbers"].counts.metricCard).toBe(2);
    expect(byName["growth trend"].layout).toBe("chart");
    expect(byName["big opener"].layout).toBe("title");
  });

  it("finds by intent through synonyms and structure, ranked", () => {
    const lib = tempLib();
    seed(lib);
    // "kpis" never appears in any template — synonym → metrics structure
    const kpi = lib.find("kpi slide for the board");
    expect(kpi[0].name).toBe("quarterly numbers");
    expect(kpi[0].matched.some((m) => m.startsWith("structure:"))).toBe(true);

    const graph = lib.find("a graph of growth over time");
    expect(graph[0].name).toBe("growth trend");

    const cover = lib.find("intro cover");
    expect(cover[0].name).toBe("big opener");

    expect(lib.find("zebra unicorns")).toHaveLength(0);
  });

  it("copies elements across templates (findTemplateElement)", () => {
    const lib = tempLib();
    seed(lib);
    const row = lib.findTemplateElement("quarterly numbers", { elementType: "row" });
    expect(row.type).toBe("row");
    expect((row as { children: unknown[] }).children).toHaveLength(2);
    expect(() => lib.findTemplateElement("growth trend", { elementType: "table" })).toThrow(
      /It contains/,
    );
  });
});

describe("brand sections", () => {
  it("registers and persists a full brand block on a theme", () => {
    const dir = mkdtempSync(join(tmpdir(), "deckforge-brand-"));
    const lib = new Library(dir);
    lib.saveTheme({
      name: "atlas",
      base: "corporate-bold",
      brand: {
        tagline: "Robots that pay for themselves",
        audience: "Ops leaders at 3PLs",
        voice: {
          tone: "confident, concrete, zero hype",
          personality: ["direct", "technical", "warm"],
          dos: ["lead with numbers"],
          donts: ["never say 'revolutionary'"],
          preferredTerms: ["deployment"],
          avoidTerms: ["solution"],
        },
        logos: [{ name: "wordmark", src: "data:image/png;base64,aGk=", usage: "primary" }],
        imagery: { style: "documentary warehouse photography" },
      },
    });
    expect(THEMES.atlas.brand?.voice?.tone).toContain("zero hype");
    // reload from disk
    delete THEMES.atlas;
    new Library(dir);
    expect(THEMES.atlas.brand?.logos?.[0].usage).toBe("primary");
    expect(THEMES.atlas.brand?.voice?.donts).toEqual(["never say 'revolutionary'"]);
  });

  it("mergeTheme carries brand through and lets a patch replace it", () => {
    const withBrand = mergeTheme(THEMES["corporate-bold"], {
      name: "b1",
      brand: { tagline: "hello" },
    });
    expect(withBrand.brand?.tagline).toBe("hello");
    const inherited = mergeTheme(withBrand, { name: "b2" });
    expect(inherited.brand?.tagline).toBe("hello");
  });

  it("brand is optional — existing themes still validate", () => {
    const d = newDeck() as Deck;
    expect(THEMES["corporate-bold"].brand).toBeUndefined();
    expect(d.schemaVersion).toBe(2);
  });
});
