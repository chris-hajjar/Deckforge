/**
 * Google Slides OAuth mechanics (the parts testable without a Google
 * account): config persistence, consent-URL construction with PKCE,
 * token exchange/refresh request shapes, and the Slides-converting upload.
 */
import { mkdtempSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleSlides } from "../src/google.js";

const tempProject = () => {
  const dir = mkdtempSync(join(tmpdir(), "deckforge-google-"));
  mkdirSync(join(dir, "library"), { recursive: true });
  return dir;
};

afterEach(() => vi.restoreAllMocks());

describe("GoogleSlides", () => {
  it("reports unconfigured → configured → connected states", async () => {
    const g = new GoogleSlides(tempProject());
    expect(g.status()).toEqual({ configured: false, connected: false });
    g.saveConfig({ client_id: "id.apps.googleusercontent.com", client_secret: "GOCSPX-x" });
    expect(g.status()).toEqual({ configured: true, connected: false });
    expect(() => g.saveConfig({ client_id: " ", client_secret: "" } as never)).toThrow(/required/);
  });

  it("builds a PKCE consent URL with drive.file scope and offline access", () => {
    const g = new GoogleSlides(tempProject());
    g.saveConfig({ client_id: "cid", client_secret: "sec" });
    const url = new URL(g.authUrl("http://localhost:4820/api/google/callback"));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const p = url.searchParams;
    expect(p.get("client_id")).toBe("cid");
    expect(p.get("scope")).toBe("https://www.googleapis.com/auth/drive.file");
    expect(p.get("access_type")).toBe("offline");
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("code_challenge")).toBeTruthy();
    expect(p.get("state")).toBeTruthy();
    expect(p.get("redirect_uri")).toBe("http://localhost:4820/api/google/callback");
  });

  it("exchanges the callback code (with the matching PKCE verifier) and stores tokens", async () => {
    const dir = tempProject();
    const g = new GoogleSlides(dir);
    g.saveConfig({ client_id: "cid", client_secret: "sec" });
    const url = new URL(g.authUrl("http://localhost:4820/api/google/callback"));
    const state = url.searchParams.get("state")!;

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ access_token: "at", refresh_token: "rt", expires_in: 3600 })),
    );
    await g.handleCallback("thecode", state, "http://localhost:4820/api/google/callback");

    const body = new URLSearchParams(String(fetchMock.mock.calls[0][1]!.body));
    expect(body.get("code")).toBe("thecode");
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code_verifier")).toBeTruthy();
    expect(g.status().connected).toBe(true);
    expect(existsSync(join(dir, "library", "google-token.json"))).toBe(true);

    // unknown state (CSRF / stale attempt) is rejected
    await expect(g.handleCallback("c", "bogus-state", "http://x")).rejects.toThrow(/start again/);
  });

  it("uploads with the Slides MIME type (Drive converts) and returns the edit URL", async () => {
    const dir = tempProject();
    const g = new GoogleSlides(dir);
    g.saveConfig({ client_id: "cid", client_secret: "sec" });
    const state = new URL(g.authUrl("http://cb")).searchParams.get("state")!;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "at", refresh_token: "rt", expires_in: 3600 })),
    );
    await g.handleCallback("code", state, "http://cb");

    const upload = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ id: "FILE123" })));
    const url = await g.uploadAsSlides(Buffer.from("PKfake"), "My Deck");
    expect(url).toBe("https://docs.google.com/presentation/d/FILE123/edit");
    const [reqUrl, init] = upload.mock.calls[0];
    expect(String(reqUrl)).toContain("uploadType=multipart");
    expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer at");
    const bodyText = (init!.body as Buffer).toString();
    expect(bodyText).toContain('"application/vnd.google-apps.presentation"');
    expect(bodyText).toContain("My Deck");
  });

  it("refreshes expired access tokens before uploading", async () => {
    const dir = tempProject();
    const g = new GoogleSlides(dir);
    g.saveConfig({ client_id: "cid", client_secret: "sec" });
    const state = new URL(g.authUrl("http://cb")).searchParams.get("state")!;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "old", refresh_token: "rt", expires_in: -100 })),
    );
    await g.handleCallback("code", state, "http://cb");

    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (u, init) => {
      calls.push(String(u));
      if (String(u).includes("oauth2.googleapis.com/token")) {
        const body = new URLSearchParams(String(init!.body));
        expect(body.get("grant_type")).toBe("refresh_token");
        expect(body.get("refresh_token")).toBe("rt");
        return new Response(JSON.stringify({ access_token: "fresh", expires_in: 3600 }));
      }
      expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer fresh");
      return new Response(JSON.stringify({ id: "F2" }));
    });
    await g.uploadAsSlides(Buffer.from("x"), "T");
    expect(calls[0]).toContain("oauth2.googleapis.com/token");
    // refreshed token persisted for next time
    const saved = JSON.parse(readFileSync(join(dir, "library", "google-token.json"), "utf8"));
    expect(saved.access_token).toBe("fresh");
    expect(saved.refresh_token).toBe("rt");
  });
});
