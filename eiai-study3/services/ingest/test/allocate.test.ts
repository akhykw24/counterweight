import { describe, expect, it } from "vitest";
import { allocateRequest, memorySlots, supabaseSlots, type SlotStore } from "../src/allocate.js";

const SESSION = "5b1f0f7e-2f3c-4c8e-9a1d-0c2b7a6e4d11";
const SEQUENCES = {
  "B1-B2": ["Neutral-B", "EI-B", "EI-A", "Neutral-A"],
  "C1-C2-native": ["EI-A", "Neutral-A", "EI-B", "Neutral-B"],
  "test:B1-B2": ["EI-B", "EI-A", "Neutral-B", "Neutral-A"],
  "test:C1-C2-native": ["Neutral-A", "EI-B", "EI-A", "Neutral-B"],
};

const post = (body: unknown) =>
  new Request("http://x/api/allocate", { method: "POST", body: JSON.stringify(body) });

async function call(store: SlotStore, body: unknown) {
  const response = await allocateRequest(post(body), store);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("POST /api/allocate", () => {
  it("gives the next slot of the participant's stratum", async () => {
    const store = memorySlots(SEQUENCES);
    const results = [];
    for (let n = 1; n <= 4; n += 1) {
      results.push((await call(store, { session_id: uuid(n), english_band: "B1-B2", run_mode: "live" })).body);
    }
    expect(results.map((r) => r["cell"])).toEqual(SEQUENCES["B1-B2"]);
    expect(results.map((r) => r["sequence_index"])).toEqual([0, 1, 2, 3]);
    expect(results[0]!["stratum"]).toBe("B1-B2");
  });

  it("sends test runs to the test sequence, never the participants'", async () => {
    const store = memorySlots(SEQUENCES);
    const result = await call(store, { session_id: SESSION, english_band: "B1-B2", run_mode: "test" });
    expect(result.body).toEqual({ cell: "EI-B", sequence_index: 0, stratum: "test:B1-B2" });
    const status = await store.status();
    expect(status.find((s) => s.stratum === "B1-B2")!.claimed).toBe(0);
  });

  it("answers a repeated request from the same session with the same slot", async () => {
    const store = memorySlots(SEQUENCES);
    const a = await call(store, { session_id: SESSION, english_band: "C1-C2-native", run_mode: "live" });
    const b = await call(store, { session_id: SESSION, english_band: "C1-C2-native", run_mode: "live" });
    expect(b.body).toEqual(a.body);
    expect((await store.status()).find((s) => s.stratum === "C1-C2-native")!.claimed).toBe(1);
  });

  it("refuses pilot runs: they keep their own rotation", async () => {
    const result = await call(memorySlots(SEQUENCES), { session_id: SESSION, english_band: "B1-B2", run_mode: "pilot" });
    expect(result.status).toBe(400);
  });

  it("refuses a malformed request with the reasons", async () => {
    const result = await call(memorySlots(SEQUENCES), { session_id: "nope", english_band: "A2", run_mode: "live" });
    expect(result.status).toBe(400);
    expect(result.body["issues"]).toHaveLength(2);
    const notJson = await allocateRequest(new Request("http://x", { method: "POST", body: "{" }), memorySlots(SEQUENCES));
    expect(notJson.status).toBe(400);
  });

  it("says 409 when a stratum is used up, so the browser stops retrying", async () => {
    const store = memorySlots({ "B1-B2": ["EI-A"] });
    await call(store, { session_id: uuid(1), english_band: "B1-B2", run_mode: "live" });
    const full = await call(store, { session_id: uuid(2), english_band: "B1-B2", run_mode: "live" });
    expect(full.status).toBe(409);
  });

  it("says 503 when the store fails, so the browser keeps retrying", async () => {
    const broken: SlotStore = {
      claim: () => Promise.reject(new Error("down")),
      status: () => Promise.reject(new Error("down")),
    };
    expect((await call(broken, { session_id: SESSION, english_band: "B1-B2", run_mode: "live" })).status).toBe(503);
  });

  it("refuses to pass on a cell that is not one of the four", async () => {
    const odd: SlotStore = { claim: async () => ({ index: 0, cell: "warm" }), status: async () => [] };
    expect((await call(odd, { session_id: SESSION, english_band: "B1-B2", run_mode: "live" })).status).toBe(500);
  });
});

describe("GET /api/allocate", () => {
  it("reports counts per stratum and nothing about what comes next", async () => {
    const store = memorySlots(SEQUENCES);
    await call(store, { session_id: SESSION, english_band: "B1-B2", run_mode: "live" });
    const response = await allocateRequest(new Request("http://x/api/allocate"), store);
    const body = (await response.json()) as { strata: unknown[] };
    expect(body.strata).toContainEqual({ stratum: "B1-B2", claimed: 1, total: 4 });
    expect(JSON.stringify(body)).not.toMatch(/EI-|Neutral-/);
  });
});

describe("supabaseSlots", () => {
  it("calls the RPC with the session and stratum and reads the slot", async () => {
    const calls: { url: string; body: string }[] = [];
    const store = supabaseSlots("https://p.supabase.co/", "k", async (url, init) => {
      calls.push({ url: String(url), body: String(init?.body) });
      return new Response(JSON.stringify([{ idx: 7, cell: "Neutral-A" }]), { status: 200 });
    });
    expect(await store.claim(SESSION, "B1-B2")).toEqual({ index: 7, cell: "Neutral-A" });
    expect(calls[0]!.url).toBe("https://p.supabase.co/rest/v1/rpc/claim_v3_slot");
    expect(JSON.parse(calls[0]!.body)).toEqual({ p_session: SESSION, p_stratum: "B1-B2" });
  });

  it("recognises the database's 'exhausted' error", async () => {
    const store = supabaseSlots("https://p.supabase.co", "k", async () =>
      new Response(JSON.stringify({ code: "P0001", message: "v3 allocation sequence exhausted for stratum B1-B2", hint: "exhausted" }), {
        status: 400,
      }),
    );
    expect(await store.claim(SESSION, "B1-B2")).toBe("exhausted");
  });

  it("treats any other failure as an error to retry", async () => {
    const store = supabaseSlots("https://p.supabase.co", "k", async () =>
      new Response(JSON.stringify({ code: "PGRST202", message: "Could not find the function" }), { status: 404 }),
    );
    await expect(store.claim(SESSION, "B1-B2")).rejects.toThrow(/claim_v3_slot failed: 404/);
  });
});
