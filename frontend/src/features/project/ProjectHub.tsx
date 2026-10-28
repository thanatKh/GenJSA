/* Project Mode, step 2 — JSA แต่ละขั้นตอน
 *
 * The project's phases in order, each with its JSA's state: not drafted yet,
 * drafted and waiting for review, or reviewed. Drafting happens here (one
 * phase or all of them, see usePhaseDrafting.ts); reviewing opens the normal
 * JSA editor. The procedure and the files come after every JSA is reviewed.
 */

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, Check, FileText, PenLine, Sparkles, X } from "lucide-react";

import { Alert, Button } from "../../components/ui";
import { type SaveState, SaveStatus } from "../../components/SaveStatus";
import { fadeSwap, listItem } from "../../lib/motion";
import type { ProjectDocument, ProjectPhase } from "../../lib/schema";
import type { PhaseDrafting } from "./usePhaseDrafting";

/** m:ss since `since`, ticking every second — how long this draft has taken */
export function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  return (
    <span className="tabular-nums">
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
    </span>
  );
}

function StatusChip({ phase, drafting, waiting }: { phase: ProjectPhase; drafting: boolean; waiting: boolean }) {
  const base = "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium";
  if (drafting) return <span className={`${base} border-navy/30 bg-navy-soft text-navy`}>กำลังร่าง…</span>;
  if (waiting) return <span className={`${base} border-line bg-raised text-muted`}>รอคิว</span>;
  if (!phase.jsa) return <span className={`${base} border-line bg-raised text-muted`}>ยังไม่ได้ร่าง</span>;
  if (!phase.reviewed)
    return (
      <span className={`${base} border-[var(--warning-border)] bg-[var(--warning-soft)] text-[var(--warning-text)]`}>
        ร่างแล้ว รอตรวจทาน
      </span>
    );
  return (
    <span className={`${base} border-[#bfe6cc] bg-[#effaf3] text-[#0f6b31]`}>
      <Check className="size-3" aria-hidden="true" />
      ตรวจแล้ว · {phase.jsa.steps.length} ขั้นตอน
    </span>
  );
}

