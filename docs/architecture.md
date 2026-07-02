# Architecture

Deckforge is "Retool for presentations": one validated JSON deck is the single
source of truth; an AI edits it through MCP tools, a human edits it through a
live canvas, and both flow through the same pipeline.

## One write path

```
AI tool call ─┐
              ├─→ JSON Patch → schema validate → brand auto-correct → apply
canvas knob ──┘                                                        │
                                                    rev++ · patch log · persist
                                                        │
                                                broadcast over WebSocket
```

- Tools mutate a draft; the store diffs it into RFC-6902 patches. Canvas
  controls emit patches directly. Same pipeline, so undo, sync, and brand
  enforcement behave identically for both.
- The patch log is the awareness channel: the AI calls `get_changes_since`
  and sees exactly what the human changed (`source: "human"`), and vice versa
  via the WS broadcast.
- Auto-correction (packages/validate) snaps every off-brand value — raw hex
  colors, off-scale padding/margins/font sizes, illegal component props — to
  the nearest brand token and reports the correction to the caller.

## Deterministic layout = identical export

The solver (packages/layout) resolves the tree into absolute boxes on a fixed
1280×720 canvas, measuring text with precomputed font-metrics tables
(Liberation fonts ≈ Arial/Georgia/Courier New) — no browser, no font files at
runtime. The canvas renders those boxes as positioned divs/SVG; the pptx
compiler emits native shapes at the same coordinates. Preview and export
match by construction (golden tests assert the EMU coordinates in the
OpenXML equal the solver's output). The one exception is charts, which export
as native *editable* PowerPoint charts — same data/colors/labels, but
PowerPoint draws its own axes.

## Beyond pptxgenjs: the XML injector

pptxgenjs can't express slide transitions, entrance animations, or gradient
fills. `compile-pptx/src/animate.ts` post-processes the zip and injects
`<p:transition>`, `<p:timing>` click-sequence trees (including per-bullet
paragraph builds), and `<a:gradFill>` directly — output stays standard
OpenXML that PowerPoint and Google Slides import. Present mode in the canvas
shares the reveal-plan code (`layout/src/steps.ts`), so on-screen clicks and
PowerPoint clicks reveal the same things in the same order.

## The design library

`<project>/library/` persists across sessions:

- `themes/*.json` — full token sets. Registered themes join the same registry
  as the built-ins, so validation/layout/export resolve them uniformly.
  `register_theme {name, base, colors…}` layers a brand over a base theme.
- `templates/*.json` — complete slides. `create_slide {template}` stamps one
  out with fresh ids. Templates come from JSON, from `save_slide_as_template`
  (design once on canvas, reuse forever), or from `import_pptx_templates`,
  which parses an existing PowerPoint/Google Slides file into positioned
  elements. Imported raw colors re-brand to tokens on use.

## Packages

| Package | Role |
|---|---|
| `schema` | Zod deck tree, token vocabulary, walk utilities |
| `themes` | theme registry + built-ins (corporate-bold, minimalist-dark) |
| `validate` | auto-correction engine |
| `layout` | deterministic solver, font metrics, reveal plans |
| `compile-pptx` | boxes → native OpenXML + animation/gradient injector |
| `server` | DeckStore, MCP tools, HTTP/WS, library, pptx importer |
| `canvas` | React editor: renderer, inspector, Present mode |

`schema`/`validate`/`layout`/`compile-pptx` are pure libraries — unit-tested
without a server or browser. The e2e script (`e2e/pitch-demo.ts`) drives the
whole system: a real MCP client builds a deck, Chromium edits it, and the
export is verified by unzipping the XML and rendering via LibreOffice.
