/**
 * tools.ts — the MCP tool surface (friendly v1-style ergonomics).
 *
 * Every mutating tool runs through DeckStore.mutate: it edits a draft with
 * ordinary code, and the store diffs, validates, auto-corrects, logs, and
 * broadcasts. Tools return the new revision plus any corrections, so the
 * model always sees what the brand engine actually applied.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  COLOR_ROLES,
  findNode,
  freshId,
  walkSlide,
  type Deck,
  type DeckNode,
  type Slide,
} from "@deckforge/schema";
import { THEMES } from "@deckforge/themes";
import { solveSlide } from "@deckforge/layout";
import { compileDeckToFile } from "@deckforge/compile-pptx";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import type { DeckStore, ApplyResult } from "./store.js";
import type { Library } from "./library.js";
import { importPptx } from "./import-pptx.js";

const ok = (payload: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
});

const fail = (message: string) => ({
  content: [{ type: "text" as const, text: `Error: ${message}` }],
  isError: true as const,
});

function summarize(result: ApplyResult, extra: Record<string, unknown> = {}) {
  return ok({
    rev: result.rev,
    corrections: result.corrections,
    ...extra,
  });
}

function nodeSummary(node: DeckNode): Record<string, unknown> {
  const base: Record<string, unknown> = { id: node.id, type: node.type };
  switch (node.type) {
    case "heading":
    case "text":
      base.text = node.text.length > 60 ? node.text.slice(0, 57) + "..." : node.text;
      break;
    case "bulletList":
      base.items = node.items.length;
      break;
    case "metricCard":
      base.label = node.label;
      base.value = node.value;
      break;
    case "row":
    case "column":
      base.children = node.children.map(nodeSummary);
      break;
  }
  return base;
}

function requireSlide(deck: Deck, slideId: string): Slide {
  const slide = deck.slides.find((s) => s.id === slideId);
  if (!slide) {
    throw new Error(
      `No slide "${slideId}". Slides: ${deck.slides.map((s) => s.id).join(", ")}`,
    );
  }
  return slide;
}

/** Slide templates so "make me a pitch deck" starts from structure, not void. */
function slideTemplate(deck: Deck, kind: string, name?: string): Slide {
  const sid = freshId(deck, "slide");
  const el = (p: string) => `${sid}-${p}`;
  const roots: Record<string, DeckNode> = {
    blank: { id: el("root"), type: "column", children: [] },
    title: {
      id: el("root"),
      type: "column",
      style: { justify: "center", gap: 24 },
      children: [
        { id: el("title"), type: "heading", text: name ?? "Title", level: 1 },
        {
          id: el("subtitle"),
          type: "text",
          text: "Subtitle",
          style: { color: "text-secondary" },
        },
      ],
    },
    bullets: {
      id: el("root"),
      type: "column",
      style: { gap: 32 },
      children: [
        { id: el("h"), type: "heading", text: name ?? "Section", level: 2 },
        { id: el("list"), type: "bulletList", items: ["First point"] },
      ],
    },
    metrics: {
      id: el("root"),
      type: "column",
      style: { gap: 32 },
      children: [
        { id: el("h"), type: "heading", text: name ?? "Metrics", level: 2 },
        {
          id: el("cards"),
          type: "row",
          style: { gap: 16 },
          children: [
            { id: el("m1"), type: "metricCard", label: "Metric", value: "0" },
            { id: el("m2"), type: "metricCard", label: "Metric", value: "0" },
            { id: el("m3"), type: "metricCard", label: "Metric", value: "0" },
          ],
        },
      ],
    },
    split: {
      id: el("root"),
      type: "column",
      style: { gap: 32 },
      children: [
        { id: el("h"), type: "heading", text: name ?? "Section", level: 2 },
        {
          id: el("cols"),
          type: "row",
          style: { gap: 32 },
          children: [
            { id: el("left"), type: "column", style: { gap: 16 }, children: [] },
            { id: el("right"), type: "column", style: { gap: 16 }, children: [] },
          ],
        },
      ],
    },
  };
  const root = roots[kind];
  if (!root) throw new Error(`Unknown template "${kind}". Use: ${Object.keys(roots).join(", ")}`);
  return { id: sid, name, root } as Slide;
}

