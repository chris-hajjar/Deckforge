/**
 * store.ts — the deck state store: ONE write path for every mutation.
 *
 * AI tool calls and canvas knob-turns both land here as JSON Patch ops:
 *
 *   patches → apply to draft → normalizeDeck (schema + auto-correct) →
 *   commit → bump rev → append patch log → persist → notify subscribers
 *
 * The patch log is the shared awareness channel: the AI reads it via the
 * get_changes_since tool to see what the human just changed, and the canvas
 * receives broadcasts to stay live. Corrections are recorded per change so
 * callers always learn what the brand engine actually applied.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as jsonpatch from "fast-json-patch";
import type { Operation } from "fast-json-patch";
import { newDeck, type Deck, type ThemeTokens } from "@deckforge/schema";
import { normalizeDeck, type Correction } from "@deckforge/validate";

export type ChangeSource = "ai" | "human" | "system";

export interface ChangeEntry {
  rev: number;
  source: ChangeSource;
  /** Ops as submitted (before auto-correction rewrote values). */
  patches: Operation[];
  corrections: Correction[];
  at: string; // ISO timestamp
}

export interface ApplyResult {
  rev: number;
  deck: Deck;
  tokens: ThemeTokens;
  corrections: Correction[];
}

export type StoreListener = (result: ApplyResult, source: ChangeSource) => void;

export class DeckStore {
  deck: Deck;
  tokens: ThemeTokens;
  rev = 0;
  readonly log: ChangeEntry[] = [];
  private listeners = new Set<StoreListener>();

  constructor(private filePath: string) {
    if (existsSync(filePath)) {
      const raw = JSON.parse(readFileSync(filePath, "utf8"));
      const { deck, tokens, corrections } = normalizeDeck(raw);
      this.deck = deck;
      this.tokens = tokens;
      if (corrections.length > 0) this.persist(); // heal drift on load
    } else {
      const { deck, tokens } = normalizeDeck(newDeck());
      this.deck = deck;
      this.tokens = tokens;
      this.persist();
    }
  }

  subscribe(fn: StoreListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Apply raw JSON Patch ops (the canvas path). Throws on invalid ops/decks. */
  apply(patches: Operation[], source: ChangeSource): ApplyResult {
    // Leniency over RFC 6902: a `replace` whose final key doesn't exist yet
    // (e.g. setting style on an element that has none) is treated as `add`,
    // so UI knobs don't need to know whether a key already exists.
    const effective = structuredClone(patches).map((op) =>
      op.op === "replace" && jsonpatch.getValueByPointer(this.deck, op.path) === undefined
        ? { ...op, op: "add" as const }
        : op,
    );
    const draft = jsonpatch.applyPatch(
      structuredClone(this.deck) as Deck,
      effective,
      /* validateOperation */ true,
    ).newDocument;
    return this.commit(draft, patches, source);
  }

  /**
   * Apply a mutation function (the tool path): tools mutate a draft with
   * ordinary code; the store diffs draft vs current to record real patches.
   */
  mutate(fn: (draft: Deck) => void, source: ChangeSource): ApplyResult {
    const draft = structuredClone(this.deck) as Deck;
    fn(draft);
    const patches = jsonpatch.compare(this.deck, draft) as Operation[];
    if (patches.length === 0) {
      return { rev: this.rev, deck: this.deck, tokens: this.tokens, corrections: [] };
    }
    return this.commit(draft, patches, source);
  }

  private commit(draft: Deck, patches: Operation[], source: ChangeSource): ApplyResult {
    const { deck, tokens, corrections } = normalizeDeck(draft); // throws on invalid
    this.deck = deck;
    this.tokens = tokens;
    this.rev += 1;
    this.log.push({
      rev: this.rev,
      source,
      patches,
      corrections,
      at: new Date().toISOString(),
    });
    this.persist();
    const result: ApplyResult = { rev: this.rev, deck, tokens, corrections };
    for (const fn of this.listeners) fn(result, source);
    return result;
  }

  changesSince(rev: number): ChangeEntry[] {
    return this.log.filter((e) => e.rev > rev);
  }

  private persist() {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.deck, null, 2) + "\n");
  }
}
