import assert from "node:assert/strict";
import { readdir, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { test } from "node:test";
import { TokenStore, TokenStoreError, type StoredToken } from "../src/token-store.js";
import { tempTokenPath } from "./helpers.js";

const sample: StoredToken = {
  access_token: "at",
  refresh_token: "rt",
  token_type: "Bearer",
  expires_at: 2_000_000_000,
  scope: "asset:read",
  authorized_at: 1,
  updated_at: 1,
};

test("retorna null quando não há arquivo", async () => {
  assert.equal(await new TokenStore(await tempTokenPath()).read(), null);
});

test("grava e lê (roundtrip) com permissão 0600 e sem arquivos temporários", async () => {
  const path = await tempTokenPath();
  const store = new TokenStore(path);
  await store.write(sample);
  assert.deepEqual(await store.read(), sample);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(dirname(path)), ["canva-token.json"]);
  await store.clear();
  assert.equal(await store.read(), null);
});

test("JSON corrompido gera TokenStoreError", async () => {
  const path = await tempTokenPath();
  const store = new TokenStore(path);
  await store.write(sample);
  await writeFile(path, "{not json");
  await assert.rejects(store.read(), TokenStoreError);
});
