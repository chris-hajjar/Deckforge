/**
 * walk.ts — tree utilities shared by validate/layout/server.
 * Paths use JSON-Pointer segments relative to the deck root, so the same
 * addressing works for JSON Patch ops and for correction reports.
 */
import type { Deck, DeckNode, Slide } from "./deck.js";

export interface NodeVisit {
  node: DeckNode;
  /** JSON Pointer to this node from the deck root, e.g. "/slides/0/root/children/2". */
  pointer: string;
  slideIndex: number;
  parent: DeckNode | null;
}

export function* walkSlide(slide: Slide, slideIndex: number): Generator<NodeVisit> {
  function* rec(node: DeckNode, pointer: string, parent: DeckNode | null): Generator<NodeVisit> {
    yield { node, pointer, slideIndex, parent };
    if (node.type === "row" || node.type === "column") {
      for (let i = 0; i < node.children.length; i++) {
        yield* rec(node.children[i], `${pointer}/children/${i}`, node);
      }
    }
  }
  yield* rec(slide.root, `/slides/${slideIndex}/root`, null);
  const overlays = slide.overlays ?? [];
  for (let i = 0; i < overlays.length; i++) {
    yield* rec(overlays[i], `/slides/${slideIndex}/overlays/${i}`, null);
  }
}

export function* walkDeck(deck: Deck): Generator<NodeVisit> {
  for (let s = 0; s < deck.slides.length; s++) {
    yield* walkSlide(deck.slides[s], s);
  }
}

/** Find a node (and its pointer) by element id anywhere in the deck. */
export function findNode(deck: Deck, id: string): NodeVisit | undefined {
  for (const visit of walkDeck(deck)) {
    if (visit.node.id === id) return visit;
  }
  return undefined;
}

/** All ids in the deck (for uniqueness checks and id generation). */
export function allIds(deck: Deck): Set<string> {
  const ids = new Set<string>();
  for (const s of deck.slides) ids.add(s.id);
  for (const v of walkDeck(deck)) ids.add(v.node.id);
  return ids;
}

export function freshId(deck: Deck, prefix: string): string {
  const ids = allIds(deck);
  let n = 1;
  while (ids.has(`${prefix}-${n}`)) n++;
  return `${prefix}-${n}`;
}
