/**
 * Deployment entry point for the ingest endpoint.
 *
 * Vercel discovers serverless functions in `api/` at the project root, so this
 * file exists to put the endpoint where the platform looks. It holds no logic:
 * the handler, the store and the schema validation all live in
 * `services/ingest/`, which is where they are tested.
 *
 * Keeping it a re-export rather than a copy matters. A second implementation of
 * the write path is a second thing that can disagree with the schema, and the
 * one guarantee this service makes is that everything reaching the table has
 * been validated by exactly one piece of code.
 */

export { config, default } from "../services/ingest/api/events.js";
