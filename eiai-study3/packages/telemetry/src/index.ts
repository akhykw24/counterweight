/**
 * @eiai/telemetry — offline-first event capture.
 *
 * Client-side durability, at-least-once delivery, idempotent reconciliation by
 * event UUID. The difference between losing 8% of a school sample to
 * connectivity and losing none (STUDY3_SPEC_v3.md section 6).
 */

export * from "./wal.js";
export * from "./transport.js";
export * from "./resume.js";
export * from "./recorder.js";
