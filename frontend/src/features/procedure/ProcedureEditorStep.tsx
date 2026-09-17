/* Review and edit the AI-drafted work procedure before exporting it.
 *
 * Simpler than the JSA's EditorStep by design. The step list belongs to the
 * JSA — this document only fills in the how-to underneath — so step titles are
 * read-only here and the user is pointed back to the JSA editor to change
 * them. That keeps the two documents from drifting into disagreement about
 * what the job's steps even are.
 */

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, FileText, Info, Plus, Trash2, TriangleAlert } from "lucide-react";

import {
  Alert,
  AutoGrowTextarea,
  Button,
  Card,
  Label,
  UndoToast,
} from "../../components/ui";
import type { ProcedureDocument, SubStep } from "../../lib/schema";

// Same undo window as EditorStep's step/hazard deletion
const UNDO_TIMEOUT_MS = 6000;

type PendingDelete = { label: string; restore: () => void };

export function ProcedureEditorStep({
  procedure,
  onChange,
  onContinue,
  onBack,
  stale,
  error,
}: {
  procedure: ProcedureDocument;
  onChange: (next: ProcedureDocument) => void;
  onContinue: () => void;
  onBack: () => void;
  /** The JSA's steps changed after this procedure was generated */
  stale: boolean;
  error: string | null;
}) {
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    };
  }, []);

  const armUndo = (pending: PendingDelete) => {
    setPendingDelete(pending);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setPendingDelete(null), UNDO_TIMEOUT_MS);
  };

  const patch = (partial: Partial<ProcedureDocument>) =>
    onChange({ ...procedure, ...partial });

  const patchStep = (stepIndex: number, subSteps: SubStep[]) =>
    patch({
      steps: procedure.steps.map((step, i) =>
        i === stepIndex ? { ...step, sub_steps: renumber(subSteps) } : step,
      ),
    });

  const renumber = (subSteps: SubStep[]): SubStep[] =>
    subSteps.map((sub, i) => ({ ...sub, no: i + 1 }));

  const patchSub = (stepIndex: number, subIndex: number, partial: Partial<SubStep>) =>
    patchStep(
      stepIndex,
      procedure.steps[stepIndex].sub_steps.map((sub, i) =>
        i === subIndex ? { ...sub, ...partial } : sub,
      ),
    );

  const addSub = (stepIndex: number) =>
    patchStep(stepIndex, [
      ...procedure.steps[stepIndex].sub_steps,
      { no: 0, action: "", note: "" },
    ]);

  const removeSub = (stepIndex: number, subIndex: number) => {
    const before = procedure.steps[stepIndex].sub_steps;
    patchStep(
      stepIndex,
      before.filter((_, i) => i !== subIndex),
    );
    armUndo({
      label: "ลบขั้นตอนย่อยแล้ว",
      restore: () => patchStep(stepIndex, before),
    });
  };

  const undoDelete = () => {
    pendingDelete?.restore();
    setPendingDelete(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
  };

  // One per line, the same convention EditorStep uses for controls
  const linesToList = (text: string) =>
    text.split("\n").map((line) => line.trim()).filter(Boolean);

  return (
    <section>
      <button
        type="button"
        onClick={onBack}
        className="mb-3 flex items-center gap-1 text-sm text-muted hover:text-navy"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        กลับไปหน้าเอกสาร JSA
      </button>

      <h1 className="text-[1.75rem] font-semibold text-navy">ตรวจทานขั้นตอนปฏิบัติงาน</h1>
      <p className="mt-1.5 text-muted">
        ระบบร่างขั้นตอนย่อยจาก JSA ของคุณ กรุณาตรวจสอบให้ตรงกับวิธีทำงานจริงก่อนสร้างเอกสาร
      </p>

      {stale ? (
        <div className="mt-4 rounded-[var(--radius)] border border-[var(--warning-border)] bg-[var(--warning-soft)] p-4">
          <h2 className="flex items-center gap-2 font-medium text-[var(--warning-text)]">
            <TriangleAlert className="size-5 text-[var(--warning)]" aria-hidden="true" />
            JSA ถูกแก้ไขหลังจากสร้างเอกสารนี้
          </h2>
          <p className="mt-1 text-sm text-[var(--warning-text)]">
            ขั้นตอนใน JSA เปลี่ยนไปหลังจากร่างเอกสารนี้แล้ว
            กรุณาตรวจสอบว่ายังตรงกัน หรือสร้างขั้นตอนปฏิบัติงานใหม่
          </p>
        </div>
      ) : null}

      <Card className="mt-6">
        <div className="grid gap-5">
          <div>
            <Label htmlFor="purpose">วัตถุประสงค์</Label>
            <AutoGrowTextarea
              id="purpose"
              minRows={2}
              value={procedure.purpose}
              onChange={(event) => patch({ purpose: event.target.value })}
            />
          </div>

          <div>
            <Label htmlFor="scope">ขอบเขต</Label>
            <AutoGrowTextarea
              id="scope"
              minRows={2}
              value={procedure.scope}
              onChange={(event) => patch({ scope: event.target.value })}
            />
          </div>

          <div>
            <Label htmlFor="tools">เครื่องมือ/อุปกรณ์ที่ต้องเตรียม</Label>
            <AutoGrowTextarea
              id="tools"
              minRows={2}
              value={procedure.tools.join("\n")}
              onChange={(event) => patch({ tools: linesToList(event.target.value) })}
              aria-describedby="tools_hint"
            />
            <p id="tools_hint" className="mt-1.5 text-sm text-muted">
              พิมพ์หนึ่งรายการต่อบรรทัด
            </p>
          </div>

          {procedure.references.length > 0 ? (
            <div>
              {/* Read-only: generated from the source JSA, not something the
                  user fills in — editing it would only break the link back */}
              <p className="mb-1.5 text-ink">เอกสารอ้างอิง</p>
              <ul className="grid gap-1 rounded-[var(--radius)] border border-line bg-surface p-3 text-sm text-muted">
                {procedure.references.map((reference, index) => (
                  <li key={index}>{reference}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </Card>

      <h2 className="mt-8 text-lg font-semibold text-navy">ขั้นตอนการปฏิบัติงาน</h2>
      <p className="mt-1 text-sm text-muted">
        ชื่อขั้นตอนหลักมาจาก JSA — แก้ไขได้ที่หน้าตรวจทาน JSA
      </p>

      <ul className="mt-4 grid list-none gap-4 p-0">
        {procedure.steps.map((step, stepIndex) => (
          <li key={stepIndex}>
            <Card>
              <h3 className="font-display font-semibold text-ink">
                {stepIndex + 1}. {step.procedure || "(ไม่มีชื่อขั้นตอน)"}
              </h3>

              <ul className="mt-3 grid list-none gap-3 p-0">
                {step.sub_steps.map((sub, subIndex) => (
                  <li
                    key={subIndex}
                    className="grid grid-cols-[auto_1fr_auto] items-start gap-2 border-t border-line pt-3"
                  >
                    <span className="pt-2.5 text-sm text-muted tabular-nums">
                      {stepIndex + 1}.{subIndex + 1}
                    </span>
                    <div className="grid gap-2">
                      <AutoGrowTextarea
                        minRows={1}
                        value={sub.action}
                        placeholder="สิ่งที่ต้องลงมือทำ"
                        aria-label={`ขั้นตอนย่อยที่ ${stepIndex + 1}.${subIndex + 1}`}
                        onChange={(event) =>
                          patchSub(stepIndex, subIndex, { action: event.target.value })
                        }
                      />
                      <AutoGrowTextarea
                        minRows={1}
                        value={sub.note}
                        placeholder="หมายเหตุ / ข้อควรระวัง (ถ้ามี)"
                        aria-label={`หมายเหตุของขั้นตอนย่อยที่ ${stepIndex + 1}.${subIndex + 1}`}
                        className="text-sm"
                        onChange={(event) =>
                          patchSub(stepIndex, subIndex, { note: event.target.value })
                        }
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-lg"
                      aria-label={`ลบขั้นตอนย่อยที่ ${stepIndex + 1}.${subIndex + 1}`}
                      onClick={() => removeSub(stepIndex, subIndex)}
                      className="mt-1 text-muted hover:text-danger"
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>

              <div className="mt-3 flex justify-start border-t border-line pt-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => addSub(stepIndex)}
                >
                  <Plus className="size-4" aria-hidden="true" />
                  เพิ่มขั้นตอนย่อย
                </Button>
              </div>
            </Card>
          </li>
        ))}
      </ul>

      {procedure.assumptions.length > 0 ? (
        <div className="mt-6 rounded-[var(--radius)] border border-[var(--warning-border)] bg-[var(--warning-soft)] p-4">
          <h2 className="flex items-center gap-2 font-medium text-[var(--warning-text)]">
            <Info className="size-5 text-[var(--warning)]" aria-hidden="true" />
            ข้อสันนิษฐานที่ระบบใช้ — กรุณาตรวจสอบ
          </h2>
          <p className="mt-1 text-sm text-[var(--warning-text)]">
            ข้อมูลเหล่านี้ไม่ได้ระบุมาใน JSA กรุณาตรวจสอบว่าตรงกับหน้างานจริง
            (ส่วนนี้ไม่ถูกพิมพ์ลงเอกสาร)
          </p>
          <ul className="mt-2 grid gap-1 pl-5 text-sm text-[var(--warning-text)]">
            {procedure.assumptions.map((assumption, index) => (
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

      {/* Spacer so the fixed bar below doesn't cover the last bit of content */}
      <div className="h-20" aria-hidden="true" />

      {/* Fixed, matching EditorStep — on a long procedure these actions would
          otherwise only be reachable after scrolling the whole document */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-[var(--page-max-w)] flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button type="button" variant="ghost" size="lg" onClick={onBack}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            กลับไปหน้าเอกสาร JSA
          </Button>
          <Button type="button" size="lg" onClick={onContinue}>
            <FileText className="size-5" aria-hidden="true" />
            สร้างเอกสาร
          </Button>
        </div>
      </div>

      <UndoToast
        open={!!pendingDelete}
        message={pendingDelete?.label ?? ""}
        onUndo={undoDelete}
      />
    </section>
  );
}
