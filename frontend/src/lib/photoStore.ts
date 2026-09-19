/* Step photos, persisted in IndexedDB — survives an accidental refresh.
 *
 * This reverses an earlier, deliberate decision (see StepPhoto in
 * lib/pdf/layout.ts and the plan history): photos used to be memory-only,
 * gone on refresh, because keeping them out of sessionStorage/history.ts
 * sidestepped quota limits and the "every keystroke re-serializes megabytes
 * of base64" perf bug those stores are vulnerable to. IndexedDB doesn't have
 * either problem — it's async (never blocks a render) and its quota is
 * realistically hundreds of MB to low GB, not localStorage's ~5MB — so the
 * memory-only trade-off no longer buys anything an engineer on a phone cares
 * about, and losing photos to a stray refresh is a real cost to them.
 *
 * What did NOT change: photos still never reach the backend, never reach
 * history.ts's JSON blob, and still never touch ProcedureDocument (still no
 * schema lie, still no typing-lag bug on every keystroke — see
 * updateProcedure in App.tsx). This is a THIRD store, parallel to
 * history.ts and store.ts, not a merge into either.
 *
 * Keyed by (historyId, stepNo), not stepNo alone. The in-memory `photos` map
 * in App.tsx can get away with stepNo alone because only one job is ever open
 * at a time, but this store persists across reloads and across jobs, so it
 * needs the same job identity history.ts itself keys by — otherwise loading
 * a DIFFERENT job after a refresh could read back a stale job's photos by
 * coincidence of matching step numbers, exactly the cross-job leak
 * discardProcedure()'s setPhotos({}) already exists to prevent in memory.
 *
 * Lifecycle is the caller's job (App.tsx), not this module's — this file only
 * knows how to read/write/delete rows. Every place that already clears the
 * in-memory `photos` map (discardProcedure, startOver, regenerate's orphan
 * pruning) needs a matching call here, or photos survive on disk after the
 * job that owned them is gone. See App.tsx for how each of those is wired.
 *
 * No retention policy of its own — piggybacks on history.ts's lifecycle
 * instead of inventing a second expiry clock. Whenever a historyId's entry is
 * removed (explicit delete, "ล้างประวัติทั้งหมด", or history.ts's own silent
 * age/quota pruning), its photos must be removed too, or they'd accumulate on
 * disk forever with no owning entry left to show them against. See
 * history.ts's onEntriesRemoved hook.
 */

const DB_NAME = "genjsa-photos";
const DB_VERSION = 1;
const STORE = "photos";

export type StoredPhoto = {
  historyId: string;
  stepNo: number;
  data: string;
  ratio: number;
  savedAt: number;
};

let dbPromise: Promise<IDBDatabase | null> | null = null;

/** Opens (or creates) the database once per page load. Resolves to null —
 * rather than rejecting — when IndexedDB is unavailable or blocked (private
 * browsing in some browsers, disabled storage, a handful of restrictive
 * in-app WebViews): every function below treats null as "persistence isn't
 * available right now" and no-ops instead of throwing, the same fail-quiet
 * posture store.ts and history.ts already take on their own storage. */
function openDb(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: ["historyId", "stepNo"] });
          // Lets clearForHistoryId scan by historyId alone without a full-store walk
          store.createIndex("historyId", "historyId");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }
        try {
          const tx = db.transaction(STORE, mode);
          const request = run(tx.objectStore(STORE));
          request.onsuccess = () => resolve(request.result ?? null);
          request.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

/** All photos saved for one job, keyed by stepNo — the shape App.tsx's
 * in-memory `photos` map already uses, so a caller can drop this straight
 * into setPhotos(). Empty object (never throws) if the DB is unavailable or
 * the job has no saved photos. */
export async function loadForHistoryId(
  historyId: string,
): Promise<Record<number, { data: string; ratio: number }>> {
  const db = await openDb();
  if (!db) return {};
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const index = tx.objectStore(STORE).index("historyId");
      const request = index.getAll(IDBKeyRange.only(historyId));
      request.onsuccess = () => {
        const rows = (request.result ?? []) as StoredPhoto[];
        resolve(
          Object.fromEntries(rows.map((row) => [row.stepNo, { data: row.data, ratio: row.ratio }])),
        );
      };
      request.onerror = () => resolve({});
    } catch {
      resolve({});
    }
  });
}

/** Save or overwrite one step's photo. Fire-and-forget from the caller's
 * perspective (App.tsx doesn't await this) — a failed write here is never
 * worse than the pre-existing memory-only behaviour, so it fails quiet. */
export function save(
  historyId: string,
  stepNo: number,
  photo: { data: string; ratio: number },
): Promise<void> {
  return withStore("readwrite", (store) =>
    store.put({ historyId, stepNo, data: photo.data, ratio: photo.ratio, savedAt: Date.now() }),
  ).then(() => undefined);
}

/** Remove one step's photo (the user deleted it in the editor). */
export function remove(historyId: string, stepNo: number): Promise<void> {
  return withStore("readwrite", (store) => store.delete([historyId, stepNo])).then(() => undefined);
}

/** Remove every photo saved for one job — discardProcedure, startOver, and
 * history.ts's own deletion/expiry all need this so photos never outlive the
 * entry they illustrate. */
export async function clearForHistoryId(historyId: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      const index = tx.objectStore(STORE).index("historyId");
      const request = index.openKeyCursor(IDBKeyRange.only(historyId));
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          tx.objectStore(STORE).delete(cursor.primaryKey);
          cursor.continue();
        } else {
          resolve();
        }
      };
      request.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Remove every photo saved for several jobs at once — history.ts's own
 * age/quota pruning and "ล้างประวัติทั้งหมด" both drop many entries in one
 * pass, so this avoids opening one transaction per id. */
export async function clearForHistoryIds(historyIds: string[]): Promise<void> {
  await Promise.all(historyIds.map((id) => clearForHistoryId(id)));
}
