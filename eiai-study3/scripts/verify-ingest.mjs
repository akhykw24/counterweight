#!/usr/bin/env node
/**
 * Checks that a deployed ingest endpoint is actually working.
 *
 * Why this exists
 * ---------------
 * The offline-first client makes a broken server invisible. If `/api/events`
 * is missing, misconfigured, or pointed at a database it cannot write to, the
 * participant's browser holds everything in its write-ahead log and retries
 * quietly. The session looks perfect from the participant's side and from
 * yours. You find out when you go to analyse the data and there is none.
 *
 * So the endpoint gets checked deliberately, before recruiting, with a command
 * whose output is unambiguous.
 *
 * Usage
 * -----
 *   node scripts/verify-ingest.mjs                        # localhost:5173
 *   node scripts/verify-ingest.mjs https://your-app.app
 *   node scripts/verify-ingest.mjs https://your-app.app --write
 *
 * Without `--write` nothing is stored: the checks probe routing, function
 * boot and schema validation only. That is enough to catch most deployment
 * mistakes and is safe to run at any time, including during collection.
 *
 * `--write` additionally proves the database round-trip, which is the one
 * thing the read-only probes cannot reach. It appends one row, always the same
 * one -- see SMOKE_SESSION below.
 *
 * Exit codes: 0 all checks passed, 1 a check failed, 2 bad arguments.
 */

/**
 * The smoke row's identity, fixed rather than random.
 *
 * The events table is append-only by design, so anything written here is
 * permanent. A fixed pair means repeated runs add exactly one row in total
 * rather than one per run, and that row is trivially identifiable.
 *
 * It also excludes itself: the session has no SESSION_COMPLETED, so exclusion
 * criterion 1 in pipeline/exclusions.py drops it from every analysis without
 * anyone having to remember it exists.
 */
const SMOKE_SESSION = "00000000-0000-4000-8000-000000000001";
const SMOKE_EVENT = "00000000-0000-4000-8000-000000000002";

const args = process.argv.slice(2);
const write = args.includes("--write");
const positional = args.filter((arg) => !arg.startsWith("--"));

if (positional.length > 1) {
  console.error("usage: verify-ingest.mjs [base-url] [--write]");
  process.exit(2);
}

const base = (positional[0] ?? "http://localhost:5173").replace(/\/$/, "");
const endpoint = `${base}/api/events`;

let failures = 0;

