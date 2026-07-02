# Deckforge

**AI-native presentation builder.** An AI assistant and a visual editor work on
the same live deck — the AI through MCP tools, you through a Retool-style
canvas — and everything obeys your design system. Export a `.pptx` that matches
the preview and opens fully editable in PowerPoint or Google Slides.

```
you: "make me a 5-slide pitch deck from this brief, in our brand"
         │
   AI (MCP tools) ──┐
                    ├─→ one validated deck state ─→ live canvas (edit anything)
   you (canvas) ────┘                            └→ .pptx / Present mode
```

## Quick start

```bash
npm install
npm run build:canvas     # build the visual editor (once)
npm run serve            # → http://localhost:4820
npm test                 # 74 tests
```

Connect an AI (Claude Desktop / Claude Code — MCP over stdio):

```json
{
  "mcpServers": {
    "deckforge": {
      "command": "npx",
      "args": ["tsx", "/path/to/Deckforge/packages/server/src/main.ts", "/path/to/your/project", "--stdio"]
    }
  }
}
```

One process serves both the AI tools and the canvas at `localhost:4820` — both
edit the same live deck. Everything persists in your project dir:
`deck.v2.json` (the deck) and `library/` (your themes and templates).

## How it works

1. **One source of truth.** The deck is a JSON tree of slides and elements.
   Every edit — AI tool call or canvas knob — becomes a JSON Patch that is
   schema-validated, brand-corrected, applied, logged, and broadcast live.
2. **The brand engine.** Colors are token roles (`accent`, `surface`…), sizes
   snap to scales. Off-brand values (a raw hex, a 13px padding) are snapped to
   the nearest brand standard and the correction is reported — to the AI and
   on screen. Nobody can break the design system, including the AI.
3. **Deterministic layout.** A solver resolves every slide to absolute boxes
   on a 1280×720 canvas using precomputed font metrics. The web preview and
   the .pptx are drawn from the same boxes, so they match by construction.
4. **Mutual awareness.** The AI reads what you changed (`get_changes_since`);
   the canvas re-renders what the AI changed over WebSocket, instantly.
5. **Real export.** Native shapes, editable text, real tables, real editable
   charts, speaker notes — plus slide transitions and entrance animations
   written into the PowerPoint file itself. Google Slides imports it cleanly
   (fonts are Slides built-ins).

## What you can put on a slide

- **Text:** headings, paragraphs, bullet/numbered lists — font (sans/serif/mono),
  size, color, bold/italic/underline, alignment, line height, letter spacing,
  uppercase; inline editing by double-click.
- **Layout:** rows and columns (weights, grow, justify/align, padding, gap),
  margins on *any* element, spacers, or **freeform**: drag anything anywhere
  with absolute positioning.
- **Shapes:** rect, roundRect, ellipse, triangle, diamond, chevron, arrow,
  pill, line — with labels, token fills, gradients, borders, shadows.
- **Data:** metric cards (brand-locked accent values), brand-styled tables,
  and **charts** (column, bar, line, area, pie, donut) with colorblind-validated
  palettes — exported as native editable PowerPoint charts
  ([docs/chart-palettes.md](docs/chart-palettes.md)).
- **Media:** images (URL or upload, cover/contain, embedded in the export).
- **Motion:** entrance animations (appear, fade, fly-in, zoom, wipe) with
  click ordering and per-bullet reveals; slide transitions (fade, push, wipe).
  Play them with ▶ Present; they also run in PowerPoint's slideshow.
- **Notes:** presenter notes, exported to the notes pane.

## Design systems & templates

- **Register a brand once:** `register_theme {name: "acme", base:
  "corporate-bold", colors: {accent: "#d81b60", ...}, fonts: {...}}` — anything
  you don't specify inherits from the base. Persisted in `library/themes/`,
  usable by name from then on. Two themes ship built-in: `corporate-bold` and
  `minimalist-dark`.
- **Build a template library at any scale:** register slide JSON
  (`register_template`), save any slide you've designed
  (`save_slide_as_template`, or the button in the canvas), or **import
  existing PowerPoint / Google Slides decks** (`import_pptx_templates`, or
  ⬆ Import .pptx in the canvas — for Google Slides use File → Download →
  .pptx). One template per slide, elements at their exact positions; imported
  colors re-brand to your tokens automatically.
- **Use them:** `create_slide {template: "kpi-trio"}` from the AI, or the
  "+ from template…" picker in the canvas. Templates stamp out with fresh ids,
  as many times as you like.

## MCP tools (24)

| Area | Tools |
|---|---|
| Read | `get_design_system` · `get_deck` · `get_slide` · `get_changes_since` |
| Slides | `create_slide` · `delete_slide` · `move_slide` · `set_slide_props` · `set_transition` · `set_notes` |
| Elements | `add_element` · `edit_element` · `set_style` · `set_sizing` · `delete_element` |
| Freeform | `add_overlay` · `set_frame` |
| Motion | `set_animation` |
| Library | `register_theme` · `register_template` · `save_slide_as_template` · `import_pptx_templates` · `list_templates` · `delete_template` |
| Brand / export | `set_theme` · `set_deck_title` · `export_pptx` |

Resources: `design-system://tokens` · `design-system://templates` · `deck://current`

## Repo layout

```
packages/schema        deck + token schema (Zod)
packages/themes        theme registry + built-ins
packages/validate      brand auto-correction engine
packages/layout        deterministic layout solver + font metrics
packages/compile-pptx  OpenXML compiler + animation/gradient injector
packages/server        state store, MCP tools, HTTP/WS, library, pptx import
packages/canvas        React visual editor
e2e/pitch-demo.ts      full journey test (AI builds → human edits → export)
docs/architecture.md   how and why it's built this way
```

## Known limits

Entrance animations only (no exit/emphasis); three font families (layout
determinism requires shipped metrics); charts are semantically — not
pixel — identical to the preview (PowerPoint draws its own axes); no
multi-user editing yet.
