/**
 * codegen.ts — render a validated Deck into src/App.jsx.
 * Walks the element tree; emits Spectacle JSX. Pure functions, no I/O.
 */
import type { Deck, Slide, Element } from "./model.js";

function jsStr(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}
function tpl(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

function styleProp(style?: Record<string, unknown>): string {
  if (!style || Object.keys(style).length === 0) return "";
  const entries = Object.entries(style).map(([k, v]) => {
    const val = typeof v === "number" ? `${v}` : `"${jsStr(String(v))}"`;
    return `${k}: ${val}`;
  });
  return ` style={{ ${entries.join(", ")} }}`;
}

// Wrap a rendered element in <Appear> if animation.appear is set.
function maybeAppear(el: Element, inner: string, indent: string): string {
  const anim = (el as any).animation;
  if (anim?.appear) {
    const prio = anim.priority !== undefined ? ` priority={${anim.priority}}` : "";
    return `${indent}<Appear${prio}>\n${inner}\n${indent}</Appear>`;
  }
  return inner;
}

function renderElement(el: Element, indent: string): string {
  const s = styleProp((el as any).style);
  let body: string;

  switch ((el as any).kind) {
    case "heading":
      body = `${indent}<Heading${s}>${jsStr((el as any).text)}</Heading>`;
      break;
    case "text":
      body = `${indent}<Text${s}>${jsStr((el as any).text)}</Text>`;
      break;
    case "list": {
      const e = el as any;
      const Tag = e.ordered ? "OrderedList" : "UnorderedList";
      const items = e.items
        .map((it: string) => {
          const li = `<ListItem>${jsStr(it)}</ListItem>`;
          return e.animateItems
            ? `${indent}  <Appear>${li}</Appear>`
            : `${indent}  ${li}`;
        })
        .join("\n");
      body = `${indent}<${Tag}${s}>\n${items}\n${indent}</${Tag}>`;
      break;
    }
    case "code": {
      const e = el as any;
      let hl = "";
      if (e.highlightRanges?.length) {
        const r = e.highlightRanges.map((p: number[]) => `[${p[0]}, ${p[1]}]`).join(", ");
        hl = ` highlightRanges={[${r}]}`;
      }
      body = `${indent}<CodePane language="${jsStr(e.language)}"${hl}>\n${indent}  {\`${tpl(e.code)}\`}\n${indent}</CodePane>`;
      break;
    }
    case "image": {
      const e = el as any;
      const alt = e.alt ? ` alt="${jsStr(e.alt)}"` : "";
      body = `${indent}<Image src="${jsStr(e.src)}"${alt}${s} />`;
      break;
    }
    case "spacer": {
      const e = el as any;
      const sz = typeof e.size === "number" ? `${e.size}px` : e.size;
      body = `${indent}<Box style={{ height: "${jsStr(sz)}" }} />`;
      break;
    }
    case "box": {
      const e = el as any;
      const just = e.justify ? ` justifyContent="${jsStr(e.justify)}"` : "";
      const al = e.align ? ` alignItems="${jsStr(e.align)}"` : "";
      const kids = e.children.map((c: Element) => renderElement(c, indent + "  ")).join("\n");
      body = `${indent}<FlexBox flexDirection="${e.direction}"${just}${al}${s}>\n${kids}\n${indent}</FlexBox>`;
      break;
    }
    case "columns": {
      const e = el as any;
      const cols = e.columns
        .map((col: Element[]) => {
          const kids = col.map((c) => renderElement(c, indent + "    ")).join("\n");
          const w = `${Math.floor(100 / e.columns.length) - 2}%`;
          return `${indent}  <Box width="${w}">\n${kids}\n${indent}  </Box>`;
        })
        .join("\n");
      const gap = e.gap ? ` style={{ gap: "${typeof e.gap === "number" ? e.gap + "px" : e.gap}" }}` : "";
      body = `${indent}<FlexBox justifyContent="space-between" alignItems="flex-start"${gap}>\n${cols}\n${indent}</FlexBox>`;
      break;
    }
    default:
      throw new Error(`Unknown element kind: ${(el as any).kind}`);
  }

  return maybeAppear(el, body, indent);
}

function layoutFlex(layout: string): { justify: string; align: string } {
  switch (layout) {
    case "top":
      return { justify: "flex-start", align: "center" };
    case "left":
      return { justify: "center", align: "flex-start" };
    case "center":
    default:
      return { justify: "center", align: "center" };
  }
}

function renderSlide(slide: Slide): string {
  const { justify, align } = layoutFlex(slide.layout);
  const trans =
    slide.transition && slide.transition !== "none"
      ? ` transition={{ from: { opacity: 0 }, enter: { opacity: 1 } }}`
      : "";
  const bg = slide.backgroundColor
    ? ` backgroundColor="${jsStr(slide.backgroundColor)}"`
    : "";
  const els = slide.elements.map((e) => renderElement(e, "          ")).join("\n");
  return `      <Slide${bg}${trans}>
        <FlexBox height="100%" flexDirection="column" justifyContent="${justify}" alignItems="${align}">
${els}
        </FlexBox>
      </Slide>`;
}

export function renderAppJsx(deck: Deck): string {
  const themeJson = JSON.stringify(deck.theme, null, 2);
  const slides = deck.slides.map(renderSlide).join("\n\n");
  return `import {
  Deck, Slide, Heading, Text, UnorderedList, OrderedList, ListItem,
  CodePane, Appear, FlexBox, Box, Image,
} from "spectacle"

const theme = ${themeJson}

export default function App() {
  return (
    <Deck theme={theme}>
${slides}
    </Deck>
  )
}
`;
}
