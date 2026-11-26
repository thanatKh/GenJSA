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
 * explicit deletion and successful writes that prune corrupt records also
 * remove their photos. photoStore.ts itself
 * has no expiry logic of its own; it only reacts to what happens here.
 */

import {
  jsaDocumentSchema,
  procedureDocumentSchema,
  type JsaDocument,
  type ProcedureDocument,
} from "./lib/schema";
import { clearForHistoryIds } from "./lib/photoStore";
import { deferPhotoCleanup, cancelPhotoCleanup } from "./lib/deferredPhotoCleanup";

const KEY = "genjsa.history.v1";

// A full history rejects new jobs until space is available.
export const MAX_ENTRIES = 100;

export type HistoryEntry = {
  id: string;
  /** Epoch ms of the last time this entry was written */
  savedAt: number;
  /** Absent on old history entries and backups. */
  revision?: string;
  doc: JsaDocument;
  /** The work procedure generated from `doc`, once one exists. Most entries
   * never have one, so it stays optional rather than a second entry type. */
  procedure?: ProcedureDocument;
};

type HistoryFile = { v: 1; entries: HistoryEntry[] };

export const entryRevision = (entry: HistoryEntry) => entry.revision ?? `legacy:${entry.savedAt}`;

export async function withHistoryLock<T>(action: () => T): Promise<T> {
  return navigator.locks ? navigator.locks.request(KEY, () => action()) : action();
}

/** Reads and validates, newest first. A write can clean up assets for invalid rows. */
function readRaw(): { entries: HistoryEntry[]; droppedIds: string[] } {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { entries: [], droppedIds: [] };
    const parsed = JSON.parse(raw) as Partial<HistoryFile>;
    if (!Array.isArray(parsed?.entries)) return { entries: [], droppedIds: [] };

    // Validate rather than cast: these records outlive schema changes, and one
    // corrupt entry must not blank the whole list
    const droppedIds: string[] = [];
    const entries = parsed.entries.flatMap((entry) => {
      if (typeof entry?.id !== "string" || typeof entry?.savedAt !== "number") return [];
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
          ...(typeof entry.revision === "string" ? { revision: entry.revision } : {}),
          doc: doc.data,
          ...(procedure?.success ? { procedure: procedure.data } : {}),
        },
      ];
    });

    entries.sort((a, b) => b.savedAt - a.savedAt);
    return { entries, droppedIds };
  } catch {
    // Private-mode browsers block storage entirely — keep working without history
    return { entries: [], droppedIds: [] };
  }
}

/** True once the entries are actually stored — App.tsx's "บันทึกแล้ว"
 * indicator only claims a save that really happened. */
function writeRaw(entries: HistoryEntry[]): boolean {
  const file: HistoryFile = { v: 1, entries };
  try {
    localStorage.setItem(KEY, JSON.stringify(file));
    return true;
  } catch {
    return false;
  }
}

/** Newest first. Invalid entries are excluded from the returned list. */
export function list(): HistoryEntry[] {
  return readRaw().entries;
}

export type HistorySaveResult = { state: "saved"; revision: string } | { state: "failed" | "conflict" };

/** Save both documents as one job revision. A missing draft WP leaves the saved WP in place.
 * Call within withHistoryLock to make the check and write one operation. */
export function saveJob(
  id: string,
  doc: JsaDocument,
  procedure: ProcedureDocument | null,
  expected: string | null | undefined,
): HistorySaveResult {
  const { entries: all, droppedIds } = readRaw();
  const existing = all.find((entry) => entry.id === id);
  const nextProcedure = procedure ?? existing?.procedure;
  // Older tab drafts predate revision tracking. An identical saved document
  // can adopt its revision, but a divergent draft must be saved as a copy.
  if (existing && JSON.stringify(existing.doc) === JSON.stringify(jsaDocumentSchema.parse(doc)) &&
    JSON.stringify(existing.procedure) === JSON.stringify(procedure ? procedureDocumentSchema.parse(procedure) : undefined)) {
    return { state: "saved", revision: entryRevision(existing) };
  }
  if (expected !== (existing ? entryRevision(existing) : null)) return { state: "conflict" };
  if (!existing && all.length >= MAX_ENTRIES) return { state: "failed" };
  const others = all.filter((entry) => entry.id !== id);
  const revision = newId();
  const next: HistoryEntry = {
    id,
    savedAt: Date.now(),
    revision,
    doc,
    ...(nextProcedure ? { procedure: nextProcedure } : {}),
  };
  if (!writeRaw([next, ...others])) return { state: "failed" };
  if (droppedIds.length) void clearForHistoryIds(droppedIds.filter((droppedId) => droppedId !== id));
  return { state: "saved", revision };
}

/** Remove the document immediately; defer photo deletion beyond Undo. */
export function remove(id: string): boolean {
  if (!writeRaw(readRaw().entries.filter((entry) => entry.id !== id))) return false;
  deferPhotoCleanup(id);
  window.dispatchEvent(new Event("genjsa-library-count"));
  return true;
}

/** Put a removed entry back with its original savedAt, so undo doesn't reorder the list. */
export function restore(entry: HistoryEntry): boolean {
  const entries = readRaw().entries;
  if (entries.some((other) => other.id === entry.id)) {
    cancelPhotoCleanup(entry.id);
    return true;
  }
  const next = [entry, ...entries].sort((a, b) => b.savedAt - a.savedAt);
  if (next.length > MAX_ENTRIES || !writeRaw(next)) return false;
  cancelPhotoCleanup(entry.id);
  window.dispatchEvent(new Event("genjsa-library-count"));
  return true;
}

export function clear(): boolean {
  const ids = readRaw().entries.map((entry) => entry.id);
  try {
    localStorage.removeItem(KEY);
  } catch {
    return false;
  }
  if (ids.length) void clearForHistoryIds(ids);
  window.dispatchEvent(new Event("genjsa-library-count"));
  return true;
}

export function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // randomUUID needs a secure context; plain http:// on a LAN address doesn't have one
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
