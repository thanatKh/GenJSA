/* Saved projects (Project Mode) — localStorage, this browser on this PC only
 *
 * history.ts's counterpart for Project Mode, kept as its own list rather than
 * a second entry type inside history.ts: a project holds several JSAs and is
 * opened, listed and capped differently, and keeping it apart means Single
 * Mode's history code didn't have to change at all. Same privacy posture:
 * nothing here is ever sent anywhere, and clearAllDrafts() never touches it.
 *
 * Like history.ts, every path that drops a project also deletes its
 * browser-only images in lib/photoStore.ts (the company logo, keyed by the
 * project's id), so they never outlive the project.
 */

import { projectDocumentSchema, type ProjectDocument } from "./lib/schema";
import { clearForHistoryIds } from "./lib/photoStore";
import { newId } from "./history";

const KEY = "genjsa.projects.v1";

// Lower than history.ts's MAX_ENTRIES: one project holds several JSAs, and
// both lists share the browser's ~5MB localStorage quota. Past it, saving a
// project drops the OLDEST one (and its images). Shown in the UI.
export const MAX_PROJECTS = 30;

export type ProjectEntry = {
  id: string;
  /** Epoch ms of the last time this entry was written */
  savedAt: number;
  project: ProjectDocument;
};

type ProjectFile = { v: 1; entries: ProjectEntry[] };

/** Reads and validates, newest first. A record that no longer parses is
 * dropped (and named in droppedIds, so its images can go too) rather than
 * blanking the whole list. */
function readRaw(): { entries: ProjectEntry[]; droppedIds: string[]; pruned: boolean } {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { entries: [], droppedIds: [], pruned: false };
    const parsed = JSON.parse(raw) as Partial<ProjectFile>;
    if (!Array.isArray(parsed?.entries)) return { entries: [], droppedIds: [], pruned: true };

    const droppedIds: string[] = [];
    const entries = parsed.entries.flatMap((entry) => {
      if (typeof entry?.id !== "string" || typeof entry?.savedAt !== "number") return [];
      const project = projectDocumentSchema.safeParse(entry.project);
      if (!project.success) {
        droppedIds.push(entry.id);
        return [];
      }
      return [{ id: entry.id, savedAt: entry.savedAt, project: project.data }];
    });
    entries.sort((a, b) => b.savedAt - a.savedAt);
    return { entries, droppedIds, pruned: entries.length !== parsed.entries.length };
  } catch {
    // Private-mode browsers block storage entirely — keep working without it
    return { entries: [], droppedIds: [], pruned: false };
  }
}

/** True once the entries are actually stored (drives "บันทึกแล้ว") */
function writeRaw(entries: ProjectEntry[]): boolean {
  const kept = entries.slice(0, MAX_PROJECTS);
  const overflow = entries.slice(MAX_PROJECTS).map((entry) => entry.id);
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, entries: kept } satisfies ProjectFile));
    if (overflow.length) void clearForHistoryIds(overflow);
    return true;
  } catch {
    // Out of quota — drop the oldest and try once more, same as history.ts
    if (kept.length > 1) {
      try {
        localStorage.setItem(KEY, JSON.stringify({ v: 1, entries: kept.slice(0, -1) } satisfies ProjectFile));
        void clearForHistoryIds([...overflow, kept[kept.length - 1].id]);
        return true;
      } catch {
        /* still no room — never fail loudly */
      }
    }
    return false;
  }
}

/** Newest first. Prunes corrupt records, writing back if anything changed. */
export function list(): ProjectEntry[] {
  const { entries, droppedIds, pruned } = readRaw();
  if (pruned) {
    writeRaw(entries);
    if (droppedIds.length) void clearForHistoryIds(droppedIds);
  }
  return entries;
}

/** Create or update the project for `id`, moving it to the top of the list */
export function upsert(id: string, project: ProjectDocument): boolean {
  const others = readRaw().entries.filter((entry) => entry.id !== id);
  return writeRaw([{ id, savedAt: Date.now(), project }, ...others]);
}

/** Removes the project AND its images */
export function remove(id: string): void {
  writeRaw(readRaw().entries.filter((entry) => entry.id !== id));
  void clearForHistoryIds([id]);
}

/** Put a removed project back with its original savedAt (undo) */
export function restore(entry: ProjectEntry): void {
  const others = readRaw().entries.filter((other) => other.id !== entry.id);
  writeRaw([entry, ...others].sort((a, b) => b.savedAt - a.savedAt));
}

export { newId };
