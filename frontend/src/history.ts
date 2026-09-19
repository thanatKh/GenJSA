/* Local JSA history — localStorage, this browser on this PC only
 *
 * Why this exists: without it, a JSA is gone the moment the tab closes, so
 * coming back tomorrow to fix one hazard means re-describing the whole job and
 * paying for another AI generation.
 *
 * What is stored: the JSA data, plus the work procedure generated from it when
 * there is one — never a rendered PDF (either builder can always redraw one
 * from the document) and never anything the user typed but didn't turn into a
 * document. Nothing here is ever sent anywhere; the backend has no idea this
 * exists.
 *
 * Deliberately separate from store.ts: different storage (localStorage vs
 * sessionStorage), different lifetime, different privacy posture. In
 * particular, clearAllDrafts() must never touch history — see startOver() in
 * App.tsx, which resets the wizard without discarding past work.
 *
 * Also the lifecycle owner for lib/photoStore.ts (IndexedDB, step photos):
 * every path below that drops an entry — remove(), clear(), and readRaw()'s
 * own silent age/quota pruning — also deletes that entry's photos, so a
 * photo never outlives the history row it illustrates. photoStore.ts itself
 * has no expiry logic of its own; it only reacts to what happens here.
 */

import {
  jsaDocumentSchema,
  procedureDocumentSchema,
  type JsaDocument,
  type ProcedureDocument,
} from "./lib/schema";
import { clearForHistoryIds } from "./lib/photoStore";

const KEY = "genjsa.history.v1";
const DAY_MS = 24 * 60 * 60 * 1000;

/** Entries older than this are dropped on the next read. Shown in the UI. */
export const RETENTION_DAYS = 365;

// Quota guard — localStorage throws when full rather than evicting anything,
// so cap the list ourselves. At 365 days it's usually this, not the age limit,
// that bounds the list.
const MAX_ENTRIES = 100;

export type HistoryEntry = {
  id: string;
  /** Epoch ms of the last time this entry was written */
  savedAt: number;
  doc: JsaDocument;
  /** The work procedure generated from `doc`, once one exists. Most entries
   * never have one, so it stays optional rather than a second entry type. */
  procedure?: ProcedureDocument;
};

type HistoryFile = { v: 1; entries: HistoryEntry[] };

/** Reads and validates, newest first. `pruned` = something was dropped on the
 * way — droppedIds names exactly which entries so the caller can clean up
 * their photos in photoStore.ts too (age expiry and corrupt records both
 * silently drop entries here, and neither had a caller-visible hook before
 * photoStore.ts existed — this is that hook). */
function readRaw(): { entries: HistoryEntry[]; pruned: boolean; droppedIds: string[] } {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { entries: [], pruned: false, droppedIds: [] };
    const parsed = JSON.parse(raw) as Partial<HistoryFile>;
    if (!Array.isArray(parsed?.entries)) return { entries: [], pruned: true, droppedIds: [] };

    // Validate rather than cast: these records outlive schema changes, and one
    // corrupt entry must not blank the whole list
    const cutoff = Date.now() - RETENTION_DAYS * DAY_MS;
    const droppedIds: string[] = [];
    const entries = parsed.entries.flatMap((entry) => {
      if (typeof entry?.id !== "string" || typeof entry?.savedAt !== "number") return [];
      if (entry.savedAt < cutoff) {
        droppedIds.push(entry.id);
        return [];
      }
      const doc = jsaDocumentSchema.safeParse(entry.doc);
      if (!doc.success) {
        droppedIds.push(entry.id);
        return [];
      }

      // Validated separately, and a failure drops ONLY the procedure — losing a
      // malformed procedure is an inconvenience, losing the JSA it belongs to
      // is the user's actual work. Not added to droppedIds: the entry (and
      // its photos) survive, only its procedure half didn't parse.
      const procedure = entry.procedure
        ? procedureDocumentSchema.safeParse(entry.procedure)
        : undefined;

      return [
        {
          id: entry.id,
          savedAt: entry.savedAt,
          doc: doc.data,
          ...(procedure?.success ? { procedure: procedure.data } : {}),
        },
      ];
    });

    entries.sort((a, b) => b.savedAt - a.savedAt);
    return { entries, pruned: entries.length !== parsed.entries.length, droppedIds };
  } catch {
    // Private-mode browsers block storage entirely — keep working without history
    return { entries: [], pruned: false, droppedIds: [] };
  }
}