export function ProjectHub({
  project,
  drafting,
  saveState,
  onOpen,
  onManual,
  onEditProject,
  onProcedure,
}: {
  project: ProjectDocument;
  drafting: PhaseDrafting;
  saveState: SaveState;
  onOpen: (phaseId: string) => void;
  onManual: (phaseId: string) => void;
  onEditProject: () => void;
  /** On to the project's work procedure — offered once every JSA is reviewed */
  onProcedure: () => void;
}) {
  const busy = drafting.current !== null;
  const undrafted = project.phases.filter((phase) => !phase.jsa).map((phase) => phase.id);
  const reviewed = project.phases.filter((phase) => phase.jsa && phase.reviewed).length;
  const allReviewed = project.phases.length > 0 && reviewed === project.phases.length;

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h1 className="text-2xl font-semibold text-navy sm:text-[1.75rem]">JSA แต่ละขั้นตอน</h1>
        <SaveStatus state={saveState} />
      </div>
      <p className="mt-1.5 font-medium text-ink">{project.name}</p>
      <p className="mt-0.5 text-sm text-muted">
        ตรวจแล้ว {reviewed} จาก {project.phases.length} ขั้นตอน
      </p>

      {undrafted.length > 1 && !busy ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-raised p-3 sm:p-4">
          <p className="text-sm text-muted">
            ร่างทีละขั้นตอนตามลำดับ ระหว่างรอตรวจทานขั้นตอนที่ร่างเสร็จแล้วได้
          </p>
          <Button type="button" onClick={() => drafting.draft(undrafted)}>
            <Sparkles className="size-4" aria-hidden="true" />
            ร่าง JSA ที่เหลือทั้งหมด ({undrafted.length})
          </Button>
        </div>
      ) : null}

      <ol className="mt-4 grid list-none gap-3 p-0">
        {project.phases.map((phase, index) => {
          const isDrafting = drafting.current === phase.id;
          const isWaiting = drafting.queued.includes(phase.id);
          const error = drafting.errors[phase.id];
          return (
            <motion.li
              key={phase.id}
              {...listItem}
              className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 rounded-card border border-line bg-surface p-3 sm:grid-cols-[2rem_minmax(0,1fr)_auto] sm:p-4"
            >
              <span className="flex size-8 items-center justify-center rounded-full bg-navy-soft text-sm font-semibold text-navy">
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className="font-medium text-ink">{phase.work || `ขั้นตอนที่ ${index + 1}`}</p>
                {!phase.jsa && phase.description ? (
                  <p className="mt-0.5 line-clamp-2 text-sm text-muted">{phase.description}</p>
                ) : null}
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <StatusChip phase={phase} drafting={isDrafting} waiting={isWaiting} />
                  {isDrafting ? (
                    <span className="text-sm text-muted">
                      <Elapsed since={drafting.startedAt} /> · ปกติใช้เวลา 1–3 นาที
                    </span>
                  ) : null}
                </div>
                {error ? (
                  <div className="mt-2">
                    <Alert>{error}</Alert>
                  </div>
                ) : null}
              </div>

              {/* Actions: below the text on a phone, beside it from sm */}
              <div className="col-span-2 mt-3 flex flex-wrap items-center justify-end gap-2 sm:col-span-1 sm:mt-0 sm:self-center">
                <AnimatePresence initial={false} mode="wait">
                  {isDrafting ? (
                    <motion.div key="cancel" {...fadeSwap}>
                      <Button type="button" variant="outline" onClick={drafting.cancel}>
                        <X className="size-4" aria-hidden="true" />
                        ยกเลิก
                      </Button>
                    </motion.div>
                  ) : phase.jsa ? (
                    <motion.div key="open" {...fadeSwap}>
                      <Button
                        type="button"
                        variant={phase.reviewed ? "outline" : "default"}
                        onClick={() => onOpen(phase.id)}
                        aria-label={`${phase.reviewed ? "เปิด" : "ตรวจทาน"} JSA ของ ${phase.work}`}
                      >
                        <FileText className="size-4" aria-hidden="true" />
                        {phase.reviewed ? "เปิด JSA" : "ตรวจทาน"}
                      </Button>
                    </motion.div>
                  ) : isWaiting ? null : (
                    <motion.div key="draft" {...fadeSwap} className="flex flex-wrap justify-end gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => onManual(phase.id)}
                        aria-label={`กรอก JSA ของ ${phase.work || `ขั้นตอนที่ ${index + 1}`} เอง`}
                      >
                        <PenLine className="size-4" aria-hidden="true" />
                        กรอกเอง
                      </Button>
                      <Button type="button" disabled={busy} onClick={() => drafting.draft([phase.id])}>
                        <Sparkles className="size-4" aria-hidden="true" />
                        ร่าง JSA
                      </Button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.li>
          );
        })}
      </ol>

      {busy && drafting.queued.length > 0 ? (
        <div className="mt-3 flex justify-end">
          <Button type="button" variant="ghost" onClick={drafting.cancel}>
            หยุดร่างที่เหลือ ({drafting.queued.length})
          </Button>
        </div>
      ) : null}

      <div className="mt-6 flex items-center justify-between gap-2 border-t border-line pt-4">
        <Button type="button" variant="ghost" size="lg" onClick={onEditProject} disabled={busy}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          ข้อมูลโครงการ
        </Button>
        <Button type="button" size="lg" disabled={!allReviewed || busy} onClick={onProcedure}>
          ขั้นตอนปฏิบัติงาน
          <ArrowRight className="size-5" aria-hidden="true" />
        </Button>
      </div>
      {allReviewed ? null : (
        <p className="mt-2 text-right text-sm text-muted">ตรวจทาน JSA ให้ครบทุกขั้นตอนก่อน</p>
      )}
    </section>
  );
}
