import { useEffect, useState } from "react";

import { AppBar } from "./components/AppBar";
import { Stepper } from "./components/Stepper";
import { EditorStep } from "./features/jsa-editor/EditorStep";
import { InputStep } from "./features/jsa-input/InputStep";
import { PdfStep } from "./features/pdf-view/PdfStep";
import { ApiError, fetchPublicConfig, generateJsa, type PublicConfig } from "./lib/api";
import type { InputForm, JsaDocument } from "./lib/schema";
import { clearAllDrafts, docDraft } from "./store";

type Stage = 0 | 1 | 2;

export default function App() {
  const [stage, setStage] = useState<Stage>(0);
  const [doc, setDoc] = useState<JsaDocument | null>(() => docDraft.load());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appName, setAppName] = useState("GenJSA");
  const [footer, setFooter] = useState<string>("");
  const [config, setConfig] = useState<PublicConfig | null>(null);

  // If a draft JSA is left over (refresh mid-flow), jump straight back to the editor step
  useEffect(() => {
    if (doc) setStage(1);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Guard against a blank screen: if the draft disappears (cleared elsewhere), never stay stuck on step 2/3
  useEffect(() => {
    if (stage !== 0 && !doc) {
      clearAllDrafts();
      setStage(0);
    }
  }, [stage, doc]);

  useEffect(() => {
    // One config powers both the app name/footer display and PDF drawing (layout values from config/pdf.yaml)
    void fetchPublicConfig().then((loaded) => {
      if (!loaded) return;
      setConfig(loaded);
      setAppName(loaded.appName);
      const parts = [loaded.company.department, loaded.company.name].filter(Boolean);
      setFooter(parts.join(" · "));
    });
  }, []);

  const handleGenerate = async (values: InputForm) => {
    setBusy(true);
    setError(null);
    try {
      const generated = await generateJsa(values);
      setDoc(generated);
      docDraft.save(generated);
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

  const startOver = () => {
    setDoc(null);
    setError(null);
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
            <InputStep onGenerate={handleGenerate} busy={busy} error={error} />
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
            <PdfStep doc={doc} config={config} onBack={() => goto(1)} />
          </div>
        ) : null}
      </main>

      <footer className="border-t border-line px-4 py-4">
        <p className="mx-auto max-w-[60rem] text-sm text-muted">
          {footer}
        </p>
      </footer>
    </div>
  );
}
