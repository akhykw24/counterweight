import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  StimulusFile,
  StimulusManifest,
  type Condition,
  type Language,
  type RegisterState,
  type StimulusResponse,
} from "@eiai/schema";
import { registerSlug, stimulusFileFor } from "@eiai/fsm";

/**
 * Loads the frozen stimulus set and verifies it against the committed hash
 * manifest (STUDY3_SPEC_v2.md section 5).
 *
 * Serving a response is a lookup. Nothing here generates, interpolates, or
 * falls back: if the requested stimulus is absent or the manifest does not
 * match, this throws rather than improvising, because an improvised stimulus
 * is an uncontrolled one.
 */

export interface LoadedStimuli {
  readonly manifest: StimulusManifest;
  readonly byResponseId: ReadonlyMap<string, StimulusResponse>;
  readonly launchReady: boolean;
}

export class StimulusIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StimulusIntegrityError";
  }
}

/**
 * Digest of a file's bytes with line endings normalised to LF.
 *
 * Must stay byte-identical to `sha256_file` in pipeline/_common.py. Without the
 * normalisation, a CRLF checkout on Windows produces a different digest from
 * the same content on CI and the integrity guarantee degrades into a platform
 * check.
 */
export function hashFileLF(path: string): string {
  const normalised = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  return createHash("sha256").update(Buffer.from(normalised, "utf8")).digest("hex");
}

/** Digest over the sorted per-file digests. Mirrors `manifest_digest` in Python. */
export function manifestDigest(files: readonly { path: string; sha256: string }[]): string {
  const lines = files.map((file) => `${file.sha256}  ${file.path}`).join("\n");
  return createHash("sha256").update(Buffer.from(lines + "\n", "utf8")).digest("hex");
}

export function loadStimuli(materialsDir: string): LoadedStimuli {
  const manifestRaw: unknown = JSON.parse(
    readFileSync(join(materialsDir, "manifest.json"), "utf8"),
  );
  const manifestParsed = StimulusManifest.safeParse(manifestRaw);
  if (!manifestParsed.success) {
    throw new StimulusIntegrityError(
      `manifest.json failed schema validation: ${JSON.stringify(manifestParsed.error.issues)}`,
    );
  }
  const manifest = manifestParsed.data;

  const byResponseId = new Map<string, StimulusResponse>();

  for (const entry of manifest.files) {
    const absolute = join(materialsDir, "..", entry.path);
    const actual = hashFileLF(absolute);
    if (actual !== entry.sha256) {
      throw new StimulusIntegrityError(
        `${entry.path} does not match the committed manifest.\n` +
          `  expected ${entry.sha256}\n  actual   ${actual}\n` +
          `Frozen stimuli changed after the manifest was committed.`,
      );
    }

    const fileParsed = StimulusFile.safeParse(JSON.parse(readFileSync(absolute, "utf8")));
    if (!fileParsed.success) {
      throw new StimulusIntegrityError(
        `${entry.path} failed schema validation: ${JSON.stringify(fileParsed.error.issues)}`,
      );
    }

    for (const response of fileParsed.data.responses) {
      if (byResponseId.has(response.response_id)) {
        throw new StimulusIntegrityError(`duplicate response_id ${response.response_id}`);
      }
      byResponseId.set(response.response_id, response);
    }
  }

  const recomputed = manifestDigest(manifest.files);
  if (recomputed !== manifest.manifest_sha256) {
    throw new StimulusIntegrityError(
      `manifest_sha256 does not match its own file list.\n` +
        `  recorded   ${manifest.manifest_sha256}\n  recomputed ${recomputed}`,
    );
  }

  return { manifest, byResponseId, launchReady: manifest.launch_ready };
}

/**
 * Refuses to proceed with a stimulus set that is not launch-ready.
 *
 * The app must call this before a participant can be allocated. Placeholder
 * stimuli are structurally valid by design, which is exactly why they need an
 * explicit gate rather than relying on someone noticing.
 */
export function assertLaunchReady(stimuli: LoadedStimuli): void {
  if (!stimuli.launchReady) {
    throw new StimulusIntegrityError(
      `Stimulus set is not launch-ready (generator_mode=${stimuli.manifest.generator_mode}). ` +
        `Regenerate with pipeline/generate.py against the real API before collecting data.`,
    );
  }
}

export function resolveResponse(
  stimuli: LoadedStimuli,
  language: Language,
  condition: Condition,
  registerState: RegisterState | null,
  itemId: string,
): StimulusResponse {
  const id = `${language}_${condition}_${registerSlug(registerState)}_${itemId}`;
  const response = stimuli.byResponseId.get(id);
  if (!response) {
    throw new StimulusIntegrityError(`no frozen stimulus for ${id}`);
  }
  return response;
}

export { stimulusFileFor };
