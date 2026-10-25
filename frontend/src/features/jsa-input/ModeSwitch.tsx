/* What to make: JSA only, or JSA + work procedure — the first control on
 * step 1.
 *
 * A two-option switch (radiogroup), not tabs: the form underneath is the
 * same either way, and tabs would promise different content. Top of the
 * form so the choice frames the job before any typing; it replaced a
 * checkbox at the foot of the form that read as fine print, so the
 * procedure went unnoticed. "เฉพาะ JSA" (only) on the first option keeps
 * the second from reading as "procedure instead of JSA". A pill inside a
 * pill: both rounded-full, so the corners nest at any height. No helper line
 * underneath: the two labels say it on their own.
 *
 * The highlight slides between options (motion layoutId, the transitions.dev
 * tabs-sliding pattern) on the app's --duration-fast / --ease-smooth-out
 * values, and jumps instead when the OS asks for reduced motion.
 */

import { useRef } from "react";
import { motion, useReducedMotion } from "motion/react";
import { FileText, ListOrdered } from "lucide-react";

const OPTIONS = [
  {
    withProcedure: false,
    label: "เฉพาะ JSA",
    Icon: FileText,
  },
  {
    withProcedure: true,
    label: "JSA + ขั้นตอนปฏิบัติงาน",
    Icon: ListOrdered,
  },
] as const;

export function ModeSwitch({
  withProcedure,
  onChange,
}: {
  withProcedure: boolean;
  onChange: (withProcedure: boolean) => void;
}) {
  const reduceMotion = useReducedMotion();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  // Radiogroup keyboard pattern: one tab stop, arrow keys move the choice
  // (and focus) — with only two options, any arrow just picks the other one
  const select = (index: number) => {
    onChange(OPTIONS[index].withProcedure);
    buttons.current[index]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label="เอกสารที่ต้องการสร้าง"
      className="grid grid-cols-2 gap-1 rounded-full border border-line bg-raised p-1"
    >
      {OPTIONS.map((option, index) => {
        const checked = option.withProcedure === withProcedure;
        return (
          <button
            key={option.label}
            ref={(el) => {
              buttons.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(option.withProcedure)}
            onKeyDown={(event) => {
              if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
                event.preventDefault();
                select(1 - index);
              }
            }}
            className={`relative flex min-h-10 items-center justify-center rounded-full px-2 text-sm font-medium
                        transition-colors focus-visible:outline-none focus-visible:ring-2
                        focus-visible:ring-ring/50 ${checked ? "text-navy" : "text-muted hover:text-ink"}`}
          >
            {checked ? (
              <motion.span
                layoutId="mode-switch-pill"
                className="absolute inset-0 rounded-full border border-line bg-surface shadow-sm"
                transition={reduceMotion ? { duration: 0 } : { duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                aria-hidden="true"
              />
            ) : null}
            <span className="relative flex items-center gap-1.5 text-center">
              {/* Icon dropped below sm: on a phone each option is ~170px and
                  the second label needs all of it to stay on one line */}
              <option.Icon className="size-4 shrink-0 max-sm:hidden" aria-hidden="true" />
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
