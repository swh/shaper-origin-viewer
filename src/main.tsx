import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { preloadClipper } from "./depth";
import "./index.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("missing #root");

// js-angusj-clipper has an async init. Preload before mounting so the depth
// pipeline can run synchronously thereafter.
preloadClipper().then(() => {
  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
