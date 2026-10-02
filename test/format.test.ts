import { describe, expect, it } from "vitest";
import { formatDuration, formatPlainText } from "../src/destinations/format";
import type { DeploymentEvent } from "../src/types";

describe("notification formatting", () => {
  it("formats duration", () => {
    expect(formatDuration(500)).toBe("500ms");
    expect(formatDuration(12_000)).toBe("12s");
    expect(formatDuration(125_000)).toBe("2m 5s");
  });

  it("formats actionable deployment text", () => {
    const event: DeploymentEvent = {
      eventId: "x",
      provider: "cloudflare",
      product: "workers",
      project: "api",
      status: "failed",
      environment: "staging",
      branch: "staging",
      commitSha: "abcdef1234",
      source: "github-actions",
      errorSummary: "build failed",
      observedAt: "2026-10-02T00:00:00Z",
    };
    const text = formatPlainText(event);
    expect(text).toContain("DEPLOY FAILED");
    expect(text).toContain("api · Workers · staging");
    expect(text).toContain("commit: abcdef12");
    expect(text).toContain("error: build failed");
  });
});
