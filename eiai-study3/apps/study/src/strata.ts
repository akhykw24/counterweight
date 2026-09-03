import strataDocument from "../../../materials/strata.json";
import type { CefrLevel, Stratum } from "@eiai/schema";

/**
 * Randomisation strata, read from configuration.
 *
 * The browser half of `pipeline/strata.py`. Spec v2 requires the number and
 * names of strata to be a config edit rather than a code edit, so this file
 * reads `materials/strata.json` and derives everything from it -- there is no
 * list of stratum names anywhere in the app.
 */

type StrataDocument = {
  readonly block_size: number;
  readonly blocks_per_stratum: number;
  readonly conditions: readonly string[];
  readonly strata: readonly {
    readonly id: string;
    readonly label: string;
    readonly cefr_levels: readonly string[];
  }[];
};

const document = strataDocument as StrataDocument;

export class StratumError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StratumError";
  }
}

export const stratumIds: readonly Stratum[] = document.strata.map((entry) => entry.id);

const byCefr = new Map<string, Stratum>();
for (const entry of document.strata) {
  for (const level of entry.cefr_levels) {
    if (byCefr.has(level)) {
      // Overlapping strata would make assignment depend on iteration order,
      // which is exactly the nondeterminism a randomisation scheme cannot have.
      throw new StratumError(
        `CEFR level ${level} is claimed by both ${byCefr.get(level)} and ${entry.id}`,
      );
    }
    byCefr.set(level, entry.id);
  }
}

/**
 * The stratum a self-reported level belongs to, or null if it is not admitted.
 *
 * Null rather than a fallback stratum: a level below the inclusion threshold is
 * screened out before randomisation, and someone reaching allocation without a
 * stratum is a bug that must not be papered over by assigning them somewhere.
 */
export function stratumForCefr(level: CefrLevel): Stratum | null {
  return byCefr.get(level) ?? null;
}

export function labelFor(stratum: Stratum): string {
  const entry = document.strata.find((candidate) => candidate.id === stratum);
  if (!entry) throw new StratumError(`unknown stratum '${stratum}'`);
  return entry.label;
}
