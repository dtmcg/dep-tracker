import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { GoogleSheetsError } from "./client.ts";

/**
 * Google sign-in for a locally run app: OAuth 2.0 for installed apps with a
 * loopback redirect and PKCE. Only the refresh token is stored, in a file
 * readable by the current user only, never in project files.
 */
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const PENDING_MS = 10 * 60_000;

export interface StoredTokens {
  refreshToken: string;
}

export interface TokenStore {
  read(): Promise<StoredTokens | null>;
  write(tokens: StoredTokens | null): Promise<void>;
}

export function fileTokenStore(file: string): TokenStore {
  return {
    async read() {
      try {
        return JSON.parse(await readFile(file, "utf8")) as StoredTokens;
      } catch {
        return null;
      }
    },
    async write(tokens) {
      if (!tokens) {
        await rm(file, { force: true });
        return;
      }
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      const temp = `${file}.${process.pid}.tmp`;
      await writeFile(temp, JSON.stringify(tokens), { mode: 0o600 });
      await chmod(temp, 0o600).catch(() => undefined);
      await rename(temp, file);
    },
  };
}

export interface GoogleAuthOptions {
  clientId: string;
  clientSecret: string;
  accountsUrl?: string;
  oauthUrl?: string;
  store: TokenStore;
  fetchFn?: typeof fetch;
  now?: () => number;
}

const b64url = (buf: Buffer) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export type GoogleAuth = ReturnType<typeof createGoogleAuth>;

export function createGoogleAuth(options: GoogleAuthOptions) {
  const fetchFn = options.fetchFn ?? ((...args) => fetch(...args));
  const now = options.now ?? (() => Date.now());
  const accountsUrl = options.accountsUrl ?? "https://accounts.google.com";
  const oauthUrl = options.oauthUrl ?? "https://oauth2.googleapis.com";
  const configured = Boolean(options.clientId && options.clientSecret);
  const pending = new Map<string, { verifier: string; redirectUri: string; expires: number }>();
  let access: { token: string; expires: number } | null = null;

  async function tokenRequest(params: Record<string, string>) {
    const res = await fetchFn(`${oauthUrl}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: options.clientId, client_secret: options.clientSecret, ...params }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      refresh_token?: string;
      error?: string;
      error_description?: string;
    };
    if (!res.ok || !body.access_token) {
      throw new GoogleSheetsError(`Google sign-in failed: ${body.error_description ?? body.error ?? res.statusText}`, res.status);
    }
    access = { token: body.access_token, expires: now() + ((body.expires_in ?? 3600) - 60) * 1000 };
    return body;
  }

  return {
    configured,

    async status() {
      return { configured, connected: configured && Boolean((await options.store.read())?.refreshToken) };
    },

    /** The consent URL to open in a browser; Google redirects back to `redirectUri`. */
    start(redirectUri: string): { url: string; state: string } {
      if (!configured) throw new GoogleSheetsError("Google sign-in is not set up: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (see the README)");
      const verifier = b64url(randomBytes(32));
      const state = b64url(randomBytes(16));
      for (const [key, p] of pending) if (p.expires < now()) pending.delete(key);
      pending.set(state, { verifier, redirectUri, expires: now() + PENDING_MS });
      const q = new URLSearchParams({
        client_id: options.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: SCOPE,
        state,
        code_challenge: b64url(createHash("sha256").update(verifier).digest()),
        code_challenge_method: "S256",
        access_type: "offline",
        prompt: "consent",
      });
      return { url: `${accountsUrl}/o/oauth2/v2/auth?${q}`, state };
    },

    /** Handle the redirect back from Google. */
    async finish(params: URLSearchParams): Promise<void> {
      if (params.get("error")) throw new GoogleSheetsError(`Google sign-in was cancelled: ${params.get("error")}`);
      const state = params.get("state") ?? "";
      const entry = pending.get(state);
      pending.delete(state);
      if (!entry || entry.expires < now()) throw new GoogleSheetsError("Sign-in link expired or not issued by this app (state mismatch). Start again.");
      const body = await tokenRequest({
        grant_type: "authorization_code",
        code: params.get("code") ?? "",
        code_verifier: entry.verifier,
        redirect_uri: entry.redirectUri,
      });
      if (!body.refresh_token) throw new GoogleSheetsError("Google did not return a refresh token; remove the app's access in your Google account and sign in again.");
      await options.store.write({ refreshToken: body.refresh_token });
    },

    async accessToken(): Promise<string> {
      if (access && access.expires > now()) return access.token;
      const stored = await options.store.read();
      if (!stored?.refreshToken) throw new GoogleSheetsError("Sign in to Google first (start screen, Google Sheet).", 401);
      try {
        return (await tokenRequest({ grant_type: "refresh_token", refresh_token: stored.refreshToken })).access_token!;
      } catch (error) {
        throw new GoogleSheetsError(`Your Google sign-in has expired. Sign in to Google again. (${(error as Error).message})`, 401);
      }
    },

    async signOut() {
      access = null;
      await options.store.write(null);
    },
  };
}
