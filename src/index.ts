import { handleHttp } from "./handlers/http";
import { handleQueue } from "./handlers/queue";
import { handleScheduled } from "./handlers/scheduled";
import type { Env } from "./types";

export default {
  fetch(request, env) {
    return handleHttp(request, env);
  },
  scheduled(_controller, env) {
    return handleScheduled(env);
  },
  queue(batch, env) {
    return handleQueue(batch, env);
  },
} satisfies ExportedHandler<Env, unknown>;
