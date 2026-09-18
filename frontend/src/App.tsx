import { useEffect, useRef, useState } from "react";

import { AppBar } from "./components/AppBar";
import { Stepper } from "./components/Stepper";
import { EditorStep } from "./features/jsa-editor/EditorStep";
import { GeneratingPanel } from "./features/jsa-input/GeneratingPanel";
import { PROCEDURE_STAGES } from "./features/jsa-input/generatingStages";
import { HistoryList } from "./features/jsa-input/HistoryList";
import { InputStep } from "./features/jsa-input/InputStep";
import { PdfStep } from "./features/pdf-view/PdfStep";
import { ProcedureEditorStep } from "./features/procedure/ProcedureEditorStep";
import { ProcedurePdfStep } from "./features/procedure/ProcedurePdfStep";
import type { StepPhoto } from "./lib/pdf/layout";
import * as historyStore from "./history";
import type { HistoryEntry } from "./history";
import {
  ApiError,
  CancelledError,
  fetchPublicConfig,
  generateJsa,
  generateProcedure,
  type PublicConfig,
} from "./lib/api";
import {
  stepFingerprint,
  type InputForm,
  type JsaDocument,
  type ProcedureDocument,
} from "./lib/schema";
import { clearAllDrafts, currentHistoryId, docDraft, procedureDraft } from "./store";

// How long to wait after the last edit before rewriting the history entry.
// The editor changes `doc` on every keystroke; localStorage writes serialize
// the whole list, so they don't belong on that path.
const HISTORY_SAVE_DEBOUNCE_MS = 800;

// A blank starting point for users who skip the AI draft and fill the JSA
// in by hand — one empty step with one empty hazard, matching the shape
// EditorStep's own "เพิ่มขั้นตอน"/"เพิ่มอันตราย" actions add.
function buildBlankDocument(
  values: Pick<InputForm, "supervisor" | "analysis_date" | "analyst">,
): JsaDocument {
  return {
    header: { work_activity: "", ...values },
    steps: [{ no: 1, procedure: "", details: "", hazards: [{ hazard: "", controls: [""] }] }],
    assumptions: [],
  };
}

// 0-2 are the JSA wizard and map 1:1 onto the Stepper. 3-4 are the optional
// work procedure, reached only from stage 2 — see the Stepper note in the JSX
// for why they don't get their own step in the progress bar.
type Stage = 0 | 1 | 2 | 3 | 4;

