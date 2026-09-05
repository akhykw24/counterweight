import { ingestRequest } from "../src/handler.js";
import { supabaseStore } from "../src/supabase.js";

/**
 * The configured handler: the generic ingest wrapper bound to the Supabase
 * store, with the credentials read from the environment.
 *
 * Not the deployment entry any more -- `api/events.ts` at the project root is,
 * because that is where the platform looks. The runtime declaration lives
 * there too, and deliberately not here: Vercel reads `export const config`
 * statically from the function file, so a copy in this module would be dead
 * weight that looks authoritative.
 *
 * The service key lives only on the server side. No key of any kind reaches
 * the client bundle -- that is ADR-002's other half.
 */

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
