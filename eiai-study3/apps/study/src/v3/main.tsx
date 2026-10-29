import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { V3App } from "./App";
import { bootstrapV3 } from "./telemetry";
import "../styles.css";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from index.html");
document.title = "Nova — space training";

const session = await bootstrapV3();

// A resumed session keeps the kind of run it started as, whatever the link
// says now: a participant who reopens a trimmed link must not turn half a
// pilot session into live data.
const saved = (session.snapshot as { context?: Partial<Record<string, unknown>> } | null)?.context;
const runMode = (saved?.["runMode"] as typeof session.runMode | undefined) ?? session.runMode;

// The single public link is the main study, and it stays shut until the
// researcher opens recruitment: a deploy made to let someone try a test link
// must never start live data collection by itself. Open it with
// VITE_V3_LIVE=open (or by changing this default on launch day). Pilot and
// test links work either way.
const LIVE_DEFAULT = "closed";
const liveClosed = ((import.meta.env["VITE_V3_LIVE"] as string | undefined) ?? LIVE_DEFAULT) !== "open";

createRoot(root).render(
  <StrictMode>
    {runMode === "live" && liveClosed ? (
      <div className="app v3" data-state="closed">
        <main>
          <section data-testid="screen-closed">
            <p>This study is not open yet.</p>
          </section>
        </main>
      </div>
    ) : (
      <V3App
        recorder={session.recorder}
        sessionId={session.sessionId}
        participantId={session.participantId}
        runMode={runMode}
        pilotFlow={(saved?.["pilotFlow"] as boolean | undefined) ?? session.pilotFlow}
        pilotParticipant={(saved?.["pilotParticipant"] as number | null | undefined) ?? session.pilotParticipant}
        requestedCell={(saved?.["requestedCell"] as never) ?? session.requestedCell}
        resumed={session.resumed}
        repeatSession={session.repeatSession}
        snapshot={session.snapshot}
        onSnapshot={session.persist}
        onComplete={session.complete}
      />
    )}
  </StrictMode>,
);
