/* Step 2 — Review and edit
 *
 * No AI buttons on this page at all, whether per-field or automated review.
 * The user owns the data after generation — every field is editable, and if
 * they don't like the result they start over.
 */

import { useEffect, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import { ArrowRight, Info, Plus, RotateCcw } from "lucide-react";

import {
  Alert,
  AutoGrowTextarea,
  Button,
  ConfirmDialog,
  Card,
  Input,
  UndoToast,
} from "../../components/ui";
import { ThaiDatePicker } from "../../components/ThaiDatePicker";
import type { JsaDocument, JsaStep } from "../../lib/schema";
import { docDraft } from "../../store";
import { StepCard } from "./StepCard";

const UNDO_TIMEOUT_MS = 6000;

// What's needed to put a deleted step or hazard back exactly where it was
type PendingDelete =
  | { kind: "step"; index: number; step: JsaStep; message: string }
  | {
      kind: "hazard";
      stepIndex: number;
      hazardIndex: number;
      hazard: JsaStep["hazards"][number];
      message: string;
    };

// Mirrors backend/app/models/jsa.py's JsaHeader.work_activity max_length
const WORK_ACTIVITY_MAX = 500;

const EMPTY_STEP: Omit<JsaStep, "no"> = {
  procedure: "",
  details: "",
  hazards: [{ hazard: "", controls: [""] }],
};

export function EditorStep({
  doc,
  onChange,
  onContinue,
  onStartOver,
  error,
}: {
  doc: JsaDocument;
  onChange: (next: JsaDocument) => void;
  onContinue: () => void;
  onStartOver: () => void;
  error: string | null;
}) {
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [liveMessage, setLiveMessage] = useState("");
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    docDraft.save(doc);
  }, [doc]);

  useEffect(() => () => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
  }, []);

  const setSteps = (steps: JsaStep[]) =>
    onChange({ ...doc, steps: steps.map((step, i) => ({ ...step, no: i + 1 })) });

  const moveStep = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= doc.steps.length) return;
    const steps = [...doc.steps];
    [steps[index], steps[target]] = [steps[target], steps[index]];
    setSteps(steps);
    // Keyboard/screen reader users need to know the move succeeded
    setLiveMessage(`ย้ายขั้นตอนไปอยู่ลำดับที่ ${target + 1}`);
  };

  const armUndo = (pending: PendingDelete) => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setPendingDelete(pending);
    undoTimer.current = setTimeout(() => setPendingDelete(null), UNDO_TIMEOUT_MS);
  };

  const removeStep = (index: number) => {
    const step = doc.steps[index];
    setSteps(doc.steps.filter((_, i) => i !== index));
    armUndo({
      kind: "step",
      index,
      step,
      message: `ลบขั้นตอนที่ ${index + 1} แล้ว`,
    });
  };

  const removeHazard = (stepIndex: number, hazardIndex: number) => {
    const step = doc.steps[stepIndex];
    const hazard = step.hazards[hazardIndex];
    setSteps(
      doc.steps.map((s, i) =>
        i === stepIndex
          ? { ...s, hazards: s.hazards.filter((_, hi) => hi !== hazardIndex) }
          : s,
      ),
    );
    armUndo({
      kind: "hazard",
      stepIndex,
      hazardIndex,
      hazard,
      message: "ลบอันตรายนี้แล้ว",
    });
  };

  const undoDelete = () => {
    if (!pendingDelete) return;
    if (undoTimer.current) clearTimeout(undoTimer.current);

    if (pendingDelete.kind === "step") {
      const steps = [...doc.steps];
      steps.splice(pendingDelete.index, 0, pendingDelete.step);
      setSteps(steps);
    } else {
      const { stepIndex, hazardIndex, hazard } = pendingDelete;
      setSteps(
        doc.steps.map((s, i) => {
          if (i !== stepIndex) return s;
          const hazards = [...s.hazards];
          hazards.splice(hazardIndex, 0, hazard);
          return { ...s, hazards };
        }),
      );
    }
    setPendingDelete(null);
  };

  // Supervisor is required on step 1 (inputFormSchema.supervisor.min(1)), but
  // that only stops it arriving here empty — once it's editable in this step
  // too (see the header card below), nothing else was re-checking it, so a
  // cleared field could sail through to a PDF with a blank sign-off name.
  const missingSupervisor = !doc.header.supervisor.trim();
  const missingSteps = doc.steps.some((step) => !step.procedure.trim());
  const incomplete = missingSupervisor || missingSteps;

  return (
    <section>
      <h1 className="text-[1.75rem] font-semibold text-navy">ตรวจทานและแก้ไข</h1>
      <p className="mt-1.5 text-muted">
        เอกสารนี้ระบบร่างให้เป็นจุดเริ่มต้น{" "}
        <strong className="font-semibold text-ink">
          ผู้ปฏิบัติงานและหัวหน้างานเป็นผู้ตรวจสอบและรับผิดชอบเนื้อหา
        </strong>{" "}
        โปรดอ่านทุกขั้นตอนและแก้ให้ตรงกับงานจริงก่อนนำไปใช้
      </p>

      <Card className="mt-6">
        <label htmlFor="work_activity" className="text-sm font-medium text-muted">
          งาน/กิจกรรม
        </label>
        <AutoGrowTextarea
          id="work_activity"
          minRows={1}
          maxRows={4}
          maxLength={WORK_ACTIVITY_MAX}
          value={doc.header.work_activity}
          onChange={(event) =>
            onChange({
              ...doc,
              header: { ...doc.header, work_activity: event.target.value },
            })
          }
          // py-2 (not the default py-2.5) so one row lands at exactly 44px —
          // 1 * 28px line-height + 16px padding — matching the Input fields
          // below it (h-11) instead of sitting ~4-20px taller
          className="mt-1 py-2"
        />

        {/* Editable, not read-only <dd>s — a typo here used to mean "เริ่มใหม่"
            and losing the whole AI draft, since this was the only place these
            three fields could ever be fixed after step 1. ผู้วิเคราะห์ in
            particular wasn't shown anywhere in this step before, so a mistake
            there wasn't caught until the printed PDF. */}
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="supervisor" className="text-sm font-medium text-muted">
              หัวหน้างาน<span className="ml-0.5 text-danger-text">*</span>
            </label>
            <Input
              id="supervisor"
              autoComplete="name"
              aria-invalid={missingSupervisor}
              value={doc.header.supervisor}
              onChange={(event) =>
                onChange({
                  ...doc,
                  header: { ...doc.header, supervisor: event.target.value },
                })
              }
              className="mt-1"
            />
          </div>
          <div>
            <label htmlFor="analysis_date" className="text-sm font-medium text-muted">
              วันที่วิเคราะห์
            </label>
            <div className="mt-1">
              <ThaiDatePicker
                id="analysis_date"
                value={doc.header.analysis_date}
                onChange={(next) =>
                  onChange({
                    ...doc,
                    header: { ...doc.header, analysis_date: next },
                  })
                }
              />
            </div>
          </div>
          <div>
            <label htmlFor="analyst" className="text-sm font-medium text-muted">
              ผู้วิเคราะห์
            </label>
            <Input
              id="analyst"
              autoComplete="name"
              value={doc.header.analyst}
              onChange={(event) =>
                onChange({
                  ...doc,
                  header: { ...doc.header, analyst: event.target.value },
                })
              }
              className="mt-1"
            />
          </div>
        </div>
      </Card>

      {/* Column header matching the printed PDF table — desktop only, the
          step list itself repeats these labels per-step at narrower widths.
          Shaded and fully bordered (bg-raised, matching the hazard/controls
          cell tint) plus lg:mt-0 on the frame below so this reads as the
          table's own header row, not a caption floating above it — the two
          share one border line and one rectangle. Kept as a sibling of <ul>
          rather than its first row: the frame below is lg:overflow-hidden
          for its rounded corners, which would clip this if it lived inside
          it while lg:sticky. Sticky under the app bar (lg only, so always
          past the sm breakpoint — see --appbar-h in tokens.css) so the three
          column meanings stay visible while scrolling a long JSA. */}
      <div className="mt-4 hidden grid-cols-[35%_1fr_1fr] gap-0 px-1 text-center text-sm font-medium text-muted lg:grid lg:grid-cols-[3rem_35%_1fr_1fr] lg:sticky lg:top-[var(--appbar-h)] lg:z-[5] lg:rounded-t-[var(--radius)] lg:border lg:border-b-0 lg:border-line lg:bg-raised lg:px-2 lg:py-2 lg:font-semibold lg:text-ink">
        {/* Blank corner cell, Excel-style — matches StepCard.tsx's row-number gutter column */}
        <span aria-hidden="true" />
        <span>ขั้นตอนการทำงาน</span>
        <span>อันตรายที่อาจเกิดขึ้น</span>
        <span>
          มาตรการป้องกัน/ควบคุม
          <span className="block text-xs font-normal text-muted/80">
            พิมพ์หนึ่งมาตรการต่อบรรทัด
          </span>
        </span>
      </div>

      {/* Below lg: unchanged gap-separated cards. On lg: one continuous
          table — this frame owns the border/rounding, and each StepCard
          becomes a row inside it (see StepCard.tsx's own lg: classes).
          lg:mt-0 butts it directly against the header row above so their
          shared border is one line, not two with a gap between. */}
      {/* No lg:rounded-b here — the add-step row below is the frame's actual
          visual bottom (it owns its own rounded-b and sits flush against
          this <ul>'s bottom border as their shared divider line). Rounding
          this element's own bottom corners too would curve them away right
          at that seam, leaving a gap in the add-step row's side borders
          exactly where they're supposed to line up straight. */}
      <ul className="mt-2 grid list-none gap-2 p-0 lg:mt-0 lg:gap-0 lg:overflow-hidden lg:border lg:border-line">
        <AnimatePresence initial={false}>
          {doc.steps.map((step, index) => (
            <StepCard
              key={`${index}-${step.no}`}
              step={step}
              index={index}
              total={doc.steps.length}
              incomplete={!step.procedure.trim()}
              onChange={(next) =>
                setSteps(doc.steps.map((s, i) => (i === index ? next : s)))
              }
              onRemove={() => removeStep(index)}
              onRemoveHazard={(hazardIndex) => removeHazard(index, hazardIndex)}
              onMove={(direction) => moveStep(index, direction)}
            />
          ))}
        </AnimatePresence>
      </ul>

      <p className="sr-only" role="status" aria-live="polite">
        {liveMessage}
      </p>

      {/* On lg, visually fused to the table frame above (negative margin +
          matching side borders, rounded only at the bottom) so it reads as
          the table's own last row rather than a detached control */}
      <div className="mt-3 lg:mt-0 lg:-translate-y-px lg:rounded-b-[var(--radius)] lg:border lg:border-t-0 lg:border-line lg:px-2 lg:py-1.5">
        <Button
          variant="outline"
          className="lg:h-8 lg:w-full lg:justify-start lg:border-0 lg:px-1 lg:text-sm lg:font-normal lg:text-muted lg:hover:bg-raised lg:hover:text-ink"
          onClick={() =>
            setSteps([...doc.steps, { ...EMPTY_STEP, no: doc.steps.length + 1 }])
          }
        >
          <Plus className="size-4" aria-hidden="true" />
          เพิ่มขั้นตอน
        </Button>
      </div>

      {doc.assumptions.length > 0 ? (
        <div className="mt-6 rounded-[var(--radius)] border border-[var(--warning-border)] bg-[var(--warning-soft)] p-4">
          <h2 className="flex items-center gap-2 font-medium text-[var(--warning-text)]">
            <Info className="size-5 text-[var(--warning)]" aria-hidden="true" />
            ข้อสันนิษฐานที่ระบบใช้ — กรุณาตรวจสอบ
          </h2>
          <p className="mt-1 text-sm text-[var(--warning-text)]">
            ข้อมูลเหล่านี้ไม่ได้ระบุมาในรายละเอียดงาน กรุณาตรวจสอบว่าตรงกับหน้างานจริง
            (ส่วนนี้ไม่ถูกพิมพ์ลงเอกสาร)
          </p>
          <ul className="mt-2 grid gap-1 pl-5 text-sm text-[var(--warning-text)]">
            {doc.assumptions.map((assumption, index) => (
              <li key={index} className="list-disc">
                {assumption}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? (
        <div className="mt-6">
          <Alert>{error}</Alert>
        </div>
      ) : null}

      {incomplete ? (
        <p className="mt-6 text-sm text-danger-text">
          {missingSupervisor && missingSteps
            ? "กรุณากรอกชื่อหัวหน้างาน และกรอกขั้นตอนการทำงานที่ยังไม่ได้กรอกให้ครบ (ดูเครื่องหมายเตือนสีแดงด้านบน) ก่อนสร้างเอกสาร"
            : missingSupervisor
              ? "กรุณากรอกชื่อหัวหน้างานก่อนสร้างเอกสาร"
              : "มีขั้นตอนที่ยังไม่ได้กรอกชื่อ (ดูเครื่องหมายเตือนสีแดงด้านบน) กรุณากรอกให้ครบก่อนสร้างเอกสาร"}
        </p>
      ) : null}

      {/* Spacer so the fixed bar below doesn't cover the last bit of content */}
      <div className="h-20" aria-hidden="true" />

      {/* Fixed rather than a normal-flow footer — on a long document (many
          steps) these actions used to only be reachable by scrolling all the
          way down every time; keeping them pinned means "restart" and
          "generate PDF" are always one tap away while reviewing. */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-[60rem] flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          {/* size="lg" — matching the primary button, not the app-wide 44px
              default, so the two don't sit at different heights in the same
              row (ghost's low visual weight already keeps it secondary) */}
          <Button variant="ghost" size="lg" onClick={() => setConfirmRestart(true)}>
            <RotateCcw className="size-4" aria-hidden="true" />
            เริ่มใหม่
          </Button>
          <Button size="lg" onClick={onContinue} disabled={incomplete}>
            สร้าง PDF
            <ArrowRight className="size-5" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmRestart}
        title="เริ่มใหม่?"
        description="JSA ที่แก้ไว้จะหายไป แล้วกลับไปหน้ากรอกรายละเอียดงาน"
        confirmLabel="เริ่มใหม่"
        onConfirm={() => {
          setConfirmRestart(false);
          onStartOver();
        }}
        onCancel={() => setConfirmRestart(false)}
      />

      <UndoToast
        open={pendingDelete !== null}
        message={pendingDelete?.message ?? ""}
        onUndo={undoDelete}
      />
    </section>
  );
}