export default function App() {
  const [stage, setStage] = useState<Stage>(0);
  const [doc, setDoc] = useState<JsaDocument | null>(() => docDraft.load());
  const [procedure, setProcedure] = useState<ProcedureDocument | null>(() =>
    procedureDraft.load(),
  );
  const [busy, setBusy] = useState(false);
  const [procedureBusy, setProcedureBusy] = useState(false);
  const [procedureError, setProcedureError] = useState<string | null>(null);
  /* Photos attached to procedure steps, keyed by ProcedureStep.no.
   *
   * Held here rather than inside ProcedureDocument on purpose. That type
   * mirrors the backend model and is written to sessionStorage on every
   * keystroke (see updateProcedure), so megabytes of base64 inside it would be
   * both a schema lie and a typing-lag bug. Keeping them separate also means a
   * regenerate replaces the document while the photos stay put.
   *
   * Consequence, accepted by design: photos are memory-only and do not survive
   * a refresh. The exported PDF is the permanent copy, and the editor says so. */
  const [photos, setPhotos] = useState<Record<number, StepPhoto>>({});
  const [error, setError] = useState<string | null>(null);
  const [appName, setAppName] = useState("GenJSA");
  const [config, setConfig] = useState<PublicConfig | null>(null);
  // Ref, not state: only ever read from an event handler (cancelGenerate),
  // never rendered — a state setter here would just cause an extra re-render
  // every generate call for no visual purpose
  const generateController = useRef<AbortController | null>(null);
  // Which historyStore.ts entry the current document belongs to, so edits update
  // that row instead of piling up duplicates
  const [historyId, setHistoryId] = useState<string | null>(() =>
    currentHistoryId.load(),
  );

  // If a draft JSA is left over (refresh mid-flow), jump straight back to the editor step
  useEffect(() => {
    if (doc) setStage(1);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Guard against a blank screen: if the draft disappears (cleared elsewhere), never stay stuck on step 2/3
  useEffect(() => {
    if (stage !== 0 && !doc) {
      setHistoryId(null);
      clearAllDrafts();
      setStage(0);
    }
  }, [stage, doc]);

  // The procedure pages need a procedure. Falling back to stage 2 rather than
  // 0 on purpose: losing the procedure says nothing about the JSA, which is
  // still perfectly usable.
  useEffect(() => {
    if (stage >= 3 && !procedure) setStage(2);
  }, [stage, procedure]);

  // Keep the history entry in step with the document being edited
  useEffect(() => {
    if (!doc || !historyId) return;
    // Don't leave an empty row behind for a manual entry the user abandons
    const worthKeeping =
      doc.header.work_activity.trim() || doc.steps.some((s) => s.procedure.trim());
    if (!worthKeeping) return;

    const timer = setTimeout(
      () => historyStore.upsertDoc(historyId, doc),
      HISTORY_SAVE_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [doc, historyId]);

  // Same for the procedure. Separate from the effect above because the two
  // documents are edited on different pages and change independently —
  // upsertProcedure merges rather than replacing, so neither erases the other.
  useEffect(() => {
    if (!procedure || !historyId) return;
    const timer = setTimeout(
      () => historyStore.upsertProcedure(historyId, procedure),
      HISTORY_SAVE_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [procedure, historyId]);

  useEffect(() => {
    // One config powers both the app name display and PDF drawing (layout values from config/pdf.yaml)
    void fetchPublicConfig().then((loaded) => {
      if (!loaded) return;
      setConfig(loaded);
      setAppName(loaded.appName);
    });
  }, []);

  const startHistoryEntry = () => {
    const id = historyStore.newId();
    setHistoryId(id);
    currentHistoryId.save(id);
  };

  /** Drop the procedure from screen and draft storage. The copy already in
   * history stays: it belongs to whatever entry it was generated for. */
  const discardProcedure = () => {
    setProcedure(null);
    setProcedureError(null);
    procedureDraft.clear();
    // Required, not tidiness: photos are keyed by step number, so leaving them
    // behind would attach this job's images to the next job's steps 1, 2, 3…
    setPhotos({});
  };

  const handleGenerate = async (values: InputForm, detailed: boolean) => {
    setBusy(true);
    setError(null);
    const controller = new AbortController();
    generateController.current = controller;
    try {
      const generated = await generateJsa(
        { ...values, detailed },
        { signal: controller.signal },
      );
      setDoc(generated);
      docDraft.save(generated);
      // A new JSA means any procedure on screen describes a different job
      discardProcedure();
      startHistoryEntry();
      setStage(1);
      window.scrollTo({ top: 0 });
    } catch (caught) {
      // Cancelled by the user (see cancelGenerate) — not a failure, so no
      // error banner; just fall through to the form as if nothing happened.
      // Form data is otherwise left untouched on a real error too — never
      // clear anything just because the request failed.
      if (!(caught instanceof CancelledError)) {
        setError(
          caught instanceof ApiError
            ? caught.message
            : "เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองอีกครั้ง",
        );
      }
    } finally {
      setBusy(false);
      generateController.current = null;
    }
  };

  // "ยกเลิก" during GeneratingPanel — aborts the in-flight fetch so the
  // wait actually stops, rather than just hiding it while the request (and
  // its eventual setDoc/setStage) keeps running in the background
  const cancelGenerate = () => generateController.current?.abort();

  const handleSkipToManual = (
    values: Pick<InputForm, "supervisor" | "analysis_date" | "analyst">,
  ) => {
    const blank = buildBlankDocument(values);
    setDoc(blank);
    docDraft.save(blank);
    discardProcedure();
    startHistoryEntry();
    setStage(1);
    window.scrollTo({ top: 0 });
  };

  /** Restore both documents from a history entry. `to` is where to land —
   * the two callers differ only in that. */
  const openHistoryEntry = (entry: HistoryEntry, to: Stage) => {
    setDoc(entry.doc);
    // Required, not belt-and-braces: without it the blank-screen guard above
    // can bounce straight back to step 1
    docDraft.save(entry.doc);
    // Bring back the procedure too when this entry has one, so reopening
    // yesterday's job restores both documents rather than silently half of it
    if (entry.procedure) {
      setProcedure(entry.procedure);
      procedureDraft.save(entry.procedure);
    } else {
      discardProcedure();
    }
    setHistoryId(entry.id);
    currentHistoryId.save(entry.id);
    setError(null);
    setStage(to);
    window.scrollTo({ top: 0 });
  };

  const handleOpenHistory = (entry: HistoryEntry) => openHistoryEntry(entry, 1);

  /** Straight to the procedure editor, for the "+ ขั้นตอนปฏิบัติงาน" badge.
   * Safe even if the procedure fails to restore: the guard above bounces
   * stage 3 back to 2 rather than leaving a blank screen. */
  const handleOpenHistoryProcedure = (entry: HistoryEntry) =>
    openHistoryEntry(entry, 3);

  const startOver = () => {
    setDoc(null);
    discardProcedure();
    setError(null);
    setHistoryId(null);
    // Drafts only — past work in historyStore.ts deliberately survives "เริ่มใหม่"
    clearAllDrafts();
    setStage(0);
    window.scrollTo({ top: 0 });
  };

  /** Draft a procedure from the current JSA.
   *
   * From the PDF page this reopens an existing one rather than spending
   * another AI call; `force` is the editor's "regenerate" path, which has
   * already confirmed that the user's edits are being discarded. */
  const handleCreateProcedure = async ({ force = false } = {}) => {
    if (!doc) return;
    if (procedure && !force) {
      goto(3);
      return;
    }

    setProcedureBusy(true);
    setProcedureError(null);
    try {
      const generated = await generateProcedure(doc);
      setProcedure(generated);
      procedureDraft.save(generated);
      // Photos survive a regenerate — they're the user's own work, not the
      // AI's, and the step they illustrate usually still exists. Drop only the
      // ones whose step number is gone from the new draft, so repeated
      // redrafts in one session can't accumulate unreachable images.
      setPhotos((current) => {
        const live = new Set(generated.steps.map((step) => step.no));
        return Object.fromEntries(
          Object.entries(current).filter(([no]) => live.has(Number(no))),
        );
      });
      goto(3);
    } catch (caught) {
      setProcedureError(
        caught instanceof ApiError
          ? caught.message
          : "สร้างขั้นตอนปฏิบัติงานไม่สำเร็จ กรุณาลองอีกครั้ง",
      );
    } finally {
      setProcedureBusy(false);
    }
  };

  const updateProcedure = (next: ProcedureDocument) => {
    setProcedure(next);
    procedureDraft.save(next);
  };

  /** Attach or clear one step's photo. Never touches the document. */
  const updatePhoto = (stepNo: number, photo: StepPhoto | null) => {
    setPhotos((current) => {
      const next = { ...current };
      if (photo) next[stepNo] = photo;
      else delete next[stepNo];
      return next;
    });
  };

  const goto = (next: Stage) => {
    setStage(next);
    window.scrollTo({ top: 0 });
  };

  // The procedure mirrors the JSA's step list, so edits to those steps leave
  // it describing work that no longer matches — warn rather than silently
  // resync, which would throw away the user's own edits to the procedure
  const procedureStale =
    !!doc && !!procedure && stepFingerprint(doc) !== stepFingerprint(procedure);

  return (
    <div className="min-h-dvh flex flex-col bg-surface">
      <AppBar
        appName={appName}
        documentMeta={config?.document}
        department={config?.company.department}
        onHome={startOver}
      />

      {/* max-w-[var(--page-max-w)] — shared with AppBar.tsx's title-bar row
          so the two always share the same left/right edges (see tokens.css).
          It's wider than the 60rem every other stage needs only so stage 0
          has room for the form's own 45rem plus a real side column for
          history on desktop; EditorStep/PdfStep pin themselves back to
          their previous, narrower widths below so they're unaffected. */}
      <main className="mx-auto w-full max-w-[var(--page-max-w)] flex-1 px-4 py-6 sm:py-8">
        {/* current stays clamped to 2: the work procedure (stages 3-4) is
            optional and branches off the JSA's last step rather than
            extending the wizard — most users will stop at the JSA, and a
            permanent fourth circle would imply it isn't finished without one.
            `branch` is how stages 3-4 still get a "you are here": see its doc
            comment in Stepper.tsx for why it's a dashed branch node rather
            than a fourth step. */}
        <Stepper
          current={Math.min(stage, 2) as 0 | 1 | 2}
          onNavigate={goto}
          branch={
            stage >= 3
              ? { label: "ขั้นตอนปฏิบัติงาน", onBack: () => goto(2) }
              : undefined
          }
        />

        {stage === 0 ? (
          // Below xl: unchanged — single 45rem column, history stacked below
          // the form. From xl up, with real desktop width to spare: history
          // moves beside the form as its own column instead of competing for
          // vertical space under it (see HistoryList.tsx's matching xl:
          // classes that drop its now-unneeded top divider). Deliberately
          // xl (1280px), not lg (1024px) — the form alone is 45rem (720px),
          // so anything narrower than xl only leaves the side column ~300px
          // wide: enough to break, not enough to look right (heading wraps,
          // search placeholder truncates).
          <div className="mx-auto grid max-w-[45rem] gap-y-10 xl:max-w-none xl:grid-cols-[45rem_1fr] xl:items-start xl:gap-x-12 xl:gap-y-0">
            <InputStep
              onGenerate={handleGenerate}
              onSkipToManual={handleSkipToManual}
              // Only set when reached via the stepper's back-navigation
              // (doc already exists then — see the effect above that jumps
              // stage to 1 whenever a fresh mount finds a doc) — never on a
              // genuinely fresh session, where there's nothing to cancel back to
              onCancel={doc ? () => goto(1) : undefined}
              onCancelGenerate={cancelGenerate}
              busy={busy}
              error={error}
            />
            {/* Hidden while generating so it doesn't compete with GeneratingPanel */}
            {busy ? null : (
              <HistoryList
                onOpen={handleOpenHistory}
                onOpenProcedure={handleOpenHistoryProcedure}
              />
            )}
          </div>
        ) : null}

        {/* No inner max-w wrapper — the table benefits from the room, and it
            keeps this stage's body flush with AppBar's edges (both share
            <main>'s max-w-[var(--page-max-w)]) instead of sitting narrower
            and off-center under a wider title bar. */}
        {stage === 1 && doc ? (
          <EditorStep
            doc={doc}
            onChange={setDoc}
            onContinue={() => goto(2)}
            onStartOver={startOver}
            error={error}
          />
        ) : null}

        {/* The procedure takes as long as the JSA did, so it gets the same
            honest wait — elapsed counter and all — rather than a lone spinner
            on a button. Replaces the page content for the same reason
            InputStep does: the wait should be the only thing on screen. */}
        {stage === 2 && doc && procedureBusy ? (
          <div className="mx-auto max-w-[45rem]">
            <h1 className="text-[1.75rem] font-semibold text-navy">
              กำลังสร้างขั้นตอนปฏิบัติงาน
            </h1>
            <GeneratingPanel stages={PROCEDURE_STAGES} />
          </div>
        ) : null}

        {stage === 2 && doc && !procedureBusy ? (
          <div className="mx-auto max-w-[45rem]">
            <PdfStep
              doc={doc}
              config={config}
              onBack={() => goto(1)}
              onNewJsa={startOver}
              onCreateProcedure={() => void handleCreateProcedure()}
              procedureBusy={procedureBusy}
              procedureError={procedureError}
              hasProcedure={!!procedure}
            />
          </div>
        ) : null}

        {/* Regenerating replaces the editor with the same full-page wait as a
            first-time draft, for the same reason: the old sub-steps must not
            stay on screen and editable while a response that's about to
            overwrite them is in flight — the AI's reply silently wins that
            race, so nothing here may be edited until it lands. */}
        {stage === 3 && procedure && procedureBusy ? (
          <div className="mx-auto max-w-[45rem]">
            <h1 className="text-[1.75rem] font-semibold text-navy">
              กำลังสร้างขั้นตอนปฏิบัติงานใหม่
            </h1>
            <GeneratingPanel stages={PROCEDURE_STAGES} />
          </div>
        ) : null}

        {stage === 3 && procedure && !procedureBusy ? (
          <div className="mx-auto max-w-[45rem]">
            <ProcedureEditorStep
              procedure={procedure}
              onChange={updateProcedure}
              photos={photos}
              onPhotoChange={updatePhoto}
              onContinue={() => goto(4)}
              onBack={() => goto(2)}
              onRegenerate={() => void handleCreateProcedure({ force: true })}
              stale={procedureStale}
              error={procedureError}
            />
          </div>
        ) : null}

        {stage === 4 && procedure ? (
          <div className="mx-auto max-w-[45rem]">
            <ProcedurePdfStep
              procedure={procedure}
              photos={photos}
              config={config}
              onBack={() => goto(3)}
              onBackToJsa={() => goto(2)}
            />
          </div>
        ) : null}
      </main>
    </div>
  );
}
