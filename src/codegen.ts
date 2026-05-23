/**
 * codegen.ts — render a validated Deck into a self-contained presentation.html.
 * Uses Reveal.js via CDN. No build step needed — just open the file.
 */
import type { Deck, Slide, Element } from "./model.js";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const UNITLESS = new Set(["fontWeight", "opacity", "zIndex", "lineHeight"]);

function toCss(key: string, val: unknown): string {
  const prop = key.replace(/([A-Z])/g, "-$1").toLowerCase();
  const cssVal =
    typeof val === "number" && !UNITLESS.has(key) ? `${val}px` : String(val);
  return `${prop}: ${cssVal}`;
}

function styleAttr(style?: Record<string, unknown>): string {
  if (!style || Object.keys(style).length === 0) return "";
  const css = Object.entries(style)
    .map(([k, v]) => toCss(k, v))
    .join("; ");
  return ` style="${esc(css)}"`;
}

function fragAttrs(el: Element): string {
  const anim = (el as any).animation;
  if (!anim?.appear) return "";
  const idx =
    anim.priority !== undefined
      ? ` data-fragment-index="${anim.priority}"`
      : "";
  return ` class="fragment"${idx}`;
}

function renderElement(el: Element, indent: string): string {
  const s = styleAttr((el as any).style);
  const fa = fragAttrs(el);

  switch ((el as any).kind) {
    case "heading":
      return `${indent}<h2${s}${fa}>${esc((el as any).text)}</h2>`;

    case "text":
      return `${indent}<p${s}${fa}>${esc((el as any).text)}</p>`;

    case "list": {
      const e = el as any;
      const Tag = e.ordered ? "ol" : "ul";
      const items = e.items
        .map((it: string) => {
          const f = e.animateItems ? ` class="fragment"` : "";
          return `${indent}  <li${f}>${esc(it)}</li>`;
        })
        .join("\n");
      return `${indent}<${Tag}${s}${fa}>\n${items}\n${indent}</${Tag}>`;
    }

    case "code": {
      const e = el as any;
      return `${indent}<pre${fa}><code class="language-${esc(e.language)}">${esc(e.code)}</code></pre>`;
    }

    case "image": {
      const e = el as any;
      const alt = e.alt ? ` alt="${esc(e.alt)}"` : "";
      return `${indent}<img src="${esc(e.src)}"${alt}${s}${fa} />`;
    }

    case "spacer": {
      const e = el as any;
      const sz = typeof e.size === "number" ? `${e.size}px` : String(e.size);
      return `${indent}<div style="height:${esc(sz)}"${fa}></div>`;
    }

    case "box": {
      const e = el as any;
      const boxStyle: Record<string, unknown> = {
        display: "flex",
        flexDirection: e.direction ?? "column",
        ...(e.justify ? { justifyContent: e.justify } : {}),
        ...(e.align ? { alignItems: e.align } : {}),
        ...(e.style ?? {}),
      };
      const kids = e.children
        .map((c: Element) => renderElement(c, indent + "  "))
        .join("\n");
      return `${indent}<div${styleAttr(boxStyle)}${fa}>\n${kids}\n${indent}</div>`;
    }

    case "columns": {
      const e = el as any;
      const gap =
        e.gap != null
          ? typeof e.gap === "number"
            ? `${e.gap}px`
            : String(e.gap)
          : "2rem";
      const colPct = `${Math.floor(100 / e.columns.length) - 2}%`;
      const cols = e.columns
        .map((col: Element[]) => {
          const kids = col
            .map((c) => renderElement(c, indent + "    "))
            .join("\n");
          return `${indent}  <div style="width:${colPct}">\n${kids}\n${indent}  </div>`;
        })
        .join("\n");
      return `${indent}<div style="display:flex;justify-content:space-between;gap:${esc(gap)}"${fa}>\n${cols}\n${indent}</div>`;
    }

    default:
      throw new Error(`Unknown element kind: ${(el as any).kind}`);
  }
}

function renderSlide(slide: Slide): string {
  const trans =
    slide.transition && slide.transition !== "none"
      ? ` data-transition="${slide.transition}"`
      : "";
  const bg = slide.backgroundColor
    ? ` data-background-color="${esc(slide.backgroundColor)}"`
    : "";
  const layoutStyle =
    slide.layout === "top"
      ? ` style="top:0;padding-top:2rem"`
      : slide.layout === "left"
      ? ` style="text-align:left"`
      : "";

  const els = slide.elements.map((e) => renderElement(e, "      ")).join("\n");
  return `    <section${bg}${trans}${layoutStyle}>\n${els}\n    </section>`;
}

export function renderPresentation(deck: Deck): string {
  const colors = deck.theme.colors ?? {};
  const fonts = deck.theme.fonts ?? {};
  const sizes = deck.theme.fontSizes ?? {};

  const bg = colors.tertiary ?? "#0f1419";
  const fg = colors.primary ?? "#e8e6e3";
  const accent = colors.secondary ?? "#7dd3fc";
  const headerFont = fonts.header ?? '"Georgia", serif';
  const textFont = fonts.text ?? '"Georgia", serif';
  const h1 = sizes.h1 ?? "3.5rem";
  const h2 = sizes.h2 ?? "2.4rem";
  const text = sizes.text ?? "1.4rem";

  const slides = deck.slides.map(renderSlide).join("\n\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Presentation</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5.2.1/dist/reveal.css" />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5.2.1/plugin/highlight/monokai.css" />
  <style>
    :root {
      --r-background-color: ${bg};
      --r-main-color: ${fg};
      --r-heading-color: ${fg};
      --r-link-color: ${accent};
      --r-main-font: ${textFont};
      --r-heading-font: ${headerFont};
      --r-heading1-size: ${h1};
      --r-heading2-size: ${h2};
      --r-main-font-size: ${text};
    }
    .reveal h2 { color: ${fg}; }
    .reveal a  { color: ${accent}; }
  </style>
</head>
<body>
  <div class="reveal">
    <div class="slides">
${slides}
    </div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/reveal.js@5.2.1/dist/reveal.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/reveal.js@5.2.1/plugin/highlight/highlight.js"></script>
  <script>
    Reveal.initialize({ hash: true, plugins: [RevealHighlight] });
  </script>
</body>
</html>
`;
}
