import type { Env } from "../types";
import { stateTtl } from "../config";

export async function isProcessed(env: Env, eventId: string): Promise<boolean> {
  return (await env.STATE.get(`processed:${eventId}`)) !== null;
}

export async function markProcessed(env: Env, eventId: string): Promise<void> {
  await env.STATE.put(`processed:${eventId}`, "1", { expirationTtl: stateTtl(env) });
}

export async function isDelivered(env: Env, eventId: string, destination: string): Promise<boolean> {
  return (await env.STATE.get(`delivered:${eventId}:${destination}`)) !== null;
}

export async function markDelivered(env: Env, eventId: string, destination: string): Promise<void> {
  await env.STATE.put(`delivered:${eventId}:${destination}`, "1", { expirationTtl: stateTtl(env) });
}

export async function getState(env: Env, key: string): Promise<string | null> {
  return env.STATE.get(key);
}

export async function putState(env: Env, key: string, value: string): Promise<void> {
  await env.STATE.put(key, value, { expirationTtl: stateTtl(env) });
}
