// Removed from the active app by spec v2 (adults only). Preserved verbatim,
// including its participant-facing copy, so the text is not lost and the
// design history stays readable.

export function AssentScreen({
  context,
  send,
}: {
  context: SessionContext;
  send: Send;
}) {
  return (
    <section data-testid="screen-assent">
      <h1>Do you want to take part?</h1>
      <p>
        Your parent or guardian has already been given a form about this study.
        Enter the session code from that form so we know it was returned. The
        code is not your name and does not identify you.
      </p>
      <p>
        You are being asked separately, because it is your choice too. You can
        stop at any time and nobody will mind.
      </p>
      <label htmlFor="parental-code">Session code</label>
      <input
        id="parental-code"
        data-testid="parental-code"
        value={context.parentalConsentCode ?? ""}
        onChange={(event) =>
          send({ type: "SET_PARENTAL_CODE", code: event.target.value })
        }
      />
      <button
        type="button"
        className="primary"
        data-testid="give-assent"
        disabled={!context.parentalConsentCode?.trim()}
        onClick={() => send({ type: "GIVE_ASSENT" })}
      >
        Yes, I want to take part
      </button>
    </section>
  );
}

