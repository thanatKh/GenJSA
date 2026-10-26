/* "กำลังบันทึก…" / "บันทึกแล้ว" next to an editor's title — the editors save
 * to this device's history as you type (debounced in App.tsx), and without
 * this nothing said so. Only claims "saved" once history.ts reports the
 * write actually stored; a full storage quota says so instead. */

import type { ReactNode } from "react";
import { Check, LoaderCircle, TriangleAlert } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

export type SaveState = "idle" | "saving" | "saved" | "failed";

const LINES: Record<Exclude<SaveState, "idle">, { className: string; icon: ReactNode; text: string }> = {
  saving: {
    className: "text-muted",
    icon: <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />,
    text: "กำลังบันทึก…",
  },
  saved: {
    className: "text-muted",
    icon: <Check className="size-3.5 text-[var(--success)]" aria-hidden="true" />,
    text: "บันทึกแล้ว",
  },
  failed: {
    className: "text-danger-text",
    icon: <TriangleAlert className="size-3.5" aria-hidden="true" />,
    text: "บันทึกไม่สำเร็จ พื้นที่จัดเก็บในเครื่องเต็ม — กรุณาบันทึกเป็นไฟล์ PDF",
  },
};

export function SaveStatus({ state }: { state: SaveState }) {
  const line = state === "idle" ? null : LINES[state];
  return (
    <p role="status" aria-live="polite" className="flex min-h-5 items-center gap-1.5 text-sm">
      {/* A quick cross-fade between states rather than the text snapping —
          it changes every time typing pauses, so it stays short and still */}
      <AnimatePresence mode="wait" initial={false}>
        {line ? (
          <motion.span
            key={state}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className={`flex items-center gap-1.5 ${line.className}`}
          >
            {line.icon}
            {line.text}
          </motion.span>
        ) : null}
      </AnimatePresence>
    </p>
  );
}
