# Deckforge v2 — Architecture

**The pitch:** Retool for presentations. An MCP server holds a validated JSON
deck as the single source of truth; an AI assistant mutates it through tools; a
Retool-style canvas app beside the chat lets a human click an element and turn
knobs; and an export button produces a `.pptx` that matches the preview
shape-for-shape.

This doc records the v2 design decisions and the reasoning behind them.

---

## 1. What v1 got right (keep it)

v1 (`src/model.ts`, `src/server.ts`) already implements the "State" layer of
the Retool analogy correctly:

- **A validated JSON tree as the only source of truth.** The agent never
  writes markup; it edits `deck.json` through tools, and Zod rejects malformed
  input before anything is persisted.
- **Small, friendly mutation tools** (`create_slide`, `add_element`,
  `set_element_style`, ...) instead of "here, rewrite the whole JSON."
  Models are dramatically more reliable with narrow tools.
- **Composable layout primitives** (`box`, `columns`, recursive children)
  rather than a fixed menu of slide templates.

All three carry forward.

## 2. What v1 got wrong for the v2 vision

1. **The render target is a browser.** v1 compiles the tree to HTML and lets
   CSS flexbox decide where everything lands. That means *nothing in the
   system knows the geometry* — there is no x/y/width/height anywhere. You
   cannot compile to PPTX (an absolutely-positioned shape format) from a tree
   whose layout only exists inside a browser's layout engine, and you cannot
   promise "the .pptx looks identical to the preview" when the preview's
   geometry is browser-dependent.
2. **Styles are raw CSS values.** `color: "#7dd3fc"` appears inline on
   elements. There is no token layer, so there is nothing to validate brand
   compliance against and nothing for an auto-correction engine to snap to.
3. **No shared state protocol.** v1 is one process writing a file. There is
   no way for a canvas app and an AI to edit the same deck concurrently and
   stay aware of each other's changes.

These three gaps define the three pillars of v2.

---

## 3. The three pillars

### Pillar A — Deterministic layout solver (the hard one)

The single most important architectural decision in v2:

> **Deckforge owns layout. The tree is resolved by our own deterministic
> solver into absolute boxes on a fixed 1280×720 canvas. Both the web
> renderer and the PPTX compiler consume those boxes.**

```
deck tree (rows/columns/padding/gap/weights)
        │
        ▼
  layout solver  ──►  ResolvedSlide = [{ id, x, y, w, h, style, content }]
        │                                   │
        ▼                                   ▼
  web canvas renders                 pptx compiler emits
  absolutely-positioned divs         shapes at the same x/y/w/h
```

Web preview and PPTX are pixel-identical **by construction**, not by heroic
CSS-to-OpenXML translation. The renderer becomes trivial (positioned divs);
the compiler becomes a tree walk (box → shape, text → text frame).

**The honest cost:** we must measure text ourselves (line wrapping needs
string widths). Mitigations, in order:

- Constrain fonts to a small, metrics-known set (the brand-token font stacks:
  Arial/Inter/Georgia tier). Load the font files server-side and measure with
  `opentype.js` (or precomputed advance-width tables). This is why the spec's
  "web-safe font stacks" requirement is a *feature* of the architecture, not
  just a branding rule.
- Autoshrink rules per component (PowerPoint does the same): if measured text
  overflows its box, step the font size down within a token-approved range.
- Golden-file tests: render N reference decks to both HTML screenshots and
  pptx, diff geometry numerically.

Rejected alternative: keep browser flexbox and "measure the DOM, then export."
It makes export depend on a headless browser, makes geometry non-deterministic
across environments, and couples the headless backend to a rendering engine.
The whole point of the MCP server is that it is headless.

### Pillar B — Design tokens + component registry + auto-correction

Two-layer vocabulary, exactly like Retool (layout primitives underneath,
semantic components on top):

- **Primitives:** `row`, `column`, `box`, `spacer` — pure geometry.
- **Components:** `Header`, `Text`, `List`, `Image`, `MetricCard`, and future
  additions — semantic units with *constrained props*. Each component is
  registered with:
  - its prop schema (Zod),
  - its **token bindings** (a `MetricCard`'s number is `color: accent`,
    `weight: bold` — bound, not chosen per-instance),
  - its layout behavior (intrinsic size, autoshrink policy),
  - its PPTX mapping (a `MetricCard` compiles to a group of native shapes).

**Styles reference tokens, not values.** `background: "surface-primary"`,
`color: "accent"`. The schema makes raw hex/px the exception (an
`override` escape hatch that validation can flag), not the default.

**Themes are token sets.** `Corporate Bold` and `Minimalist Dark` ship
built-in as data files: color roles, font stacks, spacing scale, per-component
constraint overrides. Registering a brand = forking a theme's token values.

**Auto-correction engine** = one pure function in the write path:

```
proposedPatch → validate(schema) → snap(tokens, constraints) → appliedPatch
```

Off-palette color → nearest brand token. Arbitrary padding → nearest step on
the spacing scale. Disallowed font weight on a MetricCard number → forced to
the registered weight. The corrected patch is what gets applied and echoed
back, so the AI's context always reflects reality, never its rejected intent.

### Pillar C — One write path: everything is a JSON Patch

The key sync insight: **do not build two mutation mechanisms.** AI tool calls
and canvas UI edits are the same thing — both compile to RFC-6902 JSON Patch
operations and flow through the same pipeline:

