import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { CanvaOAuthClient } from "../src/canva-oauth.js";
import type { Config } from "../src/config.js";
import { PendingAuthStore } from "../src/pending-auth.js";
import { createApp } from "../src/server.js";
import { TokenManager } from "../src/token-manager.js";
import { TokenStore } from "../src/token-store.js";
import { tempTokenPath, testConfig } from "./helpers.js";

/** Servidor falso que imita POST /oauth/token do Canva. */
interface FakeCanva {
  url: string;
  requests: Array<{ headers: http.IncomingHttpHeaders; body: URLSearchParams }>;
  challengeByCode: Map<string, string>;
  refreshStatus: number;
  close(): Promise<void>;
}

async function startFakeCanva(): Promise<FakeCanva> {
  const state: Omit<FakeCanva, "url" | "close"> = { requests: [], challengeByCode: new Map(), refreshStatus: 200 };
  let counter = 0;
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = new URLSearchParams(raw);
      state.requests.push({ headers: req.headers, body });
      const send = (status: number, json: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(json));
      };
      const expectedAuth = `Basic ${Buffer.from("test-client-id:test-client-secret").toString("base64")}`;
      if (req.headers.authorization !== expectedAuth) return send(401, { code: "invalid_client", message: "bad client" });

      if (body.get("grant_type") === "authorization_code") {
        const code = body.get("code") ?? "";
        const expectedChallenge = state.challengeByCode.get(code);
        const actual = createHash("sha256").update(body.get("code_verifier") ?? "").digest("base64url");
        if (!expectedChallenge || expectedChallenge !== actual) {
          return send(400, { code: "invalid_grant", message: "PKCE verification failed" });
        }
        return send(200, {
          access_token: "access-1",
          refresh_token: "refresh-1",
          token_type: "Bearer",
          expires_in: 14400,
          scope: "asset:read asset:write",
        });
      }
      if (body.get("grant_type") === "refresh_token") {
        if (state.refreshStatus !== 200) return send(state.refreshStatus, { code: "invalid_grant", message: "refresh token reused" });
        counter += 1;
        return send(200, { access_token: `access-r${counter}`, refresh_token: `refresh-r${counter}`, expires_in: 14400 });
      }
      return send(400, { code: "unsupported_grant_type", message: "?" });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return Object.assign(state, {
    url: `http://127.0.0.1:${port}/oauth/token`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  });
}

interface App {
  base: string;
  store: TokenStore;
  close(): Promise<void>;
}

