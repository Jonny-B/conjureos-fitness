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

const container = document.getElementById("root");
if (!container) throw new Error("#root not found");
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
