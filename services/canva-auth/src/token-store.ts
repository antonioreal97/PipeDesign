import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** Formato persistido em TOKEN_STORE_PATH. Nunca versionar este arquivo. */
export interface StoredToken {
  access_token: string;
  refresh_token: string;
  token_type: string;
  /** Epoch em segundos. */
  expires_at: number;
  scope: string;
  /** Epoch em segundos da autorização original (OAuth). */
  authorized_at: number;
  /** Epoch em segundos da última gravação (autorização ou refresh). */
  updated_at: number;
  /** true quando o refresh token foi rejeitado e é preciso autorizar de novo. */
  reauthorization_required?: boolean;
  last_error?: { code: string; message: string; at: number };
}

export class TokenStoreError extends Error {
  override name = "TokenStoreError";
}

type RawStoredToken = Partial<StoredToken> & Pick<StoredToken, "access_token" | "refresh_token" | "expires_at">;

function isStoredToken(value: unknown): value is RawStoredToken {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.access_token === "string" &&
    typeof v.refresh_token === "string" &&
    typeof v.expires_at === "number" &&
    Number.isFinite(v.expires_at)
  );
}

export class TokenStore {
  constructor(private readonly path: string) {}

  get location(): string {
    return this.path;
  }

  async read(): Promise<StoredToken | null> {
    let raw: string;
    try {
      raw = await readFile(this.path, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new TokenStoreError(`Não foi possível ler o token store: ${(err as Error).message}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new TokenStoreError("Token store corrompido (JSON inválido). Apague o arquivo e autorize novamente.");
    }
    if (!isStoredToken(parsed)) {
      throw new TokenStoreError("Token store com formato inesperado. Apague o arquivo e autorize novamente.");
    }
    return {
      ...parsed,
      token_type: parsed.token_type ?? "Bearer",
      scope: parsed.scope ?? "",
      authorized_at: parsed.authorized_at ?? 0,
      updated_at: parsed.updated_at ?? 0,
    };
  }

  /** Gravação atômica: escreve em arquivo temporário (0600) e renomeia. */
  async write(token: StoredToken): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const tmp = `${this.path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    try {
      await writeFile(tmp, `${JSON.stringify(token, null, 2)}\n`, { mode: 0o600 });
      await rename(tmp, this.path);
    } catch (err) {
      await rm(tmp, { force: true }).catch(() => {});
      throw new TokenStoreError(`Não foi possível gravar o token store: ${(err as Error).message}`);
    }
  }

  async clear(): Promise<void> {
    await rm(this.path, { force: true });
  }
}