function report(ok, name, detail) {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}`);
  if (detail) console.log(`        ${detail}`);
}

/**
 * Never throws. An unreachable endpoint is the most likely thing this script
 * finds, and a stack trace is a worse answer than a sentence -- the first
 * version of this crashed with an ECONNREFUSED dump, which is exactly the
 * output someone checking a deployment at midnight does not need.
 */
async function post(body) {
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    return { status: 0, body: null, unreachable: String(error) };
  }
  let parsed = null;
  try {
    parsed = await response.json();
  } catch {
    // A non-JSON body is itself diagnostic: usually an HTML error page from
    // the platform, meaning the request never reached the function.
  }
  return { status: response.status, body: parsed };
}

/**
 * Ends the process with a code, without calling process.exit().
 *
 * fetch leaves keep-alive sockets in undici's pool, and process.exit() while
 * they are open aborts the process on Windows with a libuv assertion -- exit
 * code 127 immediately after printing "All checks passed", which is the worst
 * possible combination for something whose whole job is to give a trustworthy
 * answer. Setting exitCode and unreferencing the pool lets Node leave cleanly.
 */
function finish(code) {
  process.exitCode = code;
  // Nudge the keep-alive sockets closed so the event loop empties promptly
  // instead of waiting out undici's idle timeout.
  const dispatcher = globalThis[Symbol.for("undici.globalDispatcher.1")];
  void dispatcher?.close?.();
}

function abortUnreachable(detail) {
  console.log("");
  console.log(`Nothing is answering at ${endpoint}.`);
  console.log(`  ${detail}`);
  console.log("");
  console.log("Check, in order: the URL is right; the deployment finished;");
  console.log("the project root is set to eiai-study3; api/events.ts was built.");
  finish(1);
  // Nothing after this can say anything useful.
  throw new ProbeAborted();
}

/** Thrown only to unwind out of the checks; never reaches the user. */
class ProbeAborted extends Error {}

process.on("uncaughtException", (error) => {
  // The unwind out of abortUnreachable, which has already printed everything
  // useful and set the exit code. Anything else is a genuine crash and is
  // re-raised so it is not swallowed.
  if (error instanceof ProbeAborted) return;
  throw error;
});

console.log(`Ingest check -> ${endpoint}`);
console.log(write ? "  mode: read-only probes + one written row" : "  mode: read-only probes");
console.log("");

// --- 1. the endpoint exists and runs our handler ---------------------------
{
  let response;
  try {
    response = await fetch(endpoint, { method: "GET" });
  } catch (error) {
    abortUnreachable(String(error));
  }
  const body = await response.json().catch(() => null);
  report(
    response.status === 405 && body?.error === "method_not_allowed",
    "the endpoint is reachable and running the ingest handler",
    response.status === 404
      ? "404: nothing is deployed at this path. The function was not built, or the project root is wrong."
      : response.status === 405
        ? undefined
        : `expected 405 method_not_allowed, got ${response.status}`,
  );
}

// --- 2. it is configured, i.e. it has a store to write to ------------------
{
  const { status, body, unreachable } = await post({ events: [] });
  if (unreachable) abortUnreachable(unreachable);
  if (status === 503 && body?.error === "ingest_not_configured") {
    report(
      false,
      "the store is configured",
      "503 ingest_not_configured: SUPABASE_URL and SUPABASE_SERVICE_KEY are not set in this deployment's environment.",
    );
  } else {
    report(true, "the store is configured");
  }
}

// --- 3. the schema is loaded and rejecting ---------------------------------
{
  const { status, body } = await post({
    events: [
      {
        event_id: "33333333-3333-4333-8333-333333333333",
        session_id: SMOKE_SESSION,
        seq: 0,
        client_ts: new Date().toISOString(),
        type: "NOT_A_REAL_EVENT",
        payload: {},
      },
    ],
  });
  report(
    status === 400 && body?.error === "invalid_batch",
    "an unknown event type is rejected, so validation is live",
    status === 400 ? undefined : `expected 400 invalid_batch, got ${status}`,
  );
}

// --- 4. the database round-trip -------------------------------------------
if (write) {
  const event = {
    event_id: SMOKE_EVENT,
    session_id: SMOKE_SESSION,
    seq: 0,
    client_ts: "2026-01-01T00:00:00.000Z",
    type: "SESSION_STARTED",
    payload: {
      app_version: "ingest-smoke-check",
      stimuli_manifest_hash: "0".repeat(64),
      viewport: { width: 1280, height: 800 },
      resumed: false,
      repeat_session: false,
    },
  };

  const first = await post({ events: [event] });
  const accepted = first.status === 200;
  report(
    accepted,
    "a well-formed event is accepted and stored",
    accepted
      ? first.body?.inserted === 1
        ? "wrote the smoke row"
        : "the smoke row was already present from an earlier run"
      : `got ${first.status}: ${JSON.stringify(first.body)}`,
  );

  if (accepted) {
    const second = await post({ events: [event] });
    report(
      second.status === 200 && second.body?.inserted === 0,
      "re-sending it stores nothing, so at-least-once delivery is safe",
      second.body?.inserted === 0
        ? undefined
        : `expected inserted: 0 on the second send, got ${JSON.stringify(second.body)}`,
    );
  }
}

console.log("");
if (failures === 0) {
  console.log(
    write
      ? "All checks passed. Participants' data will reach the database."
      : "All checks passed. Re-run with --write to prove the database round-trip.",
  );
} else {
  console.log(`${failures} check(s) failed. Do not recruit until these pass.`);
}

finish(failures === 0 ? 0 : 1);
