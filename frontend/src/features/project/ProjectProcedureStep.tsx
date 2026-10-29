/* Project Mode, step 3 — ขั้นตอนปฏิบัติงานโครงการ
 *
 * One work procedure for the whole project, drafted one phase's section at a
 * time from that phase's JSA (usePhaseDrafting, kind "procedure"). Numbered
 * by phase, the same as it prints: phase 2's steps are 2.1, 2.2… and their
 * sub-steps 2.1.1, 2.1.2…
 *
 * Step titles are read-only here, as in Single Mode — they belong to the
 * phase's JSA. If that JSA's steps change after its section was drafted, the
 * section says so and offers to redraft it.
 *
 * A photo can be attached to any sub-step, as in Single Mode. Photos live
 * outside the document (IndexedDB, under the project's id) keyed
 * "<phase id>:<step>.<sub>" — the phase id rather than its number, so
 * reordering phases never moves a photo to the wrong one. That's the same
 * key buildProcedurePdf/Docx look up through ProjectProcedureLayout.photoPrefix.
 */

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, Info, Plus, RotateCcw, Sparkles, TriangleAlert, X } from "lucide-react";

import {
  Alert,
  AutoGrowTextarea,
  Button,
  Card,
  ConfirmDialog,
  Label,
  UndoToast,
} from "../../components/ui";
import { type SaveState, SaveStatus } from "../../components/SaveStatus";
import { fadeSwap } from "../../lib/motion";
import type { PhotoMap, StepPhoto } from "../../lib/pdf/layout";
import { SubStepItem } from "../procedure/ProcedureEditorStep";
import type { ProcedureDocument, ProjectDocument, ProjectPhase, SubStep } from "../../lib/schema";
import { Elapsed } from "./ProjectHub";
import { projectPhotoKey, sectionStale } from "./projectModel";
import type { PhaseDrafting } from "./usePhaseDrafting";

const UNDO_TIMEOUT_MS = 6000;

