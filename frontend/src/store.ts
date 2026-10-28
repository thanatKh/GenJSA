/* Keep drafts in sessionStorage
 *
 * Why this exists: a core requirement is that "data the user typed must
 * never be lost because of an API error." If the AI fails, the network
 * drops, or the user accidentally refreshes, what they typed must survive.
 *
 * Why sessionStorage and not localStorage: a draft is scratch state for one
 * pass through the wizard, so it's scoped to the tab and disappears when the
 * tab closes. Nothing here is ever sent to a server to be stored.
 *
 * Finished documents are a different matter and live in history.ts
 * (localStorage, this PC only) — that's the deliberate exception, not a
 * contradiction of this file.
 */

import type { InputForm, JsaDocument, ProcedureDocument, ProjectDocument } from "./lib/schema";

const INPUT_KEY = "genjsa.draft.input";
const DOC_KEY = "genjsa.draft.doc";
const PROCEDURE_KEY = "genjsa.draft.procedure";
const HISTORY_ID_KEY = "genjsa.draft.historyId";
const PROJECT_KEY = "genjsa.draft.project";
const MODE_KEY = "genjsa.draft.mode";

function read<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    // Some browsers' private mode blocks storage entirely — keep working without a draft
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Full or blocked — not fatal, fail silently
  }
}

function remove(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* fail silently */
  }
}

export const inputDraft = {
  load: () => read<InputForm>(INPUT_KEY),
  save: (value: InputForm) => write(INPUT_KEY, value),
  clear: () => remove(INPUT_KEY),
};

export const docDraft = {
  load: () => read<JsaDocument>(DOC_KEY),
  save: (value: JsaDocument) => write(DOC_KEY, value),
  clear: () => remove(DOC_KEY),
};

/** The work procedure generated from docDraft, while it's being reviewed. */
export const procedureDraft = {
  load: () => read<ProcedureDocument>(PROCEDURE_KEY),
  save: (value: ProcedureDocument) => write(PROCEDURE_KEY, value),
  clear: () => remove(PROCEDURE_KEY),
};

/* Which history.ts entry the in-progress document belongs to. Kept here so a
 * mid-flow refresh — which App.tsx rehydrates straight back into the editor —
 * keeps updating that entry instead of forking a duplicate. */
export const currentHistoryId = {
  load: () => read<string>(HISTORY_ID_KEY),
  save: (value: string) => write(HISTORY_ID_KEY, value),
  clear: () => remove(HISTORY_ID_KEY),
};

/* Project Mode's in-progress project, with the id of its projects.ts entry
 * (null until the project is first saved) and which phase's JSA is open. */
export type ProjectDraft = {
  id: string | null;
  project: ProjectDocument;
  openPhase: number;
  /** Which project screen was open (App.tsx's stage 10-12), so a refresh
   * comes back to it rather than to the JSA list every time */
  screen?: number;
};
export const projectDraft = {
  load: () => read<ProjectDraft>(PROJECT_KEY),
  save: (value: ProjectDraft) => write(PROJECT_KEY, value),
  clear: () => remove(PROJECT_KEY),
};

/** Which tab the first screen is on — งานเดียว (single) or โครงการ (project) */
export type Mode = "single" | "project";
export const modeDraft = {
  load: () => read<Mode>(MODE_KEY) ?? "single",
  save: (value: Mode) => write(MODE_KEY, value),
};

/** Clears the in-progress draft only. History (history.ts) is untouched by
 * design, and so are saved projects (projects.ts). */
export function clearAllDrafts(): void {
  inputDraft.clear();
  docDraft.clear();
  procedureDraft.clear();
  currentHistoryId.clear();
  projectDraft.clear();
}
