/**
 * deck.ts — the Deckforge-JSON tree.
 *
 * Two-layer vocabulary:
 *   - containers (row/column) are pure geometry;
 *   - components (heading/text/bulletList/metricCard/image/shape/table/spacer)
 *     are semantic units with constrained props.
 *
 * Beyond the flow layout, every slide has a freeform `overlays` layer where
 * elements carry an absolute `frame` (x/y/w/h on the 1280×720 canvas) — the
 * Google-Slides-style "drag anything anywhere" surface.
 *
 * Style values reference theme tokens by role name ("accent"); raw values are
 * rejected or snapped by @deckforge/validate, never trusted as-is.
 */
import { z } from "zod";
import { COLOR_ROLES, FontIdSchema, ThemeRefSchema } from "./tokens.js";

export const ColorTokenSchema = z.enum(COLOR_ROLES);

/** The fixed slide coordinate space (16:9 at 96dpi). */
export const CANVAS_W = 1280;
export const CANVAS_H = 720;

/** Two-token gradient; both stops are brand roles, angle is constrained. */
export const GradientSchema = z
  .object({
    from: z.string(), // token role
    to: z.string(), // token role
    angle: z.union([z.literal(0), z.literal(45), z.literal(90), z.literal(135)]).default(90),
  })
  .strict();
export type Gradient = z.infer<typeof GradientSchema>;

export const BorderSchema = z
  .object({
    color: z.string(), // token role
    width: z.number().min(1).max(8).default(2),
  })
  .strict();
export type Border = z.infer<typeof BorderSchema>;

/** Style knobs shared by text-bearing components. Theme fills the gaps. */
export const TextStyleSchema = z
  .object({
    color: z.string().optional(), // token role; raw hex gets snapped by validate
    fontSize: z.number().optional(), // px; snapped to theme.fontSizeScale
    font: FontIdSchema.optional(), // per-element font family override
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    align: z.enum(["left", "center", "right"]).optional(),
    lineHeight: z.number().min(0.9).max(2.5).optional(), // multiplier
    letterSpacing: z.number().min(0).max(12).optional(), // px
    uppercase: z.boolean().optional(),
  })
  .strict();
export type TextStyle = z.infer<typeof TextStyleSchema>;

export const BoxStyleSchema = z
  .object({
    background: z.string().optional(), // token role
    gradient: GradientSchema.optional(), // wins over background
    border: BorderSchema.optional(),
    shadow: z.boolean().optional(),
    padding: z.number().optional(), // px; snapped to spacingScale
    gap: z.number().optional(), // px; snapped to spacingScale
    radius: z.number().optional(), // px; snapped to theme radius steps
    /** Main-axis distribution of leftover space (layout, not brand). */
    justify: z.enum(["start", "center", "end", "between"]).optional(),
    /** Cross-axis alignment of children. */
    align: z.enum(["start", "center", "end", "stretch"]).optional(),
  })
  .strict();
export type BoxStyle = z.infer<typeof BoxStyleSchema>;

/** Entrance animation, on any element. `order` groups clicks (1 = first click). */
export const AnimationSchema = z
  .object({
    effect: z.enum(["appear", "fade", "flyIn", "zoom", "wipe"]),
    direction: z.enum(["left", "right", "top", "bottom"]).optional(), // flyIn/wipe
    order: z.number().int().min(1).default(1),
    /** bulletList only: reveal one bullet per click. */
    byParagraph: z.boolean().optional(),
  })
  .strict();
export type Animation = z.infer<typeof AnimationSchema>;

/** Slide enter transition. */
export const TransitionSchema = z
  .object({
    type: z.enum(["none", "fade", "push", "wipe"]),
    direction: z.enum(["left", "right", "top", "bottom"]).optional(),
  })
  .strict();
export type Transition = z.infer<typeof TransitionSchema>;

/** Absolute placement on the 1280×720 canvas (freeform/overlay elements). */
export const FrameSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    w: z.number().min(8),
    h: z.number().min(8),
  })
  .strict();
export type Frame = z.infer<typeof FrameSchema>;

const Base = {
  id: z.string(),
  animation: AnimationSchema.optional(),
  /** Only meaningful on overlay elements; ignored in flow layout. */
  frame: FrameSchema.optional(),
};

/**
 * Sizing along the parent's main axis (flow layout).
 * - column children: intrinsic height by default; `grow` shares leftover space.
 * - row children: width shared by `weight` (default 1); `widthPct` pins a %.
 */
/** Outer spacing on any flow element; each side snaps to the spacing scale. */
export const MarginSchema = z
  .object({
    top: z.number().min(0).optional(),
    bottom: z.number().min(0).optional(),
    left: z.number().min(0).optional(),
    right: z.number().min(0).optional(),
  })
  .strict();
export type Margin = z.infer<typeof MarginSchema>;

