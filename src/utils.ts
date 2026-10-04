import type { DeploymentStatus, Env } from "./types";
import { errorSummaryMaxChars } from "./config";

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function normalizeStatus(input: string | undefined): DeploymentStatus | null {
  const value = input?.trim().toLowerCase();
  if (!value) return null;
  if (["started", "start", "active", "running", "queued", "pending", "in_progress"].includes(value)) return "started";
  if (["succeeded", "success", "successful", "complete", "completed"].includes(value)) return "succeeded";
  if (["failed", "failure", "error", "errored"].includes(value)) return "failed";
  if (["canceled", "cancelled", "cancel"].includes(value)) return "canceled";
  if (["skipped", "skip"].includes(value)) return "skipped";
  return null;
}

export function durationMs(start?: string, end?: string): number | undefined {
  if (!start || !end) return undefined;
  const a = Date.parse(start);
  const b = Date.parse(end);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return undefined;
  return b - a;
}

export function sanitizeErrorSummary(value: string | undefined, env: Env): string | undefined {
  if (!value) return undefined;
  let sanitized = value
    .replace(/(authorization:\s*bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/(CLOUDFLARE_API_TOKEN\s*[=:]\s*)[^\s]+/gi, "$1[REDACTED]")
    .replace(/(API[_-]?TOKEN\s*[=:]\s*)[^\s]+/gi, "$1[REDACTED]")
    .replace(/(TELEGRAM_BOT_TOKEN\s*[=:]\s*)[^\s]+/gi, "$1[REDACTED]")
    .replace(/https:\/\/api\.telegram\.org\/bot[^\s/]+/gi, "https://api.telegram.org/bot[REDACTED]")
    .replace(/https:\/\/discord(?:app)?\.com\/api\/webhooks\/[^\s]+/gi, "[REDACTED_DISCORD_WEBHOOK]")
    .replace(/https:\/\/hooks\.slack\.com\/services\/[^\s]+/gi, "[REDACTED_SLACK_WEBHOOK]")
    .trim();
  const max = errorSummaryMaxChars(env);
  if (sanitized.length > max) sanitized = `${sanitized.slice(0, max - 1)}…`;
  return sanitized || undefined;
}

export function readBearer(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (!auth?.toLowerCase().startsWith("bearer ")) return null;
  return auth.slice(7).trim() || null;
}

export function timingSafeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  const max = Math.max(left.length, right.length);
  for (let i = 0; i < max; i += 1) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

export async function parseJsonBody<T>(request: Request, maxBytes = 64 * 1024): Promise<T> {
  const declared = Number.parseInt(request.headers.get("content-length") ?? "0", 10);
  if (declared > maxBytes) throw new Error("request body too large");
  const text = await request.text();
  if (text.length > maxBytes) throw new Error("request body too large");
  return JSON.parse(text) as T;
}

export function stringifyError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

export function shortSha(value?: string): string | undefined {
  return value ? value.slice(0, 8) : undefined;
}
