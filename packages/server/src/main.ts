/**
 * main.ts — Deckforge v2 server entry.
 *
 *   deckforge [projectDir]            HTTP + WS + canvas on port 4820
 *   deckforge [projectDir] --stdio    additionally exposes MCP over stdio
 *                                     (register this in Claude Desktop/Code)
 *
 * One process holds ONE DeckStore; the MCP tools and the canvas edit the
 * same live state, which is the whole point.
 */
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DeckStore } from "./store.js";
import { Library } from "./library.js";
import { registerTools } from "./tools.js";
import { createHttpServer } from "./http.js";

const args = process.argv.slice(2);
const stdio = args.includes("--stdio");
const projectDir = resolve(args.find((a) => !a.startsWith("--")) ?? process.cwd());
const port = Number(process.env.DECKFORGE_PORT ?? 4820);

// stdout belongs to MCP in stdio mode — everything human goes to stderr.
const log = (...parts: unknown[]) => console.error("[deckforge]", ...parts);

// library first: custom themes must be registered before the deck (which may
// reference one) is loaded and validated
const library = new Library(projectDir);
log(
  `library: ${library.customThemes.size} custom theme(s), ${library.templates.size} template(s)`,
);
const store = new DeckStore(join(projectDir, "deck.v2.json"));
log(`deck: ${join(projectDir, "deck.v2.json")} (rev ${store.rev})`);

const here = dirname(fileURLToPath(import.meta.url));
// dev layout, then bundled (.mcpb) layout, then explicit override
const canvasCandidates = [
  process.env.DECKFORGE_CANVAS_DIST,
  resolve(here, "../../canvas/dist"),
  resolve(here, "canvas"),
].filter((p): p is string => !!p);
const canvasDist = canvasCandidates.find((p) => existsSync(join(p, "index.html"))) ?? canvasCandidates[1];
const httpServer = createHttpServer(store, canvasDist, library);
httpServer.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    log(`port ${port} is already in use — is another Deckforge running? (set DECKFORGE_PORT to change)`);
  } else {
    log("http server error:", err.message);
  }
  process.exit(1);
});
httpServer.listen(port, () => log(`canvas + API: http://localhost:${port}`));

if (stdio) {
  const mcp = new McpServer({ name: "deckforge", version: "2.0.0" });
  registerTools(mcp, store, projectDir, library);
  await mcp.connect(new StdioServerTransport());
  log("MCP connected over stdio");
} else {
  // still register tools on a server instance so tests can exercise them via
  // the in-memory transport; harmless otherwise.
  log("running without MCP stdio (pass --stdio when launching from an MCP client)");
}
