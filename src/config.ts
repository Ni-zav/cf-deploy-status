import type { Env, ProjectConfig } from "./types";

export type ParsedProjects = {
  projects: ProjectConfig[];
  error?: string;
};

export function parseProjectsJson(value: string | undefined): ParsedProjects {
  if (!value?.trim()) return { projects: [] };
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return { projects: [], error: "PROJECTS_JSON must be an array" };

    const projects: ProjectConfig[] = [];
    for (const item of parsed) {
      if (!isProjectConfig(item)) {
        return { projects: [], error: "PROJECTS_JSON contains an invalid project entry" };
      }
      if (item.enabled !== false) projects.push(item);
    }
    return { projects };
  } catch (error) {
    return {
      projects: [],
      error: `PROJECTS_JSON is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function getProjects(env: Env): ProjectConfig[] {
  const parsed = parseProjectsJson(env.PROJECTS_JSON);
  if (parsed.error) console.error("Invalid PROJECTS_JSON", parsed.error);
  return parsed.projects;
}

function isProjectConfig(value: unknown): value is ProjectConfig {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (v.product === "workers" || v.product === "pages") && typeof v.name === "string" && v.name.length > 0;
}

export function envFlag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export function stateTtl(env: Env): number {
  const value = Number.parseInt(env.STATE_TTL_SECONDS ?? "2592000", 10);
  return Number.isFinite(value) && value >= 60 ? value : 2_592_000;
}

export function errorSummaryMaxChars(env: Env): number {
  const value = Number.parseInt(env.ERROR_SUMMARY_MAX_CHARS ?? "1200", 10);
  return Number.isFinite(value) && value >= 100 ? Math.min(value, 5000) : 1200;
}

export function findProject(env: Env, product: "workers" | "pages", name: string): ProjectConfig | undefined {
  return getProjects(env).find((project) => project.product === product && project.name === name);
}

export function resolveEnvironment(
  project: ProjectConfig | undefined,
  branch: string | undefined,
  providerEnvironment: string | undefined,
  explicitEnvironment?: string,
): string {
  if (explicitEnvironment?.trim()) return explicitEnvironment.trim();
  if (project?.environment?.trim()) return project.environment.trim();
  if (branch && project?.branchEnvironmentMap?.[branch]) return project.branchEnvironmentMap[branch]!;
  if (providerEnvironment === "production") return "production";
  if (providerEnvironment === "preview") return project?.defaultPreviewEnvironment ?? "preview";
  if (branch === "main" || branch === "master") return "production";
  if (branch) return branch;
  return providerEnvironment || "unknown";
}
