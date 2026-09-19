import { Fragment } from "react";
import { ListOrdered } from "lucide-react";

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
  branch?: { label: string; onBack: () => void };
}) {
  return (
    <nav aria-label="ขั้นตอนการทำงาน" className="mb-7">
      {/* Each step is its own natural width and the connector lines between them
          are the flex-1 elements — this spreads the extra space evenly between
          steps instead of trailing off after the last one */}
      <ol className="flex items-center">
        {STEPS.map((label, index) => {
          // While on the procedure branch, the JSA truly is finished — all
          // three steps get the checkmark, not just the ones strictly before
          // `current`. Without the `branch` override, step 3 (index === current)
          // fell into neither "done" nor "active" once `active` below excluded
          // it, and rendered as a bare, unfilled circle showing "3" — looking
          // unfinished on a JSA that's actually complete.
          const done = branch ? index <= current : index < current;
          const active = index === current && !branch;
          return (
            <Fragment key={label}>
              <li className="flex min-w-0 shrink items-center gap-1.5 sm:shrink-0 sm:gap-2">
                {done && onNavigate ? (
                  <button
                    type="button"
                    onClick={() => onNavigate(index as 0 | 1 | 2)}
                    aria-label={`กลับไปขั้นตอน ${label}`}
                    className="flex min-w-0 items-center gap-1.5 rounded-md
                               focus-visible:outline-none focus-visible:ring-2
                               focus-visible:ring-ring/50 sm:gap-2"
                  >
                    <StepCircle n={index + 1} done={done} filled={done || active} />
                    <span className="truncate text-xs text-muted hover:text-navy sm:text-sm">
                      {label}
                    </span>
                  </button>
                ) : (
                  <>
                    <StepCircle n={index + 1} done={done} filled={done || active} />
                    {/* All three labels always shown — hiding inactive ones made
                        step 1 (active, with its label) much wider than steps 2/3
                        (bare circles), which pushed the flex-1 connector lines'
                        midpoints off-center from what the eye expects, making
                        circle 2 look mis-centered even though the flex math was
                        technically correct. Equal-width items keep the circles
                        landing at true equal thirds of the track. */}
                    <span
                      className={[
                        "truncate text-xs sm:text-sm",
                        active ? "font-semibold text-navy" : "text-muted",
                      ].join(" ")}
                      aria-current={active ? "step" : undefined}
                    >
                      {label}
                    </span>
                  </>
                )}
              </li>
              {index < STEPS.length - 1 ? (
                <li
                  className={[
                    "mx-1 h-px flex-1 sm:mx-3",
                    index < current ? "bg-navy" : "bg-line",
                  ].join(" ")}
                  aria-hidden="true"
                />
              ) : null}
            </Fragment>
          );
        })}

        {branch ? (
          <>
            {/* Dashed, not solid like steps 1-3 — the line style itself signals
                "branch", readable even before the eye reaches the icon badge. */}
            <li
              className="mx-1 h-px flex-1 border-t border-dashed border-navy/50 sm:mx-3"
              aria-hidden="true"
            />
            <li className="flex min-w-0 shrink items-center gap-1.5 sm:shrink-0 sm:gap-2">
              <button
                type="button"
                onClick={branch.onBack}
                aria-label={`${branch.label} — กลับไปหน้าเอกสาร JSA`}
                className="flex min-w-0 items-center gap-1.5 rounded-md
                           focus-visible:outline-none focus-visible:ring-2
                           focus-visible:ring-ring/50 sm:gap-2"
              >
                <BranchCircle />
                <span
                  className="truncate text-xs font-semibold text-navy sm:text-sm"
                  aria-current="step"
                >
                  {branch.label}
                </span>
              </button>
            </li>
          </>
        ) : null}
      </ol>
    </nav>
  );
}
