// Derives prisma/schema.sqlite.prisma from the canonical Postgres schema
// (prisma/schema.prisma) so local dev can use SQLite without hand-maintaining a
// second schema. Prisma's datasource `provider` can't be set from an env var, so
// two schema files are required; this keeps schema.prisma the single source of truth.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "prisma", "schema.prisma"), "utf8");

const derived = src
  // swap the datasource provider
  .replace(/provider\s*=\s*"postgresql"/, 'provider = "sqlite"')
  // drop Postgres/Vercel-only lines (directUrl, binaryTargets)
  .split("\n")
  .filter(
    (line) =>
      !/^\s*directUrl\s*=/.test(line) && !/^\s*binaryTargets\s*=/.test(line)
  )
  .join("\n");

const header =
  "// AUTO-GENERATED from prisma/schema.prisma by scripts/make-sqlite-schema.mjs.\n" +
  "// Do NOT edit — change prisma/schema.prisma and re-run. Local SQLite dev only.\n\n";

writeFileSync(join(root, "prisma", "schema.sqlite.prisma"), header + derived, "utf8");
console.log("Wrote prisma/schema.sqlite.prisma (sqlite, derived).");
