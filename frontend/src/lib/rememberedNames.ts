/* The หัวหน้างาน and ผู้วิเคราะห์ names used last time, so the first screen
 * starts with them filled in instead of blank on every job. Plain
 * localStorage, this browser only, like history.ts — never sent anywhere.
 *
 * "Last time" means the last names the user actually typed: saved when a
 * document is created on the first screen, and when either field is edited
 * in the JSA editor. Clearing a field and creating a document forgets it,
 * so there's no separate setting to manage.
 */

const KEY = "genjsa.names.v1";

export type RememberedNames = { supervisor: string; analyst: string };

const EMPTY: RememberedNames = { supervisor: "", analyst: "" };

/** Never throws — storage can be disabled, and a broken record just means
 * nothing is remembered */
export function loadNames(): RememberedNames {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<RememberedNames> | null;
    return {
      supervisor: typeof parsed?.supervisor === "string" ? parsed.supervisor : "",
      analyst: typeof parsed?.analyst === "string" ? parsed.analyst : "",
    };
  } catch {
    return { ...EMPTY };
  }
}

export function saveNames(names: Partial<RememberedNames>): void {
  try {
    const next = { ...loadNames(), ...names };
    next.supervisor = next.supervisor.trim();
    next.analyst = next.analyst.trim();
    if (!next.supervisor && !next.analyst) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Quota or disabled storage — remembering is a convenience, never required
  }
}
