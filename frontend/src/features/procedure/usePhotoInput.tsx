/* Every way a photo can arrive for one sub-step — file picker, drop, paste —
 * funnelled through one decode/resize, one busy flag and one error message.
 * Used by ProcedureEditorStep's SubStepItem; the buttons it drives live in
 * SubStepPhoto.tsx (see its header for the three ways in). */

import { useRef, useState } from "react";

import { fileFrom, fileToStepPhoto, PhotoError } from "../../lib/photo";
import type { StepPhoto } from "../../lib/pdf/layout";

export function usePhotoInput(onChange: (photo: StepPhoto | null) => void) {
  const inputRef = useRef<HTMLInputElement>(null);
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

  const fileInput = (
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
  );

  return {
    busy,
    error,
    fileInput,
    openPicker: () => inputRef.current?.click(),
    /** Drop handler props for the row */
    dropProps: (setDragging: (on: boolean) => void) => ({
      onDragOver: (event: React.DragEvent) => {
        if (!Array.from(event.dataTransfer.types).includes("Files")) return;
        event.preventDefault();
        setDragging(true);
      },
      onDragLeave: () => setDragging(false),
      onDrop: (event: React.DragEvent) => {
        if (!Array.from(event.dataTransfer.types).includes("Files")) return;
        event.preventDefault();
        setDragging(false);
        void accept(fileFrom(event.dataTransfer));
      },
    }),
    /** Paste handler for the sub-step's text box: only takes over when the
     * clipboard actually carries a file, so typing and text pastes behave
     * exactly as before. */
    onPaste: (event: React.ClipboardEvent) => {
      const file = fileFrom(event.clipboardData);
      if (!file) return;
      event.preventDefault();
      void accept(file);
    },
  };
}
