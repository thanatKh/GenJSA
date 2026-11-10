import type { PhotoMap, StepPhoto } from "./pdf/layout";

/** Reinsert one photo, shifting the current photos rather than restoring an
 * old snapshot that would overwrite newer attachments or removals. */
export function restorePhotoAt(photos: PhotoMap, prefix: string, position: number, deleted?: StepPhoto): PhotoMap {
  const next: PhotoMap = {};
  for (const [key, photo] of Object.entries(photos)) {
    if (!key.startsWith(prefix)) continue;
    const n = Number(key.slice(prefix.length));
    if (Number.isInteger(n)) next[`${prefix}${n >= position ? n + 1 : n}`] = photo;
  }
  if (deleted) next[`${prefix}${position}`] = deleted;
  return next;
}
