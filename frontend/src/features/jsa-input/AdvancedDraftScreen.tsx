import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Copy } from "lucide-react";
import { Button, FieldError, Label } from "../../components/ui";
import { buildPersonalProcedurePrompt, buildPersonalPrompt, detailLevels, type DetailLevel } from "../../lib/personalAi";
import { advancedDraft, type AdvancedKind } from "../../store";

const textAreaClass = "w-full min-w-0 resize-y rounded-lg border border-line bg-surface p-3 text-base focus-visible:outline-2 focus-visible:outline-navy";

type PreviewStep = { no: number; procedure: string; hazards?: unknown[]; sub_steps?: unknown[] };
type PreviewDraft = { steps: PreviewStep[]; work_activity?: string; header?: { work_activity: string } };

export function AdvancedDraftScreen<T extends PreviewDraft>({ kind, description, scope, backLabel, onBack, parse, onImport }: {
  kind: AdvancedKind;
  description: string;
  scope?: string;
  backLabel: string;
  onBack: () => void;
  parse: (answer: string) => T;
  onImport: (draft: T) => void;
}) {
  const [saved] = useState(() => {
    const value = advancedDraft.load(kind, scope);
    if (!value) return null;
    const hasEdits = value.work !== value.source || value.answer.trim() || value.instructions.trim() || value.level !== "มาตรฐาน";
    return value.source === description || hasEdits ? value : null;
  });
  const [source, setSource] = useState(saved?.source ?? description);
  const [level, setLevel] = useState<DetailLevel>(saved?.level ?? "มาตรฐาน");
  const [work, setWork] = useState(saved?.work ?? description);
  const [instructions, setInstructions] = useState(saved?.instructions ?? "");
  const [answer, setAnswer] = useState(saved?.answer ?? "");
  const [draft, setDraft] = useState<T | null>(null);
  useEffect(() => {
    advancedDraft.save(kind, { source, work, level, instructions, answer }, scope);
  }, [kind, source, work, level, instructions, answer, scope]);
  const [error, setError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const promptField = useRef<HTMLTextAreaElement>(null);
  const answerField = useRef<HTMLTextAreaElement>(null);
  const buildPrompt = kind === "wp" ? buildPersonalProcedurePrompt : buildPersonalPrompt;
  const prompt = buildPrompt(work, level, instructions);
  const sourceChanged = source !== description;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopyStatus("คัดลอกคำสั่งแล้ว");
    } catch {
      promptField.current?.focus();
      promptField.current?.select();
      setCopyStatus("เลือกข้อความแล้ว กรุณาคัดลอกด้วยเมนูของอุปกรณ์");
    }
  };

  return (
    <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5">
      <header>
        <Button type="button" variant="ghost" size="sm" onClick={onBack} className="-ms-2 mb-2">
          <ArrowLeft className="size-4" aria-hidden="true" />
          {backLabel}
        </Button>
        <h1 className="text-2xl font-semibold text-navy sm:text-[1.75rem]">ขั้นสูง</h1>
        <p className="mt-1.5 text-muted">
          {kind === "wp" ? "ร่างขั้นตอนปฏิบัติงาน (WP) จาก JSA ที่ตรวจทานแล้ว" : "ร่าง JSA ด้วย AI ที่คุณเลือก แล้วนำคำตอบกลับมาตรวจทาน"}
        </p>
      </header>
      {sourceChanged ? (
        <section className="grid min-w-0 gap-2 rounded-card border border-line bg-raised p-4">
          <p role="status" className="text-sm text-ink">ข้อมูลต้นทางเปลี่ยนแล้ว คำสั่งและคำตอบเดิมยังอยู่ เลือกใช้ร่างเดิมหรือเริ่มใหม่จากข้อมูลล่าสุด</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setSource(description)}>ใช้ร่างเดิม</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => {
              setSource(description);
              setWork(description);
              setAnswer("");
              setDraft(null);
              setError("");
              setCopyStatus("");
            }}>ล้างคำตอบและใช้ข้อมูลใหม่</Button>
          </div>
        </section>
      ) : null}
      <section aria-labelledby="personal-prompt-heading" className="grid gap-3 rounded-card border border-line p-4 sm:p-5">
        <h2 id="personal-prompt-heading" className="text-lg font-semibold text-ink">1. เตรียมคำสั่ง</h2>
        <p className="text-muted">แก้รายละเอียดที่จะส่งได้ที่นี่ และตัดข้อมูลภายในที่ไม่ควรแชร์ก่อนนำคำสั่งไปวางใน ChatGPT, Claude หรือ Gemini</p>
        {kind === "wp" ? <p className="text-sm text-muted">คงเลขขั้นตอนหลักให้ตรงกับ JSA เพื่อจับคู่คำตอบตอนนำเข้า</p> : null}
        <div>
          <Label htmlFor="personal-work">รายละเอียดงานที่จะส่ง</Label>
          <textarea id="personal-work" rows={3} maxLength={kind === "jsa" ? 5000 : undefined} className={textAreaClass} value={work} onChange={(e) => { setWork(e.target.value); setCopyStatus(""); }} />
        </div>
        <fieldset>
          <legend className="font-medium text-ink">ระดับรายละเอียด</legend>
          <div className="flex flex-wrap gap-x-4">
            {detailLevels.map((option) => (
              <label key={option} className="flex min-h-12 items-center gap-2">
                <input type="radio" name="personal-detail" checked={level === option} className="accent-navy" onChange={() => { setLevel(option); setCopyStatus(""); }} />
                {option}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <Label htmlFor="personal-instructions">คำขอเพิ่มเติม (ไม่บังคับ)</Label>
          <textarea id="personal-instructions" rows={2} maxLength={2000} className={textAreaClass} value={instructions} onChange={(e) => { setInstructions(e.target.value); setCopyStatus(""); }} />
        </div>
        <div>
          <Label htmlFor="personal-prompt">คำสั่งที่จะคัดลอก</Label>
          <textarea id="personal-prompt" ref={promptField} rows={3} readOnly className={textAreaClass} value={prompt} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => void copy()}><Copy className="size-4" aria-hidden="true" /> คัดลอกคำสั่ง</Button>
          <span role="status" className="text-muted">{copyStatus}</span>
        </div>
      </section>
      <form aria-labelledby="personal-import-heading" className="grid gap-3 rounded-card border border-line p-4 sm:p-5" onSubmit={(event) => {
        event.preventDefault();
        if (sourceChanged) return;
        try {
          setDraft(parse(answer));
          setError("");
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : "อ่านคำตอบไม่ได้");
          answerField.current?.focus();
        }
      }}>
        <h2 id="personal-import-heading" className="text-lg font-semibold text-ink">2. นำคำตอบกลับมา</h2>
        <div>
          <Label htmlFor="personal-answer">คำตอบ JSON จาก AI</Label>
          <textarea id="personal-answer" name="answer" ref={answerField} rows={4} className={textAreaClass} value={answer}
            aria-invalid={!!error} aria-describedby={error ? "personal-answer-error" : undefined}
            onChange={(e) => { setAnswer(e.target.value); setDraft(null); setError(""); }} />
          <FieldError id="personal-answer-error">{error}</FieldError>
        </div>
        <Button type="submit" variant="outline" disabled={sourceChanged} className="justify-self-start">ตรวจรูปแบบคำตอบ</Button>
        {draft && !sourceChanged ? (
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 rounded-lg bg-navy-soft p-3 [overflow-wrap:anywhere]">
            <p role="status" className="font-medium">
              {draft.work_activity ?? draft.header?.work_activity ?? "ตรวจรูปแบบแล้ว"} · {draft.steps.length} ขั้นตอน
            </p>
            <ol className="max-h-32 list-decimal overflow-y-auto ps-5">
              {draft.steps.map((step) => (
                <li key={step.no}>
                  {step.procedure} <span className="text-muted">{step.hazards ? `· อันตราย ${step.hazards.length} ข้อ` : `· ขั้นตอนย่อย ${step.sub_steps?.length ?? 0} ข้อ`}</span>
                </li>
              ))}
            </ol>
            <Button type="button" className="justify-self-start" onClick={() => onImport(draft)}>เปิดร่างเพื่อตรวจทาน</Button>
          </div>
        ) : null}
      </form>
    </section>
  );
}
