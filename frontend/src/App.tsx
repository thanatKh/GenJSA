import { useEffect, useRef, useState } from "react";

import { AppBar } from "./components/AppBar";
import { Stepper } from "./components/Stepper";
import { EditorStep } from "./features/jsa-editor/EditorStep";
import { HistoryList } from "./features/jsa-input/HistoryList";
import { InputStep } from "./features/jsa-input/InputStep";
import { PdfStep } from "./features/pdf-view/PdfStep";
import * as historyStore from "./history";
import type { HistoryEntry } from "./history";
import {
  ApiError,
  CancelledError,
  fetchPublicConfig,
  generateJsa,
  type PublicConfig,
} from "./lib/api";
import type { InputForm, JsaDocument } from "./lib/schema";
import { clearAllDrafts, currentHistoryId, docDraft } from "./store";

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

type Stage = 0 | 1 | 2;

export default function App() {
  const [stage, setStage] = useState<Stage>(0);
  const [doc, setDoc] = useState<JsaDocument | null>(() => docDraft.load());
  const [busy, setBusy] = useState(false);
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

  // Keep the history entry in step with the document being edited
  useEffect(() => {
    if (!doc || !historyId) return;
    // Don't leave an empty row behind for a manual entry the user abandons
    const worthKeeping =
      doc.header.work_activity.trim() || doc.steps.some((s) => s.procedure.trim());
    if (!worthKeeping) return;

    const timer = setTimeout(
      () => historyStore.upsert(historyId, doc),
      HISTORY_SAVE_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [doc, historyId]);

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
    startHistoryEntry();
    setStage(1);
    window.scrollTo({ top: 0 });
  };

  const handleOpenHistory = (entry: HistoryEntry) => {
    setDoc(entry.doc);
    // Required, not belt-and-braces: without it the blank-screen guard above
    // can bounce straight back to step 1
    docDraft.save(entry.doc);
    setHistoryId(entry.id);
    currentHistoryId.save(entry.id);
    setError(null);
    setStage(1);
    window.scrollTo({ top: 0 });
  };

  const startOver = () => {
    setDoc(null);
    setError(null);
    setHistoryId(null);
    // Drafts only — past work in historyStore.ts deliberately survives "เริ่มใหม่"
    clearAllDrafts();
    setStage(0);
    window.scrollTo({ top: 0 });
  };

  const goto = (next: Stage) => {
    setStage(next);
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="min-h-dvh flex flex-col bg-surface">
      <AppBar
        appName={appName}
        documentMeta={config?.document}
        department={config?.company.department}
      />

      {/* max-w-[var(--page-max-w)] — shared with AppBar.tsx's title-bar row
          so the two always share the same left/right edges (see tokens.css).
          It's wider than the 60rem every other stage needs only so stage 0
          has room for the form's own 45rem plus a real side column for
          history on desktop; EditorStep/PdfStep pin themselves back to
          their previous, narrower widths below so they're unaffected. */}
      <main className="mx-auto w-full max-w-[var(--page-max-w)] flex-1 px-4 py-6 sm:py-8">
        <Stepper current={stage} onNavigate={goto} />

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
            {busy ? null : <HistoryList onOpen={handleOpenHistory} />}
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

        {stage === 2 && doc ? (
          <div className="mx-auto max-w-[45rem]">
            <PdfStep
              doc={doc}
              config={config}
              onBack={() => goto(1)}
              onNewJsa={startOver}
            />
          </div>
        ) : null}
      </main>
    </div>
  );
}
