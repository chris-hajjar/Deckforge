/**
 * model.ts — the deck schema. Source of truth is a JSON tree validated by Zod.
 *
 * A deck is { theme, slides[] }. A slide is { id, layout, transition?, elements[] }.
 * An element is a composable node (heading/text/list/code/image/box/columns/spacer)
 * carrying optional `style` and `animation`. App.jsx is GENERATED from this tree,
 * so output JSX is always valid; Zod rejects malformed input before anything is written.
 */
import { z } from "zod";

// ---------- shared sub-schemas ----------
const StyleSchema = z
  .object({
    color: z.string().optional(),
    backgroundColor: z.string().optional(),
    fontSize: z.union([z.string(), z.number()]).optional(),
    fontWeight: z.union([z.string(), z.number()]).optional(),
    fontStyle: z.string().optional(),
    textAlign: z.enum(["left", "center", "right"]).optional(),
    fontFamily: z.string().optional(),
    opacity: z.number().optional(),
    padding: z.union([z.string(), z.number()]).optional(),
    margin: z.union([z.string(), z.number()]).optional(),
    width: z.union([z.string(), z.number()]).optional(),
    borderRadius: z.union([z.string(), z.number()]).optional(),
  })
  .strict();

// Spectacle reveal/animation, exposed as data.
const AnimationSchema = z
  .object({
    // appear = wrap in <Appear>; element reveals on click/step.
    appear: z.boolean().optional(),
    // priority controls the order Appear elements reveal (Spectacle activeStep).
    priority: z.number().int().optional(),
  })
  .strict();

const SlideTransition = z
  .enum(["none", "fade", "slide", "zoom"])
  .describe("Slide-level enter/exit transition");

// ---------- element schemas (discriminated union on `kind`) ----------
const Base = {
  id: z.string(),
  style: StyleSchema.optional(),
  animation: AnimationSchema.optional(),
};

const HeadingEl = z.object({ ...Base, kind: z.literal("heading"), text: z.string() }).strict();
const TextEl = z.object({ ...Base, kind: z.literal("text"), text: z.string() }).strict();
const ListEl = z
  .object({
    ...Base,
    kind: z.literal("list"),
    ordered: z.boolean().optional(),
    items: z.array(z.string()),
    // animateItems: each item reveals on its own step
    animateItems: z.boolean().optional(),
  })
  .strict();
const CodeEl = z
  .object({
    ...Base,
    kind: z.literal("code"),
    language: z.string().default("tsx"),
    code: z.string(),
    highlightRanges: z.array(z.tuple([z.number(), z.number()])).optional(),
  })
  .strict();
const ImageEl = z
  .object({ ...Base, kind: z.literal("image"), src: z.string(), alt: z.string().optional() })
  .strict();
const SpacerEl = z
  .object({ ...Base, kind: z.literal("spacer"), size: z.union([z.string(), z.number()]).default(24) })
  .strict();

// Container elements recurse via `get children()/get columns()` getters that
// reference the single lazy ElementSchema. Crucially, the discriminated-union
// MEMBERS are plain objects (so Zod can read each `kind`); only the children
// fields are lazy. This avoids the "can't read discriminator through lazy" bug.
type ElementT = any; // structural; see Element export below

const BoxEl = z
  .object({
    ...Base,
    kind: z.literal("box"),
    direction: z.enum(["row", "column"]).default("column"),
    justify: z.string().optional(),
    align: z.string().optional(),
    children: z.lazy(() => z.array(ElementSchema)),
  })
  .strict();

const ColumnsEl = z
  .object({
    ...Base,
    kind: z.literal("columns"),
    gap: z.union([z.string(), z.number()]).optional(),
    columns: z.lazy(() => z.array(z.array(ElementSchema))),
  })
  .strict();

export const ElementSchema: z.ZodType<ElementT> = z.discriminatedUnion("kind", [
  HeadingEl,
  TextEl,
  ListEl,
  CodeEl,
  ImageEl,
  SpacerEl,
  BoxEl,
  ColumnsEl,
]) as unknown as z.ZodType<ElementT>;

// ---------- slide & deck ----------
export const SlideSchema = z
  .object({
    id: z.string(),
    layout: z.enum(["center", "top", "left"]).default("center"),
    transition: SlideTransition.optional(),
    backgroundColor: z.string().optional(),
    elements: z.array(ElementSchema),
  })
  .strict();

export const ThemeSchema = z
  .object({
    colors: z.record(z.string()).optional(),
    fonts: z.record(z.string()).optional(),
    fontSizes: z.record(z.string()).optional(),
  })
  .strict();

export const DeckSchema = z
  .object({
    theme: ThemeSchema,
    slides: z.array(SlideSchema),
  })
  .strict();

export type Deck = z.infer<typeof DeckSchema>;
export type Slide = z.infer<typeof SlideSchema>;
export type Element = ElementT;

export const DEFAULT_THEME = {
  colors: {
    primary: "#e8e6e3",
    secondary: "#7dd3fc",
    tertiary: "#0f1419",
    quaternary: "#1e2730",
  },
  fonts: { header: '"Georgia", serif', text: '"Georgia", serif' },
  fontSizes: { h1: "64px", h2: "44px", text: "26px" },
};

export function newDeck(): Deck {
  return {
    theme: DEFAULT_THEME,
    slides: [
      {
        id: "slide-1",
        layout: "center",
        elements: [
          { id: "el-1", kind: "heading", text: "New Deck" },
          { id: "el-2", kind: "text", text: "Built with deckforge-mcp", style: { opacity: 0.7, textAlign: "center" } },
        ],
      },
    ],
  } as Deck;
}
