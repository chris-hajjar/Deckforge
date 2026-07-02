/**
 * Server tests: the store's unified write path, and the MCP tool surface
 * exercised through a real client over the SDK's in-memory transport.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { DeckStore } from "../src/store.js";
import { Library } from "../src/library.js";
import { registerTools } from "../src/tools.js";

function tempStore(): { store: DeckStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "deckforge-store-"));
  return { store: new DeckStore(join(dir, "deck.v2.json")), dir };
}

describe("DeckStore write pipeline", () => {
  let store: DeckStore;
  beforeEach(() => {
    store = tempStore().store;
  });

  it("applies human JSON patches with auto-correction and logs the change", () => {
    const result = store.apply(
      [{ op: "replace", path: "/slides/0/root/children/0/style", value: { color: "#0a5fd9" } }],
      "human",
    );
    expect(result.rev).toBe(1);
    expect(result.corrections).toHaveLength(1);
    expect((result.deck.slides[0].root as any).children[0].style.color).toBe("accent");
    const log = store.changesSince(0);
    expect(log).toHaveLength(1);
    expect(log[0].source).toBe("human");
  });

  it("rejects patches that break the schema without changing state", () => {
    expect(() =>
      store.apply([{ op: "replace", path: "/slides", value: "garbage" }], "human"),
    ).toThrow();
    expect(store.rev).toBe(0);
    expect(store.deck.slides).toHaveLength(1);
  });

  it("mutate() records diffs as patches and notifies subscribers", () => {
    const events: number[] = [];
    store.subscribe((r) => events.push(r.rev));
    const result = store.mutate((draft) => {
      draft.title = "Board deck";
    }, "ai");
    expect(result.rev).toBe(1);
    expect(events).toEqual([1]);
    expect(store.changesSince(0)[0].patches).toEqual([
      { op: "replace", path: "/title", value: "Board deck" },
    ]);
  });

  it("persists and reloads from disk", () => {
    const { store: s1, dir } = tempStore();
    s1.mutate((d) => {
      d.title = "Persisted";
    }, "ai");
    const s2 = new DeckStore(join(dir, "deck.v2.json"));
    expect(s2.deck.title).toBe("Persisted");
  });
});

describe("MCP tool surface", () => {
  let store: DeckStore;
  let client: Client;

  beforeEach(async () => {
    const t = tempStore();
    store = t.store;
    const server = new McpServer({ name: "deckforge-test", version: "2.0.0" });
    registerTools(server, store, t.dir, new Library(t.dir));
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([server.connect(serverT), client.connect(clientT)]);
  });

  async function call(name: string, args: Record<string, unknown> = {}) {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as Array<{ text: string }>)[0].text;
    if (res.isError) throw new Error(text);
    return JSON.parse(text);
  }

  it("builds a metrics slide via tools, with brand corrections applied", async () => {
    const created = await call("create_slide", { template: "metrics", name: "KPIs" });
    expect(created.slideId).toBeTruthy();
    const cardId = created.tree.children[1].children[0].id;

    const edited = await call("edit_element", {
      elementId: cardId,
      updates: { label: "ARR", value: "$4.2M", delta: "+12% QoQ" },
    });
    expect(edited.corrections).toEqual([]);

    // off-brand color on the heading → snapped and reported
    const headingId = created.tree.children[0].id;
    const styled = await call("set_style", {
      elementId: headingId,
      style: { color: "#0a5fd9", fontSize: 33 },
    });
    expect(styled.corrections).toHaveLength(2);
    expect(styled.corrections.map((c: { to: unknown }) => c.to)).toContain("accent");
    expect(styled.corrections.map((c: { to: unknown }) => c.to)).toContain(32);
  });

  it("registers a brand via set_theme and exposes it in get_design_system", async () => {
    await call("set_theme", {
      base: "minimalist-dark",
      overrides: { colors: { accent: "#ff0055" } },
    });
    const ds = await call("get_design_system");
    expect(ds.tokens.colors.accent).toBe("#ff0055");
    expect(ds.availableThemes).toContain("corporate-bold");
  });

  it("surfaces human canvas edits through get_changes_since", async () => {
    const before = await call("get_deck");
    // simulate a canvas slider: direct patch through the human path
    store.apply(
      [{ op: "replace", path: "/slides/0/root/children/0/text", value: "Hello from the canvas" }],
      "human",
    );
    const changes = await call("get_changes_since", { rev: before.rev });
    expect(changes.changes).toHaveLength(1);
    expect(changes.changes[0].source).toBe("human");
    expect(changes.changes[0].patches[0].value).toBe("Hello from the canvas");
  });

  it("rejects adding elements to non-containers with a readable error", async () => {
    const deck = await call("get_deck");
    const headingId = deck.slides[0].tree.children[0].id;
    await expect(
      call("add_element", {
        slideId: deck.slides[0].id,
        parentId: headingId,
        element: { type: "text", text: "nope" },
      }),
    ).rejects.toThrow(/not a container/);
  });

  it("auto-assigns ids to nested added elements", async () => {
    const deck = await call("get_deck");
    const added = await call("add_element", {
      slideId: deck.slides[0].id,
      element: {
        type: "row",
        children: [
          { type: "metricCard", label: "A", value: "1" },
          { type: "metricCard", label: "B", value: "2" },
        ],
      },
    });
    expect(added.elementId).toMatch(/^row/);
    const slide = await call("get_slide", { slideId: deck.slides[0].id });
    const row = slide.slide.root.children.at(-1);
    expect(row.children).toHaveLength(2);
    expect(new Set(row.children.map((c: { id: string }) => c.id)).size).toBe(2);
  });

  it("exports a pptx file via the tool", async () => {
    const out = await call("export_pptx", {});
    expect(out.path).toMatch(/\.pptx$/);
    expect(out.slides).toBe(1);
  });

  it("exposes design tokens and current deck as MCP resources", async () => {
    const tokens = await client.readResource({ uri: "design-system://tokens" });
    expect(JSON.parse((tokens.contents[0] as { text: string }).text).colors.accent).toBeTruthy();
    const deck = await client.readResource({ uri: "deck://current" });
    expect(JSON.parse((deck.contents[0] as { text: string }).text).deck.schemaVersion).toBe(2);
  });
});
