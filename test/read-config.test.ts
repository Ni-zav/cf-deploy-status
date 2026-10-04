import { describe, expect, it } from "vitest";
import { parseWranglerConfig } from "../scripts/read-config.mjs";

describe("Wrangler JSONC configuration parsing", () => {
  it("accepts comments and trailing commas without changing strings", () => {
    expect(parseWranglerConfig(`{
      // Local configuration note
      "name": "test-worker",
      "vars": { "URL": "https://example.com/path//value", },
      /* Another configuration note */
    }`)).toEqual({ name: "test-worker", vars: { URL: "https://example.com/path//value" } });
  });

  it("rejects malformed pasted content instead of using a partial parse", () => {
    expect(() => parseWranglerConfig('{"name":"test-worker"}Metrics')).toThrow("Invalid Wrangler JSONC");
    expect(() => parseWranglerConfig('{"name":"test-worker",')).toThrow("Invalid Wrangler JSONC");
  });

  it("requires a configuration object", () => {
    for (const text of ["[]", "null", '"worker"']) {
      expect(() => parseWranglerConfig(text)).toThrow("must be an object");
    }
  });
});