const SizingSchema = z
  .object({
    weight: z.number().positive().optional(),
    widthPct: z.number().min(5).max(100).optional(),
    grow: z.number().positive().optional(),
    /** Fixed height in px (enables autoshrink for text inside). */
    height: z.number().positive().optional(),
    /** Margin around the element, on any element, anywhere in the flow. */
    margin: MarginSchema.optional(),
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
    ordered: z.boolean().optional(), // numbered list
    style: TextStyleSchema.optional(),
    sizing: SizingSchema.optional(),
  })
  .strict();

/**
 * MetricCard — semantic component with hard brand constraints:
 * value renders in the accent color at metricValue size, bold, always.
 */
export const MetricCardSchema = z
  .object({
    ...Base,
    type: z.literal("metricCard"),
    label: z.string(),
    value: z.string(),
    delta: z.string().optional(),
    background: z.string().optional(), // token role; defaults to surface
    sizing: SizingSchema.optional(),
  })
  .strict();

export const ImageSchema = z
  .object({
    ...Base,
    type: z.literal("image"),
    src: z.string(), // http(s) URL or data: URL
    alt: z.string().optional(),
    fit: z.enum(["cover", "contain"]).default("cover"),
    radius: z.number().optional(),
    shadow: z.boolean().optional(),
    sizing: SizingSchema.optional(),
  })
  .strict();

/** Geometry presets map 1:1 onto native PowerPoint autoshapes. */
export const SHAPE_KINDS = [
  "rect",
  "roundRect",
  "ellipse",
  "triangle",
  "diamond",
  "chevron",
  "rightArrow",
  "pill",
  "line",
] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

export const ShapeSchema = z
  .object({
    ...Base,
    type: z.literal("shape"),
    shape: z.enum(SHAPE_KINDS),
    fill: z.string().optional(), // token role
    gradient: GradientSchema.optional(),
    border: BorderSchema.optional(),
    shadow: z.boolean().optional(),
    /** Optional centered label inside the shape. */
    text: z.string().optional(),
    textStyle: TextStyleSchema.optional(),
    sizing: SizingSchema.optional(),
  })
  .strict();

/** Brand-styled table; header + zebra styling comes from tokens, not knobs. */
export const TableSchema = z
  .object({
    ...Base,
    type: z.literal("table"),
    rows: z.array(z.array(z.string()).nonempty()).nonempty(),
    header: z.boolean().default(true),
    /** Relative column widths; defaults to equal. */
    columns: z.array(z.number().positive()).optional(),
    style: TextStyleSchema.optional(),
    sizing: SizingSchema.optional(),
  })
  .strict();

/** Chart types deliberately expose ONE value axis (dual axes are banned). */
export const CHART_TYPES = ["column", "bar", "line", "area", "pie", "donut"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export const ChartSchema = z
  .object({
    ...Base,
    type: z.literal("chart"),
    chartType: z.enum(CHART_TYPES),
    categories: z.array(z.string()).nonempty(),
    /** Series colors come from the theme's validated chartPalette in slot
     * order — identity follows the series, never a per-instance pick. */
    series: z
      .array(z.object({ name: z.string(), values: z.array(z.number()) }).strict())
      .nonempty(),
    /** Legend defaults on for ≥2 series, off for one (the title names it). */
    legend: z.boolean().optional(),
    /** Direct value labels; default on (contrast-relief rule for light fills). */
    dataLabels: z.boolean().optional(),
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
  animation?: Animation;
  frame?: Frame;
  children: DeckNode[];
}
export interface ColumnNode {
  id: string;
  type: "column";
  style?: BoxStyle;
  sizing?: Sizing;
  animation?: Animation;
  frame?: Frame;
  children: DeckNode[];
}

export type LeafNode =
  | z.infer<typeof HeadingSchema>
  | z.infer<typeof TextSchema>
  | z.infer<typeof BulletListSchema>
  | z.infer<typeof MetricCardSchema>
  | z.infer<typeof ImageSchema>
  | z.infer<typeof ShapeSchema>
  | z.infer<typeof TableSchema>
  | z.infer<typeof ChartSchema>
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
  ShapeSchema,
  TableSchema,
  ChartSchema,
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
    gradient: GradientSchema.optional(), // full-bleed background gradient
    padding: z.number().optional(),
    transition: TransitionSchema.optional(),
    /** Presenter notes; exported into the pptx notes pane. */
    notes: z.string().optional(),
    /** Root flow container of the slide. */
    root: z.lazy(() => NodeSchema),
    /** Freeform layer: absolutely-positioned elements, painted in order on
     * top of the flow layout. Each MUST carry a `frame`. */
    overlays: z.lazy(() => z.array(NodeSchema)).optional(),
  })
  .strict();
export type Slide = z.infer<typeof SlideSchema> & { root: DeckNode; overlays?: DeckNode[] };

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
