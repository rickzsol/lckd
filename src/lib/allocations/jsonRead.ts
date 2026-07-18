// Defensive readers for untyped webhook and RPC payloads.

export function readString(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") return null;
  const raw = Reflect.get(value, key);
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

export function readNumber(value: unknown, key: string): number | null {
  if (!value || typeof value !== "object") return null;
  const raw = Reflect.get(value, key);
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

export function readArray(value: unknown, key: string): unknown[] {
  if (!value || typeof value !== "object") return [];
  const raw = Reflect.get(value, key);
  return Array.isArray(raw) ? raw : [];
}

export function readObject(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return null;
  const raw = Reflect.get(value, key);
  return raw && typeof raw === "object" ? raw : null;
}
