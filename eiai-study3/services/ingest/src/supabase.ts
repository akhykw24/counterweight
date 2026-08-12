import type { EventRow, EventStore } from "./handler.js";

/**
 * Supabase-backed store.
 *
 * Uses PostgREST directly rather than @supabase/supabase-js: the whole client
 * is one authenticated POST, and a serverless function that ships a full SDK
 * to do a single insert is paying cold-start cost for nothing.
 *
 * `Prefer: resolution=ignore-duplicates` maps to ON CONFLICT DO NOTHING, which
 * is what makes at-least-once delivery safe.
 */
export function supabaseStore(
  url: string,
  serviceKey: string,
  fetchImpl: typeof fetch = fetch,
): EventStore {
  const endpoint = `${url.replace(/\/$/, "")}/rest/v1/events`;

  return {
    async insert(rows: readonly EventRow[]): Promise<number> {
      if (rows.length === 0) return 0;

      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          apikey: serviceKey,
          authorization: `Bearer ${serviceKey}`,
          "content-type": "application/json",
          prefer: "return=representation,resolution=ignore-duplicates",
        },
        body: JSON.stringify(rows),
      });

      if (!response.ok) {
        throw new Error(`supabase insert failed: ${response.status} ${await response.text()}`);
      }

      // With return=representation the response holds only the rows that were
      // actually written, so its length is the true insert count.
      const written = (await response.json()) as unknown[];
      return Array.isArray(written) ? written.length : rows.length;
    },
  };
}
