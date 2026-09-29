import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigError, DEFAULT_SCOPES, loadConfig } from "../src/config.js";

const base = {
  CANVA_CLIENT_ID: "id",
  CANVA_CLIENT_SECRET: "secret",
  CANVA_REDIRECT_URI: "http://127.0.0.1:3001/auth/canva/callback",
};

test("carrega defaults e remove aspas de CANVA_SCOPES", () => {
  const cfg = loadConfig({ ...base, CANVA_SCOPES: '"asset:read  design:meta:read"' });
  assert.deepEqual(cfg.scopes, ["asset:read", "design:meta:read"]);
  assert.equal(cfg.port, 3001);
  assert.equal(cfg.tokenStorePath, "/data/canva-token.json");
  assert.equal(cfg.apiKey, undefined);
  assert.deepEqual(loadConfig(base).scopes, [...DEFAULT_SCOPES]);
});

test("falha listando variáveis obrigatórias ausentes", () => {
  assert.throws(() => loadConfig({ CANVA_CLIENT_ID: "id", CANVA_CLIENT_SECRET: "" }), (err: unknown) => {
    assert.ok(err instanceof ConfigError);
    assert.match(err.message, /CANVA_CLIENT_SECRET/);
    assert.match(err.message, /CANVA_REDIRECT_URI/);
    return true;
  });
});

test("rejeita redirect com localhost", () => {
  assert.throws(
    () => loadConfig({ ...base, CANVA_REDIRECT_URI: "http://localhost:3001/auth/canva/callback" }),
    /localhost/,
  );
});

test("rejeita porta divergente entre redirect e CANVA_AUTH_PORT", () => {
  assert.throws(() => loadConfig({ ...base, CANVA_AUTH_PORT: "3002" }), /porta/);
});

test("rejeita caminho de callback diferente", () => {
  assert.throws(() => loadConfig({ ...base, CANVA_REDIRECT_URI: "http://127.0.0.1:3001/callback" }), /auth\/canva\/callback/);
});
