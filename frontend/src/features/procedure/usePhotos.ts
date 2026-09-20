/* Step photos, kept in memory and synced to lib/photoStore.ts (IndexedDB).
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
 * photoStore.ts's own (historyId, stepNo) key, and matching why photos
 * cross-job-leak was a real bug before: the in-memory map has no identity of
 * its own beyond "whatever's currently loaded", so this hook owns exactly
 * one job's worth of photos, keyed by whichever historyId it's given.
 */

import { useEffect, useState } from "react";

import type { StepPhoto } from "../../lib/pdf/layout";
import * as photoStore from "../../lib/photoStore";

export function usePhotos(historyId: string | null) {
  const [photos, setPhotos] = useState<Record<number, StepPhoto>>({});

  // Recover photos from IndexedDB whenever historyId points at a real entry
  // — covers both a refresh mid-review (historyId restored from
  // currentHistoryId's sessionStorage draft on mount, procedure restored the
  // same way, photos now recoverable too instead of just gone) and opening a
  // history entry from HistoryList. Merged into the in-memory map rather
  // than replacing it outright, though in practice photos is always {} at
  // the two moments this actually fires (mount, or right after
  // openHistoryEntry sets both historyId and discards/replaces photos) —
  // merging is what stays correct if that ever stops being true, at no
  // extra cost when it is.
  useEffect(() => {
    if (!historyId) return;
    let cancelled = false;
    void photoStore.loadForHistoryId(historyId).then((loaded) => {
      if (cancelled || Object.keys(loaded).length === 0) return;
      setPhotos((current) => ({ ...loaded, ...current }));
    });
    return () => {
      cancelled = true;
    };
  }, [historyId]);

  /** Attach or clear one step's photo. Never touches the document.
   *
   * Also writes through to photoStore.ts (IndexedDB) so the photo survives a
   * refresh — fire-and-forget, same as every other call into that module,
   * since a failed persist here is never worse than this feature not
   * existing at all. Skipped when there's no historyId yet (shouldn't
   * happen in practice: a procedure can't exist before a history entry has
   * been started) — there'd be nothing to key the write by. */
  const setPhoto = (stepNo: number, photo: StepPhoto | null) => {
    setPhotos((current) => {
      const next = { ...current };
      if (photo) next[stepNo] = photo;
      else delete next[stepNo];
      return next;
    });
    if (!historyId) return;
    if (photo) void photoStore.save(historyId, stepNo, photo);
    else void photoStore.remove(historyId, stepNo);
  };

  /** Drop every photo for the current job, in memory and on disk. Required,
   * not tidiness: photos are keyed by step number, so leaving them behind
   * would attach this job's images to the next job's steps 1, 2, 3… — the
   * caller is about to move on to a different job (a new JSA, "เริ่มใหม่", or
   * opening a different history entry). Uses whichever historyId this hook
   * currently has, i.e. the job being left behind, not whatever the caller
   * is about to switch to. */
  const discardAll = () => {
    setPhotos({});
    if (historyId) void photoStore.clearForHistoryId(historyId);
  };

  /** After a regenerate, drop photos whose step number no longer exists in
   * the new draft — repeated redrafts in one session can't accumulate
   * unreachable images. Photos survive a regenerate at all (unlike the
   * document itself) because they're the user's own work, not the AI's, and
   * the step they illustrate usually still exists.
   *
   * Same pruning applied to the persisted copy, or an orphan dropped from
   * the in-memory map here would simply reappear the next time this
   * historyId's photos are loaded from IndexedDB (on refresh, or reopening
   * this entry from history). */
  const pruneToLiveSteps = (liveStepNos: readonly number[]) => {
    setPhotos((current) => {
      const live = new Set(liveStepNos);
      const orphaned = Object.keys(current)
        .map(Number)
        .filter((no) => !live.has(no));
      if (historyId && orphaned.length) {
        void Promise.all(orphaned.map((no) => photoStore.remove(historyId, no)));
      }
      return Object.fromEntries(Object.entries(current).filter(([no]) => live.has(Number(no))));
    });
  };

  return { photos, setPhoto, discardAll, pruneToLiveSteps };
}
