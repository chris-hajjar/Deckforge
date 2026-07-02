/**
 * build-mcpb.mjs — package Deckforge as a self-contained MCP Bundle (.mcpb)
 * for Claude Desktop: double-click to install, no npm/tsx on the host needed
 * (only Node, which Claude Desktop ships with).
 *
 * Layout:
 *   manifest.json          — MCPB manifest (user_config: project folder)
 *   server/index.js        — the whole server, esbuild-bundled (deps inlined)
 *   server/canvas/…        — the built visual editor, served at :4820
 *
 * Run: node scripts/build-mcpb.mjs   →  dist-mcpb/deckforge.mcpb
 */
import { build } from "esbuild";
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist-mcpb");
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "server"), { recursive: true });

// 1. bundle OUR workspace code only; npm deps stay external and ship as a
//    real node_modules (inlining two zod majors — ours v4, the MCP SDK's v3 —
//    breaks zod's class identity checks)
const serverPkg = JSON.parse(readFileSync(join(root, "packages/server/package.json"), "utf8"));
const compilePkg = JSON.parse(readFileSync(join(root, "packages/compile-pptx/package.json"), "utf8"));
const deps = Object.fromEntries(
  Object.entries({ ...compilePkg.dependencies, ...serverPkg.dependencies }).filter(
    ([name]) => !name.startsWith("@deckforge/"),
  ),
);

await build({
  entryPoints: [join(root, "packages/server/src/main.ts")],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  // bundle @deckforge/* workspace code; keep real npm deps external
  external: Object.keys(deps).flatMap((n) => [n, `${n}/*`]),
  outfile: join(out, "server/index.js"),
  logLevel: "error",
});

// install production deps next to the bundle (nested resolution mirrors dev)
writeFileSync(
  join(out, "server/package.json"),
  JSON.stringify({ name: "deckforge-mcpb", private: true, type: "module", dependencies: deps }, null, 2),
);
execSync("npm install --omit=dev --no-audit --no-fund --loglevel=error", {
  cwd: join(out, "server"),
  stdio: "inherit",
});

// 2. ship the visual editor next to it (server falls back to ./canvas)
const canvasDist = join(root, "packages/canvas/dist");
if (!existsSync(join(canvasDist, "index.html"))) {
  console.error("canvas not built — run `npm run build:canvas` first");
  process.exit(1);
}
cpSync(canvasDist, join(out, "server/canvas"), { recursive: true });

// 3. manifest
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const manifest = {
  manifest_version: "0.2",
  name: "deckforge",
  display_name: "Deckforge",
  version,
  description: "AI-native presentation builder: build branded decks via MCP tools, fine-tune in the live canvas at http://localhost:4820, export editable .pptx.",
  long_description:
    "Deckforge keeps one validated deck as shared state: Claude edits it through its MCP tools (slides, elements, charts, animations, design systems, templates, pptx import/export) while the bundled visual editor at http://localhost:4820 shows every change live and lets you tweak anything by hand — knobs or code. Everything obeys the active design system; exports are native editable PowerPoint files that Google Slides imports cleanly.",
  author: { name: "Chris Hajjar" },
  server: {
    type: "node",
    entry_point: "server/index.js",
    mcp_config: {
      command: "node",
      args: ["${__dirname}/server/index.js", "${user_config.project_dir}", "--stdio"],
      env: {},
    },
  },
  user_config: {
    project_dir: {
      type: "directory",
      title: "Deck project folder",
      description: "Where your deck (deck.v2.json) and library (themes, templates) are stored.",
      required: true,
      default: "${HOME}/Deckforge",
    },
  },
  compatibility: { platforms: ["darwin", "win32", "linux"], runtimes: { node: ">=18.0.0" } },
  keywords: ["presentations", "slides", "pptx", "design-system", "deck"],
};
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2));

// 4. zip → .mcpb
const zip = new JSZip();
const addDir = (dir, prefix) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(p).isDirectory()) addDir(p, rel);
    else zip.file(rel, readFileSync(p));
  }
};
zip.file("manifest.json", readFileSync(join(out, "manifest.json")));
addDir(join(out, "server"), "server");
const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
const target = join(out, "deckforge.mcpb");
writeFileSync(target, buf);
console.log(`built ${relative(root, target)} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
