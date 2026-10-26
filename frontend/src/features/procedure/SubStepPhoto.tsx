/* Attach one optional photo to a work-procedure sub-step (1.1, 1.2…).
 *
 * Three ways in, because the people using this are on a phone at the job site
 * or on a desktop with a screenshot in the clipboard: the photo button (the
 * file picker, which offers the camera directly on mobile), drag-and-drop
 * onto the sub-step's row, and Ctrl-V into the sub-step's text box — only
 * when the clipboard holds an image; a normal text paste is left alone.
 * Pasting into the text box (rather than a separate drop zone, as when photos
 * were per main step) means the paste always lands on the sub-step being
 * edited, with nothing extra on screen per row.
 *
 * Photos are downscaled on the way in (lib/photo.ts), then persisted in
 * IndexedDB (lib/photoStore.ts) so an accidental refresh on a phone mid-review
 * doesn't lose them — they still never reach the backend, never reach
 * ProcedureDocument or history.ts's own JSON (see StepPhoto in
 * lib/pdf/layout.ts for why), and are still tied to this device's browser
 * only, same as the rest of history.ts.
 */

import { ImagePlus, LoaderCircle, Trash2 } from "lucide-react";
import { motion } from "motion/react";

import { Button } from "../../components/ui";
import { popIn } from "../../lib/motion";
import type { StepPhoto } from "../../lib/pdf/layout";

/** Icon button in the sub-step row's action column, beside the delete button */
export function PhotoButton({
  label,
  busy,
  onClick,
}: {
  label: string;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-lg"
      aria-label={label}
      title={label}
      disabled={busy}
      onClick={onClick}
      className="mt-1 text-muted hover:text-navy"
    >
      {busy ? (
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        <ImagePlus className="size-4" aria-hidden="true" />
      )}
    </Button>
  );
}

/** The attached photo, shown under the sub-step's text */
export function PhotoPreview({
  photo,
  label,
  onRemove,
}: {
  photo: StepPhoto;
  label: string;
  onRemove: () => void;
}) {
  return (
    <div className="mt-2 flex items-start gap-2">
      {/* Keyed on the image: scales in when added and again when replaced */}
      <motion.img
        key={photo.data}
        {...popIn}
        src={photo.data}
        alt={label}
        className="max-h-32 w-auto max-w-full rounded-xl border border-line"
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onRemove}
        className="text-muted hover:bg-danger-soft hover:text-danger-text"
      >
        <Trash2 className="size-4" aria-hidden="true" />
        ลบรูปภาพ
      </Button>
    </div>
  );
}
