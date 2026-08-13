/* Step 2 — Review and edit
 *
 * No AI buttons on this page at all, whether per-field or automated review.
 * The user owns the data after generation — every field is editable, and if
 * they don't like the result they start over.
 */

import { useEffect, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import { ArrowRight, Info, Plus, RotateCcw } from "lucide-react";

import { Alert, Button, ConfirmDialog, Card, UndoToast } from "../../components/ui";
import { AutoGrowTextarea } from "../../components/ui";
import { formatThaiDate } from "../../lib/thaidate";
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

  const incomplete = doc.steps.some((step) => !step.procedure.trim());

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
          className="mt-1"
        />
        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <div className="flex gap-1.5">
            <dt className="text-muted">หัวหน้างาน:</dt>
            <dd className="font-medium text-ink">{doc.header.supervisor}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-muted">วันที่วิเคราะห์:</dt>
            <dd className="font-medium text-ink">
              {formatThaiDate(doc.header.analysis_date)}
            </dd>
          </div>
        </dl>
      </Card>

      {/* Column header matching the printed PDF table — desktop only, the
          step list itself repeats these labels per-step at narrower widths */}
      <div className="mt-4 hidden grid-cols-[35%_1fr_1fr] gap-0 px-1 text-sm font-medium text-muted lg:grid">
        <span>ขั้นตอนการทำงาน</span>
        <span>อันตรายที่อาจเกิดขึ้น</span>
        <span>มาตรการป้องกัน/ควบคุม</span>
      </div>

      <ul className="mt-2 grid list-none gap-3 p-0">
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

      <div className="mt-3">
        <Button
          variant="outline"
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
          มีขั้นตอนที่ยังไม่ได้กรอกชื่อ (ดูกรอบสีแดงด้านบน) กรุณากรอกให้ครบก่อนสร้างเอกสาร
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
          <Button variant="ghost" onClick={() => setConfirmRestart(true)}>
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
