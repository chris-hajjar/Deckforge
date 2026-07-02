/** Verify the DevTools-style Code sidebar: hover→highlight and hand edits. */
import { execSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
let failures = 0;
const check = (name: string, cond: boolean) => {
  console.log(`${cond ? "  ✓" : "  ✗ FAIL"} ${name}`);
  if (!cond) failures++;
};

try { execSync("pkill -f 'packages/server/src/main.ts' || true", { stdio: "ignore" }); } catch {}
await new Promise((r) => setTimeout(r, 400));
const srv = spawn("npx", ["tsx", join(here, "../packages/server/src/main.ts"), join(here, "out/project")], { stdio: "ignore" });
for (let i = 0; i < 50; i++) {
  try { await fetch("http://localhost:4820/api/deck"); break; } catch { await new Promise((r) => setTimeout(r, 200)); }
}
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH ? { executablePath: "/opt/pw-browsers/chromium" } : {},
);
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto("http://localhost:4820");
await page.waitForSelector(".slide-frame");
await page.locator(".thumb").nth(2).click(); // Traction
await page.waitForTimeout(300);

// switch the sidebar to Code
await page.locator(".side-tabs button", { hasText: "Code" }).click();
await page.waitForSelector(".code-editor textarea");
check("code tab shows the slide JSON", (await page.locator(".code-editor textarea").inputValue()).includes('"metricCard"'));

// hover a metric card on the canvas → its JSON block highlights
// (aim at the center of the rendered "128%" value so the target is exact)
const target = await page.locator("main .slide-frame div", { hasText: "128%" }).last().boundingBox();
await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, { steps: 4 });
await page.waitForTimeout(400);
const mark = await page.locator(".code-editor pre mark").textContent();
check("hovering the slide highlights the matching code", !!mark && mark.includes("metricCard"));
await page.screenshot({ path: join(here, "out/ui-4-code-hover.png") });

// hand-edit the JSON and apply → slide updates through the validated pipeline
const ta = page.locator(".code-editor textarea");
const stamp = `hand-edited ${Date.now()}`;
const doc = JSON.parse(await ta.inputValue());
doc.root.children[0].text = `Traction — ${stamp}`;
await ta.fill(JSON.stringify(doc, null, 2));
await page.locator(".code-toolbar button", { hasText: "apply" }).click();
await page.waitForTimeout(500);
check(
  "applied code edit renders on the canvas",
  await page.locator("main .slide-frame").getByText(stamp).isVisible(),
);
// bad JSON is rejected with a readable error, state untouched
await ta.fill("{ definitely not json");
await page.locator(".code-toolbar button", { hasText: "apply" }).click();
check("invalid JSON surfaces an error instead of applying", await page.locator(".code-error").isVisible());

await browser.close();
srv.kill();
console.log(failures === 0 ? "CODE TAB CHECKS PASSED" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
