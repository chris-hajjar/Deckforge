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
await page.locator("main .slide-frame div", { hasText: "$4.2M" }).last().click({ force: true });
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

// ---------- 6. deep customization: shapes, animations, table, overlay ----------
console.log("[6] building an animated roadmap slide (shapes/table/overlay/transition)");
const s6 = await tool("create_slide", { template: "blank", name: "Roadmap" });
await tool("add_element", {
  slideId: s6.slideId,
  element: { type: "heading", text: "Roadmap to Series C", level: 2 },
});
await tool("add_element", {
  slideId: s6.slideId,
  element: {
    type: "row",
    style: { gap: 16 },
    animation: { effect: "flyIn", direction: "bottom", order: 1 },
    children: [
      { type: "shape", shape: "chevron", fill: "accent", text: "Build", sizing: { height: 110 } },
      { type: "shape", shape: "chevron", fill: "accent", text: "Launch", sizing: { height: 110 } },
      {
        type: "shape",
        shape: "chevron",
        gradient: { from: "accent", to: "accent-alt", angle: 0 },
        text: "Scale",
        sizing: { height: 110 },
      },
    ],
  },
});
await tool("add_element", {
  slideId: s6.slideId,
  element: {
    type: "bulletList",
    items: ["Q1 — AtlasPick GA", "Q2 — EU grocery pilots", "Q3 — 200 units/quarter"],
    animation: { effect: "fade", order: 2, byParagraph: true },
  },
});
await tool("add_element", {
  slideId: s6.slideId,
  element: {
    type: "table",
    header: true,
    columns: [2, 1, 1],
    rows: [
      ["Milestone", "Quarter", "Owner"],
      ["AtlasPick GA", "Q1", "Product"],
      ["EU grocery pilots", "Q2", "GTM"],
    ],
    animation: { effect: "wipe", direction: "left", order: 3 },
  },
});
await tool("add_overlay", {
  slideId: s6.slideId,
  element: { type: "shape", shape: "ellipse", fill: "accent-alt", text: "NEW" },
  frame: { x: 1080, y: 48, w: 130, h: 130 },
});
const badgeSlide = await tool("get_slide", { slideId: s6.slideId });
const badgeId = badgeSlide.slide.overlays[0].id;
await tool("set_animation", { elementId: badgeId, animation: { effect: "zoom", order: 4 } });
await tool("set_transition", { slideId: s6.slideId, transition: { type: "push", direction: "left" } });
await tool("set_notes", { slideId: s6.slideId, notes: "Pause here — this is the ask setup." });
// move the badge with the same tool the drag gesture uses
const moved = await tool("set_frame", { elementId: badgeId, frame: { x: 1060, y: 40, w: 150, h: 150 } });
check("overlay badge moved via set_frame", moved.rev > 0);

// canvas: view the slide, then step through Present mode
const page2 = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page2.goto(BASE);
await page2.waitForSelector(".slide-frame");
await page2.locator(".thumb").nth(5).click();
await page2.waitForTimeout(300);
await page2.screenshot({ path: join(outDir, "4-canvas-roadmap.png") });
check(
  "canvas renders native chevrons as SVG",
  (await page2.locator("main svg path").count()) >= 3,
);

await page2.getByRole("button", { name: "▶ Present" }).click();
await page2.waitForSelector(".present");
await page2.waitForTimeout(600);
await page2.screenshot({ path: join(outDir, "5-present-step0.png") });
const chevronsHidden = !(await page2.locator(".present").getByText("Build").isVisible().catch(() => false));
check("present mode: animated chevrons hidden before their click", chevronsHidden);
await page2.keyboard.press("ArrowRight"); // chevrons fly in
await page2.waitForTimeout(700);
check("step 1 reveals the chevron group", await page2.locator(".present").getByText("Build").isVisible());
await page2.keyboard.press("ArrowRight"); // first bullet fades
await page2.waitForTimeout(400);
const bullet2Hidden = !(await page2.locator(".present").getByText("Q2 — EU grocery pilots").isVisible().catch(() => false));
check("byParagraph: second bullet still hidden after first click", bullet2Hidden);
await page2.keyboard.press("ArrowRight"); // second bullet
await page2.waitForTimeout(400);
check("byParagraph: second bullet revealed on its own click", await page2.locator(".present").getByText("Q2 — EU grocery pilots").isVisible());
await page2.keyboard.press("ArrowRight"); // third bullet
await page2.keyboard.press("ArrowRight"); // table wipes in
await page2.waitForTimeout(700);
await page2.screenshot({ path: join(outDir, "6-present-mid.png") });
await page2.keyboard.press("Escape");

