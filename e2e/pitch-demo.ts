/**
 * e2e/pitch-demo.ts — the full Deckforge v2 journey, verified end to end:
 *
 *  1. spawn the server (MCP stdio + HTTP/WS in one process)
 *  2. AS THE AI: register a brand, build a 5-slide pitch deck via MCP tools
 *     (including an off-brand color that auto-correction must snap)
 *  3. AS THE HUMAN: open the canvas in Chromium, click elements, screenshot
 *  4. simulate a canvas edit via /api/patches and confirm the AI sees it
 *     through get_changes_since, and that the WS-live canvas re-rendered
 *  5. export .pptx over HTTP and check it opens
 *
 * Run: npx tsx e2e/pitch-demo.ts
 * Artifacts land in e2e/out/.
 */
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chromium } from "playwright";

// make the run idempotent: clear any server left over from a previous run
try {
  execSync("pkill -f 'packages/server/src/main.ts' || true", { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 500));
} catch {
  /* nothing to kill */
}

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const outDir = join(here, "out");
const demoProject = join(outDir, "project");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(demoProject, { recursive: true });

const PORT = 4820;
const BASE = `http://localhost:${PORT}`;

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗ FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

// ---------- 1. spawn server (MCP client owns the process) ----------
const transport = new StdioClientTransport({
  command: "npx",
  args: ["tsx", join(repo, "packages/server/src/main.ts"), demoProject, "--stdio"],
  cwd: repo,
  stderr: "pipe",
});
const ai = new Client({ name: "e2e-ai", version: "1.0.0" });
await ai.connect(transport);
console.log("\n[1] server up, MCP connected");

async function tool(name: string, args: Record<string, unknown> = {}) {
  const res = await ai.callTool({ name, arguments: args });
  const text = (res.content as Array<{ text: string }>)[0].text;
  if (res.isError) throw new Error(`${name}: ${text}`);
  return JSON.parse(text);
}

// wait for HTTP to come up
for (let i = 0; i < 50; i++) {
  try {
    await fetch(`${BASE}/api/deck`);
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 200));
  }
}

// ---------- 2. the AI builds a branded pitch deck ----------
console.log("[2] building the deck via MCP tools (as the AI)");

await tool("set_deck_title", { title: "Atlas Robotics — Series B" });
// brand registration: PM inputs company hex codes on a base theme
const themed = await tool("set_theme", {
  base: "corporate-bold",
  overrides: { colors: { accent: "#6d28d9", "accent-alt": "#d97706" } },
});
check("brand override registered", themed.tokens.colors.accent === "#6d28d9");

const s1 = await tool("create_slide", { template: "title", name: "Cover" });
await tool("edit_element", { elementId: `${s1.slideId}-title`, updates: { text: "Atlas Robotics" } });
await tool("edit_element", {
  elementId: `${s1.slideId}-subtitle`,
  updates: { text: "Series B · Investor Briefing · FY26" },
});

const s2 = await tool("create_slide", { template: "bullets", name: "Problem" });
await tool("edit_element", { elementId: `${s2.slideId}-h`, updates: { text: "Warehouse labor is the bottleneck" } });
await tool("edit_element", {
  elementId: `${s2.slideId}-list`,
  updates: {
    items: [
      "1.2M unfilled logistics roles across the US and EU",
      "Turnover above 40% makes training a recurring cost",
      "Peak-season throughput capped by headcount, not demand",
      "Incumbent automation needs 18-month integrations",
    ],
  },
});

const s3 = await tool("create_slide", { template: "metrics", name: "Traction" });
await tool("edit_element", { elementId: `${s3.slideId}-h`, updates: { text: "Traction" } });
await tool("edit_element", { elementId: `${s3.slideId}-m1`, updates: { label: "ARR", value: "$4.2M", delta: "+142% YoY" } });
await tool("edit_element", { elementId: `${s3.slideId}-m2`, updates: { label: "Net revenue retention", value: "128%" } });
await tool("edit_element", { elementId: `${s3.slideId}-m3`, updates: { label: "Robots deployed", value: "312", delta: "+9 sites" } });

// the AI tries an off-brand color → the server must snap it and report it
const styled = await tool("set_style", { elementId: `${s3.slideId}-h`, style: { color: "#7a2ee8" } });
check(
  "auto-correction snapped off-brand hex to accent token",
  styled.corrections.length === 1 && styled.corrections[0].to === "accent",
  JSON.stringify(styled.corrections[0] ?? {}),
);

