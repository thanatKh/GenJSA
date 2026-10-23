import { useEffect, useRef, useState } from "react";

import { AppBar } from "./components/AppBar";
import type { SaveState } from "./components/SaveStatus";
import { Stepper } from "./components/Stepper";
import { EditorStep } from "./features/jsa-editor/EditorStep";
import { GeneratingPanel } from "./features/jsa-input/GeneratingPanel";
import { PROCEDURE_STAGES } from "./features/jsa-input/generatingStages";
import { HistoryList } from "./features/jsa-input/HistoryList";
import { InputStep } from "./features/jsa-input/InputStep";
import { PdfStep } from "./features/pdf-view/PdfStep";
import { ProcedureEditorStep } from "./features/procedure/ProcedureEditorStep";
import { ProcedurePdfStep } from "./features/procedure/ProcedurePdfStep";
import { usePhotos } from "./features/procedure/usePhotos";
import { useCompanyLogo } from "./features/company/useCompanyLogo";
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
import type { CompanyLogo } from "./lib/companyLogo";
import { photoKey } from "./lib/pdf/layout";
import * as photoStore from "./lib/photoStore";
import {
  stepFingerprint,
  type InputForm,
  type JsaDocument,
  type ProcedureDocument,
} from "./lib/schema";
import { todayIso } from "./lib/thaidate";
import { clearAllDrafts, currentHistoryId, docDraft, procedureDraft } from "./store";

// How long to wait after the last edit before rewriting the history entry.
// The editor changes `doc` on every keystroke; localStorage writes serialize
// the whole list, so they don't belong on that path.
const HISTORY_SAVE_DEBOUNCE_MS = 800;

// A blank starting point for users who skip the AI draft and fill the JSA
// in by hand — one empty step with one empty hazard, matching the shape
// EditorStep's own "เพิ่มขั้นตอน"/"เพิ่มอันตราย" actions add.
function buildBlankDocument(
  values: Pick<InputForm, "supervisor" | "analyst" | "company">,
): JsaDocument {
  return {
    header: { work_activity: "", analysis_date: todayIso(), ...values },
    steps: [{ no: 1, procedure: "", details: "", hazards: [{ hazard: "", controls: [""] }] }],
    assumptions: [],
  };
}

// 0-2 are the JSA wizard and map 1:1 onto the Stepper. 3-4 are the optional
// work procedure, reached only from stage 2 — see the Stepper note in the JSX
// for why they don't get their own step in the progress bar.
type Stage = 0 | 1 | 2 | 3 | 4;

/** What <main> actually renders, computed once from (stage, doc, procedure,
 * busy, procedureBusy) instead of re-derived at each of 7 separate JSX
 * "stage === N && doc && ..." conditions.
 *
 * Before this existed, the rule "what does stage 2 show" was written out
 * twice (once for `procedureBusy`, once for `!procedureBusy`) and had to be
 * kept in sync by hand with the three useEffect guards below that patch up
 * invalid (stage, doc, procedure) combinations after the fact — nearly every
 * commit that's touched this file's render section (procedure flow, photo
 * feature, stepper branch) had to update both places and cross-check they
 * still agreed. Computing `view` once here doesn't change what CAN happen —
 * the guard effects and state setters are untouched — it only gives the
 * render decision one owner instead of several copies that could drift.
 *
 * Deliberately not a reducer/discriminated-union replacement of stage/doc/
 * procedure themselves — that's a bigger, riskier change to the state shape
 * and handler call sites. This only centralizes what's rendered, computed
 * fresh every render so it can never itself go stale.
 */
type View =
  | { kind: "input" }
  | { kind: "editing"; doc: JsaDocument }
  | { kind: "procedureGenerating"; doc: JsaDocument; heading: string }
  | { kind: "pdf"; doc: JsaDocument }
  | { kind: "procedureEditing"; doc: JsaDocument; procedure: ProcedureDocument }
  | { kind: "procedurePdf"; doc: JsaDocument; procedure: ProcedureDocument };

function computeView(
  stage: Stage,
  doc: JsaDocument | null,
  procedure: ProcedureDocument | null,
  procedureBusy: boolean,
): View | null {
  if (stage === 0) return { kind: "input" };
  if (stage === 1) return doc ? { kind: "editing", doc } : null;
  if (stage === 2) {
    if (!doc) return null;
    return procedureBusy
      ? { kind: "procedureGenerating", doc, heading: "กำลังสร้างขั้นตอนปฏิบัติงาน" }
      : { kind: "pdf", doc };
  }
  if (stage === 3) {
    if (!doc || !procedure) return null;
    return procedureBusy
      ? { kind: "procedureGenerating", doc, heading: "กำลังสร้างขั้นตอนปฏิบัติงานใหม่" }
      : { kind: "procedureEditing", doc, procedure };
  }
  // stage === 4
  return doc && procedure ? { kind: "procedurePdf", doc, procedure } : null;
}