// ---------- 7. re-export with animations and verify the OpenXML ----------
console.log("[7] exporting the animated deck");
const pptx2 = await fetch(`${BASE}/api/export.pptx`);
const buf2 = Buffer.from(await pptx2.arrayBuffer());
writeFileSync(join(outDir, "Atlas Robotics — Series B.pptx"), buf2);
const { execFileSync } = await import("node:child_process");
const xdir = join(outDir, "pptx-x");
execFileSync("unzip", ["-o", "-q", join(outDir, "Atlas Robotics — Series B.pptx"), "-d", xdir]);
const { readFileSync } = await import("node:fs");
const slide6xml = readFileSync(join(xdir, "ppt", "slides", "slide6.xml"), "utf8");
check("pptx slide 6 has a push transition", slide6xml.includes("<p:push dir=\"l\"/>"));
check("pptx slide 6 has an entrance timing tree", slide6xml.includes("<p:timing>") && slide6xml.includes('presetClass="entr"'));
check("pptx slide 6 has per-bullet paragraph builds", slide6xml.includes('<p:pRg st="1" end="1"/>'));
check("pptx slide 6 has a native table and chevrons", slide6xml.includes("<a:tbl>") && slide6xml.includes('prstGeom prst="chevron"'));
check("pptx slide 6 has a gradient chevron", slide6xml.includes("<a:gradFill"));
const notes6 = readFileSync(join(xdir, "ppt", "notesSlides", "notesSlide6.xml"), "utf8");
check("pptx slide 6 carries presenter notes", notes6.includes("Pause here"));

// ---------- 8. charts + margins ----------
console.log("[8] building an analytics slide (charts + margin spacing)");
const s8 = await tool("create_slide", { template: "blank", name: "Analytics" });
await tool("add_element", {
  slideId: s8.slideId,
  element: { type: "heading", text: "The numbers", level: 2 },
});
await tool("add_element", {
  slideId: s8.slideId,
  element: {
    type: "row",
    style: { gap: 32 },
    children: [
      {
        type: "chart",
        chartType: "column",
        categories: ["FY24", "FY25", "FY26"],
        series: [
          { name: "ARR ($M)", values: [1.1, 2.4, 4.2] },
          { name: "Pipeline ($M)", values: [2.3, 4.0, 7.5] },
        ],
        sizing: { height: 360, margin: { top: 16 } },
      },
      {
        type: "donutchart" as never, // wrong on purpose — schema must reject
      },
    ],
  },
}).then(
  () => check("schema rejected an invalid chart element", false),
  () => check("schema rejected an invalid chart element", true),
);
// the row failed atomically; add the valid version
await tool("add_element", {
  slideId: s8.slideId,
  element: {
    type: "row",
    style: { gap: 32 },
    children: [
      {
        type: "chart",
        chartType: "column",
        categories: ["FY24", "FY25", "FY26"],
        series: [
          { name: "ARR ($M)", values: [1.1, 2.4, 4.2] },
          { name: "Pipeline ($M)", values: [2.3, 4.0, 7.5] },
        ],
        sizing: { height: 360, margin: { top: 16 } },
      },
      {
        type: "chart",
        chartType: "donut",
        categories: ["Enterprise", "Mid-market", "SMB"],
        series: [{ name: "Revenue mix", values: [55, 30, 15] }],
        sizing: { height: 360, margin: { top: 16 }, weight: 0.7 },
      },
    ],
  },
});
// margin snapping: off-scale margin gets snapped and reported
const analytics = await tool("get_slide", { slideId: s8.slideId });
const headingId8 = analytics.slide.root.children[0].id;
const snapped = await tool("set_sizing", {
  elementId: headingId8,
  sizing: { margin: { bottom: 29 } },
});
check(
  "margin snapped to brand spacing scale (29→32)",
  snapped.corrections.some((c: { to: unknown }) => c.to === 32),
  JSON.stringify(snapped.corrections),
);

