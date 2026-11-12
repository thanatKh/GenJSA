/* Step 2 — Review and edit
 *
 * No AI buttons on this page at all, whether per-field or automated review.
 * The user owns the data after generation — every field is editable, and if
 * they don't like the result they start over.
 */

import { useEffect, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import { ArrowLeft, ArrowRight, Check, Info, Plus, RotateCcw } from "lucide-react";

import {
  Alert,
  AutoGrowTextarea,
  Button,
  Card,
  ConfirmDialog,
  Input,
  Reveal,
  UndoToast,
} from "../../components/ui";
import { DuplicateButton } from "../../components/DuplicateButton";
import { StepNavigator } from "../../components/StepNavigator";
import { jsaProblems, focusJsaField } from "../../lib/jsaValidation";
import { ThaiDatePicker } from "../../components/ThaiDatePicker";
import { type SaveState, SaveStatus } from "../../components/SaveStatus";
import type { CompanyLogo } from "../../lib/companyLogo";
import { saveNames } from "../../lib/rememberedNames";
import type { JsaDocument, JsaStep, JsaSubStep } from "../../lib/schema";
import { CompanySection } from "../company/CompanySection";
import { docDraft } from "../../store";
import { StepCard } from "./StepCard";

const UNDO_TIMEOUT_MS = 6000;

// What's needed to put a deleted step, sub-step or hazard back exactly where it was
type PendingDelete =
  | { kind: "step"; index: number; step: JsaStep; key: string; message: string }
  | {
      kind: "hazard";
      stepIndex: number;
      hazardIndex: number;
      hazard: JsaStep["hazards"][number];
      message: string;
    }
  | {
      kind: "sub";
      stepIndex: number;
      subIndex: number;
      sub: JsaSubStep;
      key: string;
      /** It was the step's last sub-step, so the step went back to a plain
       * step carrying its hazards — undo makes it a heading again */
      wasLast: boolean;
      message: string;
    }
  | {
      kind: "subHazard";
      stepIndex: number;
      subIndex: number;
      hazardIndex: number;
      hazard: JsaStep["hazards"][number];
      message: string;
    };

// Mirrors backend/app/models/jsa.py's MAX_SUB_STEPS
const MAX_SUB_STEPS = 20;

const EMPTY_SUB_STEP: JsaSubStep = { no: 1, procedure: "", details: "", hazards: [{ hazard: "", controls: [""] }] };

// Mirrors backend/app/models/jsa.py's JsaHeader.work_activity max_length
const WORK_ACTIVITY_MAX = 500;

const EMPTY_STEP: Omit<JsaStep, "no"> = {
  procedure: "",
  details: "",
  hazards: [{ hazard: "", controls: [""] }],
  sub_steps: [],
};


export function EditorStep({
  doc,
  onChange,
  onContinue,
  continueLabel,
  onStartOver,
  error,
  companyLogo,
  onCompanyLogoChange,
  saveState,
  project,
  onDuplicate,
  onAdvanced,
}: {
  onDuplicate?: () => Promise<void>;
  onAdvanced?: () => void;
  doc: JsaDocument;
  onChange: (next: JsaDocument) => void;
  /** Browser-only, beside the document rather than in it — see useCompanyLogo.ts */
  companyLogo: CompanyLogo | null;
  onCompanyLogoChange: (logo: CompanyLogo | null) => void;
  /** This document's save to history, for the "บันทึกแล้ว" indicator */
  saveState: SaveState;
  onContinue: () => void;
  /** The forward button's wording when it doesn't lead to the PDF — "ถัดไป"
   * on the JSA + Procedure track, where the procedure comes next */
  continueLabel?: string;
  onStartOver: () => void;
  error: string | null;
  /** Project Mode: this JSA is one phase of a project. The page is the same
   * editor, but it isn't the session's draft (the project owns it), and its
   * bar goes back to the project's JSA list instead of starting over. */
  project?: { name: string; position: string; onBack: () => void };
}) {
  const [checked, setChecked] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [liveMessage, setLiveMessage] = useState("");
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // A project's JSA is saved with its project — writing it here would
    // overwrite the Single Mode draft
    if (!project) docDraft.save(doc);
  }, [doc, project]);

  useEffect(() => () => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
  }, []);

  const setSteps = (steps: JsaStep[]) =>
    onChange({ ...doc, steps: steps.map((step, i) => ({ ...step, no: i + 1 })) });

  // Stable on-screen identities for step cards — never part of the
  // document. Steps are renumbered after every change, so the old key
  // (`${index}-${step.no}`) was the same list every time: deleting step 1
  // animated the LAST card out while the text shifted up, and moving a step
  // swapped the cards' text instead of moving the cards. Every change below
  // updates these alongside the steps; anything else (a different document
  // arriving) just gets a fresh set.
  const stepKeys = useRef<string[]>([]);
  const stepKeySeq = useRef(0);
  const newStepKey = () => `step-${(stepKeySeq.current += 1)}`;
  if (stepKeys.current.length !== doc.steps.length) {
    stepKeys.current = Array.from({ length: doc.steps.length }, newStepKey);
  }

  // Sub-step card identities, per step (keyed by the step's own key so they
  // follow it when steps move) — same reasoning as stepKeys
  const subKeys = useRef(new Map<string, string[]>());
  const subKeysFor = (stepIndex: number): string[] => {
    const owner = stepKeys.current[stepIndex];
    const count = doc.steps[stepIndex].sub_steps.length;
    let keys = subKeys.current.get(owner);
    if (!keys || keys.length !== count) {
      keys = Array.from({ length: count }, () => `${owner}-sub-${(stepKeySeq.current += 1)}`);
      subKeys.current.set(owner, keys);
    }
    return keys;
  };

  const patchStep = (stepIndex: number, change: (step: JsaStep) => JsaStep) =>
    setSteps(doc.steps.map((s, i) => (i === stepIndex ? change(s) : s)));

  /** A plain step becomes a heading: its hazards move to a new 1.1, so
   * nothing typed so far is lost, and the new sub-step's title is left for
   * the user to fill in */
  const splitStep = (stepIndex: number) => {
    const step = doc.steps[stepIndex];
    const hazards = step.hazards.length ? step.hazards : EMPTY_SUB_STEP.hazards;
    patchStep(stepIndex, (s) => ({ ...s, hazards: [], sub_steps: [{ ...EMPTY_SUB_STEP, hazards }] }));
    setLiveMessage(`แบ่งขั้นตอนที่ ${stepIndex + 1} เป็นขั้นตอนย่อยแล้ว`);
    requestAnimationFrame(() => focusJsaField(`procedure-${stepIndex}-s0`));
  };

  const addSubStep = (stepIndex: number) => {
    const subs = doc.steps[stepIndex].sub_steps;
    if (subs.length >= MAX_SUB_STEPS) return;
    subKeysFor(stepIndex).push(`${stepKeys.current[stepIndex]}-sub-${(stepKeySeq.current += 1)}`);
    patchStep(stepIndex, (s) => ({ ...s, sub_steps: [...subs, { ...EMPTY_SUB_STEP, no: subs.length + 1 }] }));
    requestAnimationFrame(() => focusJsaField(`procedure-${stepIndex}-s${subs.length}`));
  };

  const patchSub = (stepIndex: number, subIndex: number, next: JsaSubStep) =>
    patchStep(stepIndex, (s) => ({ ...s, sub_steps: s.sub_steps.map((sub, j) => (j === subIndex ? next : sub)) }));

  const moveSub = (stepIndex: number, subIndex: number, direction: -1 | 1) => {
    const subs = [...doc.steps[stepIndex].sub_steps];
    const target = subIndex + direction;
    if (target < 0 || target >= subs.length) return;
    [subs[subIndex], subs[target]] = [subs[target], subs[subIndex]];
    const keys = subKeysFor(stepIndex);
    [keys[subIndex], keys[target]] = [keys[target], keys[subIndex]];
    patchStep(stepIndex, (s) => ({ ...s, sub_steps: subs }));
    setLiveMessage(`ย้ายขั้นตอนย่อยไปอยู่ลำดับที่ ${stepIndex + 1}.${target + 1}`);
  };

  const removeSub = (stepIndex: number, subIndex: number) => {
    const step = doc.steps[stepIndex];
    const sub = step.sub_steps[subIndex];
    const keys = subKeysFor(stepIndex);
    const key = keys[subIndex];
    keys.splice(subIndex, 1);
    const wasLast = step.sub_steps.length === 1;
    patchStep(stepIndex, (s) => wasLast
      // The last one gone: back to a plain step, keeping its hazards
      ? { ...s, sub_steps: [], hazards: sub.hazards.length ? sub.hazards : EMPTY_SUB_STEP.hazards }
      : { ...s, sub_steps: s.sub_steps.filter((_, j) => j !== subIndex) });
    armUndo({ kind: "sub", stepIndex, subIndex, sub, key, wasLast, message: `ลบขั้นตอนย่อยที่ ${stepIndex + 1}.${subIndex + 1} แล้ว` });
  };

  const removeSubHazard = (stepIndex: number, subIndex: number, hazardIndex: number) => {
    const hazard = doc.steps[stepIndex].sub_steps[subIndex].hazards[hazardIndex];
    patchStep(stepIndex, (s) => ({
      ...s,
      sub_steps: s.sub_steps.map((sub, j) =>
        j === subIndex ? { ...sub, hazards: sub.hazards.filter((_, h) => h !== hazardIndex) } : sub),
    }));
    armUndo({ kind: "subHazard", stepIndex, subIndex, hazardIndex, hazard, message: "ลบอันตรายนี้แล้ว" });
  };

  const moveStep = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= doc.steps.length) return;
    const steps = [...doc.steps];
    [steps[index], steps[target]] = [steps[target], steps[index]];
    const keys = [...stepKeys.current];
    [keys[index], keys[target]] = [keys[target], keys[index]];
    stepKeys.current = keys;
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
    const key = stepKeys.current[index];
    stepKeys.current = stepKeys.current.filter((_, i) => i !== index);
    setSteps(doc.steps.filter((_, i) => i !== index));
    armUndo({
      kind: "step",
      index,
      step,
      key,
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
      const keys = [...stepKeys.current];
      keys.splice(pendingDelete.index, 0, pendingDelete.key);
      stepKeys.current = keys;
      setSteps(steps);
    } else if (pendingDelete.kind === "sub") {
      const { stepIndex, subIndex, sub, key, wasLast } = pendingDelete;
      subKeysFor(stepIndex).splice(subIndex, 0, key);
      patchStep(stepIndex, (s) => {
        const subs = wasLast ? [] : [...s.sub_steps];
        subs.splice(subIndex, 0, sub);
        return { ...s, sub_steps: subs, hazards: [] };
      });
    } else if (pendingDelete.kind === "subHazard") {
      const { stepIndex, subIndex, hazardIndex, hazard } = pendingDelete;
      patchStep(stepIndex, (s) => ({
        ...s,
        sub_steps: s.sub_steps.map((sub, j) => {
          if (j !== subIndex) return sub;
          const hazards = [...sub.hazards];
          hazards.splice(hazardIndex, 0, hazard);
          return { ...sub, hazards };
        }),
      }));
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
  // work_activity has no step-1 equivalent at all: "ข้ามขั้นตอนนี้" (manual
  // mode) starts it blank (buildBlankDocument), and this editable field here
  // is the only place it's ever set. Backend's JsaHeader.work_activity has
  // min_length=1, so leaving it blank doesn't just print an empty title on
  // the JSA PDF — it 422s the moment "สร้างขั้นตอนปฏิบัติงาน" POSTs this doc to
  // /api/procedure/generate. Catch it here, at the source, rather than as a
  // failure on a later page the user has no reason to connect back to this field.
  const missingActivity = !doc.header.work_activity.trim();
  const problems = jsaProblems(doc);
  const continueReviewed = (next: () => void) => {
    setChecked(true);
    if (problems.length) { focusJsaField(problems[0].id); return; }
    next();
  };

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h1 className="text-2xl font-semibold sm:text-[1.75rem] text-navy">
          {project ? `ตรวจทาน ${project.position}` : "ตรวจทานและแก้ไข"}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          {onDuplicate ? <DuplicateButton action={onDuplicate} /> : null}
          {onAdvanced ? (
            <Button type="button" variant="ghost" size="sm" title="ร่าง WP จาก JSA นี้"
              onClick={() => continueReviewed(onAdvanced)}>ขั้นสูง</Button>
          ) : null}
        </div>
      </div>
      {project ? (
        <p className="mt-1 text-sm font-medium text-ink">
          {/* The project name, shown not edited here — it's set on the project's own page */}
          โครงการ: {project.name}
        </p>
      ) : null}
      <p className="mt-1.5 text-muted">
        เอกสารนี้ระบบร่างให้เป็นจุดเริ่มต้น{" "}
        <strong className="font-semibold text-ink">
          ผู้ปฏิบัติงานและหัวหน้างานเป็นผู้ตรวจสอบและรับผิดชอบเนื้อหา
        </strong>{" "}
        โปรดอ่านทุกขั้นตอนและแก้ไขให้ตรงกับงานจริงก่อนนำไปใช้
      </p>

      <Card className="mt-4">
        <label htmlFor="work_activity" className="text-sm font-medium text-ink">
          งาน/กิจกรรม
        </label>
        <AutoGrowTextarea
          id="work_activity"
          required
          minRows={1}
          maxLength={WORK_ACTIVITY_MAX}
          aria-invalid={missingActivity}
          value={doc.header.work_activity}
          onChange={(event) =>
            onChange({
              ...doc,
              header: { ...doc.header, work_activity: event.target.value },
            })
          }
          // py-1.5 (not the default py-2) so one row lands at ~40px —
          // 25.6px line-height + 12px padding + 2px border — matching the
          // Input fields below it (h-10) instead of sitting taller
          className="mt-1 py-1.5"
        />

        {/* Editable, not read-only <dd>s — a typo here used to mean "เริ่มใหม่"
            and losing the whole AI draft, since this was the only place these
            three fields could ever be fixed after step 1. ผู้วิเคราะห์ in
            particular wasn't shown anywhere in this step before, so a mistake
            there wasn't caught until the printed PDF. */}
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="supervisor" className="text-sm font-medium text-ink">
              ชื่อหัวหน้างาน<span className="ml-0.5 text-danger-text">*</span>
            </label>
            <Input
              id="supervisor"
              required
              autoComplete="name"
              aria-invalid={missingSupervisor}
              value={doc.header.supervisor}
              onChange={(event) => {
                // Only a real edit updates the remembered name — merely
                // opening an old job must not
                saveNames({ supervisor: event.target.value });
                onChange({
                  ...doc,
                  header: { ...doc.header, supervisor: event.target.value },
                });
              }}
              className="mt-1"
            />
          </div>
          <div>
            <label htmlFor="analysis_date" className="text-sm font-medium text-ink">
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
            <label htmlFor="analyst" className="text-sm font-medium text-ink">
              ผู้วิเคราะห์
            </label>
            <Input
              id="analyst"
              autoComplete="name"
              value={doc.header.analyst}
              onChange={(event) => {
                // Only a real edit updates the remembered name — merely
                // opening an old job must not
                saveNames({ analyst: event.target.value });
                onChange({
                  ...doc,
                  header: { ...doc.header, analyst: event.target.value },
                });
              }}
              className="mt-1"
            />
          </div>
        </div>

        {/* Company — optional, for documents prepared in another company's
            name. Blank prints no company row, so PTTOR's own JSAs are
            unchanged. The same collapsible section as the first screen. */}
        <div className="mt-4">
          <CompanySection
            name={doc.header.company}
            nameField={
              <Input
                id="company"
                autoComplete="organization"
                value={doc.header.company}
                onChange={(event) =>
                  onChange({
                    ...doc,
                    header: { ...doc.header, company: event.target.value },
                  })
                }
              />
            }
            logo={companyLogo}
            onLogoChange={onCompanyLogoChange}
          />
        </div>
      </Card>

      {checked && problems.length > 0 ? <div role="alert" className="mt-4 rounded-lg border border-danger p-3 text-sm text-danger-text">
        <p className="font-medium">กรุณาแก้ไขก่อนดำเนินการต่อ</p>
        <ul className="mt-1 list-disc pl-5">{problems.map((p) => <li key={p.id}><button type="button" className="text-left underline" onClick={() => focusJsaField(p.id)}>{p.message}</button></li>)}</ul>
      </div> : null}
      <StepNavigator steps={doc.steps.map((step, i) => ({ id: `jsa-step-${i}`, label: `${i + 1}. ${step.procedure || "ยังไม่มีชื่อ"}` }))} />
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
      <div className="mt-4 hidden grid-cols-[35%_1fr_1fr] gap-0 px-1 text-center text-sm font-medium text-muted lg:grid lg:grid-cols-[3rem_35%_1fr_1fr] lg:sticky lg:top-[var(--appbar-h)] lg:z-[5] lg:rounded-t-card lg:border lg:border-b-0 lg:border-line lg:bg-raised lg:px-2 lg:py-2 lg:font-semibold lg:text-ink">
        {/* Blank corner cell, Excel-style — matches StepCard.tsx's row-number gutter column */}
        <span aria-hidden="true" />
        <span>ขั้นตอนการทำงาน</span>
        <span>อันตรายที่อาจเกิดขึ้น</span>
        <span>มาตรการป้องกัน/ควบคุม</span>
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
          {doc.steps.flatMap((step, index) => {
            const heading = step.sub_steps.length > 0;
            const keys = subKeysFor(index);
            return [
              <StepCard
                key={stepKeys.current[index]}
                step={step}
                index={index}
                variant={heading ? "heading" : "step"}
                first={index === 0}
                last={index === doc.steps.length - 1}
                canRemove={doc.steps.length > 1}
                incomplete={!step.procedure.trim()}
                onChange={(next) => patchStep(index, () => next)}
                onRemove={() => removeStep(index)}
                onRemoveHazard={(hazardIndex) => removeHazard(index, hazardIndex)}
                onMove={(direction) => moveStep(index, direction)}
                onSplit={heading ? undefined : () => splitStep(index)}
                onAddSub={heading && step.sub_steps.length < MAX_SUB_STEPS ? () => addSubStep(index) : undefined}
              />,
              ...step.sub_steps.map((sub, subIndex) => (
                <StepCard
                  key={keys[subIndex]}
                  step={sub}
                  // Never the table's first row, so its top divider always shows
                  index={1}
                  label={`${index + 1}.${subIndex + 1}`}
                  idBase={`${index}-s${subIndex}`}
                  variant="sub"
                  first={subIndex === 0}
                  last={subIndex === step.sub_steps.length - 1}
                  canRemove
                  incomplete={!sub.procedure.trim()}
                  onChange={(next) => patchSub(index, subIndex, next)}
                  onRemove={() => removeSub(index, subIndex)}
                  onRemoveHazard={(hazardIndex) => removeSubHazard(index, subIndex, hazardIndex)}
                  onMove={(direction) => moveSub(index, subIndex, direction)}
                />
              )),
            ];
          })}
        </AnimatePresence>
      </ul>

      <p className="sr-only" role="status" aria-live="polite">
        {liveMessage}
      </p>

      {/* On lg, visually fused to the table frame above (negative margin +
          matching side borders, rounded only at the bottom) so it reads as
          the table's own last row rather than a detached control.
          The hover shape nests inside the frame's rounded-card (22px) bottom
          corners: frame padding 8px (lg:p-2), so the button is rounded-xl
          (14px = 22 - 8). As a full-width pill it ran straight into those
          curves, with the "+" sitting inside the curve. */}
      <div className="mt-3 lg:mt-0 lg:-translate-y-px lg:rounded-b-card lg:border lg:border-t-0 lg:border-line lg:p-2">
        <Button
          variant="outline"
          className="lg:h-9 lg:w-full lg:justify-start lg:rounded-xl lg:border-0 lg:px-3 lg:text-sm lg:font-normal lg:text-muted lg:hover:bg-raised lg:hover:text-ink"
          onClick={() => {
            stepKeys.current = [...stepKeys.current, newStepKey()];
            setSteps([...doc.steps, { ...EMPTY_STEP, no: doc.steps.length + 1 }]);
          }}
        >
          <Plus className="size-4" aria-hidden="true" />
          เพิ่มขั้นตอน
        </Button>
      </div>

      {doc.assumptions.length > 0 ? (
        <div className="mt-4 rounded-card border border-[var(--warning-border)] bg-[var(--warning-soft)] p-4">
          <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--warning-text)]">
            <Info className="size-5 text-[var(--warning)]" aria-hidden="true" />
            ข้อสันนิษฐานที่ระบบใช้ — กรุณาตรวจสอบ
          </h2>
          <p className="mt-1 text-sm text-[var(--warning-text)]">
            ข้อมูลเหล่านี้ไม่ได้ระบุมาในรายละเอียดงาน กรุณาตรวจสอบว่าตรงกับหน้างานจริง
            (ส่วนนี้ไม่แสดงในเอกสาร)
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

      <Reveal show={!!error}>
        <div className="pt-4">
          <Alert>{error}</Alert>
        </div>
      </Reveal>

      {/* Spacer so the fixed bar below doesn't cover the last bit of content */}
      <div className="h-20" aria-hidden="true" />

      {/* Fixed rather than a normal-flow footer — on a long document (many
          steps) these actions used to only be reachable by scrolling all the
          way down every time; keeping them pinned means "restart" and
          "generate PDF" are always one tap away while reviewing. */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line px-4 py-3 t-glass bg-surface/95 supports-backdrop-filter:bg-surface/80 supports-backdrop-filter:backdrop-blur-md">
        {/* max-w-[var(--page-max-w)] — same shared bound as AppBar/<main> (see
            tokens.css) so these buttons line up with the table's own edges
            above them; this bar is `fixed`, so it sits outside <main>'s own
            width entirely and needs the token again rather than inheriting it. */}
        <div className="mx-auto flex w-full max-w-[var(--page-max-w)] items-center gap-2 sm:justify-between">
          {project ? (
            // Nothing to lose by leaving: every edit is already saved with the project
            <Button variant="ghost" size="lg" className="max-sm:px-2" onClick={project.onBack}>
              <ArrowLeft className="size-4" aria-hidden="true" />
              กลับ
            </Button>
          ) : (
            <Button variant="ghost" size="lg" className="max-sm:px-2" onClick={() => setConfirmRestart(true)}>
              <RotateCcw className="size-4" aria-hidden="true" />
              เริ่มใหม่
            </Button>
          )}
          <SaveStatus state={saveState} compact />
          <Button size="lg" onClick={() => continueReviewed(onContinue)} className="max-sm:px-3">
            {project ? (
              <>
                <Check className="size-5" aria-hidden="true" />
                ตรวจแล้ว
              </>
            ) : (
              <>
                {continueLabel ?? "สร้าง PDF"}
                <ArrowRight className="size-5" aria-hidden="true" />
              </>
            )}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmRestart}
        title="เริ่มใหม่?"
        description={saveState === "saved"
          ? "กลับไปกรอกรายละเอียดงานใหม่ งานนี้ยังเปิดได้จากประวัติในเบราว์เซอร์นี้"
          : "กลับไปกรอกรายละเอียดงานใหม่ หากยังบันทึกไม่สำเร็จ ให้ตรวจสถานะบันทึกก่อนออกจากหน้านี้"}
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
