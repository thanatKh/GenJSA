import { ListOrdered } from "lucide-react";
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

/** Same 28px badge as StepCircle, but an icon instead of a number/check — used
 * only for the optional branch node below. The different glyph is deliberate:
 * a number would read as "step 4 of the same sequence", which the branch
 * explicitly isn't (see the Stepper doc comment). */
function BranchCircle() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 28 28"
      className="shrink-0"
      aria-hidden="true"
    >
      <circle cx="14" cy="14" r="14" className="fill-navy" />
      <foreignObject x="7" y="7" width="14" height="14">
        <ListOrdered className="size-3.5 text-white" strokeWidth={2.5} />
      </foreignObject>
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
 * and on a phone it split the branch label as "ขั้นตอนปฏิบัติ / งาน".
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
 * circle. "done" is navy, "todo" gray, "branch" the dashed line to the
 * optional procedure node. */
function Connectors({
  left,
  right,
}: {
  left: "done" | "todo" | "branch" | null;
  right: "done" | "todo" | "branch" | null;
}) {
  const style = (kind: "todo" | "branch") =>
    kind === "branch" ? "border-t border-dashed border-navy/50" : "border-t border-line";
  /** One half of a connector. "done" draws the navy line over the gray one
   * and grows it left to right, so moving to the next step fills the line
   * toward it; `delay` lets the second half (the one beside the step being
   * reached) follow the first. Mounted once for the whole session (it sits
   * outside the per-screen fade in App.tsx), so it plays on step changes. */
  const half = (kind: "done" | "todo" | "branch", position: string, delay: number) => (
    <span className={`absolute top-[14px] ${position}`} aria-hidden="true">
      <span className={`absolute inset-x-0 top-0 ${style(kind === "done" ? "todo" : kind)}`} />
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
  branch,
}: {
  current: 0 | 1 | 2;
  // Completed steps only — jumping ahead to a step that has no data yet
  // isn't offered. Preserves whatever's in progress; callers should never
  // wire this to anything that clears the document.
  onNavigate?: (index: 0 | 1 | 2) => void;
  /** The work procedure is optional and branches off step 3 rather than
   * extending the JSA wizard — giving it a permanent 4th circle would imply
   * the JSA isn't finished without it, which is false for most users. So this
   * node exists ONLY while the caller is actually on a procedure stage
   * (App.tsx passes it conditionally) — never rendered on stages 0-2, where
   * the plain 3-step track above is the whole story.
   *
   * Visually a branch, not a continuation: a dashed connector (not the solid
   * one between steps 1-3) and an icon badge (not a number) both say "this
   * peels off the main sequence" rather than "step 4 of 4". `label` names the
   * document the user is actually in; `onBack` is the one live action here —
   * back to the JSA PDF page — everything else on the procedure pages already
   * has its own navigation. */
  branch?: {
    label: string;
    onBack: () => void;
    /** True while the caller is actually rendering the procedure-editor
     * stage this node represents (stage 3) — the same page the node's own
     * `aria-current="step"` already claims. There, clicking it to jump back
     * to the JSA PDF page reads as "go back" on a node that visually says
     * "you are here", the same contradiction steps 1-3 avoid by rendering
     * their own active circle as plain text, not a button. False on the
     * procedure PDF stage (4), where the branch node is a real, different
     * destination one step behind and stays clickable. */
    isCurrent: boolean;
  };
}) {
  // Symmetric layout: every node gets an equal-width column (3, or 4 on the
  // procedure pages), its circle centered at the top and its title centered
  // underneath. This replaced titles placed BESIDE each circle, where every
  // step was as wide as its own title — a short "กรอกข้อมูล" and a long
  // "ตรวจทานและแก้ไข" put the circles at uneven positions with connector lines
  // of different lengths. Equal columns put every circle at an exact fraction
  // of the track and make every connector the same length.
  //
  // Titles wrap onto at most two centered lines instead of truncating, so
  // they stay readable even with 4 nodes on a phone (the old side-by-side
  // layout had to hide every label below sm: in that case).
  const nodes = branch ? STEPS.length + 1 : STEPS.length;

  return (
    <nav aria-label="ขั้นตอนการทำงาน" className="mb-5">
      <ol className={`grid ${nodes === 4 ? "grid-cols-4" : "grid-cols-3"}`}>
        {STEPS.map((label, index) => {
          // While on the procedure branch, the JSA truly is finished — all
          // three steps get the checkmark, not just the ones strictly before
          // `current`. Without the `branch` override, step 3 (index === current)
          // fell into neither "done" nor "active" once `active` below excluded
          // it, and rendered as a bare, unfilled circle showing "3" — looking
          // unfinished on a JSA that's actually complete.
          const done = branch ? index <= current : index < current;
          const active = index === current && !branch;
          const circle = <StepCircle n={index + 1} done={done} filled={done || active} />;
          return (
            <li key={label} className="relative flex min-w-0 justify-center">
              <Connectors
                left={index > 0 ? (index - 1 < current || !!branch ? "done" : "todo") : null}
                right={
                  index < STEPS.length - 1
                    ? index < current || !!branch
                      ? "done"
                      : "todo"
                    : branch
                      ? "branch"
                      : null
                }
              />
              {done && onNavigate ? (
                <button
                  type="button"
                  onClick={() => onNavigate(index as 0 | 1 | 2)}
                  aria-label={`กลับไปขั้นตอน ${label}`}
                  className={`${nodeClass} group rounded-md focus-visible:outline-none
                              focus-visible:ring-2 focus-visible:ring-ring/50`}
                >
                  {circle}
                  <span className={`${labelClass} text-muted group-hover:text-navy`}>
                    {label}
                  </span>
                </button>
              ) : (
                <div className={nodeClass}>
                  {circle}
                  <span
                    className={`${labelClass} ${active ? "font-semibold text-navy" : "text-muted"}`}
                    aria-current={active ? "step" : undefined}
                  >
                    {label}
                  </span>
                </div>
              )}
            </li>
          );
        })}

        {branch ? (
          <li className="relative flex min-w-0 justify-center">
            <Connectors left="branch" right={null} />
            {branch.isCurrent ? (
              // Inert, matching how steps 1-3 render their own active circle
              // as plain text rather than a button — this node's
              // aria-current="step" already tells the user they're here, so
              // it shouldn't also act as a "go back" link on itself.
              <div className={nodeClass}>
                <BranchCircle />
                <span className={`${labelClass} font-semibold text-navy`} aria-current="step">
                  {keepWordsTogether(branch.label)}
                </span>
              </div>
            ) : (
              <button
                type="button"
                onClick={branch.onBack}
                aria-label={`${branch.label} — กลับไปหน้าเอกสาร JSA`}
                className={`${nodeClass} rounded-md focus-visible:outline-none
                            focus-visible:ring-2 focus-visible:ring-ring/50`}
              >
                <BranchCircle />
                <span className={`${labelClass} font-semibold text-navy`}>
                  {keepWordsTogether(branch.label)}
                </span>
              </button>
            )}
          </li>
        ) : null}
      </ol>
    </nav>
  );
}
