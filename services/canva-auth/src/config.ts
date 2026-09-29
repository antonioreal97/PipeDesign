/**
 * Leitura e validação das variáveis de ambiente do serviço canva-auth.
 * Falha cedo (fail fast) com mensagem clara se algo obrigatório estiver faltando.
 */

export const DEFAULT_SCOPES = [
  "asset:read",
  "asset:write",
  "brandtemplate:meta:read",
  "brandtemplate:content:read",
  "design:content:write",
  "design:meta:read",
] as const;

export interface Config {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  host: string;
  port: number;
  tokenStorePath: string;
  /** Se definido, /auth/canva/token e /auth/canva/refresh exigem o header `x-api-key`. */
  apiKey: string | undefined;
  /** Renova o access token quando faltar menos que isto (segundos) para expirar. */
  refreshSkewSeconds: number;
  /** Timeout das chamadas HTTP ao Canva (ms). */
  httpTimeoutMs: number;
}

export class ConfigError extends Error {
  override name = "ConfigError";
}

type Env = Record<string, string | undefined>;

/** Remove espaços e aspas envolventes (ex.: valores copiados de um .env com aspas). */
function clean(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  let v = value.trim();
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    v = v.slice(1, -1).trim();
  }
  return v === "" ? undefined : v;
}

function parseInteger(name: string, raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ConfigError(`${name} deve ser um inteiro entre ${min} e ${max} (recebido: "${raw}")`);
  }
  return n;
}

export function loadConfig(env: Env = process.env): Config {
  const missing: string[] = [];
  const required = (name: string): string => {
    const v = clean(env[name]);
    if (!v) missing.push(name);
    return v ?? "";
  };

  const clientId = required("CANVA_CLIENT_ID");
  const clientSecret = required("CANVA_CLIENT_SECRET");
  const redirectUri = required("CANVA_REDIRECT_URI");

  if (missing.length > 0) {
    throw new ConfigError(
      `Variáveis obrigatórias ausentes: ${missing.join(", ")}. Copie .env.example para .env e preencha os valores.`,
    );
  }

  let redirect: URL;
  try {
    redirect = new URL(redirectUri);
  } catch {
    throw new ConfigError(`CANVA_REDIRECT_URI não é uma URL válida: "${redirectUri}"`);
  }
  if (redirect.hostname === "localhost") {
    throw new ConfigError(
      "CANVA_REDIRECT_URI usa 'localhost', que o Canva não aceita. Use 127.0.0.1 (ex.: http://127.0.0.1:3001/auth/canva/callback).",
    );
  }
  if (redirect.pathname !== "/auth/canva/callback") {
    throw new ConfigError(
      `CANVA_REDIRECT_URI deve apontar para o caminho /auth/canva/callback deste serviço (recebido: ${redirect.pathname}).`,
    );
  }

  const port = parseInteger("CANVA_AUTH_PORT", clean(env.CANVA_AUTH_PORT), 3001, 1, 65535);
  const redirectPort = redirect.port ? Number(redirect.port) : redirect.protocol === "https:" ? 443 : 80;
  if (redirectPort !== port) {
    throw new ConfigError(
      `A porta de CANVA_REDIRECT_URI (${redirectPort}) difere de CANVA_AUTH_PORT (${port}). Elas precisam ser iguais.`,
    );
  }

  const scopesRaw = clean(env.CANVA_SCOPES);
  const scopes = scopesRaw ? scopesRaw.split(/\s+/).filter(Boolean) : [...DEFAULT_SCOPES];

  return {
    clientId,
    clientSecret,
    redirectUri,
    authUrl: clean(env.CANVA_AUTH_URL) ?? "https://www.canva.com/api/oauth/authorize",
    tokenUrl: clean(env.CANVA_TOKEN_URL) ?? "https://api.canva.com/rest/v1/oauth/token",
    scopes,
    host: clean(env.CANVA_AUTH_HOST) ?? "0.0.0.0",
    port,
    tokenStorePath: clean(env.TOKEN_STORE_PATH) ?? "/data/canva-token.json",
    apiKey: clean(env.CANVA_AUTH_API_KEY),
    refreshSkewSeconds: parseInteger("CANVA_TOKEN_REFRESH_SKEW_SECONDS", clean(env.CANVA_TOKEN_REFRESH_SKEW_SECONDS), 300, 0, 3600),
    httpTimeoutMs: parseInteger("CANVA_HTTP_TIMEOUT_MS", clean(env.CANVA_HTTP_TIMEOUT_MS), 15000, 1000, 120000),
  };
}

/** URL pública (acessada pelo navegador) para iniciar a autorização. */
export function publicStartUrl(config: Pick<Config, "redirectUri">): string {
  return new URL("/auth/canva/start", config.redirectUri).toString();
}