async function startApp(config: Config): Promise<App> {
  const store = new TokenStore(config.tokenStorePath);
  const oauthClient = new CanvaOAuthClient(config);
  const tokenManager = new TokenManager(store, oauthClient, { refreshSkewSeconds: config.refreshSkewSeconds });
  const logs: string[] = [];
  const server = createApp({
    config,
    oauthClient,
    tokenManager,
    tokenStore: store,
    pendingAuth: new PendingAuthStore(),
    log: (level, event, fields) => logs.push(JSON.stringify({ level, event, ...fields })),
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, store, close: () => new Promise<void>((r) => server.close(() => r())) };
}

let canva: FakeCanva;
before(async () => {
  canva = await startFakeCanva();
});
after(async () => {
  await canva.close();
});

async function authorize(app: App, code: string): Promise<Response> {
  const start = await fetch(`${app.base}/auth/canva/start`, { redirect: "manual" });
  assert.equal(start.status, 302);
  const location = new URL(start.headers.get("location") ?? "");
  canva.challengeByCode.set(code, location.searchParams.get("code_challenge") ?? "");
  const state = location.searchParams.get("state") ?? "";
  return fetch(`${app.base}/auth/canva/callback?code=${code}&state=${encodeURIComponent(state)}`);
}

test("/auth/canva/start redireciona com todos os parâmetros PKCE", async () => {
  const app = await startApp(testConfig({ tokenUrl: canva.url, tokenStorePath: await tempTokenPath() }));
  try {
    const res = await fetch(`${app.base}/auth/canva/start`, { redirect: "manual" });
    assert.equal(res.status, 302);
    const raw = res.headers.get("location") ?? "";
    assert.ok(raw.startsWith("https://www.canva.com/api/oauth/authorize?"));
    assert.ok(raw.includes("scope=asset%3Aread%20asset%3Awrite%20design%3Ameta%3Aread"), "espaços como %20");
    const loc = new URL(raw);
    assert.equal(loc.searchParams.get("code_challenge_method"), "s256");
    assert.equal(loc.searchParams.get("response_type"), "code");
    assert.equal(loc.searchParams.get("client_id"), "test-client-id");
    assert.equal(loc.searchParams.get("redirect_uri"), "http://127.0.0.1:3001/auth/canva/callback");
    assert.match(loc.searchParams.get("code_challenge") ?? "", /^[A-Za-z0-9_-]{43}$/);
    assert.ok((loc.searchParams.get("state") ?? "").length >= 64);

    const json = await (await fetch(`${app.base}/auth/canva/start?format=json`)).json() as any;
    assert.equal(json.status, "ok");
    assert.ok(String(json.authorize_url).includes("code_challenge="));
  } finally {
    await app.close();
  }
});

test("fluxo completo: sem token -> autoriza -> token -> refresh forçado", async () => {
  const app = await startApp(testConfig({ tokenUrl: canva.url, tokenStorePath: await tempTokenPath() }));
  try {
    const before = await fetch(`${app.base}/auth/canva/token`);
    assert.equal(before.status, 401);
    const beforeBody = await before.json() as any;
    assert.equal(beforeBody.status, "authorization_required");
    assert.equal(beforeBody.authorize_url, "http://127.0.0.1:3001/auth/canva/start");

    const cb = await authorize(app, "code-ok");
    assert.equal(cb.status, 200);
    assert.match(await cb.text(), /Canva conectado/);
    const exchange = canva.requests.at(-1);
    assert.equal(exchange?.body.get("grant_type"), "authorization_code");
    assert.equal(exchange?.body.get("redirect_uri"), "http://127.0.0.1:3001/auth/canva/callback");

    const tokenRes = await fetch(`${app.base}/auth/canva/token`);
    assert.equal(tokenRes.status, 200);
    assert.equal(tokenRes.headers.get("cache-control"), "no-store");
    const tokenBody = await tokenRes.json() as any;
    assert.equal(tokenBody.status, "ok");
    assert.equal(tokenBody.access_token, "access-1");
    assert.equal(tokenBody.refresh_token, undefined, "refresh token nunca sai do serviço");
    assert.equal(tokenBody.refreshed, false);

    const refreshRes = await fetch(`${app.base}/auth/canva/refresh`, { method: "POST" });
    assert.equal(refreshRes.status, 200);
    const refreshBody = await refreshRes.json() as any;
    assert.equal(refreshBody.refreshed, true);
    assert.match(refreshBody.access_token, /^access-r\d+$/);
    assert.equal(canva.requests.at(-1)?.body.get("refresh_token"), "refresh-1");
    assert.match((await app.store.read())?.refresh_token ?? "", /^refresh-r\d+$/);

    const health = await (await fetch(`${app.base}/health`)).json() as any;
    assert.equal(health.authorized, true);
    assert.equal(health.access_token_valid, true);
    assert.deepEqual(health.missing_scopes, ["design:meta:read"]);
    const healthText = JSON.stringify(health);
    assert.ok(!healthText.includes("access-") && !healthText.includes("refresh-"), "health não expõe tokens");
  } finally {
    await app.close();
  }
});

test("callback com state desconhecido ou reutilizado retorna 400", async () => {
  const app = await startApp(testConfig({ tokenUrl: canva.url, tokenStorePath: await tempTokenPath() }));
  try {
    const bad = await fetch(`${app.base}/auth/canva/callback?code=x&state=nao-existe`);
    assert.equal(bad.status, 400);
    assert.match(await bad.text(), /OAuth state mismatch/);

    const start = await fetch(`${app.base}/auth/canva/start`, { redirect: "manual" });
    const loc = new URL(start.headers.get("location") ?? "");
    canva.challengeByCode.set("code-reuse", loc.searchParams.get("code_challenge") ?? "");
    const state = encodeURIComponent(loc.searchParams.get("state") ?? "");
    assert.equal((await fetch(`${app.base}/auth/canva/callback?code=code-reuse&state=${state}`)).status, 200);
    assert.equal((await fetch(`${app.base}/auth/canva/callback?code=code-reuse&state=${state}`)).status, 400);
  } finally {
    await app.close();
  }
});

test("callback com erro do Canva (usuário negou) retorna 400", async () => {
  const app = await startApp(testConfig({ tokenUrl: canva.url, tokenStorePath: await tempTokenPath() }));
  try {
    const res = await fetch(`${app.base}/auth/canva/callback?error=access_denied&error_description=%3Cscript%3E`);
    assert.equal(res.status, 400);
    const html = await res.text();
    assert.match(html, /access_denied/);
    assert.ok(!html.includes("<script>"), "saída HTML escapada");
  } finally {
    await app.close();
  }
});

test("refresh rejeitado pelo Canva vira REAUTHORIZATION_REQUIRED", async () => {
  const app = await startApp(testConfig({ tokenUrl: canva.url, tokenStorePath: await tempTokenPath() }));
  try {
    await authorize(app, "code-reauth");
    canva.refreshStatus = 400;
    const res = await fetch(`${app.base}/auth/canva/refresh`, { method: "POST" });
    assert.equal(res.status, 401);
    assert.equal((await res.json() as any).code, "REAUTHORIZATION_REQUIRED");
    const health = await (await fetch(`${app.base}/health`)).json() as any;
    assert.equal(health.reauthorization_required, true);
    assert.equal(health.authorized, false);
  } finally {
    canva.refreshStatus = 200;
    await app.close();
  }
});

test("Canva indisponível no refresh -> 503 com erro padronizado", async () => {
  const app = await startApp(testConfig({ tokenUrl: canva.url, tokenStorePath: await tempTokenPath() }));
  try {
    await authorize(app, "code-503");
    canva.refreshStatus = 503;
    const res = await fetch(`${app.base}/auth/canva/refresh`, { method: "POST" });
    assert.equal(res.status, 503);
    const body = await res.json() as any;
    assert.deepEqual(
      { status: body.status, stage: body.stage, code: body.code, retryable: body.retryable },
      { status: "failed", stage: "token_refresh", code: "CANVA_TOKEN_REFRESH_FAILED", retryable: true },
    );
  } finally {
    canva.refreshStatus = 200;
    await app.close();
  }
});

test("CANVA_AUTH_API_KEY protege /token e /refresh, mas não /health nem /start", async () => {
  const app = await startApp(testConfig({ tokenUrl: canva.url, tokenStorePath: await tempTokenPath(), apiKey: "s3cr3t" }));
  try {
    assert.equal((await fetch(`${app.base}/auth/canva/token`)).status, 401);
    const wrong = await fetch(`${app.base}/auth/canva/token`, { headers: { "x-api-key": "nope" } });
    assert.equal((await wrong.json() as any).code, "INVALID_API_KEY");
    assert.equal((await fetch(`${app.base}/auth/canva/refresh`, { method: "POST" })).status, 401);
    const ok = await fetch(`${app.base}/auth/canva/token`, { headers: { "x-api-key": "s3cr3t" } });
    assert.equal((await ok.json() as any).status, "authorization_required");
    assert.equal((await fetch(`${app.base}/health`)).status, 200);
    assert.equal((await fetch(`${app.base}/auth/canva/start`, { redirect: "manual" })).status, 302);
  } finally {
    await app.close();
  }
});

test("rotas desconhecidas e métodos errados", async () => {
  const app = await startApp(testConfig({ tokenUrl: canva.url, tokenStorePath: await tempTokenPath() }));
  try {
    assert.equal((await fetch(`${app.base}/nope`)).status, 404);
    const res = await fetch(`${app.base}/auth/canva/refresh`);
    assert.equal(res.status, 405);
    assert.equal(res.headers.get("allow"), "POST");
  } finally {
    await app.close();
  }
});
