/* Keep drafts in sessionStorage
 *
 * Why this exists: a core requirement is that "data the user typed must
 * never be lost because of an API error." If the AI fails, the network
 * drops, or the user accidentally refreshes, what they typed must survive.
 *
 * Why sessionStorage and not localStorage: it's scoped to the tab and
 * disappears when the tab closes. This matches the "no JSA data persistence"
 * principle — nothing lingers on the device across sessions, and nothing is
 * ever sent to a server to be stored.
 */

import type { InputForm, JsaDocument } from "./lib/schema";

const INPUT_KEY = "genjsa.draft.input";
const DOC_KEY = "genjsa.draft.doc";

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

export function clearAllDrafts(): void {
  inputDraft.clear();
  docDraft.clear();
}
