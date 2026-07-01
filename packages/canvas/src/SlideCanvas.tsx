/**
 * SlideCanvas — renders a ResolvedSlide as absolutely-positioned divs.
 * It draws ONLY what the layout solver produced (the same boxes the pptx
 * compiler consumes), scaled to fit; there is no CSS layout happening here.
 * Double-click a text box to edit inline; edits emit JSON patches upstream.
 */
import { useMemo, useState } from "react";
import type { Slide, ThemeTokens } from "@deckforge/schema";
import { findNode } from "@deckforge/schema";
import { solveSlide, CANVAS_W, CANVAS_H, type TextBox } from "@deckforge/layout";
import type { Deck } from "@deckforge/schema";

const FONT_STACKS: Record<string, string> = {
  sans: 'Arial, "Liberation Sans", Helvetica, sans-serif',
  serif: 'Georgia, "Liberation Serif", serif',
};

interface Props {
  deck: Deck;
  slide: Slide;
  tokens: ThemeTokens;
  scale: number;
  selectedId?: string | null;
  onSelect?: (nodeId: string | null) => void;
  onEditText?: (nodeId: string, text: string) => void;
  interactive?: boolean;
}

export function SlideCanvas({
  deck,
  slide,
  tokens,
  scale,
  selectedId,
  onSelect,
  onEditText,
  interactive = true,
}: Props) {
  const resolved = useMemo(() => solveSlide(slide, tokens), [slide, tokens]);
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div
      className="slide-frame"
      style={{
        width: CANVAS_W * scale,
        height: CANVAS_H * scale,
        background: resolved.background,
        position: "relative",
        overflow: "hidden",
        cursor: interactive ? "default" : "pointer",
      }}
      onClick={(e) => {
        if (interactive && e.target === e.currentTarget) onSelect?.(null);
      }}
    >
      {resolved.boxes.map((box) => {
        const isSelected = interactive && selectedId != null && box.nodeId === selectedId;
        const common: React.CSSProperties = {
          position: "absolute",
          left: box.x * scale,
          top: box.y * scale,
          width: box.w * scale,
          height: box.h * scale,
          boxSizing: "border-box",
          outline: isSelected ? "2px solid #7c6cff" : undefined,
          outlineOffset: 1,
        };
        const select = (e: React.MouseEvent) => {
          if (!interactive) return;
          e.stopPropagation();
          onSelect?.(box.nodeId);
        };

        if (box.kind === "rect") {
          return (
            <div
              key={box.id}
              style={{
                ...common,
                background: box.fill,
                borderRadius: box.radius * scale,
              }}
              onClick={select}
            />
          );
        }

        if (box.kind === "image") {
          return (
            <div
              key={box.id}
              style={{
                ...common,
                background: "#dddddd",
                border: "1px dashed #999999",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#666666",
                fontSize: 12 * scale,
                fontFamily: FONT_STACKS.sans,
              }}
              onClick={select}
            >
              {box.alt ?? "image"}
            </div>
          );
        }

        const t = box as TextBox;
        const node = findNode(deck, t.nodeId)?.node;
        const editableText = node && (node.type === "heading" || node.type === "text");

        if (editing === t.id && editableText) {
          return (
            <textarea
              key={t.id}
              autoFocus
              defaultValue={(node as { text: string }).text}
              className="inline-editor"
              style={{
                ...common,
                fontFamily: FONT_STACKS[t.fontId],
                fontSize: t.size * scale,
                fontWeight: t.bold ? 700 : 400,
                fontStyle: t.italic ? "italic" : "normal",
                lineHeight: t.lineHeight,
                color: t.color,
                textAlign: t.align,
                background: "rgba(124,108,255,0.08)",
                border: "1px solid #7c6cff",
                outline: "none",
                resize: "none",
                padding: 0,
                margin: 0,
              }}
              onBlur={(e) => {
                setEditing(null);
                if (e.target.value !== (node as { text: string }).text) {
                  onEditText?.(t.nodeId, e.target.value);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") setEditing(null);
                if (e.key === "Enter" && !e.shiftKey) (e.target as HTMLTextAreaElement).blur();
              }}
            />
          );
        }

        return (
          <div
            key={t.id}
            style={{
              ...common,
              fontFamily: FONT_STACKS[t.fontId],
              fontSize: t.size * scale,
              fontWeight: t.bold ? 700 : 400,
              fontStyle: t.italic ? "italic" : "normal",
              lineHeight: t.lineHeight,
              color: t.color,
              textAlign: t.align,
              userSelect: "none",
              overflow: "hidden",
            }}
            onClick={select}
            onDoubleClick={(e) => {
              if (interactive && editableText) {
                e.stopPropagation();
                setEditing(t.id);
              }
            }}
          >
            {t.paragraphs.map((p, pi) => (
              <div
                key={pi}
                style={{
                  marginBottom: pi < t.paragraphs.length - 1 ? t.paragraphGap * scale : 0,
                  paddingLeft: p.bullet ? t.size * 1.4 * scale : 0,
                  position: "relative",
                }}
              >
                {p.bullet && (
                  <span style={{ position: "absolute", left: t.size * 0.3 * scale }}>•</span>
                )}
                {p.lines.map((line, li) => (
                  <div key={li} style={{ whiteSpace: "pre" }}>
                    {line || " "}
                  </div>
                ))}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
