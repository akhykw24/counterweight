/**
 * Deployment entry point for the v3 allocation endpoint. A thin forward to
 * services/ingest/api/allocate.ts, for the same two load-bearing reasons as
 * api/events.ts: `config` is declared literally, because Vercel reads it
 * statically to pick the edge runtime, and the import is dynamic inside a
 * try/catch, so a module that fails to load becomes a described 503 instead
 * of an opaque FUNCTION_INVOCATION_FAILED.
 */

export const config = { runtime: "edge" };

type Handler = (request: Request) => Promise<Response>;

let allocate: Handler | null = null;

export default async function handler(request: Request): Promise<Response> {
  try {
    if (!allocate) {
      const module = await import("../services/ingest/api/allocate.js");
      allocate = module.default as Handler;
    }
    return await allocate(request);
  } catch (error) {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return new Response(JSON.stringify({ error: "allocate_boot_failed", detail }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }
}
