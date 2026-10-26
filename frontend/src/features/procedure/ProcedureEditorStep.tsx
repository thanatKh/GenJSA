/* Review and edit the AI-drafted work procedure before exporting it.
 *
 * Simpler than the JSA's EditorStep by design. The step list belongs to the
 * JSA — this document only fills in the how-to underneath — so step titles are
 * read-only here and the user is pointed back to the JSA editor to change
 * them. That keeps the two documents from drifting into disagreement about
 * what the job's steps even are.
 */

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  FileText,
  Info,
  Plus,
  RotateCcw,
  Trash2,
  TriangleAlert,
} from "lucide-react";

import {
  Alert,
  AutoGrowTextarea,
  Button,
  Card,
  ConfirmDialog,
  FieldError,
  Label,
  Reveal,
  UndoToast,
} from "../../components/ui";
import { type SaveState, SaveStatus } from "../../components/SaveStatus";
import { listItem } from "../../lib/motion";
import { photoKey, type PhotoMap, type StepPhoto } from "../../lib/pdf/layout";
import type { ProcedureDocument, SubStep } from "../../lib/schema";
import { PhotoButton, PhotoPreview } from "./SubStepPhoto";
import { usePhotoInput } from "./usePhotoInput";

// Same undo window as EditorStep's step/hazard deletion
const UNDO_TIMEOUT_MS = 6000;

type PendingDelete = { label: string; restore: () => void };

