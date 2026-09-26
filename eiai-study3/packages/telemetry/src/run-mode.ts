/**
 * Which kind of run produced a session: the real study, the pilot, or a test.
 *
 * Carried in the event envelope so it is on every row rather than only on the
 * session's first event. A session whose opening event was lost would
 * otherwise lose its mark and read as live, and a pilot response sitting
 * undetected in the analysed sample is the failure this exists to prevent.
 *
 * Three values rather than two independent booleans. `pilot` and `test` both
 * mean "not the real thing"; they differ only in whether anyone intends to
 * read the answers. One column states that plainly, and the analysis filter
 * becomes `run_mode = 'live'` instead of a conjunction somebody can get half
 * right.
 */

export type RunMode = "live" | "pilot" | "test";

export const RUN_MODES: readonly RunMode[] = ["live", "pilot", "test"] as const;

/**
 * The mode a URL query string asks for.
 *
 * Only the exact string `true` counts. `?pilot=1`, `?pilot=yes` and a bare
 * `?pilot` are all somebody mistyping a link, and none of them should divert a
 * real participant into the pilot arm -- or, worse, mark a real participant's
 * data as disposable.
 *
 * `test` wins when both are present. Rehearsing the pilot flow is a real thing
 * to want, and mislabelling throwaway data as pilot data is the costlier of
 * the two mistakes.
 */
export function runModeFromSearch(search: string): RunMode {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (params.get("test") === "true") return "test";
  if (params.get("pilot") === "true") return "pilot";
  return "live";
}

/**
 * Whether this run uses the pilot flow: the separate allocation sequence and
 * the closing feedback questions.
 *
 * Both non-live modes do. The label is what differs, not the behaviour, so a
 * test session rehearses exactly what a pilot participant will meet.
 */
export function usesPilotFlow(mode: RunMode): boolean {
  return mode !== "live";
}
