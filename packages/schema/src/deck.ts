/**
 * deck.ts — the Deckforge-JSON tree.
 *
 * Two-layer vocabulary:
 *   - containers (row/column) are pure geometry;
 *   - components (heading/text/bulletList/metricCard/image/spacer) are
 *     semantic units with constrained props.
 *
 * Style values reference theme tokens by role name ("accent"); raw values are
 * rejected or snapped by @deckforge/validate, never trusted as-is.
 */
import { z } from "zod";
import { COLOR_ROLES, ThemeRefSchema } from "./tokens.js";

export const ColorTokenSchema = z.enum(COLOR_ROLES);

/** Style knobs shared by leaf components. Everything optional; theme fills gaps. */
export const TextStyleSchema = z
  .object({
    color: z.string().optional(), // token role; raw hex gets snapped by validate
    fontSize: z.number().optional(), // px; snapped to theme.fontSizeScale
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    align: z.enum(["left", "center", "right"]).optional(),
  })
  .strict();
export type TextStyle = z.infer<typeof TextStyleSchema>;

export const BoxStyleSchema = z
  .object({
    background: z.string().optional(), // token role
    padding: z.number().optional(), // px; snapped to spacingScale
    gap: z.number().optional(), // px; snapped to spacingScale
    radius: z.number().optional(), // px; snapped to theme radius steps
  })
  .strict();
export type BoxStyle = z.infer<typeof BoxStyleSchema>;

const Base = {
  id: z.string(),
};

/**
 * Sizing along the parent's main axis.
 * - column children: intrinsic height by default; `grow` shares leftover space.
 * - row children: width shared by `weight` (default 1); `widthPct` pins a %.
 */
const SizingSchema = z
  .object({
    weight: z.number().positive().optional(),
    widthPct: z.number().min(5).max(100).optional(),
    grow: z.number().positive().optional(),
    /** Fixed height in px (enables autoshrink for text inside). */
    height: z.number().positive().optional(),
  })
  .strict();
export type Sizing = z.infer<typeof SizingSchema>;

// ---------- leaf components ----------
export const HeadingSchema = z
  .object({
    ...Base,
    type: z.literal("heading"),
    text: z.string(),
    level: z.union([z.literal(1), z.literal(2)]).default(1),
    style: TextStyleSchema.optional(),
    sizing: SizingSchema.optional(),
  })
  .strict();

export const TextSchema = z
  .object({
    ...Base,
    type: z.literal("text"),
    text: z.string(),
    style: TextStyleSchema.optional(),
    sizing: SizingSchema.optional(),
  })
  .strict();

export const BulletListSchema = z
  .object({
    ...Base,
    type: z.literal("bulletList"),
    items: z.array(z.string()).nonempty(),
    style: TextStyleSchema.optional(),
    sizing: SizingSchema.optional(),
  })
  .strict();

/**
 * MetricCard — semantic component with hard brand constraints:
 * value renders in the accent color at metricValue size, bold, always.
 * Only label/value/delta text and the card background are per-instance.
 */
export const MetricCardSchema = z
  .object({
    ...Base,
    type: z.literal("metricCard"),
    label: z.string(),
    value: z.string(),
    delta: z.string().optional(), // e.g. "+12% QoQ"
    background: z.string().optional(), // token role; defaults to surface
    sizing: SizingSchema.optional(),
  })
  .strict();

export const ImageSchema = z
  .object({
    ...Base,
    type: z.literal("image"),
    src: z.string(),
    alt: z.string().optional(),
    sizing: SizingSchema.optional(),
  })
  .strict();

export const SpacerSchema = z
  .object({
    ...Base,
    type: z.literal("spacer"),
    size: z.number().default(24),
  })
  .strict();

// ---------- containers (recursive) ----------
export interface RowNode {
  id: string;
  type: "row";
  style?: BoxStyle;
  sizing?: Sizing;
  children: DeckNode[];
}
export interface ColumnNode {
  id: string;
  type: "column";
  style?: BoxStyle;
  sizing?: Sizing;
  children: DeckNode[];
}

export type LeafNode =
  | z.infer<typeof HeadingSchema>
  | z.infer<typeof TextSchema>
  | z.infer<typeof BulletListSchema>
  | z.infer<typeof MetricCardSchema>
  | z.infer<typeof ImageSchema>
  | z.infer<typeof SpacerSchema>;

export type DeckNode = LeafNode | RowNode | ColumnNode;

const RowSchema: z.ZodType<RowNode> = z
  .object({
    ...Base,
    type: z.literal("row"),
    style: BoxStyleSchema.optional(),
    sizing: SizingSchema.optional(),
    children: z.lazy(() => z.array(NodeSchema)),
  })
  .strict() as unknown as z.ZodType<RowNode>;

const ColumnSchema: z.ZodType<ColumnNode> = z
  .object({
    ...Base,
    type: z.literal("column"),
    style: BoxStyleSchema.optional(),
    sizing: SizingSchema.optional(),
    children: z.lazy(() => z.array(NodeSchema)),
  })
  .strict() as unknown as z.ZodType<ColumnNode>;

export const NodeSchema: z.ZodType<DeckNode> = z.discriminatedUnion("type", [
  HeadingSchema,
  TextSchema,
  BulletListSchema,
  MetricCardSchema,
  ImageSchema,
  SpacerSchema,
  RowSchema as never,
  ColumnSchema as never,
]) as unknown as z.ZodType<DeckNode>;

// ---------- slide & deck ----------
export const SlideSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    background: z.string().optional(), // token role; defaults to "background"
    padding: z.number().optional(), // px; defaults to theme spacing
    /** Root layout container of the slide. */
    root: z.lazy(() => NodeSchema),
  })
  .strict();
export type Slide = z.infer<typeof SlideSchema> & { root: DeckNode };

export const DeckSchema = z
  .object({
    schemaVersion: z.literal(2),
    title: z.string().default("Untitled deck"),
    theme: ThemeRefSchema,
    slides: z.array(SlideSchema),
  })
  .strict();
export type Deck = z.infer<typeof DeckSchema> & { slides: Slide[] };

export function newDeck(themeBase = "corporate-bold"): Deck {
  return {
    schemaVersion: 2,
    title: "Untitled deck",
    theme: { base: themeBase },
    slides: [
      {
        id: "slide-1",
        name: "Title",
        root: {
          id: "root-1",
          type: "column",
          children: [
            { id: "el-1", type: "heading", text: "New deck", level: 1 },
            {
              id: "el-2",
              type: "text",
              text: "Built with Deckforge v2",
              style: { color: "text-secondary" },
            },
          ],
        },
      },
    ],
  } as Deck;
}
