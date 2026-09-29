import { CanvaOAuthError, type CanvaOAuthClient, type CanvaTokenResponse } from "./canva-oauth.js";
import type { LogFn } from "./logger.js";
import { silentLogger } from "./logger.js";
import type { StoredToken, TokenStore } from "./token-store.js";

export type TokenResult =
  | { kind: "ok"; token: StoredToken; refreshed: boolean }
  | { kind: "authorization_required"; reason: "no_token" | "reauthorization_required" };

export interface TokenManagerOptions {
  refreshSkewSeconds: number;
  now?: () => number;
  log?: LogFn;
}

type RefreshClient = Pick<CanvaOAuthClient, "refresh">;

/**
 * Centraliza o ciclo de vida do token:
 *  - devolve o access token atual enquanto faltar mais que `refreshSkewSeconds` para expirar;
 *  - caso contrário renova com o refresh token e persiste o resultado;
 *  - garante um único refresh por vez (o refresh token do Canva é rotacionado a cada uso,
 *    então dois refreshes concorrentes poderiam invalidar a sessão).
 */
export class TokenManager {
  private inflight: Promise<TokenResult> | null = null;
  private readonly skew: number;
  private readonly now: () => number;
  private readonly log: LogFn;

  constructor(
    private readonly store: TokenStore,
    private readonly client: RefreshClient,
    options: TokenManagerOptions,
  ) {
    this.skew = options.refreshSkewSeconds;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? silentLogger;
  }

  private nowSeconds(): number {
    return Math.floor(this.now() / 1000);
  }

  async getValidToken(): Promise<TokenResult> {
    if (this.inflight) return this.inflight;
    const token = await this.store.read();
    if (!token) return { kind: "authorization_required", reason: "no_token" };
    if (token.reauthorization_required) return { kind: "authorization_required", reason: "reauthorization_required" };
    if (token.expires_at - this.nowSeconds() > this.skew) {
      return { kind: "ok", token, refreshed: false };
    }
    return this.refreshSingleFlight();
  }

  /** Força a renovação mesmo que o access token ainda seja válido. */
  async forceRefresh(): Promise<TokenResult> {
    return this.refreshSingleFlight();
  }

  /** Persiste o resultado da troca authorization_code -> token. */
  async saveAuthorization(response: CanvaTokenResponse): Promise<StoredToken> {
    const now = this.nowSeconds();
    const token = toStoredToken(response, now, {
      refreshToken: response.refresh_token ?? "",
      scope: response.scope ?? "",
      authorizedAt: now,
    });
    await this.store.write(token);
    this.log("info", "oauth.authorized", { expires_at: token.expires_at, scope: token.scope });
    return token;
  }

  private refreshSingleFlight(): Promise<TokenResult> {
    if (!this.inflight) {
      this.inflight = this.doRefresh().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  private async doRefresh(): Promise<TokenResult> {
    const current = await this.store.read();
    if (!current) return { kind: "authorization_required", reason: "no_token" };
    if (current.reauthorization_required) return { kind: "authorization_required", reason: "reauthorization_required" };

    this.log("info", "token.refresh.started", { expires_at: current.expires_at });
    try {
      const response = await this.client.refresh(current.refresh_token);
      const next = toStoredToken(response, this.nowSeconds(), {
        refreshToken: current.refresh_token,
        scope: current.scope,
        authorizedAt: current.authorized_at,
      });
      await this.store.write(next);
      this.log("info", "token.refresh.succeeded", { expires_at: next.expires_at, rotated: Boolean(response.refresh_token) });
      return { kind: "ok", token: next, refreshed: true };
    } catch (err) {
      if (err instanceof CanvaOAuthError && !err.retryable && (err.httpStatus === 400 || err.httpStatus === 401)) {
        // Refresh token revogado, expirado ou já utilizado: só uma nova autorização resolve.
        await this.store.write({
          ...current,
          reauthorization_required: true,
          last_error: { code: err.errorCode, message: err.message, at: this.nowSeconds() },
          updated_at: this.nowSeconds(),
        });
        this.log("warn", "token.refresh.rejected", { http_status: err.httpStatus, error_code: err.errorCode });
        return { kind: "authorization_required", reason: "reauthorization_required" };
      }
      this.log("error", "token.refresh.failed", {
        http_status: err instanceof CanvaOAuthError ? err.httpStatus : null,
        error_code: err instanceof CanvaOAuthError ? err.errorCode : "UNEXPECTED",
        message: (err as Error).message,
      });
      throw err;
    }
  }
}

export function toStoredToken(
  response: CanvaTokenResponse,
  nowSeconds: number,
  fallback: { refreshToken: string; scope: string; authorizedAt: number },
): StoredToken {
  return {
    access_token: response.access_token,
    // O Canva devolve um novo refresh token a cada renovação; se não vier, mantém o anterior.
    refresh_token: response.refresh_token ?? fallback.refreshToken,
    token_type: response.token_type ?? "Bearer",
    expires_at: nowSeconds + Math.max(0, Math.floor(response.expires_in)),
    scope: response.scope ?? fallback.scope,
    authorized_at: fallback.authorizedAt,
    updated_at: nowSeconds,
  };
}
