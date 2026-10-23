/* "กำลังบันทึก…" / "บันทึกแล้ว" next to an editor's title — the editors save
 * to this device's history as you type (debounced in App.tsx), and without
 * this nothing said so. Only claims "saved" once history.ts reports the
 * write actually stored; a full storage quota says so instead. */

import { Check, LoaderCircle, TriangleAlert } from "lucide-react";

export type SaveState = "idle" | "saving" | "saved" | "failed";

export function SaveStatus({ state }: { state: SaveState }) {
  return (
    <p role="status" aria-live="polite" className="flex min-h-5 items-center gap-1.5 text-sm">
      {state === "saving" ? (
        <span className="flex items-center gap-1.5 text-muted">
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
          กำลังบันทึก…
        </span>
      ) : state === "saved" ? (
        <span className="flex items-center gap-1.5 text-muted">
          <Check className="size-3.5 text-[var(--success)]" aria-hidden="true" />
          บันทึกแล้ว
        </span>
      ) : state === "failed" ? (
        <span className="flex items-center gap-1.5 text-danger-text">
          <TriangleAlert className="size-3.5" aria-hidden="true" />
          บันทึกไม่สำเร็จ พื้นที่จัดเก็บในเครื่องเต็ม — กรุณาบันทึกเป็นไฟล์ PDF
        </span>
      ) : null}
    </p>
  );
}
