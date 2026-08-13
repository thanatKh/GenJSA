/* Generating state — the LLM takes 10-60 seconds
 *
 * Deliberately does *not* show a percentage, since we don't actually know
 * the remaining time — a guessed number would be misleading. Uses an
 * indeterminate shimmer plus a description of the current stage instead.
 */

import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { SkeletonCard } from "../../components/ui";

const STAGES = [
  "กำลังทำความเข้าใจงาน…",
  "กำลังแยกขั้นตอนหลัก…",
  "กำลังระบุอันตรายและมาตรการป้องกัน…",
  "กำลังจัดรูปแบบเอกสาร…",
] as const;

const STAGE_MS = 4000;
const SLOW_AFTER_MS = 45000;

export function GeneratingPanel() {
  const [stage, setStage] = useState(0);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const ticker = setInterval(() => {
      // Hold on the last message rather than looping back to the first, which would look stuck
      setStage((current) => Math.min(current + 1, STAGES.length - 1));
    }, STAGE_MS);
    const slowTimer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);

    return () => {
      clearInterval(ticker);
      clearTimeout(slowTimer);
    };
  }, []);

  return (
    <section className="mt-6" aria-busy="true">
      <div className="flex items-center gap-2.5">
        <LoaderCircle
          className="size-5 shrink-0 animate-spin text-navy"
          aria-hidden="true"
        />
        <p className="text-navy font-medium" aria-live="polite">
          {STAGES[stage]}
        </p>
      </div>
      {slow ? (
        <p className="mt-1 text-sm text-muted">
          ใช้เวลานานกว่าปกติ กำลังรออยู่ ยังไม่ต้องปิดหน้านี้
        </p>
      ) : null}

      <div className="mt-4 grid gap-3">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </section>
  );
}
