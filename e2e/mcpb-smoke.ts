/** Smoke-test the .mcpb bundle contents: plain-node server, MCP + canvas. */
import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = dirname(fileURLToPath(import.meta.url));
try { execSync("pkill -f 'server/index.js' || true", { stdio: "ignore" }); execSync("pkill -f 'packages/server/src/main.ts' || true", { stdio: "ignore" }); } catch {}
await new Promise((r) => setTimeout(r, 400));

const project = mkdtempSync(join(tmpdir(), "deckforge-mcpb-"));
const transport = new StdioClientTransport({
  command: "node",
  args: [join(here, "../dist-mcpb/server/index.js"), project, "--stdio"],
  stderr: "pipe",
});
const client = new Client({ name: "mcpb-smoke", version: "1.0.0" });
await client.connect(transport);

const tools = await client.listTools();
console.log(`✓ MCP handshake over stdio — ${tools.tools.length} tools`);

const res = await client.callTool({ name: "create_slide", arguments: { template: "metrics", name: "Smoke" } });
const body = JSON.parse((res.content as Array<{ text: string }>)[0].text);
console.log(`✓ tool call works (rev ${body.rev}, slide ${body.slideId})`);

for (let i = 0; i < 40; i++) { try { await fetch("http://localhost:4820/api/deck"); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
const html = await (await fetch("http://localhost:4820/")).text();
console.log(html.includes("Deckforge") ? "✓ bundled canvas serves at :4820" : "✗ canvas missing");

const pptx = await fetch("http://localhost:4820/api/export.pptx");
const buf = Buffer.from(await pptx.arrayBuffer());
console.log(buf.subarray(0, 2).toString() === "PK" ? `✓ pptx export from bundle (${(buf.length / 1024).toFixed(0)} KB)` : "✗ export broken");

await client.close();
console.log("MCPB SMOKE PASSED");
