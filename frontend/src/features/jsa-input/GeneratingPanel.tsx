/* Generating state — the LLM takes roughly TYPICAL_MIN..TYPICAL_MAX seconds
 *
 * Deliberately does *not* show a percentage or an ETA, since we don't actually
 * know the remaining time — a guessed number would be misleading. Instead it
 * shows three honest things: the typical range, a live count of seconds
 * elapsed, and a scripted activity log of what the AI is plausibly doing.
 *
 * That log is the load-bearing gimmick here — see generatingStages.ts's
 * header comment for why it's a wall-clock-paced narration, not real
 * telemetry: the backend makes one blocking call and returns once, whole,
 * with no intermediate status to report. Advancing on a timer rather than
 * real events is the same honesty trade-off the elapsed-seconds counter
 * already makes explicit (no fake progress bar) — this file just also has to
 * keep that trade-off honest at the presentation layer: a completed (✓) line
 * must never claim more than "the wait has gone on long enough that this
 * plausibly happened by now", never "the AI just told us this step finished".
 */

import { useEffect, useState } from "react";
import { CircleCheck, LoaderCircle, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { SkeletonCard } from "../../components/ui";
import { JSA_STAGES } from "./generatingStages";

// How long each log line stays "active" (spinning) before the next one
// appears and this one flips to done. 8 lines (JSA_STAGES) x 3.5s ≈ 28s of
// log to reveal against a real measured wait of ~10-30s (see
// TYPICAL_MIN/MAX_SECONDS below) — paced to spend the log's full length
// across a typical run instead of exhausting it in the first few seconds
// and sitting on the last line, spinning, for most of the wait.
const LINE_MS = 3500;

// The range quoted to the user, in seconds. Measured against the real
// ThaiLLM endpoint on 2026-09-20 via two independent methods that agreed:
//   `python scripts/model_bench.py -n 5` against config/ai.yaml's live
//   model (openthaigpt) — 5 rounds, 5.9-10.8s, median 8.6s — and a live
//   timed run through the actual app for detailed_model (qwen3.6-35b-a3b,
//   used when "วิเคราะห์อย่างละเอียด" is checked) — 10.1s twice. 10-30s
//   covers both with real headroom for a slow round (the same bench run
//   saw one candidate model spike to 36.5s) without overselling how long
//   this now actually takes.
//
// This file used to claim 60-180s, based on one much older sample (133s)
// against a since-changed model — re-measure with the command above and
// update these whenever config/ai.yaml's model changes, or the panel starts
// quietly lying about the wait again in either direction.
// Exported so callers that chain a second AI call (see COMBINED_STAGES) can
// derive an honest doubled range instead of re-declaring their own numbers
// that could drift from these.
export const TYPICAL_MIN_SECONDS = 10;
export const TYPICAL_MAX_SECONDS = 30;

/** 90 -> "1 นาที 30 วินาที", 45 -> "45 วินาที" */
function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (!minutes) return `${seconds} วินาที`;
  return seconds ? `${minutes} นาที ${seconds} วินาที` : `${minutes} นาที`;
}

/** 60,180 -> "1–3 นาที"; 10,30 -> "10–30 วินาที" — the unit is said once, not
 * on both ends. Two cases share that shape (whole minutes on both sides, or
 * plain seconds on both sides — the only two this app's real values ever
 * take: TYPICAL_MIN/MAX_SECONDS below, and COMBINED_STAGES' doubled range);
 * anything mixed (a minutes value paired with a seconds one) falls back to
 * formatDuration on each side, which does repeat the unit — an honest range
 * still beats a wrong compact one for a shape this file doesn't expect. */
function formatRange(minSeconds: number, maxSeconds: number): string {
  if (minSeconds % 60 === 0 && maxSeconds % 60 === 0) {
    return `${minSeconds / 60}–${maxSeconds / 60} นาที`;
  }
  if (minSeconds < 60 && maxSeconds < 60) {
    return `${minSeconds}–${maxSeconds} วินาที`;
  }
  return `${formatDuration(minSeconds)}–${formatDuration(maxSeconds)}`;
}

/** One line of the activity log. */
function LogLine({
  text,
  status,
}: {
  text: string;
  status: "done" | "active" | "pending";
}) {
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 6, filter: "blur(3px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="flex items-center gap-2.5"
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        {/* Three states, three icons — swapped rather than styled in place,
            so "done" reads as a genuine state change (a check that pops in),
            not a color fade on the same glyph. */}
        <AnimatePresence initial={false} mode="wait">
          {status === "done" ? (
            <motion.span
              key="done"
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.35, ease: [0.34, 1.36, 0.64, 1] }}
            >
              <CircleCheck className="size-4 text-navy" aria-hidden="true" />
            </motion.span>
          ) : status === "active" ? (
            <motion.span
              key="active"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.25 }}
            >
              <LoaderCircle
                className="size-4 animate-spin text-navy"
                aria-hidden="true"
              />
            </motion.span>
          ) : (
            <motion.span
              key="pending"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.25 }}
              className="size-1.5 rounded-full bg-line"
            />
          )}
        </AnimatePresence>
      </span>
      <span
        className={
          status === "pending"
            ? "text-sm text-muted"
            : status === "active"
              ? "t-shimmer-label text-sm font-medium"
              : "text-sm text-muted line-through decoration-line"
        }
        data-text={status === "active" ? text : undefined}
      >
        {text}
      </span>
    </motion.li>
  );
}