const s4 = await tool("create_slide", { template: "split", name: "Product" });
await tool("edit_element", { elementId: `${s4.slideId}-h`, updates: { text: "One platform, three revenue lines" } });
await tool("add_element", {
  slideId: s4.slideId,
  parentId: `${s4.slideId}-left`,
  element: {
    type: "bulletList",
    items: [
      "AtlasOS — fleet orchestration, $/robot/month",
      "AtlasPick — vision picking, per-pick pricing",
      "AtlasCare — SLA support and spares",
    ],
  },
});
await tool("add_element", {
  slideId: s4.slideId,
  parentId: `${s4.slideId}-right`,
  element: { type: "metricCard", label: "Payback period", value: "11 mo", delta: "vs 26 mo industry avg" },
});
await tool("add_element", {
  slideId: s4.slideId,
  parentId: `${s4.slideId}-right`,
  element: { type: "metricCard", label: "Pick accuracy", value: "99.7%" },
});

const s5 = await tool("create_slide", { template: "bullets", name: "Ask" });
await tool("edit_element", { elementId: `${s5.slideId}-h`, updates: { text: "The ask: $30M Series B" } });
await tool("edit_element", {
  elementId: `${s5.slideId}-list`,
  updates: {
    items: [
      "60% — manufacturing scale-up to 200 units/quarter",
      "25% — GTM expansion into EU grocery",
      "15% — AtlasPick R&D and certification",
    ],
  },
});

await tool("delete_slide", { slideId: "slide-1" }); // drop the starter slide

const overview = await tool("get_deck");
check("deck has 5 slides", overview.slides.length === 5, `got ${overview.slides.length}`);
const revAfterAI = overview.rev;

// ---------- 3. the human opens the canvas ----------
console.log("[3] opening the canvas in Chromium (as the human)");
const browser = await chromium.launch(
  // prefer the environment's preinstalled Chromium when the pinned
  // playwright version doesn't match the downloaded browser build
  process.env.PLAYWRIGHT_BROWSERS_PATH ? { executablePath: "/opt/pw-browsers/chromium" } : {},
);
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto(BASE);
await page.waitForSelector(".slide-frame");
await page.waitForTimeout(400);
check("canvas shows live rev", (await page.locator(".conn").textContent())?.includes("live") ?? false);
await page.screenshot({ path: join(outDir, "1-canvas-cover.png") });

// go to Traction, click a metric card → inspector opens with knobs
await page.locator(".thumb").nth(2).click();
await page.waitForTimeout(200);
await page.locator("main .slide-frame div", { hasText: "$4.2M" }).last().click();
await page.waitForTimeout(200);
const chip = await page.locator(".inspector .chip").textContent();
check("clicking a metric card opens its inspector", chip === "metricCard", `chip=${chip}`);
await page.screenshot({ path: join(outDir, "2-canvas-inspector.png") });

// ---------- 4. bi-directional sync ----------
console.log("[4] human edits via canvas API; AI reads it back");
const s3Slide = overview.slides.find((s: { name: string }) => s.name === "Traction");
const res = await fetch(`${BASE}/api/patches`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    patches: [
      {
        op: "replace",
        path: `/slides/${s3Slide.index}/root/children/0/text`,
        value: "Traction (reviewed by finance)",
      },
    ],
  }),
});
check("human patch accepted", res.ok);
await page.waitForTimeout(500);
check(
  "canvas re-rendered the human edit live over WS",
  await page.locator("main .slide-frame").getByText("Traction (reviewed by finance)").isVisible(),
);
await page.screenshot({ path: join(outDir, "3-canvas-after-human-edit.png") });

const changes = await tool("get_changes_since", { rev: revAfterAI });
check(
  "AI sees the human edit in the patch log",
  changes.changes.length === 1 &&
    changes.changes[0].source === "human" &&
    JSON.stringify(changes.changes[0].patches).includes("reviewed by finance"),
);

// ---------- 5. export ----------
console.log("[5] exporting .pptx");
const pptxRes = await fetch(`${BASE}/api/export.pptx`);
check("HTTP export responds", pptxRes.ok);
const pptxBuf = Buffer.from(await pptxRes.arrayBuffer());
writeFileSync(join(outDir, "Atlas Robotics — Series B.pptx"), pptxBuf);
check("pptx is a zip (OpenXML)", pptxBuf.subarray(0, 2).toString() === "PK");
const toolExport = await tool("export_pptx", {});
check("tool export reports 5 slides, no layout warnings",
  toolExport.slides === 5 && toolExport.layoutWarnings.length === 0,
  `warnings: ${JSON.stringify(toolExport.layoutWarnings)}`);

// screenshots of remaining slides for the record
for (const [i, name] of [[0, "cover"], [1, "problem"], [3, "product"], [4, "ask"]] as const) {
  await page.locator(".thumb").nth(i).click();
  await page.waitForTimeout(250);
  await page.locator("main .slide-frame").screenshot({ path: join(outDir, `slide-${i + 1}-${name}.png`) });
}
await page.locator(".thumb").nth(2).click();
await page.waitForTimeout(250);
await page.locator("main .slide-frame").screenshot({ path: join(outDir, "slide-3-traction.png") });

await browser.close();
await ai.close();

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} — artifacts in e2e/out/`);
process.exit(failures === 0 ? 0 : 1);
