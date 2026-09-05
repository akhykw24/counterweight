import ingest from "../services/ingest/api/events.js";

/**
 * Deployment entry point for the ingest endpoint.
 *
 * Vercel discovers serverless functions in `api/` at the project root, so this
 * file exists to put the endpoint where the platform looks. It holds no logic:
 * the handler, the store and the schema validation all live in
 * `services/ingest/`, which is where they are tested. Keeping it a thin
 * forward rather than a copy matters -- a second implementation of the write
 * path is a second thing that can disagree with the schema, and the one
 * guarantee this service makes is that everything reaching the table was
 * validated by exactly one piece of code.
 *
 * `config` is declared here, literally, and NOT re-exported.
 *
 * That is not style. Vercel decides which runtime a function gets by reading
 * `export const config` statically, before anything is executed. A re-exported
 * value is invisible to that analysis, so the function was built for the
 * Node.js runtime -- whose handlers take `(req, res)` -- while the code below
 * is a Web-standard `(Request) => Response`. It deployed cleanly and then
 * failed on every invocation with FUNCTION_INVOCATION_FAILED, which says
 * nothing about the cause. The literal is what makes the two agree.
 */
export const config = { runtime: "edge" };

export default ingest;
