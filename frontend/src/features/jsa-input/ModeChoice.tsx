/* What to make — JSA / JSA + Procedure / โครงการ, at the top of step 1
 *
 * One three-way switch (radiogroup) instead of the two controls this
 * replaced — a pill for "JSA only / JSA + procedure" inside the form, and
 * tabs above it for "single job / project" — so the first screen asks one
 * question, "what am I submitting?", once.
 *
 * - JSA and JSA + Procedure share the same form; only the submit button and
 *   what gets drafted change, so nothing swaps.
 * - โครงการ swaps the whole form and flow (App.tsx slides it in from the
 *   right, the side this option sits on).
 * "JSA + Procedure" in English: the document itself is titled
 * "(Work Procedure)", and on its own "ขั้นตอน" is ambiguous with the JSA's
 * own steps. The headings and buttons elsewhere keep the full Thai name.
 *
 * The highlight slides between options (motion layoutId, the transitions.dev
 * tabs-sliding pattern) on the app's --duration-fast / --ease-smooth-out
 * values; with "reduce motion" on it just moves. Only on the first screen:
 * once a job is under way its mode is fixed.
 */

import { useRef } from "react";
import { motion, useReducedMotion } from "motion/react";
import { FileText, FolderKanban, ListOrdered } from "lucide-react";
import type { ComponentType } from "react";

import type { Mode } from "../../store";

const OPTIONS: { mode: Mode; label: string; Icon: ComponentType<{ className?: string }> }[] = [
  { mode: "jsa", label: "JSA", Icon: FileText },
  { mode: "procedure", label: "JSA + Procedure", Icon: ListOrdered },
  { mode: "project", label: "โครงการ", Icon: FolderKanban },
];

export function ModeChoice({ mode, onChange }: { mode: Mode; onChange: (mode: Mode) => void }) {
  const reduceMotion = useReducedMotion();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  // Radiogroup keyboard pattern: one tab stop, arrow keys move the choice
  // (and focus) around the three options
  const select = (index: number) => {
    const next = (index + OPTIONS.length) % OPTIONS.length;
    onChange(OPTIONS[next].mode);
    buttons.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label="เอกสารที่ต้องการสร้าง"
      // The middle option is the longest label, so it gets a wider column
      className="mb-4 grid grid-cols-[1fr_1.4fr_1fr] gap-1 rounded-full border border-line bg-raised p-1"
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
            className={`relative flex min-h-11 items-center justify-center rounded-full px-1.5 text-sm font-medium
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
            {/* Wraps onto two lines when a phone is too narrow for
                "JSA + Procedure" on one, rather than cutting it off */}
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
