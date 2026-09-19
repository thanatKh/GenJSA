/* Attach one optional photo to a work-procedure step.
 *
 * Three ways in, because the people using this are on a phone at the job site
 * or on a desktop with a screenshot in the clipboard: drag-and-drop, Ctrl-V
 * paste, and the file picker (which offers the camera directly on mobile).
 *
 * Photos are downscaled on the way in (lib/photo.ts), then persisted in
 * IndexedDB (lib/photoStore.ts) so an accidental refresh on a phone mid-review
 * doesn't lose them — they still never reach the backend, never reach
 * ProcedureDocument or history.ts's own JSON (see StepPhoto in
 * lib/pdf/layout.ts for why), and are still tied to this device's browser
 * only, same as the rest of history.ts.
 */

import { useRef, useState } from "react";
import { ImagePlus, LoaderCircle, Trash2 } from "lucide-react";

import { Button } from "../../components/ui";
import { fileFrom, fileToStepPhoto, PhotoError } from "../../lib/photo";
import type { StepPhoto } from "../../lib/pdf/layout";

export function StepPhotoField({
  stepNo,
  photo,
  onChange,
}: {
  stepNo: number;
  photo: StepPhoto | undefined;
  onChange: (photo: StepPhoto | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await fileToStepPhoto(file));
    } catch (caught) {
      setError(
        caught instanceof PhotoError
          ? caught.message
          : "เพิ่มรูปภาพไม่สำเร็จ กรุณาลองอีกครั้ง",
      );
    } finally {
      setBusy(false);
    }
  };

  if (photo) {
    return (
      <div className="mt-3 border-t border-line pt-3">
        <div className="flex items-start gap-3">
          <img
            src={photo.data}
            alt={`รูปภาพประกอบขั้นตอนที่ ${stepNo}`}
            className="max-h-32 w-auto rounded-[var(--radius)] border border-line"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange(null)}
            className="text-muted hover:text-danger"
          >
            <Trash2 className="size-4" aria-hidden="true" />
            ลบรูปภาพ
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted">
          รูปภาพนี้ถูกเก็บไว้ในเบราว์เซอร์ของเครื่องนี้เท่านั้น หากลบประวัติงานนี้
          รูปภาพจะหายไปด้วย — บันทึกไฟล์ PDF เพื่อเก็บไว้ถาวร
        </p>
      </div>
    );
  }

  return (
    <div className="mt-3 border-t border-line pt-3">
      {/* A div, not a button: it holds its own button and a file input, and a
          button inside a button is invalid. Click and keyboard activation are
          wired explicitly instead.
          onClick here opens the same file picker the inner button does — the
          helper text right below promises "...หรือกดเพื่อเลือกไฟล์" (or click
          to select a file), but until this was added only the small inner
          button actually did anything; clicking the surrounding dashed box
          (most of the tap target, and the natural place to click after
          reading "click to select") silently did nothing. Guarded against
          double-firing: a click on the inner Button already opens the picker
          itself and then bubbles up to this handler too, so it's skipped
          here via closest("button") rather than opening two file dialogs
          (browsers only ever show one, but there's no reason to ask twice). */}
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void accept(fileFrom(event.dataTransfer));
        }}
        // Paste needs focus to land here, so the zone is focusable and says so.
        // Not MIME-filtered here — a pasted non-image file still reaches
        // fileToStepPhoto and gets a real error, rather than this doing
        // nothing and leaving the user wondering if the paste landed at all.
        onPaste={(event) => void accept(fileFrom(event.clipboardData))}
        onClick={(event) => {
          if (busy) return;
          if ((event.target as HTMLElement).closest("button")) return;
          inputRef.current?.click();
        }}
        tabIndex={0}
        role="group"
        aria-label={`เพิ่มรูปภาพประกอบขั้นตอนที่ ${stepNo}`}
        className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--radius)]
                    border border-dashed p-3 text-sm transition-colors
                    cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50
                    ${dragging ? "border-navy bg-navy-soft" : "border-line"}`}
      >
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <ImagePlus className="size-4" aria-hidden="true" />
          )}
          เพิ่มรูปภาพ (ไม่บังคับ)
        </Button>
        <span className="text-xs text-muted">
          ลากรูปมาวาง วางด้วย Ctrl+V หรือกดเพื่อเลือกไฟล์
        </span>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            void accept(event.target.files?.[0] ?? null);
            // Let the same file be picked again after a remove
            event.target.value = "";
          }}
        />
      </div>

      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
    </div>
  );
}
