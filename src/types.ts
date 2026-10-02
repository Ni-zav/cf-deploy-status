export type Product = "workers" | "pages";
export type DeploymentStatus = "started" | "succeeded" | "failed" | "canceled" | "skipped";
export type EventSource =
  | "workers-builds"
  | "pages-notification"
  | "pages-api"
  | "workers-api"
  | "github-actions"
  | "wrangler-wrapper"
  | "test";

export type ProjectConfig = {
  product: Product;
  name: string;
  enabled?: boolean;
  environment?: string;
  branchEnvironmentMap?: Record<string, string>;
  defaultPreviewEnvironment?: string;
  reconcile?: boolean;
};

export type DeploymentEvent = {
  eventId: string;
  provider: "cloudflare";
  product: Product;
  project: string;
  status: DeploymentStatus;
  environment: string;
  providerEnvironment?: string;
  branch?: string;
  deploymentId?: string;
  buildId?: string;
  deploymentUrl?: string;
  dashboardUrl?: string;
  commitSha?: string;
  commitMessage?: string;
  actor?: string;
  source: EventSource;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  errorSummary?: string;
  repo?: string;
  runId?: string;
  job?: string;
  observedAt: string;
  rawRef?: {
    type?: string;
    correlationId?: string;
  };
};

export type NormalizedQueueMessage = {
  kind: "deployment-event";
  event: DeploymentEvent;
};

export type WorkersBuildEvent = {
  type?: string;
  source?: {
    type?: string;
    workerName?: string;
  };
  payload?: {
    buildUuid?: string;
    status?: string;
    buildOutcome?: string | null;
    createdAt?: string;
    initializingAt?: string | null;
    runningAt?: string | null;
    stoppedAt?: string | null;
    buildTriggerMetadata?: {
      buildTriggerSource?: string;
      branch?: string;
      commitHash?: string;
      commitMessage?: string;
      author?: string;
      buildCommand?: string;
      deployCommand?: string;
      rootDirectory?: string;
      repoName?: string;
      providerAccountName?: string;
      providerType?: string;
    };
  };
  metadata?: {
    accountId?: string;
    eventSubscriptionId?: string;
    eventSchemaVersion?: number;
    eventTimestamp?: string;
  };
};

export type PagesDeployment = {
  id?: string;
  short_id?: string;
  project_name?: string;
  environment?: string;
  url?: string;
  aliases?: string[];
  created_on?: string;
  modified_on?: string;
  latest_stage?: {
    name?: string;
    started_on?: string | null;
    ended_on?: string | null;
    status?: string;
  };
  stages?: Array<{
    name?: string;
    started_on?: string | null;
    ended_on?: string | null;
    status?: string;
  }>;
  deployment_trigger?: {
    type?: string;
    metadata?: {
      branch?: string;
      commit_hash?: string;
      commit_message?: string;
    };
  };
};

export type WorkersDeployment = {
  id?: string;
  created_on?: string;
  source?: string;
  author_email?: string;
  annotations?: Record<string, string>;
  versions?: Array<{
    version_id?: string;
    percentage?: number;
  }>;
};

export type CiPayload = {
  eventId?: string;
  product?: Product;
  project?: string;
  status?: string;
  environment?: string;
  providerEnvironment?: string;
  branch?: string;
  deploymentId?: string;
  buildId?: string;
  deploymentUrl?: string;
  dashboardUrl?: string;
  commitSha?: string;
  commitMessage?: string;
  actor?: string;
  source?: "github-actions" | "wrangler-wrapper";
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  errorSummary?: string;
  repo?: string;
  runId?: string;
  job?: string;
};

export type PagesWebhookPayload = {
  name?: string;
  text?: string;
  data?: Record<string, unknown>;
  ts?: number;
  account_id?: string;
  policy_id?: string;
  policy_name?: string;
  alert_type?: string;
  alert_correlation_id?: string;
  alert_event?: string;
};

export type Env = {
  STATE: KVNamespace;
  EVENTS: Queue<unknown>;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  INGEST_SHARED_SECRET?: string;
  PAGES_WEBHOOK_SECRET?: string;
  DISCORD_WEBHOOK_URL?: string;
  SLACK_WEBHOOK_URL?: string;
  GENERIC_WEBHOOK_URL?: string;
  GENERIC_WEBHOOK_SECRET?: string;
  PROJECTS_JSON?: string;
  NOTIFY_STARTED?: string;
  NOTIFY_ON_BOOTSTRAP?: string;
  ERROR_SUMMARY_MAX_CHARS?: string;
  STATE_TTL_SECONDS?: string;
};