const ElementInput = z
  .record(z.string(), z.unknown())
  .describe(
    'Element JSON, e.g. {"type":"heading","text":"Hi","level":2} or ' +
      '{"type":"metricCard","label":"ARR","value":"$4.2M","delta":"+12%"} or ' +
      '{"type":"row","style":{"gap":16},"children":[...]}. ' +
      "Omit ids — they are generated. Colors are token roles: " +
      COLOR_ROLES.join(", "),
  );

export function registerTools(
  server: McpServer,
  store: DeckStore,
  projectDir: string,
  library: Library,
) {
  // ---------- read ----------
  server.registerTool(
    "get_design_system",
    {
      description:
        "The active brand: resolved color tokens, fonts, size/spacing scales, component constraints, and available base themes. Read this before styling anything.",
      inputSchema: {},
    },
    async () =>
      ok({
        rev: store.rev,
        activeTheme: store.deck.theme,
        tokens: store.tokens,
        brand: store.tokens.brand ?? null,
        brandNote: store.tokens.brand
          ? "Write ALL slide copy in this brand's voice: honor tone, dos/donts and vocabulary. Use logos via image elements/overlays (src from brand.logos)."
          : "No brand section registered — consider register_theme with a brand block (voice, logos, imagery).",
        availableThemes: Object.keys(THEMES),
        customThemes: [...library.customThemes],
        templates: library.list(),
        componentRules: {
          metricCard:
            "value always renders accent color + bold at metricValue size; label auto-uppercases in text-secondary; only label/value/delta/background are settable",
          colors: "style.color/background take token ROLES; raw hex is snapped to the nearest brand token and reported as a correction",
          spacing: "padding/gap snap to spacingScale; fontSize snaps to fontSizeScale",
        },
      }),
  );

  server.registerTool(
    "get_deck",
    {
      description: "Deck overview: title, theme, revision, and a compact tree of every slide.",
      inputSchema: {},
    },
    async () =>
      ok({
        rev: store.rev,
        title: store.deck.title,
        theme: store.deck.theme,
        slides: store.deck.slides.map((s, i) => ({
          index: i,
          id: s.id,
          name: s.name,
          tree: nodeSummary(s.root),
        })),
      }),
  );

  server.registerTool(
    "get_slide",
    {
      description: "Full JSON of one slide plus layout warnings (overflow, autoshrink).",
      inputSchema: { slideId: z.string() },
    },
    async ({ slideId }) => {
      try {
        const slide = requireSlide(store.deck, slideId);
        const resolved = solveSlide(slide, store.tokens);
        return ok({ rev: store.rev, slide, layoutWarnings: resolved.warnings });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    "get_changes_since",
    {
      description:
        "The patch log after a revision — including edits the human made on the canvas (source: 'human') and what auto-correction rewrote. Call this to stay aware of manual changes.",
      inputSchema: { rev: z.number().int().min(0) },
    },
    async ({ rev }) => ok({ currentRev: store.rev, changes: store.changesSince(rev) }),
  );

  // ---------- slides ----------
  server.registerTool(
    "create_slide",
    {
      description:
        "Add a slide from a template: a built-in structural one (blank | title | bullets | metrics | split) or ANY registered library template by name (see list_templates). Library templates are instantiated with fresh ids.",
      inputSchema: {
        template: z.string().default("blank"),
        name: z.string().optional(),
        afterSlideId: z.string().optional(),
      },
    },
    async ({ template, name, afterSlideId }) => {
      try {
        let created = "";
        const result = store.mutate((draft) => {
          const slide = library.templates.has(template)
            ? { ...library.instantiate(draft, template), ...(name ? { name } : {}) }
            : slideTemplate(draft, template, name);
          created = slide.id;
          const at = afterSlideId
            ? draft.slides.findIndex((s) => s.id === afterSlideId) + 1
            : draft.slides.length;
          draft.slides.splice(at === 0 ? draft.slides.length : at, 0, slide);
        }, "ai");
        return summarize(result, {
          slideId: created,
          tree: nodeSummary(requireSlide(result.deck, created).root),
        });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  // ---------- design library ----------
  server.registerTool(
    "register_theme",
    {
      description:
        "Register a design system as a named theme, persisted in the project library and usable by set_theme. Easiest form: {name, base: 'corporate-bold', colors: {...hex by role}, fonts: {...}} — everything not given inherits from the base (including the validated chart palette). Full ThemeTokens documents are also accepted (omit base). Include a `brand` section for a MEANINGFUL system: {tagline, description, audience, voice: {tone, personality[], dos[], donts[], preferredTerms[], avoidTerms[], exampleCopy}, logos: [{name, src, usage}], imagery: {style, guidance}} — all copy you write should follow it.",
      inputSchema: {
        name: z.string(),
        base: z.string().optional(),
        brand: z.record(z.string(), z.unknown()).optional(),
        colors: z.record(z.string(), z.string()).optional(),
        fonts: z.record(z.string(), z.string()).optional(),
        fontSizes: z.record(z.string(), z.number()).optional(),
        radius: z.record(z.string(), z.number()).optional(),
        spacingScale: z.array(z.number()).optional(),
        fontSizeScale: z.array(z.number()).optional(),
        chartPalette: z.array(z.string()).optional(),
      },
    },
    async (input) => {
      try {
        const clean = Object.fromEntries(
          Object.entries(input).filter(([, v]) => v !== undefined),
        );
        const tokens = library.saveTheme(clean as { base?: string } & Record<string, unknown>);
        return ok({
          registered: tokens.name,
          tokens,
          note:
            "Activate with set_theme {base: '" +
            tokens.name +
            "'}. If you replaced chartPalette, re-validate it for colorblind safety (docs/CHART-PALETTES.md).",
        });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    "register_template",
    {
      description:
        "Register a reusable slide template from slide JSON ({root, overlays?, background?, padding?, ...}; element ids optional). Persisted in the project library; create_slide can then stamp it out by name any number of times.",
      inputSchema: {
        name: z.string(),
        description: z.string().optional(),
        tags: z.array(z.string()).optional(),
        slide: z.record(z.string(), z.unknown()),
      },
    },
    async ({ name, description, tags, slide }) => {
      try {
        const tpl = library.saveTemplate(name, slide, description, tags);
        return ok({ registered: tpl.name, templates: library.list() });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    "save_slide_as_template",
    {
      description:
        "Capture an existing slide of the current deck as a named library template — design once (AI or canvas), reuse forever.",
      inputSchema: {
        slideId: z.string(),
        name: z.string(),
        description: z.string().optional(),
        tags: z.array(z.string()).optional(),
      },
    },
    async ({ slideId, name, description, tags }) => {
      try {
        const slide = requireSlide(store.deck, slideId);
        const tpl = library.saveTemplate(name, slide, description, tags);
        return ok({ registered: tpl.name, templates: library.list() });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    "list_templates",
    {
      description:
        "List registered library templates with auto-derived structure facets, plus the built-in structural ones. Templates are REFERENCES: start from the closest one, then adapt content/structure freely with the element tools — or build from scratch when nothing fits. For big libraries prefer find_templates.",
      inputSchema: {},
    },
    async () =>
      ok({
        builtin: ["blank", "title", "bullets", "metrics", "split"],
        library: library.list(),
      }),
  );

  server.registerTool(
    "find_templates",
    {
      description:
        "Search the template library by intent (e.g. 'kpi dashboard', 'cover slide', 'roadmap timeline', 'comparison table'). Ranks by name/tags/description AND by derived structure (a query for 'kpis' finds slides containing metric cards even if never labeled). Returns scores + why each matched. Use the best hit as a baseline via create_slide, mix pieces across templates via copy_from_template, or ignore them all if the script calls for something custom.",
      inputSchema: {
        query: z.string(),
        limit: z.number().int().min(1).max(20).default(8),
      },
    },
    async ({ query, limit }) => {
      const results = library.find(query, limit);
      return ok({
        query,
        results,
        hint:
          results.length === 0
            ? "No matches — list_templates shows everything, or build the slide from scratch."
            : "Templates are baselines: instantiate then adapt, or copy_from_template to mix elements across them.",
      });
    },
  );

  server.registerTool(
    "copy_from_template",
    {
      description:
        "Mix-and-match: copy ONE element (and its children) from a template into an existing slide — e.g. pull the metric-card row from template A into a slide based on template B. Select by elementId or first-of elementType ('row','metricCard','chart','table','shape',...). Freeform source elements keep their frame and land in the overlay layer unless parentId targets a container.",
      inputSchema: {
        templateName: z.string(),
        slideId: z.string(),
        elementId: z.string().optional(),
        elementType: z.string().optional(),
        parentId: z.string().optional(),
        index: z.number().int().min(0).optional(),
      },
    },
    async ({ templateName, slideId, elementId, elementType, parentId, index }) => {
      try {
        if (!elementId && !elementType) throw new Error("Provide elementId or elementType");
        let newId = "";
        const result = store.mutate((draft) => {
          const slide = requireSlide(draft, slideId) as Slide & { overlays?: DeckNode[] };
          const source = library.findTemplateElement(templateName, { elementId, elementType });
          const withIds = assignIds(draft, source as unknown as Record<string, unknown>) as unknown as DeckNode;
          newId = withIds.id;
          if (withIds.frame && !parentId) {
            slide.overlays = [...(slide.overlays ?? []), withIds];
            return;
          }
          delete (withIds as { frame?: unknown }).frame;
          const parent = parentId
            ? [...walkSlide(slide, 0)].find((v) => v.node.id === parentId)?.node
            : slide.root;
          if (!parent) throw new Error(`No element "${parentId}" on slide "${slideId}"`);
          if (parent.type !== "row" && parent.type !== "column") {
            throw new Error(`Parent "${parent.id}" is a ${parent.type}, not a container`);
          }
          parent.children.splice(index ?? parent.children.length, 0, withIds);
        }, "ai");
        return summarize(result, { elementId: newId });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    "import_pptx_templates",
    {
      description:
        "Import an existing PowerPoint/Google Slides deck (.pptx — Google Slides: File → Download → .pptx) as library templates, one per slide: text, shapes, lines and embedded images land as freeform elements at their exact positions. Colors re-brand to the active tokens when a template is used. Charts/tables/gradient fills are skipped with notes.",
      inputSchema: {
        path: z.string().describe("Absolute path to the .pptx file"),
        namePrefix: z.string().optional().describe("Template names become '<prefix> N' (default: file name)"),
      },
    },
    async ({ path, namePrefix }) => {
      try {
        const imported = await importPptx(readFileSync(path));
        const prefix = namePrefix ?? path.split("/").pop()!.replace(/\.pptx$/i, "");
        const registered: Array<{ name: string; elements: number; notes: string[] }> = [];
        imported.forEach((imp, i) => {
          const name = `${prefix} ${i + 1}`;
          library.saveTemplate(name, imp.slide, `Imported from ${path.split("/").pop()}`);
          registered.push({ name, elements: imp.slide.overlays?.length ?? 0, notes: imp.notes });
        });
        return ok({ imported: registered.length, templates: registered });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    "delete_template",
    { description: "Remove a template from the project library.", inputSchema: { name: z.string() } },
    async ({ name }) => {
      try {
        library.deleteTemplate(name);
        return ok({ deleted: name, templates: library.list() });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    "delete_slide",
    { description: "Delete a slide by id.", inputSchema: { slideId: z.string() } },
    async ({ slideId }) => {
      try {
        const result = store.mutate((draft) => {
          requireSlide(draft, slideId);
          draft.slides = draft.slides.filter((s) => s.id !== slideId);
        }, "ai");
        return summarize(result);
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    "move_slide",
    {
      description: "Reorder a slide to a new index (0-based).",
      inputSchema: { slideId: z.string(), toIndex: z.number().int().min(0) },
    },
    async ({ slideId, toIndex }) => {
      try {
        const result = store.mutate((draft) => {
          const from = draft.slides.findIndex((s) => s.id === slideId);
          if (from < 0) throw new Error(`No slide "${slideId}"`);
          const [s] = draft.slides.splice(from, 1);
          draft.slides.splice(Math.min(toIndex, draft.slides.length), 0, s);
        }, "ai");
        return summarize(result, { order: result.deck.slides.map((s) => s.id) });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    "set_slide_props",
    {
      description: "Set slide name, background (token role), or padding (snapped to scale).",
      inputSchema: {
        slideId: z.string(),
        name: z.string().optional(),
        background: z.string().optional(),
        padding: z.number().optional(),
      },
    },
    async ({ slideId, name, background, padding }) => {
      try {
        const result = store.mutate((draft) => {
          const slide = requireSlide(draft, slideId);
          if (name !== undefined) slide.name = name;
          if (background !== undefined) slide.background = background;
          if (padding !== undefined) slide.padding = padding;
        }, "ai");
        return summarize(result);
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  // ---------- elements ----------
  server.registerTool(
    "add_element",
    {
      description:
        "Add an element to a slide. parentId targets a row/column container (defaults to the slide root); index positions it among siblings.",
      inputSchema: {
        slideId: z.string(),
        element: ElementInput,
        parentId: z.string().optional(),
        index: z.number().int().min(0).optional(),
      },
    },
    async ({ slideId, element, parentId, index }) => {
      try {
        let newId = "";
        const result = store.mutate((draft) => {
          const slide = requireSlide(draft, slideId);
          const parent = parentId
            ? [...walkSlide(slide, 0)].find((v) => v.node.id === parentId)?.node
            : slide.root;
          if (!parent) throw new Error(`No element "${parentId}" on slide "${slideId}"`);
          if (parent.type !== "row" && parent.type !== "column") {
            throw new Error(`Parent "${parent.id}" is a ${parent.type}, not a container`);
          }
          const withIds = assignIds(draft, element);
          newId = (withIds as { id: string }).id;
          parent.children.splice(index ?? parent.children.length, 0, withIds as DeckNode);
        }, "ai");
        return summarize(result, { elementId: newId });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    "edit_element",
    {
      description:
        "Update an element's content fields by id (text, level, items, label, value, delta, src, alt, size). Style goes through set_style.",
      inputSchema: { elementId: z.string(), updates: z.record(z.string(), z.unknown()) },
    },
    async ({ elementId, updates }) => {
      try {
        const allowed = new Set([
          "text", "level", "items", "ordered", "label", "value", "delta",
          "src", "alt", "fit", "size", "background",
          "shape", "fill", "gradient", "border", "shadow", "textStyle",
          "rows", "header", "columns",
          "chartType", "categories", "series", "legend", "dataLabels",
        ]);
        const result = store.mutate((draft) => {
          const visit = findNode(draft, elementId);
          if (!visit) throw new Error(`No element "${elementId}"`);
          for (const [k, v] of Object.entries(updates)) {
            if (!allowed.has(k)) throw new Error(`Field "${k}" is not editable here (allowed: ${[...allowed].join(", ")})`);
            (visit.node as unknown as Record<string, unknown>)[k] = v;
          }
        }, "ai");
        return summarize(result);
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    "set_style",
    {
      description:
        "Merge style knobs onto an element. Text elements: color/fontSize/bold/italic/align. Containers: background/padding/gap/radius/justify/align. Values snap to brand tokens/scales.",
      inputSchema: { elementId: z.string(), style: z.record(z.string(), z.unknown()) },
    },
    async ({ elementId, style }) => {
      try {
        const result = store.mutate((draft) => {
          const visit = findNode(draft, elementId);
          if (!visit) throw new Error(`No element "${elementId}"`);
          const node = visit.node as unknown as { style?: Record<string, unknown> };
          node.style = { ...(node.style ?? {}) };
          for (const [k, v] of Object.entries(style)) {
            if (v === null) delete node.style[k];
            else node.style[k] = v;
          }
        }, "ai");
        return summarize(result);
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    "set_sizing",
    {
      description:
        "Set layout sizing on an element: weight/widthPct (in rows), grow (in columns), height (fixed px, enables autoshrink). null clears.",
      inputSchema: { elementId: z.string(), sizing: z.record(z.string(), z.unknown()) },
    },
    async ({ elementId, sizing }) => {
      try {
        const result = store.mutate((draft) => {
          const visit = findNode(draft, elementId);
          if (!visit) throw new Error(`No element "${elementId}"`);
          const node = visit.node as unknown as { sizing?: Record<string, unknown> };
          node.sizing = { ...(node.sizing ?? {}) };
          for (const [k, v] of Object.entries(sizing)) {
            if (v === null) delete node.sizing[k];
            else node.sizing[k] = v;
          }
          if (Object.keys(node.sizing).length === 0) delete node.sizing;
        }, "ai");
        return summarize(result);
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    "delete_element",
    { description: "Delete an element by id.", inputSchema: { elementId: z.string() } },
    async ({ elementId }) => {
      try {
        const result = store.mutate((draft) => {
          const visit = findNode(draft, elementId);
          if (!visit) throw new Error(`No element "${elementId}"`);
          if (!visit.parent) throw new Error("Cannot delete a slide root; delete the slide instead");
          const siblings = (visit.parent as { children: DeckNode[] }).children;
          siblings.splice(siblings.findIndex((c) => c.id === elementId), 1);
        }, "ai");
        return summarize(result);
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    "set_animation",
    {
      description:
        "Set an entrance animation on any element: {effect: appear|fade|flyIn|zoom|wipe, direction?: left|right|top|bottom, order: 1.., byParagraph?: bool (bulletList: one bullet per click)}. Animating a container animates everything in it. null clears. Plays in the canvas Present mode AND in the exported pptx.",
      inputSchema: {
        elementId: z.string(),
        animation: z.record(z.string(), z.unknown()).nullable(),
      },
    },
    async ({ elementId, animation }) => {
      try {
        const result = store.mutate((draft) => {
          const visit = findNode(draft, elementId);
          if (!visit) throw new Error(`No element "${elementId}"`);
          const node = visit.node as unknown as Record<string, unknown>;
          if (animation === null) delete node.animation;
          else node.animation = animation;
        }, "ai");
        return summarize(result);
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    "set_transition",
    {
      description:
        "Set a slide's enter transition: {type: none|fade|push|wipe, direction?: left|right|top|bottom}.",
      inputSchema: { slideId: z.string(), transition: z.record(z.string(), z.unknown()).nullable() },
    },
    async ({ slideId, transition }) => {
      try {
        const result = store.mutate((draft) => {
          const slide = requireSlide(draft, slideId);
          if (transition === null) delete (slide as Record<string, unknown>).transition;
          else (slide as Record<string, unknown>).transition = transition;
        }, "ai");
        return summarize(result);
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    "set_notes",
    {
      description: "Set presenter notes on a slide (exported into the pptx notes pane).",
      inputSchema: { slideId: z.string(), notes: z.string() },
    },
    async ({ slideId, notes }) => {
      try {
        const result = store.mutate((draft) => {
          const slide = requireSlide(draft, slideId);
          (slide as Record<string, unknown>).notes = notes;
        }, "ai");
        return summarize(result);
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    "add_overlay",
    {
      description:
        "Add a freeform element to a slide's overlay layer at an absolute frame {x,y,w,h} on the 1280×720 canvas — Google-Slides-style free placement, painted above the flow layout. Any element type works (shape, text, image, table, column...).",
      inputSchema: {
        slideId: z.string(),
        element: ElementInput,
        frame: z.object({
          x: z.number(),
          y: z.number(),
          w: z.number(),
          h: z.number(),
        }),
      },
    },
    async ({ slideId, element, frame }) => {
      try {
        let newId = "";
        const result = store.mutate((draft) => {
          const slide = requireSlide(draft, slideId) as Record<string, unknown>;
          const withIds = assignIds(draft, { ...element, frame });
          newId = (withIds as { id: string }).id;
          slide.overlays = [...((slide.overlays as unknown[]) ?? []), withIds];
        }, "ai");
        return summarize(result, { elementId: newId });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    "set_frame",
    {
      description:
        "Move/resize a freeform overlay element: absolute {x,y,w,h} on the 1280×720 canvas (clamped to bounds).",
      inputSchema: {
        elementId: z.string(),
        frame: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
      },
    },
    async ({ elementId, frame }) => {
      try {
        const result = store.mutate((draft) => {
          const visit = findNode(draft, elementId);
          if (!visit) throw new Error(`No element "${elementId}"`);
          (visit.node as unknown as Record<string, unknown>).frame = frame;
        }, "ai");
        return summarize(result);
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  // ---------- theme / deck ----------
  server.registerTool(
    "set_theme",
    {
      description:
        "Set the base theme (corporate-bold | minimalist-dark) and/or brand overrides — this is where a company registers its hex codes and font choices. Overrides: {colors: {accent: '#ff0055', ...}, fonts: {heading: 'serif'|'sans'}}.",
      inputSchema: {
        base: z.string().optional(),
        overrides: z.record(z.string(), z.unknown()).optional(),
      },
    },
    async ({ base, overrides }) => {
      try {
        const result = store.mutate((draft) => {
          draft.theme = {
            base: base ?? draft.theme.base,
            ...(overrides !== undefined
              ? { overrides: overrides as never }
              : draft.theme.overrides
                ? { overrides: draft.theme.overrides }
                : {}),
          };
        }, "ai");
        return summarize(result, { tokens: result.tokens });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    "set_deck_title",
    { description: "Set the deck title (used for the pptx filename/metadata).", inputSchema: { title: z.string() } },
    async ({ title }) => {
      try {
        const result = store.mutate((draft) => {
          draft.title = title;
        }, "ai");
        return summarize(result);
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  // ---------- export ----------
  server.registerTool(
    "export_pptx",
    {
      description:
        "Compile the deck to a .pptx of native editable shapes/text, identical to the canvas preview. Opens in PowerPoint directly; for Google Slides upload to Drive or use File → Import slides — fonts are Slides built-ins so import is lossless.",
      inputSchema: { path: z.string().optional() },
    },
    async ({ path }) => {
      try {
        const safe = store.deck.title.replace(/[^a-z0-9-_ ]/gi, "").trim() || "deck";
        const outPath = path ?? join(projectDir, "out", `${safe}.pptx`);
        const resolved = await compileDeckToFile(store.deck, outPath);
        const warnings = resolved.flatMap((s) => s.warnings.map((w) => `${s.id}: ${w}`));
        return ok({ rev: store.rev, path: outPath, slides: resolved.length, layoutWarnings: warnings });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  // ---------- resources ----------
  server.registerResource(
    "design-tokens",
    "design-system://tokens",
    { description: "Resolved brand tokens for the active theme", mimeType: "application/json" },
    async (uri) => ({
      contents: [{ uri: uri.href, text: JSON.stringify(store.tokens, null, 2) }],
    }),
  );

  server.registerResource(
    "design-templates",
    "design-system://templates",
    { description: "Registered slide templates in the project library", mimeType: "application/json" },
    async (uri) => ({
      contents: [{ uri: uri.href, text: JSON.stringify(library.list(), null, 2) }],
    }),
  );

  server.registerResource(
    "deck-current",
    "deck://current",
    { description: "The full current deck JSON (source of truth)", mimeType: "application/json" },
    async (uri) => ({
      contents: [
        { uri: uri.href, text: JSON.stringify({ rev: store.rev, deck: store.deck }, null, 2) },
      ],
    }),
  );
}

/** Deep-assign fresh ids to an element (and children) that lack them. */
function assignIds(deck: Deck, element: Record<string, unknown>): Record<string, unknown> {
  const clone = structuredClone(element);
  const used = new Set<string>();
  const visit = (el: Record<string, unknown>) => {
    if (typeof el.id !== "string" || el.id === "") {
      const prefix = typeof el.type === "string" ? (el.type as string) : "el";
      let id = freshId(deck, prefix);
      while (used.has(id)) id = `${id}x`;
      el.id = id;
    }
    used.add(el.id as string);
    if (Array.isArray(el.children)) {
      for (const c of el.children) visit(c as Record<string, unknown>);
    }
  };
  visit(clone);
  return clone;
}
