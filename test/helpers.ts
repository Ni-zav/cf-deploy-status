import { vi } from "vitest";

export function createMemoryKv() {
  const store = new Map<string, string>();
  return {
    store,
    binding: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
      delete: vi.fn(async (key: string) => {
        store.delete(key);
      }),
    },
  };
}

export function createTestEnv(overrides: Record<string, unknown> = {}) {
  const kv = createMemoryKv();
  const send = vi.fn(async () => undefined);
  const env = {
    STATE: kv.binding,
    EVENTS: { send },
    PROJECTS_JSON: "[]",
    ...overrides,
  };
  return { env, kv, send };
}

export function deploymentEvent(overrides: Record<string, unknown> = {}) {
  return {
    eventId: "event-1",
    provider: "cloudflare",
    product: "workers",
    project: "api",
    status: "succeeded",
    environment: "production",
    source: "github-actions",
    observedAt: "2026-10-04T00:00:00.000Z",
    ...overrides,
  };
}