function writeRaw(entries: HistoryEntry[]): void {
  const file: HistoryFile = { v: 1, entries };
  try {
    localStorage.setItem(KEY, JSON.stringify(file));
  } catch {
    // Out of quota (or blocked). Drop the oldest entry and try once more —
    // losing the least recent JSA beats failing to save the current one.
    if (entries.length > 1) {
      const evicted = entries[entries.length - 1];
      try {
        localStorage.setItem(
          KEY,
          JSON.stringify({ v: 1, entries: entries.slice(0, -1) } satisfies HistoryFile),
        );
        void clearForHistoryIds([evicted.id]);
      } catch {
        /* still no room — history is a convenience, never fail loudly */
      }
    }
  }
}

/** Newest first. Prunes expired/corrupt records, writing back if anything changed. */
export function list(): HistoryEntry[] {
  const { entries, pruned, droppedIds } = readRaw();
  if (pruned) {
    writeRaw(entries);
    // Fire-and-forget, same posture as the rest of photoStore.ts — a photo
    // cleanup that fails leaves orphaned rows in IndexedDB, never a broken UI.
    if (droppedIds.length) void clearForHistoryIds(droppedIds);
  }
  return entries;
}

/** Create or update the entry for `id`, moving it to the top of the list.
 *
 * Merges rather than replaces: an entry holds two documents written by two
 * different flows (the JSA editor autosaves `doc`; the procedure editor
 * autosaves `procedure`), so building a fresh object here would silently erase
 * whichever one this call isn't carrying. The merge lives inside this module
 * on purpose — a caller that has only one of the two must not be able to get
 * this wrong.
 */
function upsertEntry(id: string, patch: Partial<Pick<HistoryEntry, "doc" | "procedure">>): void {
  const all = readRaw().entries;
  const existing = all.find((entry) => entry.id === id);
  const doc = patch.doc ?? existing?.doc;
  // A procedure is meaningless without the JSA it was generated from, and an
  // entry with no doc would be dropped by readRaw's validation on the next
  // read anyway — so skip rather than write a record that can't survive
  if (!doc) return;

  const procedure = patch.procedure ?? existing?.procedure;
  const others = all.filter((entry) => entry.id !== id);
  // savedAt is "now", so the updated entry is always the newest — no re-sort needed
  const next: HistoryEntry = {
    id,
    savedAt: Date.now(),
    doc,
    ...(procedure ? { procedure } : {}),
  };
  writeRaw([next, ...others].slice(0, MAX_ENTRIES));
}

/** Save the JSA for `id`, keeping any procedure already stored alongside it. */
export function upsertDoc(id: string, doc: JsaDocument): void {
  upsertEntry(id, { doc });
}

/** Save the work procedure for `id`, keeping its JSA. */
export function upsertProcedure(id: string, procedure: ProcedureDocument): void {
  upsertEntry(id, { procedure });
}

/** Removes the entry AND its photos. Note for HistoryList.tsx's undo flow:
 * restore() below only needs to put the JSA/procedure documents back to make
 * the entry usable again — it deliberately does not try to restore photos
 * within the undo window, so a delete-then-undo loses any photos that were
 * attached. Accepted trade-off: re-attaching them is exactly the manual
 * "drag the photo back in" work the user would otherwise do anyway, and it
 * keeps remove()/restore() from needing to shuttle photo blobs through the
 * undo toast's in-memory HistoryEntry just for this one edge case. */
export function remove(id: string): void {
  writeRaw(readRaw().entries.filter((entry) => entry.id !== id));
  void clearForHistoryIds([id]);
}

/** Put a removed entry back with its original savedAt, so undo doesn't reorder the list. */
export function restore(entry: HistoryEntry): void {
  const others = readRaw().entries.filter((other) => other.id !== entry.id);
  const next = [entry, ...others].sort((a, b) => b.savedAt - a.savedAt);
  writeRaw(next.slice(0, MAX_ENTRIES));
}

export function clear(): void {
  const ids = readRaw().entries.map((entry) => entry.id);
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* fail silently */
  }
  if (ids.length) void clearForHistoryIds(ids);
}

export function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // randomUUID needs a secure context; plain http:// on a LAN address doesn't have one
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
