import { Fragment } from "react";

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

export function Stepper({
  current,
  onNavigate,
}: {
  current: 0 | 1 | 2;
  // Completed steps only — jumping ahead to a step that has no data yet
  // isn't offered. Preserves whatever's in progress; callers should never
  // wire this to anything that clears the document.
  onNavigate?: (index: 0 | 1 | 2) => void;
}) {
  return (
    <nav aria-label="ขั้นตอนการทำงาน" className="mb-7">
      {/* Each step is its own natural width and the connector lines between them
          are the flex-1 elements — this spreads the extra space evenly between
          steps instead of trailing off after the last one */}
      <ol className="flex items-center">
        {STEPS.map((label, index) => {
          const done = index < current;
          const active = index === current;
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
      </ol>
    </nav>
  );
}
