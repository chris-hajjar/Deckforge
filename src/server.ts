#!/usr/bin/env node
/**
 * server.ts — deckforge MCP server.
 *
 * Agent edits a validated deck.json tree; every mutation regenerates src/App.jsx.
 * Friendly tool names: create_slide, edit_slide, add_element, set_element_style,
 * set_element_animation, set_slide_transition, set_theme, etc.
 *
 * Usage (stdio): node dist/server.js /abs/path/to/spectacle-project
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";

import {
  DeckSchema,
  ElementSchema,
  SlideSchema,
  ThemeSchema,
  newDeck,
  type Deck,
} from "./model.js";
import { renderAppJsx } from "./codegen.js";

const PROJECT = resolve(process.argv[2] ?? process.cwd());
const DECK_PATH = join(PROJECT, "deck.json");
const APP_JSX = join(PROJECT, "src", "App.jsx");

let devProc: ChildProcess | null = null;

// ---------- persistence ----------
function load(): Deck {
  if (!existsSync(DECK_PATH)) return newDeck();
  return DeckSchema.parse(JSON.parse(readFileSync(DECK_PATH, "utf8")));
}
function commit(deck: Deck): string {
  const parsed = DeckSchema.parse(deck); // throws on invalid
  const jsx = renderAppJsx(parsed); // throws on bad element
  writeFileSync(DECK_PATH, JSON.stringify(parsed, null, 2));
  mkdirSync(dirname(APP_JSX), { recursive: true });
  writeFileSync(APP_JSX, jsx);
  return `${parsed.slides.length} slides written`;
}
function findSlide(deck: Deck, slideId: string) {
  const i = deck.slides.findIndex((s) => s.id === slideId);
  if (i < 0) throw new Error(`No slide with id "${slideId}". Use list_slides.`);
  return i;
}
function genId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}
function err(e: unknown): { content: { type: "text"; text: string }[] } {
  const msg = e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : String(e);
  return { content: [{ type: "text", text: `Error: ${msg}` }] };
}
function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

const server = new McpServer({ name: "deckforge", version: "0.1.0" });

// ---------- read tools ----------
server.tool("list_slides", "List every slide: id, layout, and element count.", {}, async () => {
  try {
    const deck = load();
    if (!deck.slides.length) return ok("Deck is empty.");
    const lines = deck.slides.map((s, i) => {
      const head = s.elements.find((e: any) => e.kind === "heading") as any;
      const label = head?.text ?? `(${s.elements.length} elements)`;
      return `${i}. [${s.id}] layout=${s.layout} — ${label}`;
    });
    return ok(lines.join("\n"));
  } catch (e) {
    return err(e);
  }
});

server.tool(
  "get_slide",
  "Return the full JSON of one slide by its id.",
  { slide_id: z.string() },
  async ({ slide_id }) => {
    try {
      const deck = load();
      return ok(JSON.stringify(deck.slides[findSlide(deck, slide_id)], null, 2));
    } catch (e) {
      return err(e);
    }
  }
);

// ---------- slide CRUD ----------
server.tool(
  "create_slide",
  "Create a new slide. layout: center|top|left. Returns the new slide id. " +
    "Add content with add_element. position<0 appends.",
  {
    layout: z.enum(["center", "top", "left"]).default("center"),
    position: z.number().int().default(-1),
    background_color: z.string().optional(),
  },
  async ({ layout, position, background_color }) => {
    try {
      const deck = load();
      const slide = {
        id: genId("slide"),
        layout,
        elements: [],
        ...(background_color ? { backgroundColor: background_color } : {}),
      };
      if (position < 0 || position >= deck.slides.length) deck.slides.push(slide as any);
      else deck.slides.splice(position, 0, slide as any);
      commit(deck);
      return ok(`Created slide "${slide.id}" (layout=${layout}).`);
    } catch (e) {
      return err(e);
    }
  }
);

server.tool(
  "delete_slide",
  "Delete a slide by id.",
  { slide_id: z.string() },
  async ({ slide_id }) => {
    try {
      const deck = load();
      const i = findSlide(deck, slide_id);
      deck.slides.splice(i, 1);
      commit(deck);
      return ok(`Deleted "${slide_id}". ${deck.slides.length} slides remain.`);
    } catch (e) {
      return err(e);
    }
  }
);

server.tool(
  "move_slide",
  "Reorder a slide to a new index (0-based).",
  { slide_id: z.string(), to_index: z.number().int() },
  async ({ slide_id, to_index }) => {
    try {
      const deck = load();
      const i = findSlide(deck, slide_id);
      const [s] = deck.slides.splice(i, 1);
      const clamped = Math.max(0, Math.min(to_index, deck.slides.length));
      deck.slides.splice(clamped, 0, s);
      commit(deck);
      return ok(`Moved "${slide_id}" to index ${clamped}.`);
    } catch (e) {
      return err(e);
    }
  }
);

server.tool(
  "set_slide_transition",
  "Set a slide's enter/exit transition: none|fade|slide|zoom.",
  { slide_id: z.string(), transition: z.enum(["none", "fade", "slide", "zoom"]) },
  async ({ slide_id, transition }) => {
    try {
      const deck = load();
      (deck.slides[findSlide(deck, slide_id)] as any).transition = transition;
      commit(deck);
      return ok(`Set transition of "${slide_id}" to ${transition}.`);
    } catch (e) {
      return err(e);
    }
  }
);

server.tool(
  "set_slide_layout",
  "Set a slide's content alignment: center|top|left.",
  { slide_id: z.string(), layout: z.enum(["center", "top", "left"]) },
  async ({ slide_id, layout }) => {
    try {
      const deck = load();
      (deck.slides[findSlide(deck, slide_id)] as any).layout = layout;
      commit(deck);
      return ok(`Set layout of "${slide_id}" to ${layout}.`);
    } catch (e) {
      return err(e);
    }
  }
);

// ---------- element CRUD ----------
server.tool(
  "add_element",
  "Add an element to a slide. element_json is a JSON object with a `kind` field: " +
    "heading|text|list|code|image|box|columns|spacer. `id` is auto-filled if omitted. " +
    "Optional `style` and `animation` on any element. position<0 appends.",
  { slide_id: z.string(), element_json: z.string(), position: z.number().int().default(-1) },
  async ({ slide_id, element_json, position }) => {
    try {
      const deck = load();
      const i = findSlide(deck, slide_id);
      const obj = JSON.parse(element_json);
      if (!obj.id) obj.id = genId("el");
      const el = ElementSchema.parse(obj); // validate
      const els = deck.slides[i].elements as any[];
      if (position < 0 || position >= els.length) els.push(el);
      else els.splice(position, 0, el);
      commit(deck);
      return ok(`Added ${obj.kind} element "${obj.id}" to "${slide_id}".`);
    } catch (e) {
      return err(e);
    }
  }
);

server.tool(
  "edit_element",
  "Replace an element (matched by its id) anywhere in a slide with new element_json.",
  { slide_id: z.string(), element_id: z.string(), element_json: z.string() },
  async ({ slide_id, element_id, element_json }) => {
    try {
      const deck = load();
      const i = findSlide(deck, slide_id);
      const obj = JSON.parse(element_json);
      obj.id = element_id;
      const el = ElementSchema.parse(obj);
      const replaced = replaceById(deck.slides[i].elements as any[], element_id, el);
      if (!replaced) throw new Error(`No element "${element_id}" in "${slide_id}".`);
      commit(deck);
      return ok(`Edited element "${element_id}".`);
    } catch (e) {
      return err(e);
    }
  }
);

server.tool(
  "delete_element",
  "Delete an element by id from a slide.",
  { slide_id: z.string(), element_id: z.string() },
  async ({ slide_id, element_id }) => {
    try {
      const deck = load();
      const i = findSlide(deck, slide_id);
      const removed = deleteById(deck.slides[i].elements as any[], element_id);
      if (!removed) throw new Error(`No element "${element_id}" in "${slide_id}".`);
      commit(deck);
      return ok(`Deleted element "${element_id}".`);
    } catch (e) {
      return err(e);
    }
  }
);

server.tool(
  "set_element_style",
  "Merge style properties into an element. style_json e.g. " +
    '{"color":"#f59e0b","fontSize":48,"textAlign":"center"}. Pass {} fields to override.',
  { slide_id: z.string(), element_id: z.string(), style_json: z.string() },
  async ({ slide_id, element_id, style_json }) => {
    try {
      const deck = load();
      const i = findSlide(deck, slide_id);
      const patch = JSON.parse(style_json);
      const el = findElById(deck.slides[i].elements as any[], element_id);
      if (!el) throw new Error(`No element "${element_id}".`);
      el.style = { ...(el.style ?? {}), ...patch };
      ElementSchema.parse(el); // re-validate merged result
      commit(deck);
      return ok(`Updated style of "${element_id}".`);
    } catch (e) {
      return err(e);
    }
  }
);

server.tool(
  "set_element_animation",
  "Set an element's animation. animation_json e.g. {\"appear\":true,\"priority\":1}. " +
    "appear wraps it so it reveals on click; priority orders multiple reveals.",
  { slide_id: z.string(), element_id: z.string(), animation_json: z.string() },
  async ({ slide_id, element_id, animation_json }) => {
    try {
      const deck = load();
      const i = findSlide(deck, slide_id);
      const anim = JSON.parse(animation_json);
      const el = findElById(deck.slides[i].elements as any[], element_id);
      if (!el) throw new Error(`No element "${element_id}".`);
      el.animation = { ...(el.animation ?? {}), ...anim };
      ElementSchema.parse(el);
      commit(deck);
      return ok(`Updated animation of "${element_id}".`);
    } catch (e) {
      return err(e);
    }
  }
);

// ---------- theme ----------
server.tool(
  "set_theme",
  "Replace the deck theme. theme_json: { colors:{...}, fonts:{...}, fontSizes:{...} }. " +
    "Colors commonly: primary (text), secondary (accent), tertiary (background).",
  { theme_json: z.string() },
  async ({ theme_json }) => {
    try {
      const deck = load();
      deck.theme = ThemeSchema.parse(JSON.parse(theme_json));
      commit(deck);
      return ok("Theme updated.");
    } catch (e) {
      return err(e);
    }
  }
);

server.tool(
  "set_theme_color",
  "Set a single theme color by name (e.g. secondary=#f59e0b) without replacing the whole theme.",
  { name: z.string(), value: z.string() },
  async ({ name, value }) => {
    try {
      const deck = load();
      deck.theme.colors = { ...(deck.theme.colors ?? {}), [name]: value };
      commit(deck);
      return ok(`Set theme color ${name}=${value}.`);
    } catch (e) {
      return err(e);
    }
  }
);

// ---------- render / dev / export ----------
server.tool("render", "Force-regenerate src/App.jsx from deck.json.", {}, async () => {
  try {
    return ok(commit(load()));
  } catch (e) {
    return err(e);
  }
});

server.tool("start_dev_server", "Start `npm run dev` in the background.", {}, async () => {
  try {
    if (devProc && devProc.exitCode === null) return ok("Dev server already running.");
    commit(load());
    devProc = spawn("npm", ["run", "dev"], { cwd: PROJECT, stdio: "ignore", detached: false });
    return ok("Dev server starting — usually http://localhost:5173");
  } catch (e) {
    return err(e);
  }
});

server.tool("stop_dev_server", "Stop the background dev server.", {}, async () => {
  if (devProc && devProc.exitCode === null) {
    devProc.kill();
    devProc = null;
    return ok("Dev server stopped.");
  }
  return ok("No dev server running.");
});

server.tool("export_pdf", "Run `npm run export` to produce a PDF.", {}, async () => {
  try {
    commit(load());
    const r = spawnSync("npm", ["run", "export"], { cwd: PROJECT, encoding: "utf8", timeout: 180000 });
    if (r.status !== 0) return ok(`Export failed:\n${(r.stderr ?? "").slice(-800)}`);
    return ok("Exported. Check the project directory for the PDF.");
  } catch (e) {
    return err(e);
  }
});

// ---------- tree helpers (recurse into box.children and columns.columns) ----------
function findElById(els: any[], id: string): any | null {
  for (const el of els) {
    if (el.id === id) return el;
    if (el.kind === "box") {
      const f = findElById(el.children, id);
      if (f) return f;
    }
    if (el.kind === "columns") {
      for (const col of el.columns) {
        const f = findElById(col, id);
        if (f) return f;
      }
    }
  }
  return null;
}
function replaceById(els: any[], id: string, repl: any): boolean {
  for (let i = 0; i < els.length; i++) {
    if (els[i].id === id) {
      els[i] = repl;
      return true;
    }
    if (els[i].kind === "box" && replaceById(els[i].children, id, repl)) return true;
    if (els[i].kind === "columns") {
      for (const col of els[i].columns) if (replaceById(col, id, repl)) return true;
    }
  }
  return false;
}
function deleteById(els: any[], id: string): boolean {
  for (let i = 0; i < els.length; i++) {
    if (els[i].id === id) {
      els.splice(i, 1);
      return true;
    }
    if (els[i].kind === "box" && deleteById(els[i].children, id)) return true;
    if (els[i].kind === "columns") {
      for (const col of els[i].columns) if (deleteById(col, id)) return true;
    }
  }
  return false;
}

const transport = new StdioServerTransport();
await server.connect(transport);
