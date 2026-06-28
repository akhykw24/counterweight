/**
 * Pull a JSON object out of a model response, tolerating code fences and stray
 * prose. Returns null if nothing parseable is found. Shared by the classifier
 * and the telemetry judge.
 */
export function extractJsonObject(raw: string): unknown {
  if (!raw) return null;
  let text = raw.trim();
  // Strip a leading ```json / ``` fence and a trailing ``` fence if present.
  text = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(text);
  } catch {
    // Fall back to grabbing the first {...} block anywhere in the text.
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}
