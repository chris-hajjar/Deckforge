/**
 * Library tests: persistent design systems + templates, and the pptx
 * template importer (round-tripped against Deckforge's own export).
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Deck, Slide } from "@deckforge/schema";
import { THEMES } from "@deckforge/themes";
import { normalizeDeck } from "@deckforge/validate";
import { compileDeckToFile } from "@deckforge/compile-pptx";
import { newDeck, walkSlide } from "@deckforge/schema";
import { Library } from "../src/library.js";
import { importPptx } from "../src/import-pptx.js";

const tempDir = () => mkdtempSync(join(tmpdir(), "deckforge-lib-"));

describe("design-system registration", () => {
  it("registers a brand theme as a patch over a base and persists it", () => {
    const dir = tempDir();
    const lib = new Library(dir);
    const tokens = lib.saveTheme({
      name: "acme",
      base: "corporate-bold",
      colors: { accent: "#d81b60", background: "#faf7f2" },
      fonts: { heading: "serif" },
    });
    expect(tokens.colors.accent).toBe("#d81b60");
    expect(tokens.fonts.heading).toBe("serif");
    // untouched parameters inherit, including the validated chart palette
    expect(tokens.chartPalette).toEqual(THEMES["corporate-bold"].chartPalette);
    expect(tokens.spacingScale).toEqual(THEMES["corporate-bold"].spacingScale);

    // a deck can now use it by name, through normal validation
    const deck = newDeck("acme");
    const { tokens: resolved } = normalizeDeck(deck);
    expect(resolved.colors.accent).toBe("#d81b60");

    // survives a restart (fresh Library instance from the same dir)
    delete THEMES.acme;
    const lib2 = new Library(dir);
    expect(lib2.customThemes.has("acme")).toBe(true);
    expect(THEMES.acme.colors.accent).toBe("#d81b60");
  });

  it("rejects invalid theme documents", () => {
    const lib = new Library(tempDir());
    expect(() => lib.saveTheme({ name: "bad", colors: { accent: "#fff" } })).toThrow();
    expect(() => lib.saveTheme({ name: "bad", base: "nope" })).toThrow(/Unknown base/);
  });
});

describe("template library", () => {
  const tplSlide = {
    name: "Quote",
    background: "surface",
    root: {
      type: "column",
      style: { justify: "center", gap: 24 },
      children: [
        { type: "heading", text: "“Placeholder quote”", level: 2 },
        { type: "text", text: "— Attribution", style: { color: "text-secondary" } },
      ],
    },
    overlays: [
      { type: "shape", shape: "line", fill: "accent", frame: { x: 64, y: 600, w: 400, h: 8 } },
    ],
  };

  it("registers raw slide JSON (ids optional), persists, and reloads", () => {
    const dir = tempDir();
    const lib = new Library(dir);
    lib.saveTemplate("quote", tplSlide, "A pull-quote slide", ["content"]);
    expect(lib.list()).toEqual([{ name: "quote", description: "A pull-quote slide", tags: ["content"] }]);
    const lib2 = new Library(dir);
    expect(lib2.templates.get("quote")?.slide.root).toBeTruthy();
  });

  it("instantiates with entirely fresh ids, repeatedly", () => {
    const lib = new Library(tempDir());
    lib.saveTemplate("quote", tplSlide);
    const deck = newDeck() as Deck;
    const s1 = lib.instantiate(deck, "quote");
    deck.slides.push(s1);
    const s2 = lib.instantiate(deck, "quote");
    deck.slides.push(s2);
    const ids1 = [...walkSlide(s1, 1)].map((v) => v.node.id);
    const ids2 = [...walkSlide(s2, 2)].map((v) => v.node.id);
    expect(new Set([...ids1, ...ids2]).size).toBe(ids1.length + ids2.length);
    expect(s1.id).not.toBe(s2.id);
    // instantiated deck still validates
    expect(() => normalizeDeck(deck)).not.toThrow();
  });
});

describe("pptx template import (PowerPoint / Google Slides)", () => {
  it("round-trips Deckforge's own export into overlay templates", async () => {
    const deck: Deck = {
      schemaVersion: 2,
      title: "Roundtrip",
      theme: { base: "corporate-bold" },
      slides: [
        {
          id: "s1",
          root: {
            id: "r",
            type: "column",
            style: { gap: 24 },
            children: [
              { id: "h", type: "heading", text: "Round trip", level: 1 },
              {
                id: "row",
                type: "row",
                children: [
                  { id: "c1", type: "shape", shape: "chevron", fill: "accent", text: "Go" },
                  { id: "c2", type: "shape", shape: "ellipse", fill: "accent-alt" },
                ],
              },
            ],
          },
        },
      ],
    } as Deck;
    const dir = tempDir();
    const file = join(dir, "rt.pptx");
    await compileDeckToFile(deck, file);

    const imported = await importPptx(readFileSync(file));
    expect(imported).toHaveLength(1);
    const slide = imported[0].slide as Slide;
    const overlays = slide.overlays ?? [];
    // heading text + chevron(with label) + ellipse survive as positioned elements
    const texts = overlays.filter((o) => o.type === "text");
    const shapes = overlays.filter((o) => o.type === "shape");
    expect(texts.some((t) => (t as { text: string }).text.includes("Round trip"))).toBe(true);
    expect(shapes.map((s) => (s as { shape: string }).shape).sort()).toEqual([
      "chevron",
      "ellipse",
    ]);
    for (const o of overlays) expect(o.frame).toBeTruthy();

    // imported template registers and instantiates into a valid deck
    const lib = new Library(dir);
    lib.saveTemplate("imported 1", slide);
    const target = newDeck() as Deck;
    target.slides.push(lib.instantiate(target, "imported 1"));
    const { corrections } = normalizeDeck(target);
    // raw imported hex colors get re-branded to tokens by auto-correction
    expect(corrections.some((c) => String(c.reason).includes("brand token"))).toBe(true);
  }, 30000);

  it("rejects non-pptx buffers with a clear error", async () => {
    await expect(importPptx(Buffer.from("not a zip"))).rejects.toThrow();
  });
});
