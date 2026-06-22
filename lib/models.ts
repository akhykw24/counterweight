import OpenAI from "openai";

/**
 * Single config point for models + providers.
 *
 * Every LLM call in the app goes through one of two logical providers:
 *   - "persona": the warm sparring replies (quality matters)
 *   - "cheap":   the classifier / judge that runs on every turn (fast + free)
 *
 * Both are reached over OpenAI-compatible endpoints, so we use the standard
 * `openai` SDK with a per-provider baseURL + apiKey. Swap a model or endpoint
 * here and the whole app follows.
 */

export type Provider = "persona" | "cheap";

const GEMINI_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai/";
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

/** Warm sparring replies — Gemini via its OpenAI-compatible endpoint. */
export const PERSONA_MODEL = "gemini-2.5-flash";
/** Classifier + judge — Groq's Llama, cheap and fast on every turn. */
export const CHEAP_MODEL = "llama-3.3-70b-versatile";

type ResolvedProvider = {
  /** Model id to pass to `chat.completions.create`. */
  model: string;
  baseURL: string;
  apiKey: string | undefined;
  /** Which env var the key comes from (for clearer error messages). */
  keyName: string;
};

const personaProvider = (): ResolvedProvider => ({
  model: PERSONA_MODEL,
  baseURL: GEMINI_BASE_URL,
  apiKey: process.env.GEMINI_API_KEY,
  keyName: "GEMINI_API_KEY",
});

/**
 * Resolve a logical provider to a concrete config.
 *
 * Fallback rule: if GROQ_API_KEY is missing, the "cheap" provider falls back to
 * the Gemini client running gemini-2.5-flash, so the app still works with only
 * a single key configured.
 */
function resolveProvider(provider: Provider): ResolvedProvider {
  if (provider === "persona") return personaProvider();

  // provider === "cheap"
  if (process.env.GROQ_API_KEY) {
    return {
      model: CHEAP_MODEL,
      baseURL: GROQ_BASE_URL,
      apiKey: process.env.GROQ_API_KEY,
      keyName: "GROQ_API_KEY",
    };
  }
  // Fallback: no Groq key -> reuse the Gemini client + model for cheap calls.
  return personaProvider();
}

/** The model id to use for a logical provider (respects the cheap->Gemini fallback). */
export function getModel(provider: Provider): string {
  return resolveProvider(provider).model;
}

/**
 * Returns a configured OpenAI client for the given logical provider.
 * Throws a clear error if the required API key is missing.
 *
 * Server-side only — never import this from a client component.
 */
export function getClient(provider: Provider): OpenAI {
  const { apiKey, baseURL, keyName } = resolveProvider(provider);
  if (!apiKey) {
    throw new Error(
      `Missing ${keyName}. Add it to .env.local and restart the dev server.`
    );
  }
  // Force the SDK to use Node's native fetch (undici) instead of its bundled
  // node-fetch shim, whose gzip handling throws ERR_STREAM_PREMATURE_CLOSE on
  // recent Node versions. undici decompresses the gzipped responses correctly.
  return new OpenAI({
    apiKey,
    baseURL,
    fetch: (url, init) => globalThis.fetch(url, init),
  });
}
