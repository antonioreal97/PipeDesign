import type { Config } from "./config.js";

/**
 * Cliente mínimo dos endpoints OAuth da Canva Connect API.
 * Docs: https://www.canva.dev/docs/connect/authentication/
 *       https://www.canva.dev/docs/connect/api-reference/authentication/generate-access-token/
 */

export interface CanvaTokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  /** Segundos até expirar (hoje ~4h, mas pode mudar). */
  expires_in: number;
  scope?: string;
}

export class CanvaOAuthError extends Error {
  override name = "CanvaOAuthError";
  constructor(
    message: string,
    /** Status HTTP retornado pelo Canva; `null` para falha de rede/timeout. */
    readonly httpStatus: number | null,
    /** Código de erro do Canva (campo `code`/`error`) ou código local. */
    readonly errorCode: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export type OAuthClientConfig = Pick<
  Config,
  "clientId" | "clientSecret" | "redirectUri" | "authUrl" | "tokenUrl" | "scopes" | "httpTimeoutMs"
>;

export class CanvaOAuthClient {
  constructor(
    private readonly config: OAuthClientConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /**
   * Monta a URL de autorização. Os parâmetros são codificados com encodeURIComponent
   * (espaços viram %20, como nos exemplos da documentação do Canva).
   */
  buildAuthorizeUrl(codeChallenge: string, state: string): string {
    const params: Array<[string, string]> = [
      ["code_challenge", codeChallenge],
      ["code_challenge_method", "s256"],
      ["scope", this.config.scopes.join(" ")],
      ["response_type", "code"],
      ["client_id", this.config.clientId],
      ["state", state],
      ["redirect_uri", this.config.redirectUri],
    ];
    const query = params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
    const separator = this.config.authUrl.includes("?") ? "&" : "?";
    return `${this.config.authUrl}${separator}${query}`;
  }

  async exchangeCode(code: string, codeVerifier: string): Promise<CanvaTokenResponse> {
    const token = await this.requestToken({
      grant_type: "authorization_code",
      code_verifier: codeVerifier,
      code,
      redirect_uri: this.config.redirectUri,
    });
    if (!token.refresh_token) {
      throw new CanvaOAuthError("Resposta do Canva sem refresh_token.", 200, "INVALID_TOKEN_RESPONSE", false);
    }
    return token;
  }

  async refresh(refreshToken: string): Promise<CanvaTokenResponse> {
    return this.requestToken({ grant_type: "refresh_token", refresh_token: refreshToken });
  }

  private async requestToken(params: Record<string, string>): Promise<CanvaTokenResponse> {
    const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64");

    let res: Response;
    try {
      res = await this.fetchImpl(this.config.tokenUrl, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams(params).toString(),
        signal: AbortSignal.timeout(this.config.httpTimeoutMs),
      });
    } catch (err) {
      const isTimeout = (err as Error).name === "TimeoutError" || (err as Error).name === "AbortError";
      throw new CanvaOAuthError(
        isTimeout ? "Timeout ao chamar o endpoint de token do Canva." : `Falha de rede ao chamar o Canva: ${(err as Error).message}`,
        null,
        isTimeout ? "CANVA_TIMEOUT" : "CANVA_NETWORK_ERROR",
        true,
      );
    }

    const text = await res.text();
    let body: Record<string, unknown> | undefined;
    try {
      body = text ? (JSON.parse(text) as Record<string, unknown>) : undefined;
    } catch {
      body = undefined;
    }

    if (!res.ok) {
      const code = String(body?.code ?? body?.error ?? `HTTP_${res.status}`);
      const message = String(body?.message ?? body?.error_description ?? `Canva respondeu HTTP ${res.status}.`);
      const retryable = res.status === 429 || res.status >= 500;
      throw new CanvaOAuthError(message, res.status, code, retryable);
    }

    if (!body || typeof body.access_token !== "string" || typeof body.expires_in !== "number") {
      throw new CanvaOAuthError("Resposta de token do Canva em formato inesperado.", res.status, "INVALID_TOKEN_RESPONSE", false);
    }

    return {
      access_token: body.access_token,
      refresh_token: typeof body.refresh_token === "string" ? body.refresh_token : undefined,
      token_type: typeof body.token_type === "string" ? body.token_type : "Bearer",
      expires_in: body.expires_in,
      scope: typeof body.scope === "string" ? body.scope : undefined,
    };
  }
}
