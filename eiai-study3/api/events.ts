/**
 * Deployment entry point for the ingest endpoint.
 *
 * Vercel discovers serverless functions in `api/` at the project root, so this
 * file exists to put the endpoint where the platform looks. It holds no logic:
 * the handler, the store and the schema validation all live in
 * `services/ingest/`, which is where they are tested. Keeping it a thin
 * forward rather than a copy matters -- a second implementation of the write
 * path is a second thing that can disagree with the schema, and the one
 * guarantee this service makes is that everything reaching the table was
 * validated by exactly one piece of code.
 *
 * Two things here are load-bearing and neither is style.
 *
 * `config` is declared literally, not re-exported
 * ------------------------------------------------
 * Vercel decides which runtime a function gets by reading `export const config`
 * statically, before any code executes. A re-exported value is invisible to
 * that analysis, so the function gets built for the Node.js runtime -- whose
 * handlers take `(req, res)` -- while the code is a Web-standard
 * `(Request) => Response`. That deploys cleanly and fails on every invocation.
 *
 * The import is dynamic, inside a try/catch
 * -----------------------------------------
 * A module-level import that throws takes the whole function down before any
 * code of ours runs, and the platform reports FUNCTION_INVOCATION_FAILED with
 * no detail. On a study whose client silently retries forever, that is the
 * worst possible failure: data collection stops and nothing says so.
 *
 * Loading inside the handler means an import error becomes a described 503
 * instead of an opaque one. The client's behaviour is unchanged -- any 5xx
 * keeps the batch in the write-ahead log and retries -- but `verify-ingest`
 * and the logs can now say what actually broke.
 */

export const config = { runtime: "edge" };

type Ingest = (request: Request) => Promise<Response>;

let ingest: Ingest | null = null;

export default async function handler(request: Request): Promise<Response> {
  try {
    if (!ingest) {
      const module = await import("../services/ingest/api/events.js");
      ingest = module.default as Ingest;
    }
    return await ingest(request);
  } catch (error) {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return new Response(
      JSON.stringify({
        error: "ingest_boot_failed",
        detail,
        stack: error instanceof Error ? error.stack?.split("\n").slice(0, 6) : undefined,
      }),
      { status: 503, headers: { "content-type": "application/json" } },
    );
  }
}
