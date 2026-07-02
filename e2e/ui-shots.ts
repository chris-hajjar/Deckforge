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
await page.screenshot({ path: join(here, "out/ui-3-templates.png") });
await browser.close();
srv.kill();
console.log("shots done");
