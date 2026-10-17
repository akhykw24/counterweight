/**
 * The v3 allocation endpoint: one slot of the committed sequence per session.
 *
 *   POST /api/allocate  {session_id, english_band, run_mode}  -> {cell, sequence_index, stratum}
 *   GET  /api/allocate                                         -> {strata: [{stratum, claimed, total}]}
 *
 * The browser asks once, after screening and the pre-measures, and only on a
 * link that has no other way to choose: the single public link (run_mode
 * live) and a test run without `cell=`. Pilot links keep their numbered
 * rotation and never come here.
 *
 * Self-contained on purpose: no workspace imports, so Vercel's edge bundler
 * can follow it (see the comment at the top of handler.ts).
 */

export const CELLS = ["EI-A", "EI-B", "Neutral-A", "Neutral-B"] as const;
export const ENGLISH_BANDS = ["B1-B2", "C1-C2-native"] as const;
export const TEST_PREFIX = "test:";

export interface Slot {
  index: number;
  cell: string;
}

export interface StratumStatus {
  stratum: string;
  claimed: number;
  total: number;
}

export interface SlotStore {
  /** The session's slot in the stratum: the one it holds, or the next free one. */
  claim(sessionId: string, stratum: string): Promise<Slot | "exhausted">;
  status(): Promise<StratumStatus[]>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function allocateRequest(request: Request, store: SlotStore): Promise<Response> {
  if (request.method === "GET") {
    try {
      return json(200, { strata: await store.status() });
    } catch (error) {
      return json(503, { error: "store_unavailable", detail: String(error) });
    }
  }
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const sessionId = body["session_id"];
  const band = body["english_band"];
  const runMode = body["run_mode"];
  const issues: string[] = [];
  if (typeof sessionId !== "string" || !UUID.test(sessionId)) issues.push("session_id must be a UUID");
  if (!(ENGLISH_BANDS as readonly unknown[]).includes(band)) issues.push(`english_band must be one of ${ENGLISH_BANDS.join(", ")}`);
  // Pilot runs have their own rotation and must never draw from these lists:
  // a pilot participant holding a main-study slot would unbalance the study.
  if (runMode !== "live" && runMode !== "test") issues.push("run_mode must be live or test");
  if (issues.length > 0) return json(400, { error: "invalid_request", issues });

  const stratum = `${runMode === "test" ? TEST_PREFIX : ""}${band as string}`;
  let slot: Slot | "exhausted";
  try {
    slot = await store.claim(sessionId as string, stratum);
  } catch (error) {
    // 5xx: the browser keeps the participant on the waiting screen and retries.
    return json(503, { error: "store_unavailable", detail: String(error) });
  }
  if (slot === "exhausted") return json(409, { error: "sequence_exhausted", stratum });
  if (!(CELLS as readonly string[]).includes(slot.cell) || !Number.isInteger(slot.index) || slot.index < 0) {
    return json(500, { error: "invalid_slot", detail: slot });
  }
  return json(200, { cell: slot.cell, sequence_index: slot.index, stratum });
}

/** Supabase: the two security-definer functions from 004_v3_allocation.sql, over PostgREST. */
export function supabaseSlots(url: string, serviceKey: string, fetchImpl: typeof fetch = fetch): SlotStore {
  const base = `${url.replace(/\/$/, "")}/rest/v1/rpc`;
  const headers = {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    "content-type": "application/json",
  };
  return {
    async claim(sessionId, stratum) {
      const response = await fetchImpl(`${base}/claim_v3_slot`, {
        method: "POST",
        headers,
        body: JSON.stringify({ p_session: sessionId, p_stratum: stratum }),
      });
      const text = await response.text();
      if (!response.ok) {
        if (/exhausted/.test(text)) return "exhausted";
        throw new Error(`claim_v3_slot failed: ${response.status} ${text}`);
      }
      const rows = JSON.parse(text) as { idx: number; cell: string }[];
      const row = rows[0];
      if (!row) throw new Error("claim_v3_slot returned no slot");
      return { index: row.idx, cell: row.cell };
    },
    async status() {
      const response = await fetchImpl(`${base}/v3_allocation_status`, { method: "POST", headers, body: "{}" });
      const text = await response.text();
      if (!response.ok) throw new Error(`v3_allocation_status failed: ${response.status} ${text}`);
      return (JSON.parse(text) as { stratum: string; claimed: number; total: number }[]).map((r) => ({
        stratum: r.stratum,
        claimed: Number(r.claimed),
        total: Number(r.total),
      }));
    },
  };
}

/**
 * The same semantics in memory, over a sequence document, for the dev server
 * and the tests: lowest free slot per stratum, one slot per session, a
 * session that asks again gets the slot it holds.
 */
export function memorySlots(
  sequences: Record<string, readonly string[]>,
  persist?: { load(): Record<string, { stratum: string; index: number }>; save(claims: Record<string, { stratum: string; index: number }>): void },
): SlotStore {
  let memory: Record<string, { stratum: string; index: number }> = {};
  // Re-read on every call when persisted, so deleting the file resets the
  // claims without restarting the server -- which is how a validation run
  // starts from a clean sequence.
  const current = () => (persist ? persist.load() : memory);
  return {
    async claim(sessionId, stratum) {
      const claims = current();
      const held = claims[sessionId];
      if (held) return { index: held.index, cell: sequences[held.stratum]![held.index]! };
      const cells = sequences[stratum];
      if (!cells) return "exhausted";
      const taken = new Set(Object.values(claims).filter((c) => c.stratum === stratum).map((c) => c.index));
      const index = cells.findIndex((_, i) => !taken.has(i));
      if (index < 0) return "exhausted";
      const next = { ...claims, [sessionId]: { stratum, index } };
      if (persist) persist.save(next);
      else memory = next;
      return { index, cell: cells[index]! };
    },
    async status() {
      const claims = current();
      return Object.keys(sequences)
        .sort()
        .map((stratum) => ({
          stratum,
          claimed: Object.values(claims).filter((c) => c.stratum === stratum).length,
          total: sequences[stratum]!.length,
        }));
    },
  };
}
