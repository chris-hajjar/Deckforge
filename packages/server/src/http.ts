/**
 * http.ts — serves the canvas app and the live-sync API.
 *
 *   GET  /api/deck         → { rev, deck, tokens }  (canvas boot)
 *   POST /api/patches      → apply human JSON Patch ops through the write pipeline
 *   GET  /api/export.pptx  → compile current deck, stream the file
 *   WS   /ws               → broadcast { rev, deck, tokens, corrections, source } on every change
 */
import { createServer, type Server } from "node:http";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import type { Operation } from "fast-json-patch";
import { compileDeckToBuffer } from "@deckforge/compile-pptx";
import type { DeckStore } from "./store.js";
import type { Library } from "./library.js";

export function createHttpServer(store: DeckStore, canvasDist: string, library: Library): Server {
  const app = express();
  app.use(express.json({ limit: "4mb" }));

  app.get("/api/deck", (_req, res) => {
    res.json({ rev: store.rev, deck: store.deck, tokens: store.tokens });
  });

  app.post("/api/patches", (req, res) => {
    const patches = req.body?.patches as Operation[] | undefined;
    if (!Array.isArray(patches) || patches.length === 0) {
      res.status(400).json({ error: "body must be { patches: Operation[] }" });
      return;
    }
    try {
      const result = store.apply(patches, "human");
      res.json({ rev: result.rev, corrections: result.corrections });
    } catch (e) {
      res.status(422).json({ error: (e as Error).message });
    }
  });

  app.get("/api/templates", (_req, res) => {
    res.json({ templates: library.list() });
  });

  // save an existing slide of the deck as a library template
  app.post("/api/templates", (req, res) => {
    const { slideId, name, description } = req.body ?? {};
    try {
      const slide = store.deck.slides.find((s) => s.id === slideId);
      if (!slide) throw new Error(`No slide "${slideId}"`);
      if (!name) throw new Error("name is required");
      library.saveTemplate(name, slide, description);
      res.json({ templates: library.list() });
    } catch (e) {
      res.status(422).json({ error: (e as Error).message });
    }
  });

  // add a slide from a library template (fresh ids), the canvas path
  app.post("/api/slides", (req, res) => {
    const { template } = req.body ?? {};
    try {
      const result = store.mutate((draft) => {
        draft.slides.push(library.instantiate(draft, template));
      }, "human");
      res.json({ rev: result.rev, corrections: result.corrections });
    } catch (e) {
      res.status(422).json({ error: (e as Error).message });
    }
  });

  // upload a .pptx (PowerPoint or Google Slides export) → library templates
  app.post(
    "/api/import",
    express.raw({ type: () => true, limit: "60mb" }),
    async (req, res) => {
      try {
        const { importPptx } = await import("./import-pptx.js");
        const imported = await importPptx(req.body as Buffer);
        const prefix = String(req.query.name ?? "imported");
        const names = imported.map((imp, i) => {
          const name = `${prefix} ${i + 1}`;
          library.saveTemplate(name, imp.slide, "Imported upload");
          return name;
        });
        res.json({ imported: names, templates: library.list() });
      } catch (e) {
        res.status(422).json({ error: (e as Error).message });
      }
    },
  );

  app.get("/api/export.pptx", async (_req, res) => {
    try {
      const buf = await compileDeckToBuffer(store.deck);
      const safe = store.deck.title.replace(/[^a-z0-9-_ ]/gi, "").trim() || "deck";
      res
        .setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        )
        .setHeader("Content-Disposition", `attachment; filename="${safe}.pptx"`)
        .send(buf);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.use(express.static(canvasDist));

  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (socket) => {
    socket.send(
      JSON.stringify({ type: "init", rev: store.rev, deck: store.deck, tokens: store.tokens }),
    );
  });

  store.subscribe((result, source) => {
    const msg = JSON.stringify({
      type: "deck",
      rev: result.rev,
      deck: result.deck,
      tokens: result.tokens,
      corrections: result.corrections,
      source,
    });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
    }
  });

  return server;
}
