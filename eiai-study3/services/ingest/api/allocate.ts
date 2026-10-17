import { allocateRequest, supabaseSlots } from "../src/allocate.js";

/** Production wiring for /api/allocate: the same Supabase credentials as /api/events. */
export default async function handler(request: Request): Promise<Response> {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_SERVICE_KEY"];
  if (!url || !key) {
    return new Response(JSON.stringify({ error: "allocation_not_configured" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }
  return allocateRequest(request, supabaseSlots(url, key));
}
