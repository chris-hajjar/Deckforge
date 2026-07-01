# Deckforge v2

**Retool for presentations.** An MCP server holds a validated JSON deck as the
single source of truth; an AI assistant builds and edits it through tools; a
live canvas app beside the chat lets you click any element and turn
brand-constrained knobs; and Export produces a `.pptx` of native editable
shapes that matches the preview exactly — open it in PowerPoint, or import it
into Google Slides losslessly.

```
AI tool call ─┐
              ├→ JSON Patch → validate → auto-correct → apply → broadcast (WS)
canvas knob ──┘                                            │
                                              deterministic layout solver
                                                │                     │
                                          canvas renders        .pptx compiles
                                          the same boxes        the same boxes
```

Full design rationale: [docs/V2-ARCHITECTURE.md](docs/V2-ARCHITECTURE.md).
(v1 lives in [legacy/](legacy/).)

## Why the preview and the .pptx are identical

Deckforge owns layout. A deterministic solver (with precomputed font metrics —
no browser, no font files at runtime) resolves the deck tree into absolute
boxes on a 1280×720 canvas. The web canvas renders those boxes as positioned
divs; the pptx compiler emits shapes at the same coordinates. The golden tests
unzip the OpenXML and assert the EMU coordinates equal the solver's output.

## Quick start

```bash
npm install
npm run build:canvas          # build the visual editor once
npm run serve                 # http://localhost:4820 — canvas + API + WS
npm test                      # 45 tests across all packages
npx tsx e2e/pitch-demo.ts     # full journey: AI builds a deck, human edits, export
```

### Hook up an AI (MCP over stdio)

Register in Claude Desktop / Claude Code:

```json
{
  "mcpServers": {
    "deckforge": {
      "command": "npx",
      "args": ["tsx", "/abs/path/Deckforge/packages/server/src/main.ts", "/abs/path/to/your/deck/project", "--stdio"]
    }
  }
}
```

One process serves both the MCP tools and the canvas — the AI and the human
edit the same live state. The deck persists as `deck.v2.json` in the project
dir.

## The pieces

| Package | What it is |
|---|---|
| `packages/schema` | Zod deck tree (rows/columns + semantic components), token vocabulary, tree utils |
| `packages/themes` | `corporate-bold`, `minimalist-dark` — themes are token sets as data |
| `packages/validate` | Auto-correction: raw hex → nearest brand token, spacing/font sizes → brand scales |
| `packages/layout` | Deterministic solver: tree → absolute boxes; text metrics; autoshrink |
| `packages/compile-pptx` | Boxes → native OpenXML shapes/text via pptxgenjs |
| `packages/server` | DeckStore (one write path, patch log), 15 MCP tools, HTTP/WS |
| `packages/canvas` | React editor: renderer, slide rail, inspector, inline text edit |

## MCP tools

**Read:** `get_design_system`, `get_deck`, `get_slide`, `get_changes_since`
**Slides:** `create_slide` (templates: title/bullets/metrics/split/blank), `delete_slide`, `move_slide`, `set_slide_props`, `set_transition`, `set_notes`
**Elements:** `add_element`, `edit_element`, `set_style`, `set_sizing`, `delete_element`
**Freeform:** `add_overlay` (absolute placement), `set_frame` (move/resize)
**Motion:** `set_animation` (appear/fade/flyIn/zoom/wipe, click order, per-bullet)
**Brand:** `set_theme` (base + hex overrides = brand registration), `set_deck_title`
**Export:** `export_pptx`

## Slide customization

Element types: `heading`, `text`, `bulletList` (bullets or numbered), `metricCard`,
`image` (embedded, cover/contain), `shape` (rect, roundRect, ellipse, triangle,
diamond, chevron, rightArrow, pill, line — with labels, gradients, borders,
shadows), `table` (native, brand-styled header + zebra), `chart` (column, bar,
line, area, pie, donut — exported as native editable PowerPoint charts, series
colors from a colorblind-validated per-theme palette, see
[docs/CHART-PALETTES.md](docs/CHART-PALETTES.md)), `row`/`column`, `spacer`.

Spacing anywhere: besides container `padding`/`gap`, slide `padding` and
`spacer` elements, **every element takes `sizing.margin`**
(`{top, bottom, left, right}`) — snapped to the brand spacing scale, editable
from the inspector's margin grid on any selected element.

Styling: token colors, two-stop gradients, borders, shadows, corner radius,
per-element font (sans/serif/mono), lineHeight, letterSpacing, uppercase,
underline, bold/italic, alignment — all snapped to brand scales by the
auto-correction engine.

Freeform: every slide has an overlay layer where elements carry an absolute
frame; drag to move, corner-handle to resize on the canvas.

Animations: entrance effects with click ordering (`flyIn` a whole row of cards,
reveal a list one bullet per click) and slide transitions (fade/push/wipe).
These play in the canvas **Present mode** (▶) and are written into the .pptx
as real PowerPoint animation timing trees — the same clicks work in a
PowerPoint slideshow. Speaker notes export to the notes pane.

**Resources:** `design-system://tokens`, `deck://current`

## Brand enforcement (the auto-correction engine)

Styles reference token *roles* (`"accent"`, `"surface"`), never raw values.
If the AI — or a human on a canvas slider — supplies an off-brand value, the
server snaps it to the nearest brand standard and reports the correction to
both sides:

```json
{ "field": "color", "from": "#7a2ee8", "to": "accent",
  "reason": "raw color snapped to nearest brand token \"accent\"" }
```

Component constraints are hard: a `MetricCard`'s value always renders in the
accent color, bold, at the brand's metric size — there is no knob to break it.

## Bi-directional awareness

Canvas edits are JSON Patch ops through the same pipeline the AI uses; the AI
calls `get_changes_since(rev)` and sees `{ source: "human", patches: [...] }`.
Nobody ever works from a stale picture.

## Google Slides

The export uses only features Slides imports cleanly (plain shapes, text
frames, standard bullets) and only fonts built into both PowerPoint and Google
Slides (Arial, Georgia). Upload the `.pptx` to Drive and open it, or use
File → Import slides.
