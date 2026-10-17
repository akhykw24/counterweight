import type { CellName, ListName, ToneName, VersionName } from "@eiai/schema";

/**
 * Pilot allocation for v3 (brief, step 3).
 *
 * Four cells, handed out in a fixed rotation so that five pilot participants
 * cover every cell: EI-A, Neutral-B, EI-B, Neutral-A, then EI-A again. The
 * position comes from the numbered pilot link (`p=N`) -- there is no server
 * counter, and this is the mechanism the v2 pilot already used, with its own
 * sequence. A participant screened out never reaches allocation, so a number
 * they were given is simply reused for the next person; the rotation counts
 * only people who get through screening, as the brief requires.
 *
 * The main study (the single public link) does not use this rotation: it
 * takes the next slot of the committed sequence from the server
 * (pipeline/allocation_v3.py, services/ingest/src/allocate.ts). This module
 * only turns that slot into a cell, tone and list.
 */

export const PILOT_ROTATION: readonly CellName[] = ["EI-A", "Neutral-B", "EI-B", "Neutral-A"];

/** The brief's slot sequence: the rotation three times over. */
export const PILOT_SEQUENCE: readonly CellName[] = [...PILOT_ROTATION, ...PILOT_ROTATION, ...PILOT_ROTATION];

export const CELLS: readonly CellName[] = ["EI-A", "EI-B", "Neutral-A", "Neutral-B"];

export function toneOf(cell: CellName): ToneName {
  return cell.startsWith("EI") ? "EI" : "Neutral";
}

export function listOf(cell: CellName): ListName {
  return cell.endsWith("-A") ? "A" : "B";
}

/** List A: odd claims strong, even weak. List B: the reverse. */
export function versionFor(list: ListName, claimId: string): VersionName {
  const number = Number(claimId.slice(-2));
  if (!Number.isInteger(number) || number < 1 || number > 12) {
    throw new Error(`not a claim id: ${claimId}`);
  }
  const odd = number % 2 === 1;
  return (list === "A") === odd ? "strong" : "weak";
}

/**
 * The cell at a 1-based pilot position. Beyond the twelve slots the rotation
 * simply continues: a sixth or thirteenth participant should get the next
 * cell in turn, not an error that strands them mid-study.
 */
export function pilotCell(position: number): CellName {
  if (!Number.isInteger(position) || position < 1) {
    throw new Error(`pilot position must be a positive integer, got ${position}`);
  }
  return PILOT_ROTATION[(position - 1) % PILOT_ROTATION.length]!;
}

export function isCell(value: unknown): value is CellName {
  return typeof value === "string" && (CELLS as readonly string[]).includes(value);
}

export interface ServerSlot {
  cell: CellName;
  /** 0-based position in the committed sequence of the participant's stratum. */
  index: number;
}

export interface AllocationRequest {
  /** `test` honours a requested cell; nothing else does. */
  runMode: "live" | "pilot" | "test";
  pilotParticipant: number | null;
  requestedCell: CellName | null;
  sessionId: string;
  /** `pilot=true` on the link. With a number, a test run rehearses the rotation. */
  pilotFlow?: boolean;
  /** The slot the server handed out, for the runs that take one. */
  slot?: ServerSlot | null;
}

export interface AllocationResult {
  cell: CellName;
  tone: ToneName;
  list: ListName;
  method: "pilot_rotation" | "forced_test" | "main_sequence" | "test_sequence";
  pilotPosition: number | null;
  sequenceIndex: number | null;
}

/**
 * Whether this run takes its cell from the server's committed sequence.
 *
 * Yes for the single public link (live), and for a test run that names no
 * cell and no pilot number -- the rehearsal of exactly that link, drawing from
 * the separate test sequence. No for pilot links, which keep their numbered
 * rotation, and for test links that force a cell or rehearse a pilot number.
 */
export function needsServerSlot(request: Pick<AllocationRequest, "runMode" | "requestedCell" | "pilotParticipant" | "pilotFlow">): boolean {
  if (request.runMode === "live") return true;
  if (request.runMode === "pilot") return false;
  if (request.requestedCell) return false;
  return !(request.pilotFlow && request.pilotParticipant !== null);
}

/**
 * Where an unnumbered link lands. The session id picks a position, so the
 * cell is stable across a resume -- but it is not rotation, and the pilot
 * instructions say to use numbered links for exactly that reason.
 */
export function fallbackPosition(sessionId: string): number {
  return (fnv1a(sessionId) % PILOT_ROTATION.length) + 1;
}

export function allocate(request: AllocationRequest): AllocationResult {
  if (request.runMode === "test" && request.requestedCell) {
    const cell = request.requestedCell;
    return { cell, tone: toneOf(cell), list: listOf(cell), method: "forced_test", pilotPosition: null, sequenceIndex: null };
  }
  if (needsServerSlot(request)) {
    const slot = request.slot;
    if (!slot || !isCell(slot.cell) || !Number.isInteger(slot.index) || slot.index < 0) {
      // The browser must have the server's slot before it can allocate. Making
      // one up here would put an unregistered assignment into the sample.
      throw new Error("this run takes its cell from the server's sequence, and no slot was supplied");
    }
    return {
      cell: slot.cell,
      tone: toneOf(slot.cell),
      list: listOf(slot.cell),
      method: request.runMode === "live" ? "main_sequence" : "test_sequence",
      pilotPosition: null,
      sequenceIndex: slot.index,
    };
  }
  const position = request.pilotParticipant ?? fallbackPosition(request.sessionId);
  const cell = pilotCell(position);
  return {
    cell,
    tone: toneOf(cell),
    list: listOf(cell),
    method: "pilot_rotation",
    pilotPosition: request.pilotParticipant,
    sequenceIndex: null,
  };
}

/** 32-bit FNV-1a. Small, dependency-free, and identical in every browser. */
export function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
