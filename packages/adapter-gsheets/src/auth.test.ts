import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { createGoogleAuth, fileTokenStore } from "./auth.ts";
import { type FakeGoogle, startFakeGoogle } from "./fake-google.ts";

let fake: FakeGoogle;
before(async () => (fake = await startFakeGoogle({ clientId: "cid", clientSecret: "secret" })));
after(() => fake.close());

const REDIRECT = "http://127.0.0.1:4317/api/auth/google/callback";

async function setup(now = () => Date.now()) {
  const file = path.join(await mkdtemp(path.join(tmpdir(), "dep-tracker-auth-")), "google.json");
  const auth = createGoogleAuth({ clientId: "cid", clientSecret: "secret", accountsUrl: fake.url, oauthUrl: fake.url, store: fileTokenStore(file), now });
  return { auth, file };
}

/** What the browser does: follow the consent page's redirect back to us. */
async function consent(url: string): Promise<URLSearchParams> {
  const res = await fetch(url, { redirect: "manual" });
  return new URL(res.headers.get("location")!).searchParams;
}

describe("Google sign-in (OAuth for installed apps, loopback + PKCE)", () => {
  it("builds a consent URL with PKCE, state and offline access", async () => {
    const { auth } = await setup();
    const { url } = auth.start(REDIRECT);
    const q = new URL(url).searchParams;
    assert.equal(q.get("client_id"), "cid");
    assert.equal(q.get("redirect_uri"), REDIRECT);
    assert.equal(q.get("code_challenge_method"), "S256");
    assert.match(q.get("code_challenge") ?? "", /^[\w-]{43}$/);
    assert.equal(q.get("access_type"), "offline");
    assert.match(q.get("scope") ?? "", /auth\/spreadsheets/);
    assert.notEqual(auth.start(REDIRECT).state, q.get("state"));
  });

  it("exchanges the code, stores the refresh token privately, and hands out access tokens", async () => {
    const { auth, file } = await setup();
    assert.deepEqual(await auth.status(), { configured: true, connected: false });
    await auth.finish(await consent(auth.start(REDIRECT).url));
    assert.deepEqual(await auth.status(), { configured: true, connected: true });
    const stored = JSON.parse(await readFile(file, "utf8"));
    assert.match(stored.refreshToken, /^rt-/);
    if (process.platform !== "win32") assert.equal((await stat(file)).mode & 0o777, 0o600);
    const token = await auth.accessToken();
    const res = await fetch(`${fake.url}/v4/spreadsheets/nope`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(res.status, 404); // authenticated, just no such sheet
  });

  it("rejects a callback whose state it didn't issue", async () => {
    const { auth } = await setup();
    const params = await consent(auth.start(REDIRECT).url);
    params.set("state", "forged");
    await assert.rejects(auth.finish(params), /state/i);
  });

  it("refreshes the access token when it expires", async () => {
    let clock = Date.now();
    const { auth } = await setup(() => clock);
    await auth.finish(await consent(auth.start(REDIRECT).url));
    const first = await auth.accessToken();
    assert.equal(await auth.accessToken(), first);
    clock += 3600_000;
    assert.notEqual(await auth.accessToken(), first);
  });

  it("asks you to sign in when there is no token", async () => {
    const { auth } = await setup();
    await assert.rejects(auth.accessToken(), /sign in to google/i);
  });

  it("reports itself unconfigured without a client id", async () => {
    const auth = createGoogleAuth({ clientId: "", clientSecret: "", store: fileTokenStore(path.join(tmpdir(), "unused.json")) });
    assert.deepEqual(await auth.status(), { configured: false, connected: false });
  });
});
