/**
 * @eiai/fsm — session flow and register selection.
 *
 * Day 2 ships the register function only. The session statechart (XState) and
 * its model-based tests land on day 3; they are a genuinely different kind of
 * object and are kept in a separate module for that reason.
 */

export * from "./register.js";
export * from "./session.js";
