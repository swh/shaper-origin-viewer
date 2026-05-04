import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { preloadClipper } from "./depth";
import "./index.css";
import { useStore } from "./store";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("missing #root");

// Wait for both async dependencies before mounting, so the first paint already
// has clipper available and the persisted store hydrated. Avoids a flash of
// "no design loaded" when the user has one stored from a previous session.
Promise.all([preloadClipper(), useStore.persist.rehydrate()]).then(() => {
  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