export default function App() {
  const [stage, setStage] = useState<Stage>(0);
  const [doc, setDoc] = useState<JsaDocument | null>(() => docDraft.load());
  const [procedure, setProcedure] = useState<ProcedureDocument | null>(() =>
    procedureDraft.load(),
  );
  const [busy, setBusy] = useState(false);
  const [procedureBusy, setProcedureBusy] = useState(false);
  const [procedureError, setProcedureError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [appName, setAppName] = useState("GenJSA");
  const [config, setConfig] = useState<PublicConfig | null>(null);
  // Ref, not state: only ever read from an event handler (cancelGenerate),
  // never rendered — a state setter here would just cause an extra re-render
  // every generate call for no visual purpose
  const generateController = useRef<AbortController | null>(null);
  // Same reasoning, separate controller: generateProcedureFrom runs from two
  // different stages (2: first draft, from the PDF page or a history row;
  // 3: regenerate) and is never in flight
  // at the same time as handleGenerate's own controller above, but keeping
  // them separate avoids one cancel button ever accidentally reaching into
  // the other flow's request.
  const procedureController = useRef<AbortController | null>(null);
  // Which historyStore.ts entry the current document belongs to, so edits update
  // that row instead of piling up duplicates
  const [historyId, setHistoryId] = useState<string | null>(() =>
    currentHistoryId.load(),
  );
  // Owns the photos map AND keeping it synced with lib/photoStore.ts
  // (IndexedDB) — see usePhotos.ts's own header for why this used to be 4
  // separate hand-synced call sites in this file. Re-keys to whatever job
  // `historyId` currently points at; the hook's own effect handles loading
  // that job's persisted photos (covers both a refresh mid-review and
  // opening a history entry). Also given the procedure, so photos saved
  // before they moved to sub-steps can be placed on the right sub-step.
  const {
    photos,
    setPhoto: updatePhoto,
    replaceStepPhotos,
    pruneToLiveKeys,
  } = usePhotos(historyId, procedure);
  // The open document's company logo — browser-only, like photos. See
  // useCompanyLogo.ts for why a new job gets its logo via setLogoFor.
  const {
    logo: companyLogo,
    setLogo: setCompanyLogo,
    setLogoFor: setCompanyLogoFor,
  } = useCompanyLogo(historyId);

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

  // Keep the history entry in step with the document being edited. The
  // save states feed the editors' "บันทึกแล้ว" indicator (SaveStatus.tsx).
  const [docSave, setDocSave] = useState<SaveState>("idle");
  const [procedureSave, setProcedureSave] = useState<SaveState>("idle");
  useEffect(() => {
    if (!doc || !historyId) return;
    // Don't leave an empty row behind for a manual entry the user abandons
    const worthKeeping =
      doc.header.work_activity.trim() || doc.steps.some((s) => s.procedure.trim());
    if (!worthKeeping) {
      setDocSave("idle");
      return;
    }

    setDocSave("saving");
    const timer = setTimeout(
      () => setDocSave(historyStore.upsertDoc(historyId, doc) ? "saved" : "failed"),
      HISTORY_SAVE_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [doc, historyId]);

  // Same for the procedure. Separate from the effect above because the two
  // documents are edited on different pages and change independently —
  // upsertProcedure merges rather than replacing, so neither erases the other.
  useEffect(() => {
    if (!procedure || !historyId) return;
    setProcedureSave("saving");
    const timer = setTimeout(
      () => setProcedureSave(historyStore.upsertProcedure(historyId, procedure) ? "saved" : "failed"),
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

  const startHistoryEntry = (): string => {
    const id = historyStore.newId();
    setHistoryId(id);
    currentHistoryId.save(id);
    return id;
  };

  /** Drop the procedure from screen and draft storage. The copy already in
   * history stays: it belongs to whatever entry it was generated for — and
   * so do its photos. Every caller also moves to another historyId (or
   * none), which is what clears photos from the screen; see usePhotos.ts. */
  const discardProcedure = () => {
    setProcedure(null);
    setProcedureError(null);
    procedureDraft.clear();
  };

  const handleGenerate = async (
    values: InputForm,
    withProcedure: boolean,
    logo: CompanyLogo | null,
  ) => {
    setBusy(true);
    setError(null);
    const controller = new AbortController();
    generateController.current = controller;
    // The history id this run allocates, if it gets that far — the cancel
    // branch below rolls back the logo saved under it along with the rest
    let newEntryId: string | null = null;
    try {
      // The date is today, stamped at the moment of creating — the first
      // screen no longer asks for it (a saved draft used to carry yesterday's
      // date into today's JSA); it stays editable in the JSA editor.
      const generated = await generateJsa(
        { ...values, analysis_date: todayIso() },
        { signal: controller.signal },
      );
      setDoc(generated);
      docDraft.save(generated);
      // A new JSA means any procedure on screen describes a different job
      discardProcedure();
      newEntryId = startHistoryEntry();
      setCompanyLogoFor(newEntryId, logo);

      // Chained under the SAME controller/signal as the JSA call, so ยกเลิก
      // (cancelGenerate) aborts either half — including after the JSA already
      // succeeded, per the "cancel always discards everything" choice made
      // for this feature. The JSA is only committed to history below, once
      // this whole block (both calls) is past the point where it can still
      // be cancelled — see the CancelledError branch, which intentionally
      // discards a JSA that finished but whose procedure call was cancelled.
      if (withProcedure) {
        setProcedureBusy(true);
        setProcedureError(null);
        try {
          const procedureGenerated = await generateProcedure(generated, {
            signal: controller.signal,
          });
          setProcedure(procedureGenerated);
          procedureDraft.save(procedureGenerated);
        } catch (procedureCaught) {
          // The JSA already succeeded and is kept regardless — losing the
          // procedure never costs the user the document they actually asked
          // to review first. Cancellation here is handled by the outer catch
          // (the same AbortSignal rejects both fetches), so this only ever
          // reports a genuine procedure failure.
          if (!(procedureCaught instanceof CancelledError)) {
            setProcedureError(
              procedureCaught instanceof ApiError
                ? procedureCaught.message
                : "สร้างขั้นตอนปฏิบัติงานไม่สำเร็จ กรุณาลองอีกครั้ง",
            );
          } else {
            throw procedureCaught;
          }
        } finally {
          setProcedureBusy(false);
        }
      }

      setStage(1);
      window.scrollTo({ top: 0 });
    } catch (caught) {
      // Cancelled by the user (see cancelGenerate) — not a failure, so no
      // error banner; just fall through to the form as if nothing happened.
      // Form data is otherwise left untouched on a real error too — never
      // clear anything just because the request failed. A cancel during the
      // procedure half also discards the JSA that already finished, matching
      // "ยกเลิก always aborts everything" — setStage/setDoc above already ran
      // for the JSA, so undo them rather than leaving a half-finished result
      // stage 0 has no way to explain.
      if (caught instanceof CancelledError) {
        // Only reachable once the JSA already succeeded and the cancel landed
        // during the procedure half — a plain single-JSA cancel never gets
        // here at all, since setDoc/startHistoryEntry below only run after
        // generateJsa resolves. Roll back exactly what this function itself
        // set: the JSA, its draft, and the history id it allocated.
        //
        // Deliberately NOT inputDraft — GeneratingPanel's cancel button relies
        // on the typed description surviving any cancel with no confirm
        // dialog; clearing it here would break that promise for this one path.
        setDoc(null);
        docDraft.clear();
        discardProcedure();
        if (newEntryId) void photoStore.remove(newEntryId, photoStore.COMPANY_LOGO_KEY);
        setHistoryId(null);
        currentHistoryId.clear();
      } else {
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
    values: Pick<InputForm, "supervisor" | "analyst" | "company">,
    logo: CompanyLogo | null,
  ) => {
    const blank = buildBlankDocument(values);
    setDoc(blank);
    docDraft.save(blank);
    discardProcedure();
    setCompanyLogoFor(startHistoryEntry(), logo);
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
  const handleCreateProcedure = ({ force = false } = {}) => {
    if (!doc) return;
    if (procedure && !force) {
      goto(3);
      return;
    }
    void generateProcedureFrom(doc);
  };

  /** "สร้างขั้นตอนปฏิบัติงาน" on a history row with no procedure yet: open
   * that job on its JSA PDF page and start drafting straight away. Stage 2
   * is where the wait already lives (computeView shows the busy panel there),
   * and it's also where a cancel or a failed draft leaves the user — on the
   * job's own PDF page, with PdfStep showing the error and its retry button.
   *
   * Passes entry.doc rather than relying on `doc`: openHistoryEntry's state
   * updates haven't rendered yet when this runs. */
  const handleCreateHistoryProcedure = (entry: HistoryEntry) => {
    openHistoryEntry(entry, 2);
    void generateProcedureFrom(entry.doc);
  };

  const generateProcedureFrom = async (source: JsaDocument) => {
    setProcedureBusy(true);
    setProcedureError(null);
    const controller = new AbortController();
    procedureController.current = controller;
    try {
      const generated = await generateProcedure(source, { signal: controller.signal });
      setProcedure(generated);
      procedureDraft.save(generated);
      // Photos survive a regenerate — they're the user's own work, not the
      // AI's. Drop only the ones whose sub-step number is gone from the new
      // draft, so repeated redrafts in one session can't accumulate
      // unreachable images (both the in-memory map and the persisted copy —
      // see usePhotos.ts).
      pruneToLiveKeys(
        generated.steps.flatMap((step) => step.sub_steps.map((sub) => photoKey(step.no, sub.no))),
      );
      goto(3);
    } catch (caught) {
      // Cancelled via ยกเลิก on the busy panel — not a failure, so no error
      // banner. Unlike handleGenerate's combined flow, there is nothing to
      // roll back here: this function never touches `procedure` until the
      // request actually succeeds (see setProcedure above), so a cancel
      // during a first-time draft leaves the caller back on PdfStep exactly
      // as it was, and a cancel during a regenerate leaves the existing
      // procedure on screen untouched.
      if (!(caught instanceof CancelledError)) {
        setProcedureError(
          caught instanceof ApiError
            ? caught.message
            : "สร้างขั้นตอนปฏิบัติงานไม่สำเร็จ กรุณาลองอีกครั้ง",
        );
      }
    } finally {
      setProcedureBusy(false);
      procedureController.current = null;
    }
  };

  // "ยกเลิก" on the busy panel shown for every generateProcedureFrom path
  // (first draft at stage 2, regenerate at stage 3) — aborts the
  // in-flight fetch so the wait actually stops, same reasoning as
  // cancelGenerate above.
  const cancelCreateProcedure = () => procedureController.current?.abort();

  const updateProcedure = (next: ProcedureDocument) => {
    setProcedure(next);
    procedureDraft.save(next);
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

  // null here means "stage doesn't match what's actually in state" — e.g. a
  // fresh mount on stage 1 before the very first effect below has run, or a
  // frame between setDoc(null) and the guard effect reacting to it. Never
  // rendered as an error: the effects below always resolve it to a real
  // stage on the next render, so <main> just renders nothing that one frame,
  // the same "briefly blank, never wrong" behavior the old JSX had by
  // falling through every condition.
  const view = computeView(stage, doc, procedure, procedureBusy);

  return (
    <div className="min-h-dvh flex flex-col bg-surface">
      <AppBar
        appName={appName}
        documentMeta={config?.document}
        department={config?.company.department}
        developer={config?.about?.developer}
        contactEmail={config?.about?.contactEmail}
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
            than a fourth step.

            Width: every stage but 1 wraps its own content at max-w-[45rem]
            (stage 0 escapes that at xl: via its own grid — see below), so the
            Stepper needs the same cap there or it visibly overflows past the
            narrower content beneath it. Only stage 1 (EditorStep) spans the
            full <main> width by design, so the Stepper matches that here too
            instead of shrinking to 45rem above a wider table. */}
        <div
          className={
            stage === 1
              ? undefined
              : stage === 0
                ? "mx-auto max-w-[45rem] xl:max-w-none"
                : "mx-auto max-w-[45rem]"
          }
        >
          <Stepper
            current={Math.min(stage, 2) as 0 | 1 | 2}
            onNavigate={goto}
            branch={
              stage >= 3
                ? {
                    label: "ขั้นตอนปฏิบัติงาน",
                    onBack: () => goto(2),
                    // Inert on stage 3 (ProcedureEditorStep) — that's the page
                    // this node itself represents. Stays a live back-link on
                    // stage 4 (ProcedurePdfStep), a genuinely different page.
                    isCurrent: stage === 3,
                  }
                : undefined
            }
          />
        </div>

        {view?.kind === "input" ? (
          // Below xl: unchanged — single 45rem column, history stacked below
          // the form. From xl up, with real desktop width to spare: history
          // moves beside the form as its own column instead of competing for
          // vertical space under it (see HistoryList.tsx's matching xl:
          // classes that drop its now-unneeded top divider). Deliberately
          // xl (1280px), not lg (1024px) — the form alone is 45rem (720px),
          // so anything narrower than xl only leaves the side column ~300px
          // wide: enough to break, not enough to look right (heading wraps,
          // search placeholder truncates).
          //
          // Grid's default stretch (no xl:items-start override) — the history
          // column now matches the form's full height so its own scroll area
          // can grow into it (see HistoryList.tsx's h-full + flex-1 scroll
          // list), instead of sizing to its own short content and floating
          // next to a much taller form.
          <div className="mx-auto grid max-w-[45rem] gap-y-10 xl:max-w-none xl:grid-cols-[45rem_1fr] xl:gap-x-12 xl:gap-y-0">
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
                onCreateProcedure={handleCreateHistoryProcedure}
              />
            )}
          </div>
        ) : null}

        {/* No inner max-w wrapper — the table benefits from the room, and it
            keeps this stage's body flush with AppBar's edges (both share
            <main>'s max-w-[var(--page-max-w)]) instead of sitting narrower
            and off-center under a wider title bar. */}
        {view?.kind === "editing" ? (
          <EditorStep
            doc={view.doc}
            onChange={setDoc}
            companyLogo={companyLogo}
            onCompanyLogoChange={setCompanyLogo}
            saveState={docSave}
            onContinue={() => goto(2)}
            onStartOver={startOver}
            error={error}
          />
        ) : null}

        {/* The procedure takes as long as the JSA did, so it gets the same
            honest wait — elapsed counter and all — rather than a lone spinner
            on a button. Replaces the page content for the same reason
            InputStep does: the wait should be the only thing on screen.
            Covers both stage 2's first-time draft and stage 3's regenerate —
            computeView picks the right heading for whichever stage this is. */}
        {view?.kind === "procedureGenerating" ? (
          <div className="mx-auto max-w-[45rem]">
            <h1 className="text-2xl font-semibold sm:text-[1.75rem] text-navy">{view.heading}</h1>
            <GeneratingPanel stages={PROCEDURE_STAGES} onCancel={cancelCreateProcedure} />
          </div>
        ) : null}

        {view?.kind === "pdf" ? (
          <div className="mx-auto max-w-[45rem]">
            <PdfStep
              doc={view.doc}
              companyLogo={companyLogo}
              config={config}
              onBack={() => goto(1)}
              onNewJsa={startOver}
              onCreateProcedure={() => handleCreateProcedure()}
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
            race, so nothing here may be edited until it lands. (The busy
            state itself renders above, under "procedureGenerating".) */}
        {view?.kind === "procedureEditing" ? (
          <div className="mx-auto max-w-[45rem]">
            <ProcedureEditorStep
              procedure={view.procedure}
              onChange={updateProcedure}
              photos={photos}
              onPhotoChange={updatePhoto}
              onStepPhotosReplace={replaceStepPhotos}
              saveState={procedureSave}
              onContinue={() => goto(4)}
              onBack={() => goto(2)}
              onRegenerate={() => handleCreateProcedure({ force: true })}
              stale={procedureStale}
              error={procedureError}
            />
          </div>
        ) : null}

        {view?.kind === "procedurePdf" ? (
          <div className="mx-auto max-w-[45rem]">
            <ProcedurePdfStep
              procedure={view.procedure}
              doc={view.doc}
              photos={photos}
              companyLogo={companyLogo}
              config={config}
              onBack={() => goto(3)}
              onBackToJsa={() => goto(2)}
              onNewJsa={startOver}
            />
          </div>
        ) : null}
      </main>

      {/* Every page ends with the standing caution — the "can make mistakes"
          line AI products carry, worded with "GenJSA" since the UI never says
          "AI". "ตกหล่น" on purpose: for a JSA the dangerous mistake is the
          hazard a draft never mentions, not a wrong sentence. Then the credit
          line from config/app.yaml (same source as the เกี่ยวกับ dialog).
          On the two editors the page ends under a bar fixed to the bottom of
          the screen, hence the extra bottom padding there. */}
      <footer
        className={`space-y-1 px-4 pt-2 text-center text-xs text-muted ${
          view?.kind === "editing" || view?.kind === "procedureEditing" ? "pb-40 sm:pb-24" : "pb-6"
        }`}
      >
        {/* Two inline-blocks so a narrow screen breaks between the phrases,
            never leaving "งานจริง" alone on a line */}
        <p>
          <span className="inline-block">GenJSA อาจร่างเนื้อหาผิดพลาดหรือตกหล่น</span>{" "}
          <span className="inline-block">โปรดตรวจสอบก่อนนำไปใช้งานจริง</span>
        </p>
        {config?.about?.developer ? <p>พัฒนาโดย {config.about.developer}</p> : null}
      </footer>
    </div>
  );
}
