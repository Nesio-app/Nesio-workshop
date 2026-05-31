import { randomInt } from "crypto";

type Entry = { code: string; expiresAt: number };

const store = new Map<string, Entry>();

function key(channel: string, target: string) {
  return `${channel}:${target.toLowerCase().trim()}`;
}

export function generateCode(): string {
  return String(randomInt(100000, 999999));
}

export function saveCode(channel: string, target: string, code: string, ttlMs = 10 * 60 * 1000) {
  store.set(key(channel, target), {
    code,
    expiresAt: Date.now() + ttlMs,
  });
}

export function verifyCode(channel: string, target: string, code: string): boolean {
  const entry = store.get(key(channel, target));
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    store.delete(key(channel, target));
    return false;
  }
  const ok = entry.code === code.trim();
  if (ok) store.delete(key(channel, target));
  return ok;
}
