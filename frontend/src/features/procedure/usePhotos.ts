/* Sub-step photos, kept in memory and synced to lib/photoStore.ts (IndexedDB).
 *
 * Deepens what used to be 4 separate call sites in App.tsx that each had to
 * remember, by hand, to touch BOTH the in-memory `photos` map and
 * photoStore.ts to keep them agreeing (load-on-historyId-change, discard on
 * leaving a job, prune orphans on regenerate, save/remove on edit) — the
 * invariant "these two copies move together" was enforced only by a code
 * comment, not by anything that would fail to compile if a future call site
 * forgot half of it. This hook is that missing owner: every place that used
 * to touch `photos` directly now goes through here, and there's no longer a
 * path to the in-memory map that can skip the persisted one.
 *
 * Keyed by `historyId`, not by a caller-supplied setter — matching
 * photoStore.ts's own (historyId, key) key. The in-memory map holds exactly
 * one job's photos: it resets the moment historyId changes (see below), so
 * moving to another job can never show this job's images on that job's 1.1,
 * 1.2…
 *
 * Leaving a job only forgets its photos IN MEMORY. They stay in IndexedDB
 * for as long as the job's history entry exists, so reopening it from
 * HistoryList brings them back along with its text. The only thing that
 * deletes photos from disk is deleting the history entry itself
 * (history.ts's onEntriesRemoved). This hook used to delete them from disk
 * on every "leave this job" — เริ่มใหม่, the logo, a new JSA, opening another
 * entry — which is why a reopened job came back with its text but no
 * photos.
 *
 * Photos are keyed per sub-step (photoKey in lib/pdf/layout.ts, "1.2"). They
 * used to be one per main step; photos saved that way are moved onto that
 * step's LAST sub-step the first time the job is loaded — the old photo
 * printed after all of a step's sub-steps, so the last one keeps the PDF
 * looking the same.
 */

import { useEffect, useRef, useState } from "react";

import { photoKey, type PhotoMap, type StepPhoto } from "../../lib/pdf/layout";
import * as photoStore from "../../lib/photoStore";
import type { ProcedureDocument } from "../../lib/schema";

/** Every key in `photos` that belongs to main step `stepNo` */
function keysOfStep(photos: PhotoMap, stepNo: number): string[] {
  const prefix = `${stepNo}.`;
  return Object.keys(photos).filter((key) => key.startsWith(prefix));
}

