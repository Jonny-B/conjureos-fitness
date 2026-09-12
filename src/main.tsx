// Polyfills globalThis.BarcodeDetector on browsers that lack it (iOS Safari +
// iOS Edge, both WebKit; Firefox). No-op on Android Chrome / Chromium desktop
// where the native API exists. Must register before any module that reads
// globalThis.BarcodeDetector, so it comes first.
import "barcode-detector/polyfill";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "@conjureos/ui/dist/ui.css";
import "./styles.css";
import { initAppearance } from "./theme";

const container = document.getElementById("root");
if (!container) throw new Error("#root not found");

// Pin Winter dark before React mounts, and start listening to ConjureOS
// without ever acting on it. See src/theme.ts for why this app is locked.
initAppearance();
// The @conjureos/ui tokens are scoped to `.cui-ui`. index.html carries the
// class for the dev server, but the single-file inline build generates its own
// shell, so set it at runtime too or every var(--cui-*) is undefined.
document.body.classList.add("cui-ui");
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
