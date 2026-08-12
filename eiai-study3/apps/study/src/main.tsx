import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { bootstrap } from "./telemetry";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from index.html");

// Telemetry is resolved before first paint so a resumed participant never sees
// the eligibility screen flash before being returned to item nine.
const session = await bootstrap();

createRoot(root).render(
  <StrictMode>
    <App
      recorder={session.recorder}
      resumed={session.resumed}
      snapshot={session.snapshot}
      onSnapshot={session.persist}
      onComplete={session.complete}
    />
  </StrictMode>,
);