export function ProcedureEditorStep({
  procedure,
  onChange,
  photos,
  onPhotoChange,
  onStepPhotosReplace,
  saveState,
  onContinue,
  onBack,
  onRegenerate,
  stale,
  error,
}: {
  procedure: ProcedureDocument;
  onChange: (next: ProcedureDocument) => void;
  /** Sub-step photos keyed by photoKey(step.no, sub.no). Kept outside
   * ProcedureDocument — they never reach the backend, and persist in
   * IndexedDB rather than this document (see usePhotos.ts /
   * lib/photoStore.ts). */
  photos: PhotoMap;
  onPhotoChange: (key: string, photo: StepPhoto | null) => void;
  /** Swap all of one main step's photos at once — see removeSub */
  onStepPhotosReplace: (stepNo: number, next: PhotoMap) => void;
  /** This document's save to history, for the "บันทึกแล้ว" indicator */
  saveState: SaveState;
  onContinue: () => void;
  onBack: () => void;
  // App.tsx unmounts this component entirely while a regenerate is in
  // flight (see its comment there for why), so there is no in-place
  // "regenerating" state to render here — calling this just starts the
  // request and the parent takes it from there.
  /** Draft the whole procedure again from the current JSA */
  onRegenerate: () => void;
  /** The JSA's steps changed after this procedure was generated */
  stale: boolean;
  error: string | null;
}) {
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Local, uncommitted text for the tools textarea — see its onChange/onBlur
  // below for why this can't be a plain derived `procedure.tools.join("\n")`.
  // A lazy initializer is enough, no resync effect needed: App.tsx unmounts
  // this whole component during a regenerate (swaps in GeneratingPanel) and
  // remounts it fresh once the new procedure lands, and opening a different
  // history entry replaces the page the same way — so every case that
  // changes `procedure` out from under this field is already a fresh mount.
  const [toolsText, setToolsText] = useState(() => procedure.tools.join("\n"));

  // Stable on-screen identities for sub-step rows, per step — never part of
  // the document. Sub-steps are renumbered on every change, so neither
  // their number nor their position says which row is which; without these,
  // deleting 1.2 of three animated the LAST row out (React saw the third
  // key disappear) and the remaining text visibly jumped up a row.
  const rowKeys = useRef<string[][]>([]);
  const keySeq = useRef(0);
  const newKey = () => `sub-${(keySeq.current += 1)}`;
  /** The step's row keys, rebuilt only if the count changed some other way
   * (a regenerate or a reloaded draft) */
  const keysFor = (stepIndex: number, count: number): string[] => {
    const current = rowKeys.current[stepIndex];
    if (current?.length === count) return current;
    const fresh = Array.from({ length: count }, newKey);
    rowKeys.current[stepIndex] = fresh;
    return fresh;
  };

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

  const addSub = (stepIndex: number) => {
    const subs = procedure.steps[stepIndex].sub_steps;
    rowKeys.current[stepIndex] = [...keysFor(stepIndex, subs.length), newKey()];
    patchStep(stepIndex, [...subs, { no: 0, action: "" }]);
  };

  /** Photos are keyed by position ("1.3"), like the printed numbers, so
   * deleting a sub-step shifts every later sub-step's photo up one with it —
   * otherwise the old 1.3's photo would end up shown under the new 1.3. The
   * deleted sub-step's own photo is dropped, and undo puts the step's
   * photos back exactly as they were along with its text. */
  const removeSub = (stepIndex: number, subIndex: number) => {
    const step = procedure.steps[stepIndex];
    const before = step.sub_steps;
    const keysBefore = keysFor(stepIndex, before.length);
    rowKeys.current[stepIndex] = keysBefore.filter((_, i) => i !== subIndex);

    const photosBefore: PhotoMap = {};
    const photosAfter: PhotoMap = {};
    before.forEach((sub, i) => {
      const photo = photos[photoKey(step.no, sub.no)];
      if (!photo) return;
      photosBefore[photoKey(step.no, sub.no)] = photo;
      if (i !== subIndex) photosAfter[photoKey(step.no, i < subIndex ? i + 1 : i)] = photo;
    });

    patchStep(
      stepIndex,
      before.filter((_, i) => i !== subIndex),
    );
    onStepPhotosReplace(step.no, photosAfter);
    armUndo({
      label: "ลบขั้นตอนย่อยแล้ว",
      restore: () => {
        // The same row keys too, so undo brings back that row rather than
        // re-animating the whole step
        rowKeys.current[stepIndex] = keysBefore;
        patchStep(stepIndex, before);
        onStepPhotosReplace(step.no, photosBefore);
      },
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

  // Commit toolsText into the document. Normally fires on blur; also called
  // right before leaving this page (สร้างเอกสาร / กลับไปหน้าเอกสาร JSA) in
  // case the user clicks straight from the textarea without blurring it
  // first — otherwise the last line they typed would ship in the editor's
  // local state but never reach procedure.tools or the PDF.
  const flushTools = () => patch({ tools: linesToList(toolsText) });

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h1 className="text-2xl font-semibold sm:text-[1.75rem] text-navy">ตรวจทานขั้นตอนปฏิบัติงาน</h1>
        <SaveStatus state={saveState} />
      </div>
      <p className="mt-1.5 text-muted">
        ระบบร่างขั้นตอนย่อยจาก JSA กรุณาตรวจสอบให้ตรงกับวิธีทำงานจริงก่อนสร้างเอกสาร
      </p>

      {/* Height + fade in, so a warning that appears while you're on the
          page (the JSA was changed in another tab) doesn't shove the form */}
      <Reveal show={stale}>
        <div className="pt-4">
          <div className="rounded-card border border-[var(--warning-border)] bg-[var(--warning-soft)] p-4">
            <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--warning-text)]">
              <TriangleAlert className="size-5 text-[var(--warning)]" aria-hidden="true" />
              JSA ถูกแก้ไขหลังจากสร้างเอกสารนี้
            </h2>
            <p className="mt-1 text-sm text-[var(--warning-text)]">
              ขั้นตอนใน JSA เปลี่ยนไปหลังจากร่างเอกสารนี้แล้ว
              กรุณาตรวจสอบว่ายังตรงกัน หรือสร้างขั้นตอนปฏิบัติงานใหม่
            </p>
            {/* Offered here rather than as a permanent action: this is the one
                moment the user has a concrete reason to want it, and it discards
                everything they've edited below */}
            <div className="mt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConfirmRegenerate(true)}
              >
                <RotateCcw className="size-4" aria-hidden="true" />
                สร้างใหม่จาก JSA ปัจจุบัน
              </Button>
            </div>
          </div>
        </div>
      </Reveal>

      <Card className="mt-4">
        <div className="grid gap-4">
          <div>
            <Label htmlFor="purpose">วัตถุประสงค์</Label>
            <AutoGrowTextarea
              id="purpose"
              minRows={1}
              value={procedure.purpose}
              onChange={(event) => patch({ purpose: event.target.value })}
            />
          </div>

          <div>
            <Label htmlFor="scope">ขอบเขต</Label>
            <AutoGrowTextarea
              id="scope"
              minRows={1}
              value={procedure.scope}
              onChange={(event) => patch({ scope: event.target.value })}
            />
          </div>

          <div>
            <Label htmlFor="tools">เครื่องมือ/อุปกรณ์ที่ต้องเตรียม</Label>
            <AutoGrowTextarea
              id="tools"
              minRows={1}
              // Raw text while typing, not procedure.tools.join("\n") — that
              // round-trip through linesToList's .filter(Boolean) on every
              // keystroke silently ate the very newline the user just typed
              // (an Enter press produces a trailing "" line, which filter()
              // strips before the next render, so the textarea's own value
              // snaps back to one line). Local state lets Enter actually land;
              // the list only gets cleaned up into procedure.tools on blur.
              value={toolsText}
              onChange={(event) => setToolsText(event.target.value)}
              onBlur={flushTools}
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
              <ul className="grid gap-1 rounded-field border border-line bg-surface p-3 text-sm text-muted">
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
      {/* Said once here rather than under every photo — with a photo on
          each sub-step, a per-photo note would repeat down the whole page */}
      <p className="mt-1 text-sm text-muted">
        แนบรูปภาพประกอบได้ที่แต่ละขั้นตอนย่อย (รูปภาพจะถูกลบหากลบงานนี้ออกจากประวัติ)
      </p>

      <ul className="mt-4 grid list-none gap-4 p-0">
        {procedure.steps.map((step, stepIndex) => (
          <li key={stepIndex}>
            <Card>
              <h3 className="font-display text-base font-semibold text-ink">
                {stepIndex + 1}. {step.procedure || "(ไม่มีชื่อขั้นตอน)"}
              </h3>

              <ul className="mt-3 grid list-none gap-3 p-0">
                <AnimatePresence initial={false}>
                {step.sub_steps.map((sub, subIndex) => (
                  <SubStepItem
                    key={keysFor(stepIndex, step.sub_steps.length)[subIndex]}
                    label={`${stepIndex + 1}.${subIndex + 1}`}
                    sub={sub}
                    photo={photos[photoKey(step.no, sub.no)]}
                    onTextChange={(action) => patchSub(stepIndex, subIndex, { action })}
                    onPhotoChange={(photo) => onPhotoChange(photoKey(step.no, sub.no), photo)}
                    onRemove={() => removeSub(stepIndex, subIndex)}
                  />
                ))}
                </AnimatePresence>
              </ul>

              <div className="mt-3 flex justify-start border-t border-line pt-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => addSub(stepIndex)}
                  className="text-sm"
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
        <div className="mt-4 rounded-card border border-[var(--warning-border)] bg-[var(--warning-soft)] p-4">
          <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--warning-text)]">
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

      <Reveal show={!!error}>
        <div className="pt-4">
          <Alert>{error}</Alert>
        </div>
      </Reveal>

      {/* Spacer so the fixed bar below doesn't cover the last bit of content */}
      <div className="h-20" aria-hidden="true" />

      {/* Fixed, matching EditorStep — on a long procedure these actions would
          otherwise only be reachable after scrolling the whole document */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line px-4 py-3 bg-surface/95 supports-backdrop-filter:bg-surface/80 supports-backdrop-filter:backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-[var(--page-max-w)] items-center gap-2 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            size="lg"
            onClick={() => {
              flushTools();
              onBack();
            }}
            aria-label="กลับไปหน้าเอกสาร JSA"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            {/* Short on phones so both buttons fit one row (see EditorStep's
                bottom bar) */}
            <span className="sm:hidden">กลับ</span>
            <span className="hidden sm:inline">กลับไปหน้าเอกสาร JSA</span>
          </Button>
          <Button
            type="button"
            size="lg"
            className="flex-1 sm:flex-none"
            onClick={() => {
              flushTools();
              onContinue();
            }}
          >
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

      {/* Unlike a step deletion this can't be undone with a toast — it
          replaces the whole document — so it asks first */}
      <ConfirmDialog
        open={confirmRegenerate}
        title="สร้างขั้นตอนปฏิบัติงานใหม่?"
        description="ระบบจะร่างขั้นตอนย่อยใหม่ทั้งหมดจาก JSA ปัจจุบัน สิ่งที่แก้ไขไว้ในหน้านี้จะหายไปและกู้คืนไม่ได้ (รูปภาพที่แนบไว้จะยังอยู่)"
        confirmLabel="สร้างใหม่"
        onConfirm={() => {
          setConfirmRegenerate(false);
          onRegenerate();
        }}
        onCancel={() => setConfirmRegenerate(false)}
      />
    </section>
  );
}

/** One sub-step row: number, text, photo + delete buttons, and the photo
 * (if any) under the text. Its own component so each row gets its own
 * usePhotoInput state — busy spinner, error, drag highlight. */
function SubStepItem({
  label,
  sub,
  photo,
  onTextChange,
  onPhotoChange,
  onRemove,
}: {
  /** "1.2" as shown on screen */
  label: string;
  sub: SubStep;
  photo: StepPhoto | undefined;
  onTextChange: (action: string) => void;
  onPhotoChange: (photo: StepPhoto | null) => void;
  onRemove: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const input = usePhotoInput(onPhotoChange);

  return (
    <motion.li
      layout="position"
      {...listItem}
      {...input.dropProps(setDragging)}
      className={`grid grid-cols-[auto_1fr_auto] items-start gap-2 border-t border-line pt-3 transition-colors ${
        dragging ? "rounded-field bg-navy-soft" : ""
      }`}
    >
      <span className="pt-2.5 text-sm text-muted tabular-nums">{label}</span>
      <div className="min-w-0">
        <AutoGrowTextarea
          minRows={1}
          value={sub.action}
          placeholder="รายละเอียดขั้นตอนย่อย"
          aria-label={`ขั้นตอนย่อยที่ ${label}`}
          onChange={(event) => onTextChange(event.target.value)}
          onPaste={input.onPaste}
        />
        {photo ? (
          <PhotoPreview
            photo={photo}
            label={`รูปภาพประกอบขั้นตอนย่อยที่ ${label}`}
            onRemove={() => onPhotoChange(null)}
          />
        ) : null}
        <FieldError>{input.error}</FieldError>
      </div>
      <div className="flex">
        {/* Replacing a photo goes through ลบรูปภาพ first — one photo per
            sub-step, so the button only appears while the slot is empty.
            Its space stays reserved (size-9 = icon-lg) so every row's text
            box keeps the same width whether or not it has a photo. */}
        {photo ? (
          <span className="mt-1 size-9 shrink-0" aria-hidden="true" />
        ) : (
          <PhotoButton
            label={`เพิ่มรูปภาพประกอบขั้นตอนย่อยที่ ${label}`}
            busy={input.busy}
            onClick={input.openPicker}
          />
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          aria-label={`ลบขั้นตอนย่อยที่ ${label}`}
          onClick={onRemove}
          className="mt-1 text-muted hover:bg-danger-soft hover:text-danger-text"
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </Button>
      </div>
      {input.fileInput}
    </motion.li>
  );
}
