import fs from "node:fs";
import { parse, printParseErrorCode } from "jsonc-parser";

export function parseWranglerConfig(text) {
  const errors = [];
  const config = parse(text, errors, { allowTrailingComma: true });
  if (errors.length) {
    const first = errors[0];
    throw new Error(`Invalid Wrangler JSONC: ${printParseErrorCode(first.error)} at offset ${first.offset}`);
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("Wrangler configuration must be an object");
  }
  return config;
}

export function readWranglerConfig(path = "wrangler.jsonc") {
  return parseWranglerConfig(fs.readFileSync(path, "utf8"));
}
