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

/** Auto-derived structure summary; makes big libraries searchable. */
export interface TemplateFacets {
  /** element type → count, across root + overlays */
  counts: Record<string, number>;
  /** dominant layout family */
  layout: "title" | "metrics" | "chart" | "table" | "split" | "list" | "freeform" | "content";
  hasOverlays: boolean;
  textBlocks: number;
}

export interface SlideTemplate {
  name: string;
  description?: string;
  tags?: string[];
  facets?: TemplateFacets;
  slide: Slide;
}

function deriveFacets(slide: Slide): TemplateFacets {
  const counts: Record<string, number> = {};
  const visit = (node: DeckNode) => {
    counts[node.type] = (counts[node.type] ?? 0) + 1;
    if (node.type === "row" || node.type === "column") for (const c of node.children) visit(c);
  };
  visit(slide.root);
  for (const o of slide.overlays ?? []) visit(o);
  const rootChildren = slide.root.type === "column" || slide.root.type === "row" ? slide.root.children.length : 1;
  const n = (t: string) => counts[t] ?? 0;
  let layout: TemplateFacets["layout"] = "content";
  if (n("metricCard") >= 2) layout = "metrics";
  else if (n("chart") >= 1) layout = "chart";
  else if (n("table") >= 1) layout = "table";
  else if (rootChildren === 0 && (slide.overlays?.length ?? 0) > 0) layout = "freeform";
  else if (n("row") >= 1 && n("column") >= 2) layout = "split";
  else if (n("bulletList") >= 1) layout = "list";
  else if (n("heading") >= 1 && n("text") + n("bulletList") <= 1 && rootChildren <= 2) layout = "title";
  return {
    counts,
    layout,
    hasOverlays: (slide.overlays?.length ?? 0) > 0,
    textBlocks: n("heading") + n("text") + n("bulletList"),
  };
}

/** Deck-vocabulary synonyms so searches match how people talk about slides. */
const SYNONYMS: Record<string, string[]> = {
  kpi: ["metrics", "metriccard"],
  kpis: ["metrics", "metriccard"],
  stats: ["metrics", "metriccard"],
  numbers: ["metrics", "chart"],
  metric: ["metrics", "metriccard"],
  graph: ["chart"],
  graphs: ["chart"],
  data: ["chart", "table", "metrics"],
  comparison: ["table", "split"],
  cover: ["title"],
  intro: ["title"],
  opener: ["title"],
  closing: ["title"],
  agenda: ["list"],
  bullets: ["list", "bulletlist"],
  points: ["list"],
  quote: ["content", "text"],
  timeline: ["shape", "chevron", "roadmap"],
  roadmap: ["shape", "chevron"],
  team: ["image", "split"],
  photo: ["image"],
  picture: ["image"],
  diagram: ["shape", "freeform"],
  hero: ["title", "freeform"],
};

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
        const parsed = SlideSchema.parse(raw.slide) as Slide;
        const tpl: SlideTemplate = {
          name: raw.name,
          description: raw.description,
          tags: raw.tags,
          facets: raw.facets ?? deriveFacets(parsed),
          slide: parsed,
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
    const tpl: SlideTemplate = { name, description, tags, facets: deriveFacets(parsed), slide: parsed };
    this.templates.set(name, tpl);
    writeFileSync(
      join(this.templatesDir, `${safeFile(name)}.json`),
      JSON.stringify(tpl, null, 2) + "\n",
    );
    return tpl;
  }

  /**
   * Ranked keyword search over names, descriptions, tags and derived
   * structure facets (with deck-vocabulary synonyms). Deterministic scoring
   * so results are explainable.
   */
  find(query: string, limit = 8): Array<{
    name: string;
    description?: string;
    tags?: string[];
    facets?: TemplateFacets;
    score: number;
    matched: string[];
  }> {
    const tokens = query
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1);
    const expanded = new Set(tokens);
    for (const t of tokens) for (const s of SYNONYMS[t] ?? []) expanded.add(s);

    const results = [...this.templates.values()].map((tpl) => {
      let score = 0;
      const matched: string[] = [];
      const name = tpl.name.toLowerCase();
      const desc = (tpl.description ?? "").toLowerCase();
      const tags = (tpl.tags ?? []).map((t) => t.toLowerCase());
      const facetWords = tpl.facets
        ? [tpl.facets.layout, ...Object.keys(tpl.facets.counts).map((k) => k.toLowerCase())]
        : [];
      for (const t of expanded) {
        if (name.includes(t)) {
          score += 5;
          matched.push(`name:${t}`);
        }
        if (tags.some((g) => g.includes(t))) {
          score += 4;
          matched.push(`tag:${t}`);
        }
        if (facetWords.includes(t)) {
          score += 3;
          matched.push(`structure:${t}`);
        }
        if (desc.includes(t)) {
          score += 2;
          matched.push(`description:${t}`);
        }
      }
      return { name: tpl.name, description: tpl.description, tags: tpl.tags, facets: tpl.facets, score, matched };
    });
    return results
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /** Find an element inside a template (by id, or first of a type). */
  findTemplateElement(templateName: string, opts: { elementId?: string; elementType?: string }): DeckNode {
    const tpl = this.templates.get(templateName);
    if (!tpl) throw new Error(`No template "${templateName}"`);
    const all: DeckNode[] = [];
    const visit = (node: DeckNode) => {
      all.push(node);
      if (node.type === "row" || node.type === "column") for (const c of node.children) visit(c);
    };
    visit(tpl.slide.root);
    for (const o of tpl.slide.overlays ?? []) visit(o);
    const found = opts.elementId
      ? all.find((n) => n.id === opts.elementId)
      : all.find((n) => n.type === opts.elementType);
    if (!found) {
      throw new Error(
        `No element ${opts.elementId ? `"${opts.elementId}"` : `of type "${opts.elementType}"`} in template "${templateName}". It contains: ${all.map((n) => `${n.type}#${n.id}`).join(", ")}`,
      );
    }
    return structuredClone(found);
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

  list(): Array<{ name: string; description?: string; tags?: string[]; facets?: TemplateFacets }> {
    return [...this.templates.values()].map(({ name, description, tags, facets }) => ({
      name,
      description,
      tags,
      facets,
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
