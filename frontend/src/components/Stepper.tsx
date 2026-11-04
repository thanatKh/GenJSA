import { motion } from "motion/react";

import { FADE_IN_CLASS } from "../lib/motion";

const STEPS = ["กรอกข้อมูล", "ตรวจทานและแก้ไข", "เอกสาร PDF"] as const;

/**
 * The step number/checkmark badge, drawn entirely as SVG.
 *
 * HTML+CSS text-in-a-circle (flex/grid centering, absolute+translate — all
 * tried) kept rendering the digit visibly off-center on some browsers,
 * because those techniques center a *text line box*, and a line box's
 * vertical extent depends on font metrics (ascent/descent/line-gap) that
 * vary by browser/font and don't align with a glyph's actual visual
 * center. SVG sidesteps this entirely: `text-anchor="middle"` and
 * `dominant-baseline="central"` position the glyph by its own rendered
 * bounding geometry at an exact coordinate — a math operation, not a text
 * layout one — so it can't drift the way HTML text-centering did.
 */
function StepCircle({
  n,
  done,
  filled,
}: {
  n: number;
  done: boolean;
  filled: boolean;
}) {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 28 28"
      className="shrink-0"
      aria-hidden="true"
    >
      <circle
        cx="14"
        cy="14"
        r="14"
        className={filled ? "fill-navy" : "fill-navy-soft"}
      />
      {done ? (
        <path
          className={FADE_IN_CLASS}
          d="M8.5 14.5l3.5 3.5 7.5-8"
          fill="none"
          stroke="white"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <text
          x="14"
          y="14.5"
          textAnchor="middle"
          dominantBaseline="central"
          className={filled ? "fill-white" : "fill-muted"}
          fontSize="13"
          fontWeight="600"
        >
          {n}
        </text>
      )}
    </svg>
  );
}

// One node: circle on top, title centered under it. `relative` without a
// z-index: positioned elements paint in DOM order, and the node comes after
// its column's connector lines, so it already sits above them. A z-10 here
// also lifted it above the sticky AppBar (also z-10, but earlier in the DOM),
// so the stepper drew over the bar while scrolling.
const nodeClass = "relative flex min-w-0 flex-col items-center gap-1.5 px-1";
const labelClass = "line-clamp-2 text-center text-xs leading-snug sm:text-sm";

/** Thai has no spaces, so the browser picks where a wrapped label breaks,
 * and on a phone it split "ขั้นตอนปฏิบัติงาน" as "ขั้นตอนปฏิบัติ / งาน".
 * Keeping "ปฏิบัติงาน" unbreakable moves the break to "ขั้นตอน / ปฏิบัติงาน". */
function keepWordsTogether(label: string) {
  return label.split(/(ปฏิบัติงาน)/).map((part, i) =>
    part === "ปฏิบัติงาน" ? (
      <span key={i} className="whitespace-nowrap">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

/** The two half-lines in one column, at the circles' vertical center (14px =
 * half of StepCircle's 28px). Each column draws the left half of the line
 * coming in and the right half of the line going out, so neighbouring halves
 * meet exactly at the column boundary — every connector ends up the same
 * length, edge of one circle to edge of the next, with an 8px gap at each
 * circle. "done" is navy, "todo" gray. */
function Connectors({
  left,
  right,
}: {
  left: "done" | "todo" | null;
  right: "done" | "todo" | null;
}) {
  /** One half of a connector. "done" draws the navy line over the gray one
   * and grows it left to right, so moving to the next step fills the line
   * toward it; `delay` lets the second half (the one beside the step being
   * reached) follow the first. Mounted once for the whole session (it sits
   * outside the per-screen fade in App.tsx), so it plays on step changes. */
  const half = (kind: "done" | "todo", position: string, delay: number) => (
    <span className={`absolute top-[14px] ${position}`} aria-hidden="true">
      <span className="absolute inset-x-0 top-0 border-t border-line" />
      {kind === "done" ? (
        <motion.span
          className="absolute inset-x-0 top-0 origin-left border-t border-navy"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.2, delay, ease: "easeOut" }}
        />
      ) : null}
    </span>
  );
  return (
    <>
      {left ? half(left, "left-0 right-1/2 mr-[22px]", 0.2) : null}
      {right ? half(right, "left-1/2 right-0 ml-[22px]", 0) : null}
    </>
  );
}

export function Stepper({
  current,
  onNavigate,
  steps = STEPS,
}: {
  current: number;
  // Completed steps only — jumping ahead to a step that has no data yet
  // isn't offered. Preserves whatever's in progress; callers should never
  // wire this to anything that clears the document.
  onNavigate?: (index: number) => void;
  /** The track's labels. Defaults to the JSA track's three; JSA + Procedure
   * and Project Mode pass their own four. */
  steps?: readonly string[];
}) {
  // Symmetric layout: every node gets an equal-width column (3 or 4), its circle centered at the top and its title centered
  // underneath. This replaced titles placed BESIDE each circle, where every
  // step was as wide as its own title — a short "กรอกข้อมูล" and a long
  // "ตรวจทานและแก้ไข" put the circles at uneven positions with connector lines
  // of different lengths. Equal columns put every circle at an exact fraction
  // of the track and make every connector the same length.
  //
  // Titles wrap onto at most two centered lines instead of truncating, so
  // they stay readable even with 4 nodes on a phone (the old side-by-side
  // layout had to hide every label below sm: in that case).
  return (
    <nav aria-label="ขั้นตอนการทำงาน" className="mb-5">
      <ol className={`grid ${steps.length === 4 ? "grid-cols-4" : "grid-cols-3"}`}>
        {steps.map((label, index) => {
          const done = index < current;
          const active = index === current;
          const circle = <StepCircle n={index + 1} done={done} filled={done || active} />;
          return (
            <li key={label} className="relative flex min-w-0 justify-center">
              <Connectors
                left={index > 0 ? (index - 1 < current ? "done" : "todo") : null}
                right={index < steps.length - 1 ? (index < current ? "done" : "todo") : null}
              />
              {done && onNavigate ? (
                <button
                  type="button"
                  onClick={() => onNavigate(index)}
                  aria-label={`กลับไปขั้นตอน ${label}`}
                  className={`${nodeClass} group rounded-md focus-visible:outline-none
                              focus-visible:ring-2 focus-visible:ring-ring/50`}
                >
                  {circle}
                  <span className={`${labelClass} text-muted group-hover:text-navy`}>
                    {keepWordsTogether(label)}
                  </span>
                </button>
              ) : (
                <div className={nodeClass}>
                  {circle}
                  <span
                    className={`${labelClass} ${active ? "font-semibold text-navy" : "text-muted"}`}
                    aria-current={active ? "step" : undefined}
                  >
                    {keepWordsTogether(label)}
                  </span>
                </div>
              )}
            </li>
          );
        })}

      </ol>
    </nav>
  );
}
