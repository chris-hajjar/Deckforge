/**
 * library.ts — the project's persistent design library.
 *
 * Lives next to the deck:
 *   <projectDir>/library/themes/<name>.json     full ThemeTokens documents
 *   <projectDir>/library/templates/<name>.json  reusable slide templates
 *
 * Themes load into the shared registry on boot so validation/layout/export
 * resolve them like built-ins. Templates are complete slides; instantiation
 * clones one with entirely fresh ids so a template can be stamped out any
 * number of times (and templates themselves never mutate).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  SlideSchema,
  freshId,
  type Deck,
  type DeckNode,
  type Slide,
  type ThemeTokens,
} from "@deckforge/schema";
import { THEMES, mergeTheme, registerTheme, type ThemePatch } from "@deckforge/themes";

export interface SlideTemplate {
  name: string;
  description?: string;
  tags?: string[];
  slide: Slide;
}

const safeFile = (name: string) => {
  const s = name.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, "-").replace(/^-+|-+$/g, "");
  if (!s) throw new Error(`"${name}" is not a usable name`);
  return s;
};

/** Fill missing ids so hand-written template JSON doesn't need them. */
function fillIds(slide: Record<string, unknown>): void {
  let n = 0;
  const visit = (el: Record<string, unknown>) => {
    if (typeof el.id !== "string" || el.id === "") el.id = `tpl-el-${++n}`;
    for (const c of (el.children as Record<string, unknown>[]) ?? []) visit(c);
  };
  if (typeof slide.id !== "string" || slide.id === "") slide.id = "tpl";
  if (slide.root) visit(slide.root as Record<string, unknown>);
  for (const o of (slide.overlays as Record<string, unknown>[]) ?? []) visit(o);
}

export class Library {
  private themesDir: string;
  private templatesDir: string;
  readonly templates = new Map<string, SlideTemplate>();
  /** Names of custom (non-builtin) themes loaded or registered. */
  readonly customThemes = new Set<string>();

  constructor(projectDir: string) {
    this.themesDir = join(projectDir, "library", "themes");
    this.templatesDir = join(projectDir, "library", "templates");
    mkdirSync(this.themesDir, { recursive: true });
    mkdirSync(this.templatesDir, { recursive: true });
    this.loadAll();
  }

  private loadAll() {
    for (const f of readdirSync(this.themesDir).filter((f) => f.endsWith(".json"))) {
      try {
        const tokens = registerTheme(JSON.parse(readFileSync(join(this.themesDir, f), "utf8")));
        this.customThemes.add(tokens.name);
      } catch (e) {
        console.error(`[deckforge] skipping bad theme ${f}: ${(e as Error).message}`);
      }
    }
    for (const f of readdirSync(this.templatesDir).filter((f) => f.endsWith(".json"))) {
      try {
        const raw = JSON.parse(readFileSync(join(this.templatesDir, f), "utf8"));
        fillIds(raw.slide);
        const tpl: SlideTemplate = {
          name: raw.name,
          description: raw.description,
          tags: raw.tags,
          slide: SlideSchema.parse(raw.slide) as Slide,
        };
        this.templates.set(tpl.name, tpl);
      } catch (e) {
        console.error(`[deckforge] skipping bad template ${f}: ${(e as Error).message}`);
      }
    }
  }

  /** Register a design system: full tokens, or a patch layered on a base theme. */
  saveTheme(input: { base?: string } & Record<string, unknown>): ThemeTokens {
    let tokens: ThemeTokens;
    if (input.base !== undefined) {
      const base = THEMES[input.base as string];
      if (!base) {
        throw new Error(`Unknown base theme "${input.base}". Available: ${Object.keys(THEMES).join(", ")}`);
      }
      const { base: _b, ...patch } = input;
      tokens = mergeTheme(base, patch as unknown as ThemePatch);
    } else {
      tokens = registerTheme(input);
    }
    registerTheme(tokens);
    this.customThemes.add(tokens.name);
    writeFileSync(join(this.themesDir, `${safeFile(tokens.name)}.json`), JSON.stringify(tokens, null, 2) + "\n");
    return tokens;
  }

  /** Register a template from raw slide JSON (ids optional). */
  saveTemplate(name: string, slide: unknown, description?: string, tags?: string[]): SlideTemplate {
    const raw = structuredClone(slide) as Record<string, unknown>;
    fillIds(raw);
    const parsed = SlideSchema.parse(raw) as Slide;
    const tpl: SlideTemplate = { name, description, tags, slide: parsed };
    this.templates.set(name, tpl);
    writeFileSync(
      join(this.templatesDir, `${safeFile(name)}.json`),
      JSON.stringify(tpl, null, 2) + "\n",
    );
    return tpl;
  }

  deleteTemplate(name: string): void {
    if (!this.templates.delete(name)) throw new Error(`No template "${name}"`);
    rmSync(join(this.templatesDir, `${safeFile(name)}.json`), { force: true });
  }

  /** Remove a custom theme (built-ins and the active theme are protected). */
  deleteTheme(name: string, activeBase: string): void {
    if (!this.customThemes.has(name)) {
      throw new Error(`"${name}" is not a custom theme (built-ins can't be deleted)`);
    }
    if (name === activeBase) {
      throw new Error(`"${name}" is the deck's active theme — switch themes first`);
    }
    this.customThemes.delete(name);
    delete THEMES[name];
    rmSync(join(this.themesDir, `${safeFile(name)}.json`), { force: true });
  }

  /** Full template documents (for visual galleries). */
  listFull(): SlideTemplate[] {
    return [...this.templates.values()];
  }

  list(): Array<{ name: string; description?: string; tags?: string[] }> {
    return [...this.templates.values()].map(({ name, description, tags }) => ({
      name,
      description,
      tags,
    }));
  }

  /** Clone a template into a deck-ready slide with entirely fresh ids. */
  instantiate(deck: Deck, templateName: string): Slide {
    const tpl = this.templates.get(templateName);
    if (!tpl) {
      throw new Error(
        `No template "${templateName}". Registered: ${[...this.templates.keys()].join(", ") || "(none)"}`,
      );
    }
    const slide = structuredClone(tpl.slide) as Slide;
    const sid = freshId(deck, "slide");
    slide.id = sid;
    slide.name = slide.name ?? tpl.name;
    let n = 0;
    const remap = (node: DeckNode) => {
      node.id = `${sid}-e${++n}`;
      if (node.type === "row" || node.type === "column") {
        for (const c of node.children) remap(c);
      }
    };
    remap(slide.root);
    for (const o of slide.overlays ?? []) remap(o);
    return slide;
  }
}
