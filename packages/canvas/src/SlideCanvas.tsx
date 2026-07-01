/**
 * SlideCanvas — the editing surface. Paints the layout solver's resolved
 * boxes via BoxView, and layers editor interactivity on top: click-to-select,
 * double-click inline text editing, and drag/resize for freeform overlay
 * elements (Google-Slides style). All edits leave as JSON patches upstream.
 */
import { useMemo, useRef, useState } from "react";
import type { Deck, Frame, Slide, ThemeTokens } from "@deckforge/schema";
import { findNode } from "@deckforge/schema";
import { solveSlide, CANVAS_W, CANVAS_H, type TextBox } from "@deckforge/layout";
import { BoxView, FONT_STACKS, cssGradient } from "./BoxView.js";

interface DragState {
  nodeId: string;
  mode: "move" | "resize";
  startX: number;
  startY: number;
  dx: number;
  dy: number;
}

interface Props {
  deck: Deck;
  slide: Slide;
  tokens: ThemeTokens;
  scale: number;
  selectedId?: string | null;
  onSelect?: (nodeId: string | null) => void;
  onEditText?: (nodeId: string, text: string) => void;
  onFrameChange?: (nodeId: string, frame: Frame) => void;
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
  onFrameChange,
  interactive = true,
}: Props) {
  const resolved = useMemo(() => solveSlide(slide, tokens), [slide, tokens]);
  const [editing, setEditing] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const overlayFrames = useMemo(() => {
    const map = new Map<string, Frame>();
    for (const node of slide.overlays ?? []) {
      if (node.frame) map.set(node.id, node.frame);
    }
    return map;
  }, [slide]);

  const beginDrag = (nodeId: string, mode: DragState["mode"], e: React.PointerEvent) => {
    if (!interactive || !onFrameChange) return;
    e.stopPropagation();
    e.preventDefault();
    const state: DragState = { nodeId, mode, startX: e.clientX, startY: e.clientY, dx: 0, dy: 0 };
    dragRef.current = state;
    setDrag(state);
    const move = (ev: PointerEvent) => {
      const s = dragRef.current;
      if (!s) return;
      const next = { ...s, dx: ev.clientX - s.startX, dy: ev.clientY - s.startY };
      dragRef.current = next;
      setDrag(next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const s = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!s || (Math.abs(s.dx) < 3 && Math.abs(s.dy) < 3)) return;
      const f = overlayFrames.get(s.nodeId);
      if (!f) return;
      const d = { x: s.dx / scale, y: s.dy / scale };
      const frame: Frame =
        s.mode === "move"
          ? { ...f, x: Math.round(f.x + d.x), y: Math.round(f.y + d.y) }
          : { ...f, w: Math.max(16, Math.round(f.w + d.x)), h: Math.max(16, Math.round(f.h + d.y)) };
      onFrameChange(s.nodeId, frame);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** Live drag offset for boxes belonging to the dragged overlay subtree. */
  const dragStyle = (nodeId: string): React.CSSProperties | undefined => {
    if (!drag) return undefined;
    const rootId = overlaySubtreeRoot(nodeId);
    if (rootId !== drag.nodeId) return undefined;
    return drag.mode === "move"
      ? { transform: `translate(${drag.dx}px, ${drag.dy}px)` }
      : undefined;
  };

  /** Map any nodeId to its overlay root id (or null if it's flow content). */
  const overlayRootOf = useMemo(() => {
    const map = new Map<string, string>();
    const walk = (node: { id: string; children?: unknown[] }, root: string) => {
      map.set(node.id, root);
      for (const c of (node.children as Array<{ id: string; children?: unknown[] }>) ?? []) {
        walk(c, root);
      }
    };
    for (const node of slide.overlays ?? []) walk(node as never, node.id);
    return map;
  }, [slide]);
  const overlaySubtreeRoot = (nodeId: string) => overlayRootOf.get(nodeId) ?? null;

  return (
    <div
      className="slide-frame"
      style={{
        width: CANVAS_W * scale,
        height: CANVAS_H * scale,
        background: resolved.gradient ? cssGradient(resolved.gradient) : resolved.background,
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
        const overlayRoot = overlaySubtreeRoot(box.nodeId);
        const node = findNode(deck, box.nodeId)?.node;
        const editableText = node && (node.type === "heading" || node.type === "text");

        if (editing === box.id && box.kind === "text" && editableText) {
          const t = box as TextBox;
          return (
            <textarea
              key={t.id}
              autoFocus
              defaultValue={(node as { text: string }).text}
              className="inline-editor"
              style={{
                position: "absolute",
                left: t.x * scale,
                top: t.y * scale,
                width: t.w * scale,
                height: t.h * scale,
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
                boxSizing: "border-box",
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
          <div key={box.id} style={dragStyle(box.nodeId)}>
            <BoxView box={box} scale={scale} />
            {interactive && (
              <div
                style={{
                  position: "absolute",
                  left: box.x * scale,
                  top: box.y * scale,
                  width: box.w * scale,
                  height: box.h * scale,
                  outline: isSelected ? "2px solid #7c6cff" : undefined,
                  outlineOffset: 1,
                  cursor: overlayRoot ? "move" : "default",
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect?.(box.nodeId);
                }}
                onDoubleClick={(e) => {
                  if (editableText && box.kind === "text") {
                    e.stopPropagation();
                    setEditing(box.id);
                  }
                }}
                onPointerDown={(e) => {
                  if (overlayRoot && e.button === 0) beginDrag(overlayRoot, "move", e);
                }}
              />
            )}
            {isSelected && overlayRoot === box.nodeId && overlayFrames.has(box.nodeId) && (
              <div
                className="resize-handle"
                style={{
                  position: "absolute",
                  left: (box.x + box.w) * scale - 6,
                  top: (box.y + box.h) * scale - 6,
                  width: 12,
                  height: 12,
                  background: "#7c6cff",
                  borderRadius: 3,
                  cursor: "nwse-resize",
                  zIndex: 10,
                }}
                onPointerDown={(e) => beginDrag(box.nodeId, "resize", e)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
