/* Generating state — the LLM takes roughly TYPICAL_MIN..TYPICAL_MAX seconds
 *
 * Deliberately does *not* show a percentage or an ETA, since we don't actually
 * know the remaining time — a guessed number would be misleading. Instead it
 * shows three honest things: the typical range, a live count of seconds
 * elapsed, and a description of the current stage. The elapsed counter is the
 * load-bearing one: a number that keeps ticking is proof the page is alive,
 * which a static "please wait" can never be.
 */

import { useEffect, useState } from "react";
import { LoaderCircle, X } from "lucide-react";
import { SkeletonCard } from "../../components/ui";

const STAGES = [
  "กำลังทำความเข้าใจงาน…",
  "กำลังแยกขั้นตอนหลัก…",
  "กำลังระบุอันตรายและมาตรการป้องกัน…",
  "กำลังจัดรูปแบบเอกสาร…",
] as const;

// Paced to spread the four messages across a typical wait rather than burning
// through them in 16s and then sitting on the last one for two minutes
const STAGE_MS = 12000;

// The range quoted to the user, in seconds. This file used to claim 10-60s;
// a timed run against the real ThaiLLM endpoint took 133s, so that was wrong
// and the panel was calling itself "slower than usual" during a perfectly
// normal wait. Quoting minutes also stops the number reading like a stopwatch
// the user should be counting against.
//
// This is ONE sample, so treat it as a floor on how long to promise, not a
// measured distribution. Re-measure with `python scripts/model_bench.py -n 10`
// (it reports latency per model) and update these whenever config/ai.yaml's
// model changes.
const TYPICAL_MIN_SECONDS = 60;
const TYPICAL_MAX_SECONDS = 180;

// Only call it slow once we're past the range we advertised — warning earlier
// than that would contradict the line right above it.
const SLOW_AFTER_SECONDS = TYPICAL_MAX_SECONDS;

/** 90 -> "1 นาที 30 วินาที", 45 -> "45 วินาที" */
function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (!minutes) return `${seconds} วินาที`;
  return seconds ? `${minutes} นาที ${seconds} วินาที` : `${minutes} นาที`;
}

/** 60,180 -> "1–3 นาที" — the unit is said once, not on both ends */
function formatRange(minSeconds: number, maxSeconds: number): string {
  const bothWholeMinutes = minSeconds % 60 === 0 && maxSeconds % 60 === 0;
  if (bothWholeMinutes) return `${minSeconds / 60}–${maxSeconds / 60} นาที`;
  return `${formatDuration(minSeconds)}–${formatDuration(maxSeconds)}`;
}

export function GeneratingPanel({ onCancel }: { onCancel?: () => void }) {
  const [stage, setStage] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const ticker = setInterval(() => {
      // Hold on the last message rather than looping back to the first, which would look stuck
      setStage((current) => Math.min(current + 1, STAGES.length - 1));
    }, STAGE_MS);
    const clock = setInterval(() => setElapsed((s) => s + 1), 1000);

    return () => {
      clearInterval(ticker);
      clearInterval(clock);
    };
  }, []);

  const slow = elapsed >= SLOW_AFTER_SECONDS;

  return (
    <section className="mt-6" aria-busy="true">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <LoaderCircle
            className="size-5 shrink-0 animate-spin text-navy"
            aria-hidden="true"
          />
          {/* aria-live lives on the <p>, reading the real text node — the
              shimmer span's ::before duplicate (index.css) is decoration only,
              not something a screen reader needs to see or announce twice. */}
          <p className="font-medium" aria-live="polite">
            <span className="t-shimmer-label" data-text={STAGES[stage]}>
              {STAGES[stage]}
            </span>
          </p>
        </div>

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
        {formatRange(TYPICAL_MIN_SECONDS, TYPICAL_MAX_SECONDS)} · ผ่านไปแล้ว{" "}
        <span className="font-medium tabular-nums text-ink">
          {formatDuration(elapsed)}
        </span>
      </p>
      <p className="mt-1 text-sm text-muted">
        {slow
          ? "ใช้เวลานานกว่าปกติ แต่ระบบยังทำงานอยู่ ไม่ได้ค้าง — กรุณาอย่าปิดหรือรีเฟรชหน้านี้"
          : "ระบบกำลังทำงานอยู่ กรุณาอย่าปิดหรือรีเฟรชหน้านี้ ข้อมูลที่กรอกไว้ยังอยู่ครบ"}
      </p>

      <div className="mt-4 grid gap-3">
        <SkeletonCard />
      </div>
    </section>
  );
}
