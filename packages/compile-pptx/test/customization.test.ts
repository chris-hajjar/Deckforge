/**
 * Round-2 golden tests: transitions, entrance animations, gradients, shapes,
 * tables and notes — verified by unzipping the OpenXML, and by LibreOffice
 * Impress parsing the file (a real consumer, and a proxy for
 * PowerPoint/Google Slides import).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Deck } from "@deckforge/schema";
import { compileDeckToFile } from "@deckforge/compile-pptx";

const deck: Deck = {
  schemaVersion: 2,
  title: "Customization golden",
  theme: { base: "corporate-bold" },
  slides: [
    {
      id: "s1",
      transition: { type: "push", direction: "left" },
      gradient: { from: "background", to: "surface-alt", angle: 90 },
      notes: "Presenter: land the roadmap story here.",
      root: {
        id: "r1",
        type: "column",
        style: { gap: 24 },
        children: [
          { id: "h1", type: "heading", text: "Roadmap", level: 2 },
          {
            id: "steps",
            type: "row",
            style: { gap: 16 },
            animation: { effect: "flyIn", direction: "bottom", order: 1 },
            children: [
              { id: "c1", type: "shape", shape: "chevron", fill: "accent", text: "Build" },
              { id: "c2", type: "shape", shape: "chevron", fill: "accent", text: "Launch" },
              {
                id: "c3",
                type: "shape",
                shape: "chevron",
                gradient: { from: "accent", to: "accent-alt", angle: 0 },
                text: "Scale",
              },
            ],
          },
          {
            id: "bullets",
            type: "bulletList",
            items: ["Alpha in Q1", "GA in Q2", "EU launch in Q3"],
            animation: { effect: "fade", order: 2, byParagraph: true },
          },
          {
            id: "tbl",
            type: "table",
            header: true,
            rows: [
              ["Milestone", "Quarter"],
              ["GA launch", "Q3"],
            ],
          },
        ],
      },
      overlays: [
        {
          id: "badge",
          type: "shape",
          shape: "ellipse",
          fill: "accent-alt",
          text: "NEW",
          frame: { x: 1080, y: 60, w: 130, h: 130 },
          animation: { effect: "zoom", order: 3 },
        },
      ],
    },
  ],
} as Deck;

describe("pptx customization", () => {
  it("injects transition, timing tree, gradients, table and notes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deckforge-anim-"));
    const file = join(dir, "custom.pptx");
    await compileDeckToFile(deck, file);
    execFileSync("unzip", ["-o", "-q", file, "-d", join(dir, "x")]);
    const slide1 = readFileSync(join(dir, "x", "ppt", "slides", "slide1.xml"), "utf8");

    // slide transition
    expect(slide1).toContain('<p:transition spd="med"><p:push dir="l"/></p:transition>');

    // timing tree: fly-in preset on the chevron group, fade preset, zoom preset
    expect(slide1).toContain('presetID="2" presetClass="entr" presetSubtype="4"');
    expect(slide1).toContain('presetID="10" presetClass="entr"');
    expect(slide1).toContain('presetID="23" presetClass="entr"');
    expect(slide1).toContain("<p:attrName>style.visibility</p:attrName>");

    // per-paragraph list build: 3 bullets → paragraph-range targets + bldP
    expect(slide1).toContain('<p:pRg st="1" end="1"/>');
    expect(slide1).toContain('<p:pRg st="2" end="2"/>');
    expect(slide1).toContain('build="p"');

    // gradient fill on the third chevron and the slide background
    expect(slide1).toContain("<a:gradFill");
    expect((slide1.match(/<a:gradFill/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(slide1).toContain('<a:lin ang="0" scaled="1"/>'); // 0° chevron gradient

    // native editable table
    expect(slide1).toContain("<a:tbl>");
    expect(slide1).toContain("Milestone");

    // native chevron geometry (not a picture of one)
    expect(slide1).toContain('prstGeom prst="chevron"');
    expect(slide1).toContain('prstGeom prst="ellipse"');

    // speaker notes land in the notes slide part
    const notes = readFileSync(join(dir, "x", "ppt", "notesSlides", "notesSlide1.xml"), "utf8");
    expect(notes).toContain("land the roadmap story");

    // the XML is still well-formed
    execFileSync("python3", ["-c", `import xml.dom.minidom; xml.dom.minidom.parse(${JSON.stringify(join(dir, "x", "ppt", "slides", "slide1.xml"))})`]);
  }, 30000);

  it("survives a real consumer: LibreOffice Impress parses and converts it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deckforge-anim-"));
    const file = join(dir, "custom.pptx");
    await compileDeckToFile(deck, file);
    // isolated profile: parallel soffice instances can't share a user dir
    execFileSync(
      "soffice",
      [`-env:UserInstallation=file://${dir}/lo-profile`, "--headless", "--convert-to", "pdf", file, "--outdir", dir],
      { timeout: 90000 },
    );
    expect(existsSync(join(dir, "custom.pdf"))).toBe(true);
  }, 120000);

  it("decks without animations skip post-processing untouched", async () => {
    const plain: Deck = {
      schemaVersion: 2,
      title: "Plain",
      theme: { base: "corporate-bold" },
      slides: [
        {
          id: "s1",
          root: {
            id: "r",
            type: "column",
            children: [{ id: "h", type: "heading", text: "Plain", level: 1 }],
          },
        },
      ],
    } as Deck;
    const dir = mkdtempSync(join(tmpdir(), "deckforge-anim-"));
    const file = join(dir, "plain.pptx");
    await compileDeckToFile(plain, file);
    execFileSync("unzip", ["-o", "-q", file, "-d", join(dir, "x")]);
    const slide1 = readFileSync(join(dir, "x", "ppt", "slides", "slide1.xml"), "utf8");
    expect(slide1).not.toContain("<p:timing>");
    expect(slide1).not.toContain("<p:transition");
  });
});
