import { createHash, randomBytes } from "node:crypto";

/**
 * PKCE (RFC 7636) com método S256.
 * 64 bytes aleatórios em base64url => 86 caracteres (limite do RFC: 43 a 128).
 */
export function generateCodeVerifier(): string {
  return randomBytes(64).toString("base64url");
}

export function computeCodeChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

/** Valor opaco usado para proteger o callback contra CSRF. */
export function generateState(): string {
  return randomBytes(64).toString("base64url");
}
