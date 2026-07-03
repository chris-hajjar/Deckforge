/** Quick visual check of the restyled chrome across all three tabs. */
import { execSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
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
await page.locator(".thumb").nth(2).click();
await page.waitForTimeout(300);

await page.screenshot({ path: join(here, "out/ui-1-deck.png") });
await page.getByRole("button", { name: "Design systems" }).click();
await page.waitForSelector(".theme-card");
await page.locator(".theme-card").last().getByRole("button", { name: /duplicate|edit/ }).first().click();
await page.waitForTimeout(400);
await page.screenshot({ path: join(here, "out/ui-2-design.png") });
await page.getByRole("button", { name: "Templates" }).click();
await page.waitForSelector(".tpl-card");

// multi-select: select all → bulk bar appears with the right count
const cards = await page.locator(".tpl-card").count();
await page.getByRole("button", { name: "select all" }).click();
const count = await page.locator(".tpl-bulk .count").textContent();
if (count !== `${cards} selected`) throw new Error(`bulk bar shows "${count}", expected "${cards} selected"`);
if ((await page.locator(".tpl-card.sel").count()) !== cards) throw new Error("not all cards highlighted");
await page.screenshot({ path: join(here, "out/ui-3-templates.png") });
// uncheck one via its checkbox, count drops
await page.locator(".tpl-check").first().click({ force: true });
const count2 = await page.locator(".tpl-bulk .count").textContent();
if (count2 !== `${cards - 1} selected`) throw new Error(`after uncheck: "${count2}"`);
await page.getByRole("button", { name: "clear" }).click();
if ((await page.locator(".tpl-card.sel").count()) !== 0) throw new Error("clear left cards selected");
console.log(`  ✓ template multi-select (${cards} cards, select all / uncheck / clear)`);

// google setup modal via right-click: exact redirect URI + copy affordance
await page.locator(".google-btn").click({ button: "right" });
await page.waitForSelector(".uri-row code");
const uri = await page.locator(".uri-row code").textContent();
if (uri !== "http://localhost:4820/api/google/callback") throw new Error(`modal shows URI "${uri}"`);
await page.screenshot({ path: join(here, "out/ui-4-google-setup.png") });
console.log("  ✓ google setup modal shows pinned redirect URI");

await browser.close();
srv.kill();
console.log("shots done");
