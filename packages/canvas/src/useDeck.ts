/**
 * useDeck — the canvas's live view of server state.
 * Boot from GET /api/deck, stay live over WS, and push edits back as JSON
 * Patch ops (the same write path the AI uses).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Operation } from "fast-json-patch";
import type { Deck, ThemeTokens } from "@deckforge/schema";
import type { Correction } from "@deckforge/validate";

export interface DeckState {
  rev: number;
  deck: Deck;
  tokens: ThemeTokens;
  lastCorrections: Correction[];
  lastSource: string | null;
  connected: boolean;
}

export function useDeck() {
  const [state, setState] = useState<DeckState | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let disposed = false;
    let retry: ReturnType<typeof setTimeout>;

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      wsRef.current = ws;
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.type === "init" || msg.type === "deck") {
          setState((prev) => ({
            rev: msg.rev,
            deck: msg.deck,
            tokens: msg.tokens,
            lastCorrections: msg.corrections ?? [],
            lastSource: msg.source ?? null,
            connected: true,
          }));
        }
      };
      ws.onclose = () => {
        setState((prev) => (prev ? { ...prev, connected: false } : prev));
        if (!disposed) retry = setTimeout(connect, 1500);
      };
    };

    fetch("/api/deck")
      .then((r) => r.json())
      .then((d) =>
        setState({
          rev: d.rev,
          deck: d.deck,
          tokens: d.tokens,
          lastCorrections: [],
          lastSource: null,
          connected: false,
        }),
      )
      .then(connect);

    return () => {
      disposed = true;
      clearTimeout(retry);
      wsRef.current?.close();
    };
  }, []);

  const sendPatches = useCallback(async (patches: Operation[]) => {
    const res = await fetch("/api/patches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patches }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      console.warn("patch rejected:", err.error);
    }
    // state update arrives via WS broadcast
  }, []);

  return { state, sendPatches };
}
