import { useRef, useState } from "react";
import { Copy, Sparkles } from "lucide-react";
import { Button, FieldError, InfoDialog, Label } from "../../components/ui";
import { buildPersonalPrompt, detailLevels, parsePersonalDraft, type DetailLevel, type PersonalDraft } from "../../lib/personalAi";

const textAreaClass = "w-full min-w-0 resize-y rounded-lg border border-line bg-surface p-3 text-base focus-visible:outline-2 focus-visible:outline-navy";

export function PersonalAiDialog({ description, onClose, onImport, restoreFocus }: {
  description: string;
  onClose: () => void;
  onImport: (draft: PersonalDraft) => void;
  restoreFocus: () => void;
}) {
  const [level, setLevel] = useState<DetailLevel>("มาตรฐาน");
  const [work, setWork] = useState(description);
  const [instructions, setInstructions] = useState("");
  const [answer, setAnswer] = useState("");
  const [draft, setDraft] = useState<PersonalDraft | null>(null);
  const [error, setError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const promptField = useRef<HTMLTextAreaElement>(null);
  const answerField = useRef<HTMLTextAreaElement>(null);
  const imported = useRef(false);
  const prompt = buildPersonalPrompt(work, level, instructions);

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
    <InfoDialog open title="ใช้ AI ของฉัน" icon={<Sparkles className="size-4" aria-hidden="true" />} onClose={onClose}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        if (!imported.current) restoreFocus();
      }}>
      <section className="grid gap-3">
        <h3 className="font-semibold text-ink">1. เตรียมคำสั่ง</h3>
        <p className="text-muted">แก้รายละเอียดที่จะส่งได้ที่นี่ และตัดข้อมูลภายในที่ไม่ควรแชร์ก่อนนำคำสั่งไปวางใน ChatGPT, Claude หรือ Gemini</p>
        <div>
          <Label htmlFor="personal-work">รายละเอียดงานที่จะส่ง</Label>
          <textarea id="personal-work" rows={3} maxLength={5000} className={textAreaClass} value={work} onChange={(e) => { setWork(e.target.value); setCopyStatus(""); }} />
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
      <form aria-labelledby="personal-import-heading" className="grid gap-3" onSubmit={(event) => {
        event.preventDefault();
        try {
          setDraft(parsePersonalDraft(answer));
          setError("");
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : "อ่านคำตอบไม่ได้");
          answerField.current?.focus();
        }
      }}>
        <h3 id="personal-import-heading" className="font-semibold text-ink">2. นำคำตอบกลับมา</h3>
        <div>
          <Label htmlFor="personal-answer">คำตอบ JSON จาก AI</Label>
          <textarea id="personal-answer" name="answer" ref={answerField} rows={4} className={textAreaClass} value={answer}
            aria-invalid={!!error} aria-describedby={error ? "personal-answer-error" : undefined}
            onChange={(e) => { setAnswer(e.target.value); setDraft(null); setError(""); }} />
          <FieldError id="personal-answer-error">{error}</FieldError>
        </div>
        <Button type="submit" variant="outline" className="justify-self-start">ตรวจรูปแบบคำตอบ</Button>
        {draft ? (
          <div className="grid gap-2 rounded-lg bg-navy-soft p-3">
            <p role="status" className="font-medium break-words">{draft.work_activity} · {draft.steps.length} ขั้นตอน</p>
            <ol className="max-h-32 list-decimal overflow-y-auto ps-5">
              {draft.steps.map((step) => <li key={step.no} className="break-words">{step.procedure}</li>)}
            </ol>
            <Button type="button" className="justify-self-start" onClick={() => {
              imported.current = true;
              onImport(draft);
            }}>เปิดร่างเพื่อตรวจทาน</Button>
          </div>
        ) : null}
      </form>
    </InfoDialog>
  );
}
