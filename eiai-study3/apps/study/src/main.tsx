/**
 * Entry point: picks the participant flow at build time.
 *
 * v3 (Mars Mission Training) is the active study. The deep-sea v2 flow stays
 * in the tree, whole and tested, behind `VITE_STUDY_FLOW=v2` -- the build the
 * v2 pilot ran is also tagged `pilot-v2-deepsea`. Only the chosen flow's code
 * is loaded: the other is a separate chunk the browser never fetches.
 */
const flow = (import.meta.env["VITE_STUDY_FLOW"] as string | undefined) ?? "v3";

if (flow === "v2") {
  await import("./main-v2");
} else {
  await import("./v3/main");
}

export {};
