import { Fragment } from "react";
import { Check } from "lucide-react";

const STEPS = ["กรอกข้อมูล", "ตรวจทานและแก้ไข", "เอกสาร PDF"] as const;

export function Stepper({ current }: { current: 0 | 1 | 2 }) {
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
              <li className="flex shrink-0 items-center gap-2">
                <span
                  className={[
                    "flex size-7 shrink-0 items-center justify-center rounded-full",
                    "text-sm font-semibold",
                    done
                      ? "bg-navy text-white"
                      : active
                        ? "bg-navy text-white"
                        : "bg-navy-soft text-muted",
                  ].join(" ")}
                  aria-hidden="true"
                >
                  {done ? <Check className="size-4" /> : index + 1}
                </span>
                <span
                  className={[
                    "whitespace-nowrap text-sm",
                    active ? "font-semibold text-navy" : "text-muted",
                    // Step labels take up room on mobile — show only the active one
                    active ? "inline" : "hidden sm:inline",
                  ].join(" ")}
                  aria-current={active ? "step" : undefined}
                >
                  {label}
                </span>
              </li>
              {index < STEPS.length - 1 ? (
                <li
                  className={[
                    "mx-1.5 h-px flex-1 sm:mx-3",
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
