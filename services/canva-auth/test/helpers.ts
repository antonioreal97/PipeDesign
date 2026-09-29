import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "../src/config.js";

export async function tempTokenPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "canva-auth-test-"));
  return join(dir, "nested", "canva-token.json");
}

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    redirectUri: "http://127.0.0.1:3001/auth/canva/callback",
    authUrl: "https://www.canva.com/api/oauth/authorize",
    tokenUrl: "http://127.0.0.1:1/oauth/token",
    scopes: ["asset:read", "asset:write", "design:meta:read"],
    host: "127.0.0.1",
    port: 3001,
    tokenStorePath: "/unused",
    apiKey: undefined,
    refreshSkewSeconds: 300,
    httpTimeoutMs: 2000,
    ...overrides,
  };
}
