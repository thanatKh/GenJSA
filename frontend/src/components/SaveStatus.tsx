/* "กำลังบันทึก…" / "บันทึกแล้ว" — the editors save
 * to this device's history as you type (debounced in App.tsx), and without
 * this nothing said so. Only claims "saved" once history.ts reports the
 * write actually stored; a full storage quota says so instead. */

import type { ReactNode } from "react";
import { Check, LoaderCircle, TriangleAlert } from "lucide-react";

export type SaveState = "idle" | "saving" | "saved" | "failed" | "conflict";

const LINES: Record<Exclude<SaveState, "idle">, { className: string; icon: ReactNode; text: string }> = {
  saving: {
    className: "text-muted",
    icon: <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />,
    text: "กำลังบันทึก…",
  },
  saved: {
    className: "text-muted",
    icon: <Check className="size-3.5 text-[var(--success)]" aria-hidden="true" />,
    text: "บันทึกในเบราว์เซอร์นี้แล้ว",
  },
  failed: {
    className: "text-danger-text",
    icon: <TriangleAlert className="size-3.5" aria-hidden="true" />,
    text: "บันทึกในเบราว์เซอร์ไม่ได้",
  },
  conflict: {
    className: "text-danger-text",
    icon: <TriangleAlert className="size-3.5" aria-hidden="true" />,
    text: "งานนี้เปลี่ยนในอีกแท็บ",
  },
};

const SHORT_LABELS = { saving: "กำลังบันทึก", saved: "บันทึกแล้ว", failed: "บันทึกไม่ได้", conflict: "งานเปลี่ยนในอีกแท็บ" };

export function SaveStatus({ state }: { state: SaveState }) {
  const line = state === "idle" ? null : LINES[state];
  return (
    <p role="status" aria-atomic="true" className="flex min-h-5 min-w-0 flex-1 items-center justify-center text-center text-xs">
      {line && state !== "idle" ? (
        <span className={`flex items-center gap-1.5 ${line.className}`} title={line.text}>
          {line.icon}
          <span className="sr-only sm:not-sr-only">{line.text}</span>
          <span aria-hidden="true" className="sm:hidden">{SHORT_LABELS[state]}</span>
        </span>
      ) : null}
    </p>
  );
}
