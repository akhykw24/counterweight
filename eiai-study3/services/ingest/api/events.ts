import { ingestRequest } from "../src/handler.js";
import { supabaseStore } from "../src/supabase.js";

/**
 * Deployment entry point (Vercel / any fetch-style runtime).
 *
 * The service key lives only here, server-side. No key of any kind reaches the
 * client bundle -- that is ADR-002's other half.
 */

export const config = { runtime: "edge" };

export default async function handler(request: Request): Promise<Response> {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_SERVICE_KEY"];

  if (!url || !key) {
    return new Response(JSON.stringify({ error: "ingest_not_configured" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }

  return ingestRequest(request, supabaseStore(url, key));
}
