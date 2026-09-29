/**
 * Guarda temporária (em memória) dos pares state -> code_verifier
 * entre /auth/canva/start e /auth/canva/callback.
 *
 * Cada state é de uso único e expira. Como o serviço é local e de um só usuário,
 * não há necessidade de persistir isso em disco: se o container reiniciar no meio
 * do fluxo, basta abrir /auth/canva/start novamente.
 */

interface PendingAuthorization {
  codeVerifier: string;
  createdAt: number;
}

export interface PendingAuthOptions {
  ttlMs?: number;
  maxItems?: number;
  now?: () => number;
}

export class PendingAuthStore {
  private readonly items = new Map<string, PendingAuthorization>();
  private readonly ttlMs: number;
  private readonly maxItems: number;
  private readonly now: () => number;

  constructor(options: PendingAuthOptions = {}) {
    this.ttlMs = options.ttlMs ?? 10 * 60_000;
    this.maxItems = options.maxItems ?? 20;
    this.now = options.now ?? Date.now;
  }

  create(state: string, codeVerifier: string): void {
    this.prune();
    while (this.items.size >= this.maxItems) {
      const oldest = this.items.keys().next().value;
      if (oldest === undefined) break;
      this.items.delete(oldest);
    }
    this.items.set(state, { codeVerifier, createdAt: this.now() });
  }

  /** Retorna o code_verifier e remove o state (uso único). `undefined` se inválido/expirado. */
  consume(state: string): string | undefined {
    this.prune();
    const item = this.items.get(state);
    if (!item) return undefined;
    this.items.delete(state);
    return item.codeVerifier;
  }

  get size(): number {
    this.prune();
    return this.items.size;
  }

  private prune(): void {
    const now = this.now();
    for (const [state, item] of this.items) {
      if (now - item.createdAt > this.ttlMs) this.items.delete(state);
    }
  }
}
