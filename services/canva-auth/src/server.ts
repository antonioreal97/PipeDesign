import { createHash, timingSafeEqual } from "node:crypto";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { CanvaOAuthError, type CanvaOAuthClient } from "./canva-oauth.js";
import { publicStartUrl, type Config } from "./config.js";
import type { LogFn } from "./logger.js";
import type { PendingAuthStore } from "./pending-auth.js";
import { computeCodeChallenge, generateCodeVerifier, generateState } from "./pkce.js";
import type { TokenManager, TokenResult } from "./token-manager.js";
import { TokenStoreError, type TokenStore } from "./token-store.js";

export const SERVICE_NAME = "canva-auth";
export const SERVICE_VERSION = "0.1.0";

export interface AppDeps {
  config: Config;
  oauthClient: Pick<CanvaOAuthClient, "buildAuthorizeUrl" | "exchangeCode">;
  tokenManager: TokenManager;
  tokenStore: TokenStore;
  pendingAuth: PendingAuthStore;
  log: LogFn;
  now?: () => number;
}

/** Modelo de erro padronizado (docs/CANVA_INTEGRATION_SPIKE.md §32). */
interface ErrorBody {
  status: "failed";
  stage: string;
  code: string;
  message: string;
  retryable: boolean;
  context?: Record<string, unknown>;
}

