import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import type { EventStore } from "./handler.js";
import { createFileStore } from "./file-store.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

/**
 * The ingest endpoint, mounted on the Vite dev server.
 *
 * Before this, `pnpm dev` served the app at one origin and nothing at all at
 * `/api/events`. Every batch the participant's browser sent got a 404, the
 * write-ahead log kept everything and retried forever, and the developer saw a
 * working study. The failure was invisible precisely because the offline-first
 * design is good: losing the server is exactly what it is built to survive.
 *
 * So the same handler that runs in production runs here, over a store that
 * writes to a file. Two consequences worth having:
 *
 *   - the participant-to-server path can be tested end to end with no cloud
 *     account, which is what `e2e/ingest.spec.ts` does;
 *   - schema rejections surface during development instead of on the first
 *     real participant.
 *
 * There is no read endpoint. Tests read the file directly, so the service keeps
 * exactly one HTTP verb and the "no read path in the ingest service" property
 * holds in development too.
 */

export const DEV_INGEST_PATH = "/api/events";

/** Where the dev server keeps what it received. Git-ignored with the rest of data/. */
export const DEV_EVENT_LOG = "data/dev-events.jsonl";

/** v3 allocation in development: the committed sequence, claims kept in a file. */
export const DEV_ALLOCATE_PATH = "/api/allocate";
export const DEV_SLOTS_FILE = "data/dev-slots.json";
const ALLOCATION_V3 = fileURLToPath(new URL("../../../materials/allocation-v3.json", import.meta.url));
const ALLOCATE_MODULE = fileURLToPath(new URL("./allocate.ts", import.meta.url));

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      raw += chunk;
    });
    request.on("end", () => resolve(raw));
    request.on("error", reject);
  });
}

export interface DevIngestOptions {
  /** Path to the JSONL log. Relative paths resolve against the process CWD. */
  logPath?: string;
  /** Where v3 slot claims are kept. Defaults to dev-slots.json beside the log. */
  slotsPath?: string;
}

const HANDLER_MODULE = fileURLToPath(new URL("./handler.ts", import.meta.url));

type IngestRequestFn = (request: Request, store: EventStore) => Promise<Response>;

interface ViteDevServer {
  middlewares: {
    use(path: string, handler: (req: IncomingMessage, res: ServerResponse) => void): void;
  };
  ssrLoadModule(id: string): Promise<Record<string, unknown>>;
  config?: { logger?: { info(message: string): void } };
}

/**
 * Loads the production handler through Vite's own resolver.
 *
 * It cannot be imported at the top of this file. Vite loads a config file with
 * Node, outside its alias and extension resolution, and the handler imports
 * `@eiai/schema`, whose sources use `./x.js` specifiers that only resolve
 * through a bundler. A static import here fails the dev server before it
 * starts. `ssrLoadModule` is the same resolver the app itself gets, so
 * development and production run byte-identical handler code.
 */
function handlerLoader(server: ViteDevServer): () => Promise<IngestRequestFn> {
  let pending: Promise<IngestRequestFn> | null = null;
  return () => {
    pending ??= server
      .ssrLoadModule(HANDLER_MODULE)
      .then((module) => module["ingestRequest"] as IngestRequestFn);
    return pending;
  };
}

/**
 * A Vite plugin. Deliberately typed loosely so this package does not take a
 * dependency on Vite for one hook signature.
 */
export function devIngestPlugin(options: DevIngestOptions = {}) {
  const logPath = options.logPath ?? DEV_EVENT_LOG;

  return {
    name: "eiai-dev-ingest",
    apply: "serve" as const,
    configureServer(server: ViteDevServer) {
      // Constructed once, so its idempotency index is shared across requests
      // and survives for the life of the dev server.
      const store = createFileStore(logPath);
      const loadHandler = handlerLoader(server);

      server.config?.logger?.info(`  ingest (dev) -> ${logPath}`);

      server.middlewares.use(DEV_INGEST_PATH, (request, response) => {
        void (async () => {
          try {
            const raw = await readBody(request);
            const ingestRequest = await loadHandler();
            // The production wrapper, unchanged: method check, size cap, JSON
            // parse, schema validation. Using anything else here would make
            // development pass what production rejects.
            const result = await ingestRequest(
              new Request(`http://localhost${DEV_INGEST_PATH}`, {
                method: request.method ?? "GET",
                headers: { "content-type": "application/json" },
                ...(request.method === "POST" || request.method === "PUT"
                  ? { body: raw }
                  : {}),
              }),
              store,
            );

            response.statusCode = result.status;
            response.setHeader("content-type", "application/json");
            response.end(await result.text());
          } catch (error) {
            // 5xx, so the client keeps the batch and retries. A 200 here would
            // tell the browser it was safe to forget events nobody stored.
            response.statusCode = 500;
            response.setHeader("content-type", "application/json");
            response.end(JSON.stringify({ error: "dev_ingest_failed", detail: String(error) }));
          }
        })();
      });

      // The production allocation endpoint's handler over an in-file store,
      // so a local run takes exactly the path a participant's browser takes.
      const slotsPath = options.slotsPath ?? logPath.replace(/dev-events\.jsonl$/, "dev-slots.json");
      server.middlewares.use(DEV_ALLOCATE_PATH, (request, response) => {
        void (async () => {
          try {
            const raw = await readBody(request);
            const module = await server.ssrLoadModule(ALLOCATE_MODULE);
            const document = JSON.parse(readFileSync(ALLOCATION_V3, "utf8")) as {
              sequence: Record<string, string[]>;
              test_sequence: Record<string, string[]>;
            };
            type Claims = Record<string, { stratum: string; index: number }>;
            const memorySlots = module["memorySlots"] as (
              s: Record<string, readonly string[]>,
              p: { load(): Claims; save(c: Claims): void },
            ) => unknown;
            const allocateRequest = module["allocateRequest"] as (r: Request, s: unknown) => Promise<Response>;
            const store = memorySlots(
              { ...document.sequence, ...document.test_sequence },
              {
                load: () => (existsSync(slotsPath) ? (JSON.parse(readFileSync(slotsPath, "utf8")) as Claims) : {}),
                save: (claims) => writeFileSync(slotsPath, JSON.stringify(claims, null, 2)),
              },
            );
            const result = await allocateRequest(
              new Request(`http://localhost${DEV_ALLOCATE_PATH}`, {
                method: request.method ?? "GET",
                headers: { "content-type": "application/json" },
                ...(request.method === "POST" ? { body: raw } : {}),
              }),
              store,
            );
            response.statusCode = result.status;
            response.setHeader("content-type", "application/json");
            response.end(await result.text());
          } catch (error) {
            response.statusCode = 500;
            response.setHeader("content-type", "application/json");
            response.end(JSON.stringify({ error: "dev_allocate_failed", detail: String(error) }));
          }
        })();
      });
    },
  };
}
