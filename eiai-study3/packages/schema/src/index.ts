/**
 * @eiai/schema — the single source of truth for every wire format in the study.
 *
 * One definition, three consumers:
 *   1. the client gets compile-time types via z.infer
 *   2. the ingest service gets runtime validation
 *   3. docs/DATA_DICTIONARY.md is generated from these schemas, so the data
 *      dictionary in the paper's appendix cannot drift from what was collected
 */

export * from "./primitives.js";
export * from "./events.js";
export * from "./stimuli.js";
export * from "./questionnaire.js";
export * from "./registry.js";
export * from "./v3.js";
export * from "./ingest.js";
