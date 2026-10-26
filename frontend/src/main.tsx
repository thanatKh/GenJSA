import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";

import App from "./App";
import "./index.css";

// After a deploy, a page that was already open (or restored from the
// browser's cache) can ask for code files the new deploy deleted — the PDF
// builders are loaded on demand, so this surfaced as "PDF won't open" until
// a manual refresh. Vite reports it as vite:preloadError; reload once to pick
// up the new version. Drafts, history and photos all survive a reload.
// Guarded so a file that's genuinely missing can't cause a reload loop: a
// second failure within a minute is left to show its normal error.
// (The server side of this fix is index.html's no-cache header — see the
// cache policy in backend/app/main.py.)
const RELOAD_KEY = "genjsa.reloadedForUpdate";
window.addEventListener("vite:preloadError", (event) => {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return; // no storage, no loop guard — don't risk a reload loop
  }
  event.preventDefault();
  window.location.reload();
});

const root = document.getElementById("root");
if (!root) throw new Error("#root not found in index.html");

createRoot(root).render(
  <StrictMode>
    {/* Every animation follows the phone's "reduce motion" setting: movement
        and size changes are skipped, fades stay (see lib/motion.ts) */}
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </StrictMode>,
);
