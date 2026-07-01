# deckforge-mcp

A local **MCP server for agentically authoring Spectacle slide decks** — written
in TypeScript so it shares one toolchain with the deck it drives.

The agent never writes JSX. It edits a **validated, composable element tree**
(`deck.json`); every mutation regenerates `src/App.jsx`. The model is rich
(nested boxes, columns, per-element style + animation, slide transitions, themes)
but Zod-validated, so it is **robust and customizable at once** — bad input is
rejected with a clear message, never written.

```
agent → friendly tool → deck.json (Zod-validated tree) → presentation.html (Reveal.js, no server needed)
```

## Why this shape

- **Composable, not templated.** A slide is a list of elements; elements nest.
  You are not limited to a fixed set of slide types — compose any layout.
- **Validated, not raw JSX.** Every element is checked against a schema before
  it is written, so the agent cannot corrupt the deck.
- **Friendly tools.** `create_slide`, `add_element`, `set_element_style`,
  `set_element_animation`, `set_slide_transition`, `set_theme_color`, etc.

## Layout

```
deckforge-mcp/
  src/model.ts     # Zod schema for the deck/slide/element tree
  src/codegen.ts   # tree → Spectacle JSX
  src/server.ts    # the MCP server (run this, compiled to dist/)
  dist/            # tsc output
spectacle-project/ # your Vite + Spectacle deck
  deck.json        # SOURCE OF TRUTH (created on first tool call)
  src/App.jsx      # GENERATED — do not hand-edit
```

## Setup

```bash
# 1. build the server
cd deckforge-mcp && npm install && npm run build

# 2. install the deck project's deps
cd ../spectacle-project && npm install
```

Register with **Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "deckforge": {
      "command": "node",
      "args": [
        "/abs/path/to/deckforge-mcp/dist/server.js",
        "/abs/path/to/spectacle-project"
      ]
    }
  }
}
```

The second arg is the deck project directory. Restart the client.

## Tools

**Read:** `list_slides`, `get_slide`
**Slides:** `create_slide`, `delete_slide`, `move_slide`, `set_slide_layout`, `set_slide_transition`
**Elements:** `add_element`, `edit_element`, `delete_element`, `set_element_style`, `set_element_animation`
**Theme:** `set_theme`, `set_theme_color`
**Build:** `render`, `open_presentation`, `export_pdf`

## Element kinds

Every element is a JSON object with a `kind`. `id` auto-fills if omitted. Any
element may carry `style` and `animation`.

```jsonc
{ "kind": "heading", "text": "Title" }
{ "kind": "text", "text": "Body copy" }
{ "kind": "list", "items": ["a","b"], "ordered": false, "animateItems": true }
{ "kind": "code", "language": "tsx", "code": "const x = 1", "highlightRanges": [[1,1]] }
{ "kind": "image", "src": "/logo.png", "alt": "Logo" }
{ "kind": "spacer", "size": 24 }

// containers (recursive)
{ "kind": "box", "direction": "column", "align": "center", "children": [ ... ] }
{ "kind": "columns", "columns": [ [ ...elements ], [ ...elements ] ] }
```

### style (any element)

```jsonc
{ "color": "#f59e0b", "backgroundColor": "#1e2730", "fontSize": 48,
  "fontWeight": 700, "fontStyle": "italic", "textAlign": "center",
  "opacity": 0.7, "padding": 16, "margin": 8, "width": "60%", "borderRadius": 8 }
```

### animation (any element)

```jsonc
{ "appear": true, "priority": 1 }
```

`appear` wraps the element so it reveals on click; `priority` orders multiple
reveals on the same slide. For lists, `animateItems: true` reveals items one by one.

### slide transition

`none | fade | slide | zoom` via `set_slide_transition`.

## PDF export

`export_pdf` runs `npm run export`. The scaffold ships a placeholder; wire your
chosen method (Spectacle print route, or Playwright-print the built site) into
the project's `export` script.

## Extending

Add an element kind in two places:
1. A schema in `src/model.ts`, added to the `discriminatedUnion`.
2. A `case` in `renderElement` in `src/codegen.ts`.
Rebuild (`npm run build`). The server validates against the schema automatically.

## Notes

- `deck.json` is the source of truth; hand-edits to `App.jsx` are overwritten on
  the next mutation. Use `render` to regenerate after editing `deck.json` directly.
- Every mutation re-validates the whole deck and re-renders before saving, so a
  bad edit is rejected rather than corrupting the file.
- Container elements (`box`, `columns`) are searched recursively, so
  `edit_element` / `set_element_style` work on deeply nested elements by id.
```
