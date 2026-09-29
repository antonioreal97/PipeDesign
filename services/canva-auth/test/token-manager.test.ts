import assert from "node:assert/strict";
import { test } from "node:test";
import { CanvaOAuthError, type CanvaTokenResponse } from "../src/canva-oauth.js";
import { TokenManager } from "../src/token-manager.js";
import { TokenStore, type StoredToken } from "../src/token-store.js";
import { tempTokenPath } from "./helpers.js";

const NOW_MS = 1_800_000_000_000;
const NOW_S = NOW_MS / 1000;

function token(overrides: Partial<StoredToken> = {}): StoredToken {
  return {
    access_token: "old-access",
    refresh_token: "old-refresh",
    token_type: "Bearer",
    expires_at: NOW_S + 3600,
    scope: "asset:read",
    authorized_at: NOW_S - 100,
    updated_at: NOW_S - 100,
    ...overrides,
  };
}

class FakeClient {
  calls: string[] = [];
  constructor(private readonly impl: (refreshToken: string) => Promise<CanvaTokenResponse>) {}
  refresh(refreshToken: string): Promise<CanvaTokenResponse> {
    this.calls.push(refreshToken);
    return this.impl(refreshToken);
  }
}

async function setup(initial: StoredToken | null, impl: (rt: string) => Promise<CanvaTokenResponse>) {
  const store = new TokenStore(await tempTokenPath());
  if (initial) await store.write(initial);
  const client = new FakeClient(impl);
  const manager = new TokenManager(store, client, { refreshSkewSeconds: 300, now: () => NOW_MS });
  return { store, client, manager };
}

const rotated = async (): Promise<CanvaTokenResponse> => ({
  access_token: "new-access",
  refresh_token: "new-refresh",
  expires_in: 14400,
  scope: "asset:read asset:write",
});

test("sem token -> authorization_required(no_token)", async () => {
  const { manager, client } = await setup(null, rotated);
  assert.deepEqual(await manager.getValidToken(), { kind: "authorization_required", reason: "no_token" });
  assert.equal(client.calls.length, 0);
});

test("token com folga maior que o skew é devolvido sem refresh", async () => {
  const { manager, client } = await setup(token(), rotated);
  const result = await manager.getValidToken();
  assert.equal(result.kind, "ok");
  assert.equal(result.kind === "ok" && result.token.access_token, "old-access");
  assert.equal(client.calls.length, 0);
});

test("token perto de expirar é renovado e o refresh token rotacionado é persistido", async () => {
  const { manager, client, store } = await setup(token({ expires_at: NOW_S + 60 }), rotated);
  const result = await manager.getValidToken();
  assert.ok(result.kind === "ok" && result.refreshed);
  assert.deepEqual(client.calls, ["old-refresh"]);
  const saved = await store.read();
  assert.equal(saved?.access_token, "new-access");
  assert.equal(saved?.refresh_token, "new-refresh");
  assert.equal(saved?.expires_at, NOW_S + 14400);
  assert.equal(saved?.authorized_at, NOW_S - 100);
});

test("mantém o refresh token anterior se a resposta não trouxer um novo", async () => {
  const { manager, store } = await setup(token({ expires_at: NOW_S - 1 }), async () => ({
    access_token: "new-access",
    expires_in: 100,
  }));
  await manager.getValidToken();
  const saved = await store.read();
  assert.equal(saved?.refresh_token, "old-refresh");
  assert.equal(saved?.scope, "asset:read");
});

test("chamadas concorrentes disparam um único refresh", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const { manager, client } = await setup(token({ expires_at: NOW_S }), async () => {
    await gate;
    return rotated();
  });
  const pending = Promise.all([manager.getValidToken(), manager.getValidToken(), manager.forceRefresh()]);
  await new Promise((r) => setTimeout(r, 20));
  release();
  const results = await pending;
  assert.equal(client.calls.length, 1);
  for (const r of results) assert.ok(r.kind === "ok" && r.token.access_token === "new-access");
});

test("refresh rejeitado (400) marca reautorização e não tenta de novo", async () => {
  const { manager, client, store } = await setup(token({ expires_at: NOW_S }), async () => {
    throw new CanvaOAuthError("invalid refresh token", 400, "invalid_grant", false);
  });
  assert.deepEqual(await manager.getValidToken(), { kind: "authorization_required", reason: "reauthorization_required" });
  assert.deepEqual(await manager.getValidToken(), { kind: "authorization_required", reason: "reauthorization_required" });
  assert.equal(client.calls.length, 1);
  const saved = await store.read();
  assert.equal(saved?.reauthorization_required, true);
  assert.equal(saved?.last_error?.code, "invalid_grant");
});

test("falha temporária (503) propaga erro retryable e preserva o token", async () => {
  const { manager, store } = await setup(token({ expires_at: NOW_S }), async () => {
    throw new CanvaOAuthError("unavailable", 503, "HTTP_503", true);
  });
  await assert.rejects(manager.getValidToken(), (err: unknown) => err instanceof CanvaOAuthError && err.retryable);
  const saved = await store.read();
  assert.equal(saved?.refresh_token, "old-refresh");
  assert.equal(saved?.reauthorization_required, undefined);
});

test("nova autorização limpa o estado de reautorização", async () => {
  const { manager, store } = await setup(token({ reauthorization_required: true }), rotated);
  await manager.saveAuthorization({ access_token: "fresh", refresh_token: "fresh-rt", expires_in: 14400, scope: "asset:read" });
  const saved = await store.read();
  assert.equal(saved?.reauthorization_required, undefined);
  assert.equal(saved?.authorized_at, NOW_S);
  const result = await manager.getValidToken();
  assert.ok(result.kind === "ok" && result.token.access_token === "fresh");
});
