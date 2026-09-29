/**
 * Logger JSON estruturado. Qualquer campo cujo nome sugira segredo é mascarado,
 * para que tokens, client secret, code e code_verifier nunca apareçam nos logs.
 */

type Level = "debug" | "info" | "warn" | "error";

const SENSITIVE_KEY = /(token|secret|password|authorization|verifier|api[_-]?key|^code$)/i;
const REDACTED = "[REDACTED]";

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    // Campos de metadados de expiração são seguros e úteis para debugging.
    const isSafeMeta = key === "expires_at" || key === "token_expires_at" || key === "token_type";
    out[key] = SENSITIVE_KEY.test(key) && !isSafeMeta ? REDACTED : redact(v, depth + 1);
  }
  return out;
}

export type LogFn = (level: Level, event: string, fields?: Record<string, unknown>) => void;

export function createLogger(service: string, sink: (line: string) => void = (l) => console.log(l)): LogFn {
  return (level, event, fields = {}) => {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      service,
      event,
      ...(redact(fields) as Record<string, unknown>),
    };
    sink(JSON.stringify(entry));
  };
}

export const silentLogger: LogFn = () => {};
