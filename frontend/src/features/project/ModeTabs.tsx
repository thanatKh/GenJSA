/* งานเดียว / โครงการ — Single Mode vs Project Mode, at the top of the first screen
 *
 * Tabs, not another pill like ModeSwitch below it: ModeSwitch picks which
 * documents one job produces and leaves the form the same, while this swaps
 * the whole form and flow — the "different content" that tabs promise. So it
 * sits one level higher (above the page title) and looks like navigation (an
 * underline) rather than a setting, which keeps the two from reading as the
 * same control twice. Single Mode stays first and selected by default: most
 * users never touch this.
 *
 * Only on the first screen: once a job is under way its mode is fixed.
 */

import { useRef } from "react";
import { motion, useReducedMotion } from "motion/react";

import type { Mode } from "../../store";

const TABS: { mode: Mode; label: string }[] = [
  { mode: "single", label: "งานเดียว" },
  { mode: "project", label: "โครงการ" },
];

export function ModeTabs({ mode, onChange }: { mode: Mode; onChange: (mode: Mode) => void }) {
  const reduceMotion = useReducedMotion();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  return (
    <div role="tablist" aria-label="รูปแบบงาน" className="mb-4 flex gap-1 border-b border-line">
      {TABS.map((tab, index) => {
        const selected = tab.mode === mode;
        return (
          <button
            key={tab.mode}
            ref={(el) => {
              buttons.current[index] = el;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.mode)}
            onKeyDown={(event) => {
              // Tabs keyboard pattern: one tab stop, arrows move between tabs
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                const next = 1 - index;
                onChange(TABS[next].mode);
                buttons.current[next]?.focus();
              }
            }}
            className={`relative min-h-11 px-4 pb-2.5 pt-2 font-semibold transition-colors
                        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50
                        rounded-t-md ${selected ? "text-navy" : "text-muted hover:text-ink"}`}
          >
            {tab.label}
            {selected ? (
              // The underline slides between the tabs, like ModeSwitch's pill
              <motion.span
                layoutId="mode-tabs-underline"
                className="absolute inset-x-2 -bottom-px h-[3px] rounded-t-full bg-navy"
                transition={reduceMotion ? { duration: 0 } : { duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                aria-hidden="true"
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
