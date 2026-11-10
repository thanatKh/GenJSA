import { clearForHistoryIds } from "./photoStore";

// Keep assets beyond the six-second undo window. Persist the cleanup queue
// so reloading after a deletion does not leave its photos behind forever.
const KEY = "genjsa.pendingPhotoCleanup.v1";
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let pending: Record<string, number> = {};
try {
  const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
  if (saved && typeof saved === "object" && !Array.isArray(saved)) {
    pending = Object.fromEntries(Object.entries(saved).filter(([, value]) => typeof value === "number" && Number.isFinite(value)));
  }
} catch { /* unavailable */ }
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(pending)); } catch { /* keep in memory */ }
}
function schedule(id: string, expires: number) {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.set(id, setTimeout(() => {
    delete pending[id]; timers.delete(id); persist();
    void clearForHistoryIds([id]);
  }, Math.max(0, expires - Date.now())));
}
for (const [id, expires] of Object.entries(pending)) {
  if (typeof expires === "number") schedule(id, expires);
}
export function deferPhotoCleanup(id: string) {
  pending[id] = Date.now() + 10_000; persist(); schedule(id, pending[id]);
}
export function cancelPhotoCleanup(id: string) {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id); delete pending[id]; persist();
}