```
AI tool call  ──┐
                ├──► JSON Patch ──► validate ──► auto-correct ──► apply ──► broadcast (WS)
canvas knob  ───┘                                                   │
                                                                    ▼
                                                              patch log (undo/redo,
                                                              get_changes_since)
```

Consequences that fall out for free:

- **Bi-directional sync** is just "broadcast applied patches to all clients."
- **Undo/redo** is the patch log with inverses.
- **"The AI stays aware of human edits"** is a `get_changes_since(rev)` tool —
  the model reads the same patch log. Each applied patch bumps a revision
  counter; tools return the current revision so the model can diff cheaply.
- **Auto-correction applies uniformly** — a human dragging a slider gets
  snapped to the spacing scale exactly like the AI does.

MCP tools keep their friendly v1 ergonomics (`set_element_style`, not "send a
patch") — but internally each tool *compiles to* patches. Ergonomic surface,
uniform core.

---

## 4. System shape

One local Node/TypeScript process (v2.0 is local-first, like v1):

```
┌─────────────────────────── deckforge server (one process) ──────────────────────────┐
│                                                                                      │
│  MCP endpoint (stdio + streamable HTTP)     HTTP: serves canvas app, /export/pptx    │
│              │                                              │                        │
│              ▼                                              ▼                        │
│   tools → patch compiler ─────► write pipeline ◄───── WS: patches from canvas        │
│                                 (validate → snap → apply → broadcast)                │
│                                       │                                              │
│                              deck state + patch log  ──► persisted to deck.json      │
│                                       │                                              │
│                                 layout solver                                        │
│                                  │         │                                         │
│                        resolved boxes    pptx compiler (pptxgenjs)                   │
│                          (to canvas)       (on export)                               │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

- **Canvas app:** React + Vite. Renders resolved boxes as positioned divs
  inside a 16:9 frame; click-to-select; property inspector reads the selected
  component's registered prop schema and *generates its knobs from it*
  (Retool-style — a token-bound color prop renders as a palette picker
  restricted to brand tokens; a spacing prop renders as a slider with
  scale-step detents). Inspector edits and inline text edits emit patches
  over WebSocket.
- **PPTX:** `pptxgenjs` (stays in the TS toolchain). Because input is
  resolved boxes + token-resolved styles, the compiler is a mechanical walk
  emitting native vector shapes and text frames — fully editable in
  PowerPoint/Google Slides. EMU coordinate conversion from the 1280×720 space
  is a constant factor.
- **MCP resources:** `design-system://tokens`, `design-system://components`,
  `deck://current`, `deck://changes` — so the model can *read* the constraint
  system it is composing against (the "snoop the schema" part of Retool).

### Monorepo layout

```
packages/
  schema/        # Zod: deck tree, tokens, component registry, patch ops
  themes/        # corporate-bold/, minimalist-dark/ — token sets as data
  validate/      # auto-correction: snap-to-token, constraint enforcement
  layout/        # deterministic solver: tree → ResolvedSlide boxes (+ text metrics)
  compile-pptx/  # ResolvedSlide[] → .pptx via pptxgenjs
  server/        # MCP tools, write pipeline, WS, HTTP, persistence
  canvas/        # React canvas + inspector
```

`schema`, `validate`, `layout`, `compile-pptx` are pure libraries with no I/O
— unit-testable without a server or browser.

### Deliberately out of scope for v2.0

- **Animations/transitions.** v1 had Reveal.js fragments; PPTX animation
  mapping is a tar pit and irrelevant to the core loop. The schema keeps an
  optional slot; nothing consumes it yet.
- **Cloud/multi-user.** Local single process. But because sync is
  patches-over-WebSocket, swapping the transport/store later doesn't change
  the interfaces.
- **Arbitrary fonts.** Metrics-known brand stacks only (see Pillar A).

---

## 5. Build order (risk-first)

The riskiest promise is *"the .pptx looks identical to the preview."* So the
export path gets proven **before** we invest in the editor experience:

| Milestone | Deliverable | Proves |
|---|---|---|
| **M1** | `schema` + `themes` + `validate` (pure libs, tested) | The vocabulary: components, tokens, auto-correction |
| **M2** | `layout` solver + text metrics for the brand font set | Deterministic geometry |
| **M3** | Read-only canvas renderer **and** `compile-pptx`, with golden decks diffed across both | The fidelity promise — the whole product bet |
| **M4** | Server: tools-as-patches, write pipeline, WS broadcast; port v1 tool surface | AI authoring loop end-to-end |
| **M5** | Inspector: selection, schema-generated knobs, inline text, patches up the wire | The Retool canvas experience |
| **M6** | Polish: undo/redo UI, `deck://changes` resource, export button, theme picker | V1-complete per spec |

M3 is the go/no-go gate: if dual-render fidelity doesn't hold on golden decks,
we fix the layout/metrics layer *then*, while it's cheap.

## 6. What migrates from v1

| v1 | v2 disposition |
|---|---|
| Zod tree, discriminated union, lazy recursion (`model.ts`) | Pattern reused directly in `packages/schema` |
| Tool surface & naming (`server.ts`) | Kept as ergonomics; reimplemented as patch compilers |
| `deck.json` as source of truth | Kept; now with revision counter + patch log |
| Codegen → Reveal.js HTML (`codegen.ts`) | Dropped (replaced by canvas renderer + pptx compiler) |
| Spectacle project | Dropped |
| Raw CSS style values | Replaced by token references + `override` escape hatch |
| Animation schema | Parked (slot kept, unimplemented) |