class HttpError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly body: ErrorBody,
  ) {
    super(body.message);
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(payload);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

function sendHtml(res: ServerResponse, status: number, title: string, bodyHtml: string): void {
  const page = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:64px auto;padding:0 16px;line-height:1.5;color:#1d1d1f}
  h1{font-size:1.4rem} code{background:#f2f2f5;padding:2px 6px;border-radius:4px}
  .ok{color:#137333} .err{color:#b3261e} .warn{color:#8a5a00}
</style></head><body>${bodyHtml}</body></html>`;
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    "Referrer-Policy": "no-referrer",
  });
  res.end(page);
}

function hashed(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function createApp(deps: AppDeps): http.Server {
  const { config, log } = deps;
  const now = deps.now ?? Date.now;
  const startUrl = publicStartUrl(config);

  const requireApiKey = (req: IncomingMessage): void => {
    if (!config.apiKey) return;
    const provided = req.headers["x-api-key"];
    const value = Array.isArray(provided) ? provided[0] : provided;
    if (!value || !timingSafeEqual(hashed(value), hashed(config.apiKey))) {
      throw new HttpError(401, {
        status: "failed",
        stage: "auth",
        code: "INVALID_API_KEY",
        message: "Header x-api-key ausente ou inválido.",
        retryable: false,
      });
    }
  };

  const tokenResponse = (res: ServerResponse, result: TokenResult): void => {
    if (result.kind === "ok") {
      sendJson(res, 200, {
        status: "ok",
        access_token: result.token.access_token,
        token_type: "Bearer",
        expires_at: result.token.expires_at,
        scope: result.token.scope,
        refreshed: result.refreshed,
      });
      return;
    }
    const reauth = result.reason === "reauthorization_required";
    sendJson(res, 401, {
      status: "authorization_required",
      code: reauth ? "REAUTHORIZATION_REQUIRED" : "AUTHORIZATION_REQUIRED",
      message: `${reauth ? "A sessão com o Canva expirou ou foi revogada." : "Nenhuma autorização do Canva encontrada."} Autorize primeiro: ${startUrl}`,
      authorize_url: startUrl,
    });
  };

  const tokenErrorToHttp = (err: unknown, stage: string): HttpError => {
    if (err instanceof CanvaOAuthError) {
      return new HttpError(err.retryable ? 503 : 502, {
        status: "failed",
        stage,
        code: stage === "token_refresh" ? "CANVA_TOKEN_REFRESH_FAILED" : "CANVA_TOKEN_EXCHANGE_FAILED",
        message: err.message,
        retryable: err.retryable,
        context: { canva_http_status: err.httpStatus, canva_error_code: err.errorCode },
      });
    }
    if (err instanceof TokenStoreError) {
      return new HttpError(500, { status: "failed", stage: "token_store", code: "TOKEN_STORE_ERROR", message: err.message, retryable: false });
    }
    throw err;
  };

  const routes: Record<string, Partial<Record<string, (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void>>>> = {
    "/health": {
      GET: async (_req, res) => {
        const nowSeconds = Math.floor(now() / 1000);
        let tokenInfo: Record<string, unknown>;
        try {
          const token = await deps.tokenStore.read();
          const granted = token?.scope ? token.scope.split(/\s+/).filter(Boolean) : [];
          tokenInfo = {
            authorized: Boolean(token) && !token?.reauthorization_required,
            reauthorization_required: Boolean(token?.reauthorization_required),
            access_token_valid: token ? token.expires_at > nowSeconds && !token.reauthorization_required : false,
            expires_at: token?.expires_at ?? null,
            scopes_granted: granted,
            missing_scopes: token ? config.scopes.filter((s) => !granted.includes(s)) : config.scopes,
          };
        } catch (err) {
          tokenInfo = { authorized: false, token_store_error: (err as Error).message };
        }
        sendJson(res, 200, {
          status: "ok",
          service: SERVICE_NAME,
          version: SERVICE_VERSION,
          api_key_required: Boolean(config.apiKey),
          authorize_url: startUrl,
          ...tokenInfo,
        });
      },
    },

    "/auth/canva/start": {
      GET: async (_req, res, url) => {
        const codeVerifier = generateCodeVerifier();
        const state = generateState();
        deps.pendingAuth.create(state, codeVerifier);
        const authorizeUrl = deps.oauthClient.buildAuthorizeUrl(computeCodeChallenge(codeVerifier), state);
        log("info", "oauth.start", { scopes: config.scopes });
        if (url.searchParams.get("format") === "json") {
          sendJson(res, 200, { status: "ok", authorize_url: authorizeUrl });
          return;
        }
        res.writeHead(302, { Location: authorizeUrl, "Cache-Control": "no-store" });
        res.end();
      },
    },

    "/auth/canva/callback": {
      GET: async (_req, res, url) => {
        const error = url.searchParams.get("error");
        if (error) {
          const description = url.searchParams.get("error_description") ?? "";
          log("warn", "oauth.callback.denied", { error, description });
          sendHtml(
            res,
            400,
            "Autorização não concluída",
            `<h1 class="err">Autorização não concluída</h1><p>O Canva retornou: <code>${escapeHtml(error)}</code> ${escapeHtml(description)}</p>
             <p><a href="${escapeHtml(startUrl)}">Tentar novamente</a></p>`,
          );
          return;
        }

        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (!code || !state) {
          sendHtml(res, 400, "Callback inválido", `<h1 class="err">Callback inválido</h1><p>Parâmetros <code>code</code> e <code>state</code> são obrigatórios.</p>`);
          return;
        }

        const codeVerifier = deps.pendingAuth.consume(state);
        if (!codeVerifier) {
          log("warn", "oauth.callback.state_mismatch");
          sendHtml(
            res,
            400,
            "OAuth state mismatch",
            `<h1 class="err">OAuth state mismatch</h1><p>O <code>state</code> recebido é desconhecido, já foi usado ou expirou.</p>
             <p><a href="${escapeHtml(startUrl)}">Iniciar a autorização novamente</a></p>`,
          );
          return;
        }

        try {
          const response = await deps.oauthClient.exchangeCode(code, codeVerifier);
          const token = await deps.tokenManager.saveAuthorization(response);
          const granted = token.scope.split(/\s+/).filter(Boolean);
          const missing = config.scopes.filter((s) => !granted.includes(s));
          const missingHtml = missing.length
            ? `<p class="warn">Atenção: scopes solicitados mas não concedidos: <code>${escapeHtml(missing.join(" "))}</code></p>`
            : "";
          sendHtml(
            res,
            200,
            "Canva conectado",
            `<h1 class="ok">Canva conectado</h1>
             <p>Tokens salvos com sucesso. O access token expira em ${new Date(token.expires_at * 1000).toISOString()} e será renovado automaticamente.</p>
             <p>Scopes concedidos: <code>${escapeHtml(token.scope || "(não informado)")}</code></p>${missingHtml}
             <p>Você já pode fechar esta aba e executar o workflow no n8n.</p>`,
          );
        } catch (err) {
          const httpErr = tokenErrorToHttp(err, "oauth");
          log("error", "oauth.callback.exchange_failed", { ...httpErr.body });
          sendHtml(
            res,
            httpErr.httpStatus,
            "Falha na autorização",
            `<h1 class="err">Falha ao trocar o código por tokens</h1><p>${escapeHtml(httpErr.body.message)}</p>
             <p><a href="${escapeHtml(startUrl)}">Tentar novamente</a></p>`,
          );
        }
      },
    },

    "/auth/canva/token": {
      GET: async (req, res) => {
        requireApiKey(req);
        try {
          tokenResponse(res, await deps.tokenManager.getValidToken());
        } catch (err) {
          throw tokenErrorToHttp(err, "token_refresh");
        }
      },
    },

    "/auth/canva/refresh": {
      POST: async (req, res) => {
        requireApiKey(req);
        try {
          tokenResponse(res, await deps.tokenManager.forceRefresh());
        } catch (err) {
          throw tokenErrorToHttp(err, "token_refresh");
        }
      },
    },
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://canva-auth.local");
    const route = routes[url.pathname];
    if (!route) {
      throw new HttpError(404, { status: "failed", stage: "routing", code: "NOT_FOUND", message: `Rota não encontrada: ${url.pathname}`, retryable: false });
    }
    const handler = route[req.method ?? "GET"];
    if (!handler) {
      res.setHeader("Allow", Object.keys(route).join(", "));
      throw new HttpError(405, { status: "failed", stage: "routing", code: "METHOD_NOT_ALLOWED", message: `Método ${req.method} não permitido em ${url.pathname}`, retryable: false });
    }
    await handler(req, res, url);
  };

  return http.createServer((req, res) => {
    const started = now();
    res.on("finish", () => {
      if (req.url?.startsWith("/health")) return;
      log("info", "http.request", {
        method: req.method,
        path: (req.url ?? "").split("?")[0],
        status: res.statusCode,
        duration_ms: now() - started,
      });
    });
    handle(req, res).catch((err: unknown) => {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (err instanceof HttpError) {
        sendJson(res, err.httpStatus, err.body);
        return;
      }
      log("error", "http.unhandled_error", { message: (err as Error).message });
      sendJson(res, 500, { status: "failed", stage: "internal", code: "INTERNAL_ERROR", message: "Erro interno no canva-auth.", retryable: true });
    });
  });
}
