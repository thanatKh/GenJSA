import { useRef } from "react";
import { motion, useReducedMotion } from "motion/react";
import { FileText, ListOrdered } from "lucide-react";
import type { ComponentType } from "react";

import type { Mode } from "../../store";

const OPTIONS: { mode: Mode; label: string; Icon: ComponentType<{ className?: string }> }[] = [
  { mode: "jsa", label: "JSA", Icon: FileText },
  { mode: "procedure", label: "JSA + ขั้นตอนปฏิบัติงาน", Icon: ListOrdered },
];

export function ModeChoice({ mode, onChange }: { mode: Mode; onChange: (mode: Mode) => void }) {
  const reduceMotion = useReducedMotion();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  // Radiogroup keyboard pattern: one tab stop, arrow keys move the choice
  // (and focus) between the two options
  const select = (index: number) => {
    const next = (index + OPTIONS.length) % OPTIONS.length;
    onChange(OPTIONS[next].mode);
    buttons.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label="เอกสารที่ต้องการสร้าง"
      className="mb-4 grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-1 rounded-full border border-line bg-raised p-1"
    >
      {OPTIONS.map((option, index) => {
        const checked = option.mode === mode;
        return (
          <button
            key={option.mode}
            ref={(el) => {
              buttons.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(option.mode)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                event.preventDefault();
                select(index + 1);
              } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                event.preventDefault();
                select(index - 1);
              }
            }}
            className={`press relative flex min-h-11 items-center justify-center rounded-full px-1.5 text-sm font-medium
                        transition-colors focus-visible:outline-none focus-visible:ring-2
                        focus-visible:ring-ring/50 ${checked ? "text-navy" : "text-muted hover:text-ink"}`}
          >
            {checked ? (
              <motion.span
                layoutId="mode-choice-pill"
                className="absolute inset-0 rounded-full border border-line bg-surface shadow-sm"
                transition={reduceMotion ? { duration: 0 } : { duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                aria-hidden="true"
              />
            ) : null}
            <span className="relative flex items-center justify-center gap-1.5 text-center leading-tight">
              <option.Icon className="size-4 shrink-0 max-sm:hidden" />
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