export function GeneratingPanel({
  onCancel,
  stages = JSA_STAGES,
  typicalMinSeconds = TYPICAL_MIN_SECONDS,
  typicalMaxSeconds = TYPICAL_MAX_SECONDS,
}: {
  onCancel?: () => void;
  /** What the wait is narrating — see PROCEDURE_STAGES */
  stages?: readonly string[];
  /** Override the quoted "โดยทั่วไปใช้เวลาประมาณ" range — needed when this
   * panel spans more than one AI call (see COMBINED_STAGES), where the
   * single-call default would undersell the real wait and make it look
   * stuck once elapsed time passes what was promised. */
  typicalMinSeconds?: number;
  typicalMaxSeconds?: number;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const stageCount = stages.length;

  useEffect(() => {
    const ticker = setInterval(() => {
      // Hold on the last line rather than looping back to the first — once
      // there are no more lines to reveal, the honest move is to let the
      // final one sit "active" (still spinning) for however long the real
      // request actually takes, not to pretend a new step started.
      setActiveIndex((current) => Math.min(current + 1, stageCount - 1));
    }, LINE_MS);
    const clock = setInterval(() => setElapsed((s) => s + 1), 1000);

    return () => {
      clearInterval(ticker);
      clearInterval(clock);
    };
  }, [stageCount]);

  const slow = elapsed >= typicalMaxSeconds;

  return (
    <section className="mt-6" aria-busy="true">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium text-ink">กำลังร่างเอกสาร</p>

        {onCancel ? (
          // Plain text link (not a Button) — matches the de-emphasized
          // secondary-action convention used elsewhere (กลับไปแก้ไข,
          // ข้ามขั้นตอนนี้): muted + dotted underline at rest, navy on hover,
          // so it reads as "leave this" rather than competing with the
          // generating status for attention. No confirm dialog — aborting
          // isn't destructive, the typed description is already saved in
          // inputDraft regardless of whether this call ever finishes.
          <button
            type="button"
            onClick={onCancel}
            className="flex shrink-0 items-center gap-1 text-sm text-muted underline decoration-dotted underline-offset-4 hover:text-navy"
          >
            <X className="size-3.5" aria-hidden="true" />
            ยกเลิก
          </button>
        ) : null}
      </div>

      {/* No aria-live here on purpose — the seconds tick every second, and a
          live region would read the whole line out loud each time */}
      <p className="mt-1.5 text-sm text-muted">
        โดยทั่วไปใช้เวลาประมาณ{" "}
        {formatRange(typicalMinSeconds, typicalMaxSeconds)} · ผ่านไปแล้ว{" "}
        <span className="font-medium tabular-nums text-ink">
          {formatDuration(elapsed)}
        </span>
      </p>
      <p className="mt-1 text-sm text-muted">
        {slow
          ? "ใช้เวลานานกว่าปกติ แต่ระบบยังทำงานอยู่ ไม่ได้ค้าง — กรุณาอย่าปิดหรือรีเฟรชหน้านี้"
          : "ระบบกำลังทำงานอยู่ กรุณาอย่าปิดหรือรีเฟรชหน้านี้ ข้อมูลที่กรอกไว้ยังอยู่ครบ"}
      </p>

      {/* The activity log itself — see this file's header comment and
          generatingStages.ts's for why this is a scripted, timer-paced
          narration and not a real trace of backend events. Rendered as a
          <ul>/aria-live region rather than a bare div list so a screen
          reader gets one polite announcement per line as it goes active,
          the same courtesy the old single-line version gave via its own
          aria-live paragraph. */}
      <ul
        aria-live="polite"
        aria-label="ขั้นตอนที่ระบบกำลังทำ"
        className="mt-4 grid list-none gap-2 rounded-[var(--radius)] border border-line bg-raised p-4"
      >
        <AnimatePresence initial={false}>
          {/* Only lines up to and including the active one are ever rendered
              — a "pending" status/dot exists in the type below for a design
              that shows the whole plan upfront, but this build reveals one
              line at a time instead (see the log's own doc comment); nothing
              currently reaches the pending branch in LogLine. */}
          {stages.slice(0, activeIndex + 1).map((text, index) => (
            <LogLine
              key={text}
              text={text}
              status={index < activeIndex ? "done" : "active"}
            />
          ))}
        </AnimatePresence>
      </ul>

      {/* Brought back: a skeleton of the document that's about to appear,
          shimmering for the whole wait — the activity log above says what's
          plausibly happening, this says "and here's roughly the shape of
          what you'll get", the same second reassurance every other loading
          state in the app gives (SkeletonCard, components/ui.tsx). Dropped
          when this panel was rebuilt as the activity-stream log; re-added
          because the log alone read as thinner than the rest of the app's
          own loading conventions once compared side by side. */}
      <div className="mt-4 grid gap-3">
        <SkeletonCard />
      </div>
    </section>
  );
}
