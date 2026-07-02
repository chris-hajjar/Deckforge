/**
 * google.ts — "Open in Google Slides", like a normal app.
 *
 * Standard OAuth 2.0 for installed apps: the developer registers ONE Google
 * Cloud OAuth client (Desktop type) whose credentials live in the project
 * library; every user then signs in with their own Google account via the
 * consent screen. Authorization-code flow with PKCE over the loopback
 * redirect (our own HTTP server at /api/google/callback); refresh token is
 * cached per-project so sign-in happens once.
 *
 * Scope is drive.file only — Deckforge can touch files it created, nothing
 * else in the user's Drive. Uploading with the Google Slides MIME type makes
 * Drive CONVERT the pptx into a native, fully editable Slides presentation.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash, randomBytes } from "node:crypto";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const UPLOAD_URL =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id";
const SCOPE = "https://www.googleapis.com/auth/drive.file";

interface OAuthConfig {
  client_id: string;
  client_secret: string;
}

interface TokenSet {
  access_token: string;
  refresh_token?: string;
  /** epoch ms when access_token expires */
  expiry: number;
}

const b64url = (buf: Buffer) =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export class GoogleSlides {
  private configPath: string;
  private tokenPath: string;
  /** state → PKCE verifier for in-flight auth attempts */
  private pending = new Map<string, string>();

  constructor(projectDir: string) {
    this.configPath = join(projectDir, "library", "google-oauth.json");
    this.tokenPath = join(projectDir, "library", "google-token.json");
  }

  private readJson<T>(path: string): T | null {
    try {
      return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : null;
    } catch {
      return null;
    }
  }

  get config(): OAuthConfig | null {
    const c = this.readJson<OAuthConfig>(this.configPath);
    return c?.client_id && c?.client_secret ? c : null;
  }

  get tokens(): TokenSet | null {
    return this.readJson<TokenSet>(this.tokenPath);
  }

  status() {
    return { configured: this.config !== null, connected: this.tokens?.refresh_token != null };
  }

  saveConfig(cfg: OAuthConfig) {
    if (!cfg.client_id?.trim() || !cfg.client_secret?.trim()) {
      throw new Error("client_id and client_secret are both required");
    }
    mkdirSync(dirname(this.configPath), { recursive: true });
    writeFileSync(
      this.configPath,
      JSON.stringify({ client_id: cfg.client_id.trim(), client_secret: cfg.client_secret.trim() }, null, 2),
    );
  }

  disconnect() {
    rmSync(this.tokenPath, { force: true });
  }

  /** Build the consent-screen URL (PKCE); state ties the callback to us. */
  authUrl(redirectUri: string): string {
    const cfg = this.config;
    if (!cfg) throw new Error("Google OAuth is not configured yet");
    const verifier = b64url(randomBytes(48));
    const state = b64url(randomBytes(16));
    this.pending.set(state, verifier);
    const params = new URLSearchParams({
      client_id: cfg.client_id,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPE,
      access_type: "offline",
      prompt: "consent",
      state,
      code_challenge: b64url(createHash("sha256").update(verifier).digest()),
      code_challenge_method: "S256",
    });
    return `${AUTH_URL}?${params}`;
  }

  async handleCallback(code: string, state: string, redirectUri: string): Promise<void> {
    const cfg = this.config;
    const verifier = this.pending.get(state);
    if (!cfg || !verifier) throw new Error("No matching sign-in attempt — start again");
    this.pending.delete(state);
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: cfg.client_id,
        client_secret: cfg.client_secret,
        code,
        code_verifier: verifier,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });
    const body = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(`Google sign-in failed: ${body.error_description ?? body.error ?? res.status}`);
    }
    const tokens: TokenSet = {
      access_token: body.access_token as string,
      refresh_token: body.refresh_token as string | undefined,
      expiry: Date.now() + (Number(body.expires_in ?? 3600) - 60) * 1000,
    };
    mkdirSync(dirname(this.tokenPath), { recursive: true });
    writeFileSync(this.tokenPath, JSON.stringify(tokens, null, 2));
  }

  private async accessToken(): Promise<string> {
    const cfg = this.config;
    const tok = this.tokens;
    if (!cfg || !tok?.refresh_token) throw new Error("Not connected to Google");
    if (tok.access_token && Date.now() < tok.expiry) return tok.access_token;
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: cfg.client_id,
        client_secret: cfg.client_secret,
        refresh_token: tok.refresh_token,
        grant_type: "refresh_token",
      }),
    });
    const body = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      if (body.error === "invalid_grant") this.disconnect(); // revoked → re-auth
      throw new Error(`Google token refresh failed: ${body.error_description ?? body.error}`);
    }
    const next: TokenSet = {
      access_token: body.access_token as string,
      refresh_token: tok.refresh_token,
      expiry: Date.now() + (Number(body.expires_in ?? 3600) - 60) * 1000,
    };
    writeFileSync(this.tokenPath, JSON.stringify(next, null, 2));
    return next.access_token;
  }

  /** Upload a pptx and let Drive convert it to a native Slides file. */
  async uploadAsSlides(pptx: Buffer, title: string): Promise<string> {
    const token = await this.accessToken();
    const boundary = `deckforge${randomBytes(8).toString("hex")}`;
    const metadata = JSON.stringify({
      name: title,
      mimeType: "application/vnd.google-apps.presentation",
    });
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
          `--${boundary}\r\nContent-Type: application/vnd.openxmlformats-officedocument.presentationml.presentation\r\n\r\n`,
      ),
      pptx,
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    const res = await fetch(UPLOAD_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
        "Content-Length": String(body.length),
      },
      body,
    });
    const out = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(`Drive upload failed: ${(out.error as { message?: string })?.message ?? res.status}`);
    }
    return `https://docs.google.com/presentation/d/${out.id}/edit`;
  }
}