export function ProjectProcedureStep({
  project,
  onChange,
  drafting,
  saveState,
  onBack,
  onContinue,
  photos,
  onPhotoChange,
}: {
  project: ProjectDocument;
  photos: PhotoMap;
  onPhotoChange: (key: string, photo: StepPhoto | null) => void;
  onChange: (update: (current: ProjectDocument) => ProjectDocument) => void;
  drafting: PhaseDrafting;
  saveState: SaveState;
  onBack: () => void;
  /** On to the two files */
  onContinue: () => void;
}) {
  const [pendingDelete, setPendingDelete] = useState<{ label: string; restore: () => void } | null>(null);
  const [redrafting, setRedrafting] = useState<ProjectPhase | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
  }, []);

  const intro = project.procedureIntro;
  // Raw text while typing — see ProcedureEditorStep's tools field for why a
  // join/split round trip on every keystroke would eat the Enter just typed.
  // Re-synced when drafting adds tools, unless the user is typing in it.
  const [toolsText, setToolsText] = useState(() => intro?.tools.join("\n") ?? "");
  const toolsJoined = intro?.tools.join("\n") ?? "";
  useEffect(() => {
    if (document.activeElement?.id !== "project_tools") setToolsText(toolsJoined);
  }, [toolsJoined]);

  // Stable on-screen identities for sub-step rows, per phase and step — the
  // same approach (and reason) as ProcedureEditorStep's rowKeys
  const rowKeys = useRef<Record<string, string[]>>({});
  const keySeq = useRef(0);
  const newKey = () => `sub-${(keySeq.current += 1)}`;
  const keysFor = (slot: string, count: number) => {
    const current = rowKeys.current[slot];
    if (current?.length === count) return current;
    return (rowKeys.current[slot] = Array.from({ length: count }, newKey));
  };

  const busy = drafting.current !== null;
  const undrafted = project.phases.filter((phase) => phase.jsa && !phase.procedure).map((phase) => phase.id);

  const patchIntro = (patch: Partial<NonNullable<ProjectDocument["procedureIntro"]>>) =>
    onChange((p) => ({
      ...p,
      procedureIntro: { purpose: "", scope: "", tools: [], ...p.procedureIntro, ...patch },
    }));
  const flushTools = () =>
    patchIntro({ tools: toolsText.split("\n").map((line) => line.trim()).filter(Boolean) });

  const setSubSteps = (phaseId: string, stepIndex: number, subs: SubStep[]) =>
    onChange((p) => ({
      ...p,
      phases: p.phases.map((phase) =>
        phase.id === phaseId && phase.procedure
          ? {
              ...phase,
              procedure: {
                ...phase.procedure,
                steps: phase.procedure.steps.map((step, i) =>
                  i === stepIndex ? { ...step, sub_steps: subs.map((sub, n) => ({ ...sub, no: n + 1 })) } : step,
                ),
              },
            }
          : phase,
      ),
    }));

  // The latest photos, for undo closures made renders ago (same reason as
  // usePhotos' photosRef)
  const photosRef = useRef(photos);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  /** Make one step's photos exactly `next` — every other key of that step
   * is cleared. One swap, so its photos never pass through a half-shifted state. */
  const replaceStepPhotos = (phaseId: string, stepNo: number, next: PhotoMap) => {
    const prefix = projectPhotoKey(phaseId, stepNo, 0).slice(0, -1); // "<phase>:<step>."
    const current = photosRef.current;
    for (const key of Object.keys(current)) {
      if (key.startsWith(prefix) && !(key in next)) onPhotoChange(key, null);
    }
    for (const [key, photo] of Object.entries(next)) {
      if (current[key] !== photo) onPhotoChange(key, photo);
    }
  };

  /** Photos are keyed by position, like the printed numbers, so deleting a
   * sub-step moves every later photo up one with its sub-step; the deleted
   * one's own photo goes, and undo puts them all back. Same rule as
   * ProcedureEditorStep's removeSub. */
  const removeSub = (phaseId: string, stepIndex: number, subs: SubStep[], subIndex: number, label: string) => {
    const slot = `${phaseId}:${stepIndex}`;
    const stepNo = stepIndex + 1;
    const keysBefore = keysFor(slot, subs.length);
    rowKeys.current[slot] = keysBefore.filter((_, i) => i !== subIndex);

    const photosBefore: PhotoMap = {};
    const photosAfter: PhotoMap = {};
    subs.forEach((_, i) => {
      const photo = photosRef.current[projectPhotoKey(phaseId, stepNo, i + 1)];
      if (!photo) return;
      photosBefore[projectPhotoKey(phaseId, stepNo, i + 1)] = photo;
      if (i !== subIndex) photosAfter[projectPhotoKey(phaseId, stepNo, i < subIndex ? i + 1 : i)] = photo;
    });

    setSubSteps(phaseId, stepIndex, subs.filter((_, i) => i !== subIndex));
    replaceStepPhotos(phaseId, stepNo, photosAfter);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setPendingDelete({
      label: `ลบขั้นตอนย่อย ${label} แล้ว`,
      restore: () => {
        rowKeys.current[slot] = keysBefore;
        setSubSteps(phaseId, stepIndex, subs);
        replaceStepPhotos(phaseId, stepNo, photosBefore);
      },
    });
    undoTimer.current = setTimeout(() => setPendingDelete(null), UNDO_TIMEOUT_MS);
  };

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h1 className="text-2xl font-semibold text-navy sm:text-[1.75rem]">ขั้นตอนปฏิบัติงานโครงการ</h1>
        <SaveStatus state={saveState} />
      </div>
      <p className="mt-1.5 font-medium text-ink">{project.name}</p>
      <p className="mt-0.5 text-sm text-muted">
        ฉบับเดียวทั้งโครงการ ร่างทีละส่วนจาก JSA ของแต่ละขั้นตอน โดยระบบรู้ว่าขั้นตอนก่อนหน้าทำอะไรไว้แล้ว
      </p>
      <p className="mt-0.5 text-sm text-muted">
        แนบรูปภาพประกอบได้ที่แต่ละขั้นตอนย่อย (รูปภาพจะถูกลบหากลบโครงการนี้)
      </p>

      {undrafted.length > 0 && !busy ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-raised p-3 sm:p-4">
          <p className="text-sm text-muted">ร่างทีละส่วนตามลำดับ ระหว่างรอแก้ไขส่วนที่เสร็จแล้วได้</p>
          <Button type="button" onClick={() => drafting.draft(undrafted)}>
            <Sparkles className="size-4" aria-hidden="true" />
            {undrafted.length === project.phases.length
              ? "ร่างขั้นตอนปฏิบัติงาน"
              : `ร่างส่วนที่เหลือ (${undrafted.length})`}
          </Button>
        </div>
      ) : null}

      <AnimatePresence initial={false}>
        {intro ? (
          <motion.div key="intro" {...fadeSwap}>
            <Card className="mt-4">
              <div className="grid gap-4">
                <div>
                  <Label htmlFor="project_purpose">วัตถุประสงค์</Label>
                  <AutoGrowTextarea
                    id="project_purpose"
                    minRows={1}
                    value={intro.purpose}
                    onChange={(event) => patchIntro({ purpose: event.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="project_scope">ขอบเขต</Label>
                  <AutoGrowTextarea
                    id="project_scope"
                    minRows={1}
                    value={intro.scope}
                    onChange={(event) => patchIntro({ scope: event.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="project_tools">เครื่องมือ/อุปกรณ์ที่ต้องเตรียม</Label>
                  <AutoGrowTextarea
                    id="project_tools"
                    minRows={1}
                    value={toolsText}
                    onChange={(event) => setToolsText(event.target.value)}
                    onBlur={flushTools}
                    aria-describedby="project_tools_hint"
                  />
                  <p id="project_tools_hint" className="mt-1.5 text-sm text-muted">
                    พิมพ์หนึ่งรายการต่อบรรทัด · รวมจากทุกส่วนที่ร่างแล้ว
                  </p>
                </div>
              </div>
            </Card>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <ol className="mt-6 grid list-none gap-4 p-0">
        {project.phases.map((phase, phaseIndex) => {
          const n = phaseIndex + 1;
          const isDrafting = drafting.current === phase.id;
          const isWaiting = drafting.queued.includes(phase.id);
          const error = drafting.errors[phase.id];
          const stale = sectionStale(phase);
          return (
            <li key={phase.id}>
              <Card>
                <h2 className="font-display text-lg font-semibold text-navy">
                  {n}. {phase.work || `ขั้นตอนที่ ${n}`}
                </h2>
                <p className="mt-0.5 text-sm text-muted">จาก JSA {n}</p>

                {error ? (
                  <div className="mt-3">
                    <Alert>{error}</Alert>
                  </div>
                ) : null}

                {stale && !isDrafting ? (
                  <div className="mt-3 rounded-card border border-[var(--warning-border)] bg-[var(--warning-soft)] p-3">
                    <p className="flex items-center gap-2 text-sm font-semibold text-[var(--warning-text)]">
                      <TriangleAlert className="size-4 text-[var(--warning)]" aria-hidden="true" />
                      JSA {n} ถูกแก้ไขหลังจากร่างส่วนนี้
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      disabled={busy}
                      onClick={() => setRedrafting(phase)}
                    >
                      <RotateCcw className="size-4" aria-hidden="true" />
                      ร่างส่วนนี้ใหม่จาก JSA ปัจจุบัน
                    </Button>
                  </div>
                ) : null}

                <AnimatePresence initial={false} mode="wait">
                  {isDrafting ? (
                    <motion.div key="busy" {...fadeSwap} className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm text-navy">
                        กำลังร่างส่วนนี้… <Elapsed since={drafting.startedAt} />
                      </p>
                      <Button type="button" variant="outline" onClick={drafting.cancel}>
                        <X className="size-4" aria-hidden="true" />
                        ยกเลิก
                      </Button>
                    </motion.div>
                  ) : isWaiting ? (
                    <motion.p key="wait" {...fadeSwap} className="mt-3 text-sm text-muted">
                      รอคิว
                    </motion.p>
                  ) : !phase.jsa ? (
                    <motion.p key="nojsa" {...fadeSwap} className="mt-3 text-sm text-muted">
                      ยังไม่มี JSA ของขั้นตอนนี้
                    </motion.p>
                  ) : !phase.procedure ? (
                    <motion.div key="draft" {...fadeSwap} className="mt-3">
                      <Button type="button" variant="outline" disabled={busy} onClick={() => drafting.draft([phase.id])}>
                        <Sparkles className="size-4" aria-hidden="true" />
                        ร่างส่วนนี้
                      </Button>
                    </motion.div>
                  ) : (
                    <motion.div key="body" {...fadeSwap}>
                      <Section
                        phaseId={phase.id}
                        prefix={n}
                        procedure={phase.procedure}
                        keysFor={keysFor}
                        newKey={newKey}
                        rowKeys={rowKeys}
                        setSubSteps={setSubSteps}
                        removeSub={removeSub}
                        photos={photos}
                        onPhotoChange={onPhotoChange}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </Card>
            </li>
          );
        })}
      </ol>

      {/* Spacer so the fixed bar below doesn't cover the last bit of content */}
      <div className="h-20" aria-hidden="true" />

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line px-4 py-3 t-glass bg-surface/95 supports-backdrop-filter:bg-surface/80 supports-backdrop-filter:backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-[var(--page-max-w)] items-center gap-2 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            size="lg"
            onClick={() => {
              if (intro) flushTools();
              onBack();
            }}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            กลับ
          </Button>
          <Button
            type="button"
            size="lg"
            className="flex-1 sm:flex-none"
            // Not while a section is drafting: its result would land after
            // the files were already built from the project without it
            disabled={busy}
            onClick={() => {
              if (intro) flushTools();
              onContinue();
            }}
          >
            เอกสาร PDF
            <ArrowRight className="size-5" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <UndoToast
        open={!!pendingDelete}
        message={pendingDelete?.label ?? ""}
        onUndo={() => {
          pendingDelete?.restore();
          setPendingDelete(null);
          if (undoTimer.current) clearTimeout(undoTimer.current);
        }}
      />

      <ConfirmDialog
        open={redrafting !== null}
        title="ร่างส่วนนี้ใหม่?"
        description="ระบบจะร่างขั้นตอนย่อยของส่วนนี้ใหม่จาก JSA ปัจจุบัน สิ่งที่แก้ไขไว้ในส่วนนี้จะหายไปและกู้คืนไม่ได้"
        confirmLabel="ร่างใหม่"
        onConfirm={() => {
          if (redrafting) void drafting.draft([redrafting.id], { replace: true });
          setRedrafting(null);
        }}
        onCancel={() => setRedrafting(null)}
      />
    </section>
  );
}

/** One phase's steps: "2.1 <title>" with its sub-steps "2.1.1 …" */
function Section({
  phaseId,
  prefix,
  procedure,
  keysFor,
  newKey,
  rowKeys,
  setSubSteps,
  removeSub,
  photos,
  onPhotoChange,
}: {
  photos: PhotoMap;
  onPhotoChange: (key: string, photo: StepPhoto | null) => void;
  phaseId: string;
  prefix: number;
  procedure: ProcedureDocument;
  keysFor: (slot: string, count: number) => string[];
  newKey: () => string;
  rowKeys: { current: Record<string, string[]> };
  setSubSteps: (phaseId: string, stepIndex: number, subs: SubStep[]) => void;
  removeSub: (phaseId: string, stepIndex: number, subs: SubStep[], subIndex: number, label: string) => void;
}) {
  return (
    <>
      <ol className="mt-3 grid list-none gap-4 p-0">
        {procedure.steps.map((step, stepIndex) => {
          const stepNo = `${prefix}.${stepIndex + 1}`;
          const slot = `${phaseId}:${stepIndex}`;
          const keys = keysFor(slot, step.sub_steps.length);
          return (
            <li key={stepIndex} className="border-t border-line pt-3">
              <h3 className="font-display text-base font-semibold text-ink">
                {stepNo} {step.procedure || "(ไม่มีชื่อขั้นตอน)"}
              </h3>
              <ul className="mt-2 grid list-none gap-2 p-0">
                <AnimatePresence initial={false}>
                  {step.sub_steps.map((sub, subIndex) => {
                    const label = `${stepNo}.${subIndex + 1}`;
                    const key = projectPhotoKey(phaseId, stepIndex + 1, subIndex + 1);
                    // Single Mode's own row: text, photo button, drop/paste, preview
                    return (
                      <SubStepItem
                        key={keys[subIndex]}
                        label={label}
                        sub={sub}
                        photo={photos[key]}
                        onTextChange={(action) =>
                          setSubSteps(
                            phaseId,
                            stepIndex,
                            step.sub_steps.map((s, i) => (i === subIndex ? { ...s, action } : s)),
                          )
                        }
                        onPhotoChange={(photo) => onPhotoChange(key, photo)}
                        onRemove={() => removeSub(phaseId, stepIndex, step.sub_steps, subIndex, label)}
                      />
                    );
                  })}
                </AnimatePresence>
              </ul>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-2 text-sm"
                onClick={() => {
                  rowKeys.current[slot] = [...keys, newKey()];
                  setSubSteps(phaseId, stepIndex, [...step.sub_steps, { no: 0, action: "" }]);
                }}
              >
                <Plus className="size-4" aria-hidden="true" />
                เพิ่มขั้นตอนย่อย
              </Button>
            </li>
          );
        })}
      </ol>

      {procedure.assumptions.length > 0 ? (
        <div className="mt-4 rounded-card border border-[var(--warning-border)] bg-[var(--warning-soft)] p-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-[var(--warning-text)]">
            <Info className="size-4 text-[var(--warning)]" aria-hidden="true" />
            ข้อสันนิษฐานที่ระบบใช้ — กรุณาตรวจสอบ (ไม่แสดงในเอกสาร)
          </p>
          <ul className="mt-1 grid gap-1 pl-5 text-sm text-[var(--warning-text)]">
            {procedure.assumptions.map((assumption, index) => (
              <li key={index} className="list-disc">
                {assumption}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}
