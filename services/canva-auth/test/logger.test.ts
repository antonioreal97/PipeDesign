import assert from "node:assert/strict";
import { test } from "node:test";
import { createLogger } from "../src/logger.js";

test("logger mascara campos sensíveis, inclusive aninhados", () => {
  const lines: string[] = [];
  const log = createLogger("t", (l) => lines.push(l));
  log("info", "evt", {
    access_token: "A",
    refresh_token: "R",
    client_secret: "S",
    code: "C",
    nested: { code_verifier: "V", Authorization: "Basic x" },
    expires_at: 123,
    stage: "ok",
  });
  const out = JSON.parse(lines[0] ?? "{}");
  for (const secret of ["A", "R", "S", "C", "V", "Basic x"]) {
    assert.ok(!lines[0]?.includes(`"${secret}"`), `vazou ${secret}`);
  }
  assert.equal(out.expires_at, 123);
  assert.equal(out.stage, "ok");
  assert.equal(out.service, "t");
});