const page3 = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page3.goto(BASE);
await page3.waitForSelector(".slide-frame");
await page3.locator(".thumb").nth(6).click();
await page3.waitForTimeout(400);
await page3.screenshot({ path: join(outDir, "7-canvas-charts.png") });
check(
  "canvas renders chart SVG marks",
  (await page3.locator("main svg rect").count()) >= 6, // 2 series × 3 categories
);
await page3.close();

// export and verify native chart parts
const pptx3 = await fetch(`${BASE}/api/export.pptx`);
writeFileSync(join(outDir, "Atlas Robotics — Series B.pptx"), Buffer.from(await pptx3.arrayBuffer()));
const xdir3 = join(outDir, "pptx-x3");
execSync(`unzip -o -q "${join(outDir, "Atlas Robotics — Series B.pptx")}" -d "${xdir3}"`);
const chartFiles = (await import("node:fs")).readdirSync(join(xdir3, "ppt", "charts")).filter((f) => f.endsWith(".xml"));
check("pptx contains native chart parts", chartFiles.length >= 2, `found ${chartFiles.length}`);
const chartXml = chartFiles.map((f) => readFileSync(join(xdir3, "ppt", "charts", f), "utf8")).join("");
check("charts are editable bar+doughnut XML", chartXml.includes("<c:barChart>") && chartXml.includes("<c:doughnutChart>"));
check("chart series use the validated palette", chartXml.toUpperCase().includes("2A78D6"));

// ---------- 9. design library: themes, templates, pptx import ----------
console.log("[9] design library: register a brand, save/reuse/import templates");
const branded = await tool("register_theme", {
  name: "atlas-brand",
  base: "corporate-bold",
  colors: { accent: "#6d28d9", "accent-alt": "#d97706" },
});
check("custom design system registered", branded.registered === "atlas-brand");
await tool("set_theme", { base: "atlas-brand" });
const ds = await tool("get_design_system");
check("deck now runs on the registered design system", ds.tokens.colors.accent === "#6d28d9");

await tool("save_slide_as_template", {
  slideId: s3.slideId,
  name: "kpi-trio",
  description: "Heading + three metric cards",
});
const fromTpl = await tool("create_slide", { template: "kpi-trio", name: "KPIs (from template)" });
check("slide stamped from saved template", !!fromTpl.slideId);
const again = await tool("create_slide", { template: "kpi-trio" });
check("template instantiates repeatedly with fresh ids", again.slideId !== fromTpl.slideId);

// import the deck we just exported — the PowerPoint/Google Slides path
const importRes = await fetch(`${BASE}/api/import?name=external`, {
  method: "POST",
  body: new Blob([readFileSync(join(outDir, "Atlas Robotics — Series B.pptx"))]),
});
const importData = await importRes.json();
check("pptx import registered one template per slide", importRes.ok && importData.imported.length >= 7, `imported ${importData.imported?.length}`);
const fromImport = await tool("create_slide", { template: "external 3" });
check("imported template instantiates via create_slide", !!fromImport.slideId);
const tplList = await tool("list_templates");
check("library lists saved + imported templates", tplList.library.length >= 8, `${tplList.library.length} templates`);
// cleanup the stamped demo slides so the deck artifact stays 7 slides
await tool("delete_slide", { slideId: fromTpl.slideId });
await tool("delete_slide", { slideId: again.slideId });
await tool("delete_slide", { slideId: fromImport.slideId });
await tool("set_theme", { base: "corporate-bold", overrides: { colors: { accent: "#6d28d9", "accent-alt": "#d97706" } } });

await browser.close();
await ai.close();

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} — artifacts in e2e/out/`);
process.exit(failures === 0 ? 0 : 1);
