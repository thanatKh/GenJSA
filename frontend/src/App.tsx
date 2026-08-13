import { useEffect, useState } from "react";

import { AppBar } from "./components/AppBar";
import { Stepper } from "./components/Stepper";
import { EditorStep } from "./features/jsa-editor/EditorStep";
import { HistoryList } from "./features/jsa-input/HistoryList";
import { InputStep } from "./features/jsa-input/InputStep";
import { PdfStep } from "./features/pdf-view/PdfStep";
import * as historyStore from "./history";
import type { HistoryEntry } from "./history";
import { ApiError, fetchPublicConfig, generateJsa, type PublicConfig } from "./lib/api";
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

  const handleGenerate = async (values: InputForm) => {
    setBusy(true);
    setError(null);
    try {
      const generated = await generateJsa(values);
      setDoc(generated);
      docDraft.save(generated);
      startHistoryEntry();
      setStage(1);
      window.scrollTo({ top: 0 });
    } catch (caught) {
      // Form data is left untouched — never clear anything on error
      setError(
        caught instanceof ApiError
          ? caught.message
          : "เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองอีกครั้ง",
      );
    } finally {
      setBusy(false);
    }
  };

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

      <main className="mx-auto w-full max-w-[60rem] flex-1 px-4 py-6 sm:py-8">
        <Stepper current={stage} />

        {stage === 0 ? (
          <div className="mx-auto max-w-[45rem]">
            <InputStep
              onGenerate={handleGenerate}
              onSkipToManual={handleSkipToManual}
              busy={busy}
              error={error}
            />
            {/* Hidden while generating so it doesn't compete with GeneratingPanel */}
            {busy ? null : <HistoryList onOpen={handleOpenHistory} />}
          </div>
        ) : null}

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
