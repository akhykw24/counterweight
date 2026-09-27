import { z } from "zod";
import { enumRegistry, schemaRegistry, type RegistryEntry } from "./registry.js";

/**
 * Builds the text of docs/DATA_DICTIONARY.md from the Zod schemas.
 *
 * Pure and filesystem-free on purpose: the CLI in scripts/ owns all I/O, and
 * the test imports this directly rather than shelling out. The output must stay
 * deterministic - no timestamps, no environment - or the CI drift gate that
 * makes this dictionary trustworthy stops meaning anything.
 *
 * Not re-exported from index.ts: nothing in the client bundle needs it.
 */

type JsonSchemaNode = Record<string, unknown>;

function toJson(schema: z.ZodType): JsonSchemaNode {
  return z.toJSONSchema(schema, {
    io: "input",
    unrepresentable: "any",
  }) as JsonSchemaNode;
}

function escapePipes(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function renderType(node: JsonSchemaNode | undefined): string {
  if (!node) return "any";
  if ("const" in node) return `\`${JSON.stringify(node["const"])}\``;

  if (Array.isArray(node["enum"])) {
    return (node["enum"] as unknown[]).map((v) => `\`${String(v)}\``).join(" \\| ");
  }
  if (Array.isArray(node["anyOf"])) {
    return (node["anyOf"] as JsonSchemaNode[]).map(renderType).join(" \\| ");
  }
  if (Array.isArray(node["prefixItems"])) {
    return `[${(node["prefixItems"] as JsonSchemaNode[]).map(renderType).join(", ")}]`;
  }

  const type = node["type"];
  if (type === "array") return `${renderType(node["items"] as JsonSchemaNode | undefined)}[]`;
  if (type === "object") return "object";
  if (type === "string" && typeof node["format"] === "string") {
    return `string(${node["format"]})`;
  }
  if (typeof type === "string") return type;
  if (Array.isArray(type)) return type.join(" \\| ");
  return "any";
}

/**
 * Zod emits Number.MAX_SAFE_INTEGER bounds on every integer. Printing them adds
 * a column of noise to 293 rows and tells the reader nothing.
 */
const SAFE_INT = 9007199254740991;

function isNoiseBound(key: string, value: unknown): boolean {
  if (typeof value !== "number") return false;
  if (key === "maximum" || key === "exclusiveMaximum") return value >= SAFE_INT;
  if (key === "minimum" || key === "exclusiveMinimum") return value <= -SAFE_INT;
  return false;
}

function renderConstraints(node: JsonSchemaNode | undefined): string {
  if (!node) return "";
  const parts: string[] = [];
  const pairs: [string, string][] = [
    ["minimum", ">="],
    ["maximum", "<="],
    ["exclusiveMinimum", ">"],
    ["exclusiveMaximum", "<"],
    ["minLength", "minLen"],
    ["maxLength", "maxLen"],
    ["minItems", "minItems"],
    ["maxItems", "maxItems"],
  ];
  for (const [key, label] of pairs) {
    const value = node[key];
    if (value !== undefined && !isNoiseBound(key, value)) {
      parts.push(`${label} ${String(value)}`);
    }
  }
  if (typeof node["pattern"] === "string") parts.push(`pattern \`${node["pattern"]}\``);
  return parts.join(", ");
}

interface FieldRow {
  path: string;
  type: string;
  required: boolean;
  constraints: string;
  description: string;
}

function collectFields(node: JsonSchemaNode, prefix = ""): FieldRow[] {
  const properties = node["properties"] as Record<string, JsonSchemaNode> | undefined;
  if (!properties) return [];

  const required = new Set((node["required"] as string[] | undefined) ?? []);
  const rows: FieldRow[] = [];

  for (const [key, child] of Object.entries(properties)) {
    const path = prefix ? `${prefix}.${key}` : key;
    rows.push({
      path,
      type: renderType(child),
      required: required.has(key),
      constraints: renderConstraints(child),
      description: typeof child["description"] === "string" ? child["description"] : "",
    });
    if (child["type"] === "object" && child["properties"]) {
      rows.push(...collectFields(child, path));
    }
  }
  return rows;
}

const ENVELOPE_KEYS = new Set(["event_id", "session_id", "seq", "client_ts"]);
/** Envelope fields only the v3 family carries; suppressed in its tables too. */
const V3_ENVELOPE_KEYS = new Set(["participant_id", "cell"]);

/**
 * True when this schema is an event: envelope + discriminator + payload.
 * Their envelope rows are suppressed below, because repeating the UUID and
 * ISO-8601 regexes in all 18 event tables buries the fields that differ.
 */
function isEventSchema(node: JsonSchemaNode): boolean {
  const properties = node["properties"] as Record<string, unknown> | undefined;
  if (!properties) return false;
  return (
    [...ENVELOPE_KEYS].every((key) => key in properties) &&
    "type" in properties &&
    "payload" in properties
  );
}

function renderEntry(entry: RegistryEntry): string {
  const node = toJson(entry.schema);
  const lines: string[] = [`#### \`${entry.name}\``, ""];

  const description = node["description"];
  if (typeof description === "string" && description.length > 0) {
    lines.push(description, "");
  }
  if (entry.emittedBy) {
    lines.push(`*Emitted when:* ${entry.emittedBy}`, "");
  }

  const isEvent = isEventSchema(node);
  if (isEvent) {
    lines.push("Envelope fields are omitted; see [Event envelope](#event-envelope).", "");
  }

  const fields = collectFields(node).filter((field) => {
    if (!isEvent) return true;
    if (ENVELOPE_KEYS.has(field.path) || V3_ENVELOPE_KEYS.has(field.path)) return false;
    // The bare `payload` row carries no information the `payload.*` rows lack.
    return field.path !== "payload";
  });
  if (fields.length === 0) {
    lines.push(`Type: ${renderType(node)}`, "");
    return lines.join("\n");
  }

  lines.push("| Field | Type | Req. | Constraints | Description |");
  lines.push("|---|---|---|---|---|");
  for (const field of fields) {
    lines.push(
      `| \`${field.path}\` | ${field.type} | ${field.required ? "yes" : "no"} | ${escapePipes(field.constraints)} | ${escapePipes(field.description)} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

function renderEnums(): string {
  const lines = ["| Enumeration | Values | Meaning |", "|---|---|---|"];
  for (const entry of enumRegistry) {
    const node = toJson(entry.schema);
    const values = Array.isArray(node["enum"])
      ? (node["enum"] as unknown[]).map((v) => `\`${String(v)}\``).join(", ")
      : renderType(node);
    const description = typeof node["description"] === "string" ? node["description"] : "";
    lines.push(`| \`${entry.name}\` | ${values} | ${escapePipes(description)} |`);
  }
  lines.push("");
  return lines.join("\n");
}

export function buildDataDictionary(): string {
  const out: string[] = [];

  out.push("# Data Dictionary", "");
  out.push(
    "**Generated file — do not edit by hand.** Produced from the Zod schemas in `packages/schema/src` by `pnpm codegen`. CI runs `pnpm codegen:check` and fails the build if this file drifts from the schemas, so the dictionary printed in the paper's appendix cannot disagree with what the ingest service actually validated.",
    "",
  );
  out.push(
    "No field anywhere in this document holds personally identifying information. Age is captured as a band at source, never as an exact number.",
    "",
  );

  out.push("## Contents", "");
  for (const section of schemaRegistry) {
    out.push(`- [${section.title}](#${section.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")})`);
  }
  out.push("- [Enumerations](#enumerations)", "");

  out.push("## Event envelope", "");
  out.push("Every event carries the same four envelope fields in addition to its `type` and `payload`.", "");
  out.push("| Field | Type | Description |");
  out.push("|---|---|---|");
  out.push("| `event_id` | string(uuid) | Idempotency key. The ingest service dedupes on this, so at-least-once delivery is safe. |");
  out.push("| `session_id` | string(uuid) | The only participant identifier that exists. |");
  out.push("| `seq` | integer | Monotonic within a session. Establishes order independently of clock skew. |");
  out.push("| `client_ts` | string(date-time) | Client clock. Untrusted for ordering; used for wall-clock reporting only. |");
  out.push("");
  out.push("v3 events add two more:", "");
  out.push("| Field | Type | Description |");
  out.push("|---|---|---|");
  out.push("| `participant_id` | string(uuid) | Per-browser identifier kept across sessions. Detects repeat participation; linked to no person. |");
  out.push("| `cell` | string, nullable | EI-A, EI-B, Neutral-A or Neutral-B. Null before allocation. |");
  out.push("");

  for (const section of schemaRegistry) {
    out.push(`## ${section.title}`, "", section.blurb, "");
    for (const entry of section.entries) {
      out.push(renderEntry(entry));
    }
  }

  out.push("## Enumerations", "", renderEnums());

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/** Line-ending-insensitive comparison, so the CRLF checkout on Windows is not a false positive. */
export function dictionaryMatches(existing: string): boolean {
  const normalise = (text: string) => text.replace(/\r\n/g, "\n");
  return normalise(existing) === normalise(buildDataDictionary());
}
