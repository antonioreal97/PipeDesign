import assert from "node:assert/strict";
import { test } from "node:test";
import { computeCodeChallenge, generateCodeVerifier, generateState } from "../src/pkce.js";

test("code_verifier respeita o RFC 7636 (43-128 chars, alfabeto unreserved)", () => {
  const v = generateCodeVerifier();
  assert.ok(v.length >= 43 && v.length <= 128, `tamanho ${v.length}`);
  assert.match(v, /^[A-Za-z0-9\-._~]+$/);
  assert.notEqual(v, generateCodeVerifier());
});

test("code_challenge S256 bate com o vetor de teste do RFC 7636 (Apêndice B)", () => {
  assert.equal(
    computeCodeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  );
});

test("state é aleatório e url-safe", () => {
  const s = generateState();
  assert.match(s, /^[A-Za-z0-9_-]{64,}$/);
  assert.notEqual(s, generateState());
});