export function usePhotos(historyId: string | null, procedure: ProcedureDocument | null) {
  const [photos, setPhotos] = useState<PhotoMap>({});
  // The latest map, for replaceStepPhotos — it's also called from undo
  // closures created several renders earlier, whose own `photos` is stale.
  const photosRef = useRef(photos);
  photosRef.current = photos;

  // Reset during render, not in an effect — React's pattern for "state that
  // belongs to one value of a prop": an effect would let one render show the
  // previous job's photos against the new job's steps first.
  const [photosFor, setPhotosFor] = useState(historyId);
  if (photosFor !== historyId) {
    setPhotosFor(historyId);
    setPhotos({});
  }

  // Read inside the async load below, after the await — by then the render
  // that set historyId has also set this job's procedure, whichever order
  // the two arrived in.
  const procedureRef = useRef(procedure);
  procedureRef.current = procedure;

  // Recover photos from IndexedDB whenever historyId points at a real entry
  // — covers both a refresh mid-review (historyId restored from
  // currentHistoryId's sessionStorage draft on mount, procedure restored the
  // same way) and opening a history entry from HistoryList. Merged under
  // whatever is already in memory: the map was just reset for this
  // historyId, so anything there is a photo the user attached in the moment
  // before this load finished, and theirs wins.
  useEffect(() => {
    if (!historyId) return;
    let cancelled = false;
    void photoStore.loadForHistoryId(historyId).then(({ photos: loaded, legacy }) => {
      if (cancelled) return;

      // Old per-step photos → that step's last sub-step. Skipped when that
      // sub-step already has a photo of its own (can't happen for data
      // written before the move, but never overwrite the user's photo).
      // A step with no sub-steps at all gets "N.1": nothing shows until a
      // sub-step exists, but the photo isn't thrown away either.
      const moved: PhotoMap = {};
      for (const [stepNoText, photo] of Object.entries(legacy)) {
        const stepNo = Number(stepNoText);
        const step = procedureRef.current?.steps.find((candidate) => candidate.no === stepNo);
        const lastSubNo = step?.sub_steps.length ? step.sub_steps[step.sub_steps.length - 1].no : 1;
        const key = photoKey(stepNo, lastSubNo);
        if (!(key in loaded) && !(key in moved)) {
          moved[key] = photo;
          void photoStore.save(historyId, key, photo);
        }
        void photoStore.remove(historyId, stepNo);
      }

      const all = { ...loaded, ...moved };
      if (Object.keys(all).length === 0) return;
      setPhotos((current) => ({ ...all, ...current }));
    });
    return () => {
      cancelled = true;
    };
  }, [historyId]);

  /** Attach or clear one sub-step's photo. Never touches the document.
   *
   * Also writes through to photoStore.ts (IndexedDB) so the photo survives a
   * refresh — fire-and-forget, same as every other call into that module,
   * since a failed persist here is never worse than this feature not
   * existing at all. Skipped when there's no historyId yet (shouldn't
   * happen in practice: a procedure can't exist before a history entry has
   * been started) — there'd be nothing to key the write by. */
  const setPhoto = (key: string, photo: StepPhoto | null) => {
    setPhotos((current) => {
      const next = { ...current };
      if (photo) next[key] = photo;
      else delete next[key];
      return next;
    });
    if (!historyId) return;
    if (photo) void photoStore.save(historyId, key, photo);
    else void photoStore.remove(historyId, key);
  };

  /** Replace every photo of one main step at once — `next` holds only that
   * step's keys. This is how ProcedureEditorStep keeps photos with their
   * sub-steps when one is deleted (the old 1.3's photo becomes 1.2's) and
   * puts them back on undo: a single swap, so the step's photos never pass
   * through a half-shifted state.
   *
   * The disk diff is taken against photosRef (the latest render's map), not
   * this render's `photos`: undo calls this from a closure made when the
   * sub-step was deleted, and diffing against that older map skipped the
   * very writes undo needs — the photo came back on screen but not on disk.
   * Kept outside the setPhotos updater so the IndexedDB writes happen
   * exactly once (an updater can run twice under StrictMode). */
  const replaceStepPhotos = (stepNo: number, next: PhotoMap) => {
    const current = photosRef.current;
    const removed = keysOfStep(current, stepNo).filter((key) => !(key in next));
    const changed = Object.entries(next).filter(([key, photo]) => current[key] !== photo);

    setPhotos((latest) => {
      const merged = { ...latest };
      for (const key of keysOfStep(latest, stepNo)) delete merged[key];
      return { ...merged, ...next };
    });

    if (!historyId) return;
    for (const key of removed) void photoStore.remove(historyId, key);
    for (const [key, photo] of changed) void photoStore.save(historyId, key, photo);
  };

  /** After a regenerate, drop photos whose sub-step no longer exists in the
   * new draft — repeated redrafts in one session can't accumulate
   * unreachable images. Photos survive a regenerate at all (unlike the
   * document itself) because they're the user's own work, not the AI's.
   *
   * Same pruning applied to the persisted copy, or an orphan dropped from
   * the in-memory map here would simply reappear the next time this
   * historyId's photos are loaded from IndexedDB (on refresh, or reopening
   * this entry from history). */
  const pruneToLiveKeys = (liveKeys: readonly string[]) => {
    setPhotos((current) => {
      const live = new Set(liveKeys);
      const orphaned = Object.keys(current).filter((key) => !live.has(key));
      if (historyId && orphaned.length) {
        void Promise.all(orphaned.map((key) => photoStore.remove(historyId, key)));
      }
      return Object.fromEntries(Object.entries(current).filter(([key]) => live.has(key)));
    });
  };

  return { photos, setPhoto, replaceStepPhotos, pruneToLiveKeys };
}
