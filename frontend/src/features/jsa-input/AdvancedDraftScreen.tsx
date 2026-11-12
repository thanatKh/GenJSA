import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, Copy, ExternalLink, FileUp } from "lucide-react";
import { Button, FieldError, Input, Label } from "../../components/ui";
import { answerFileNames, buildPersonalProcedurePrompt, buildPersonalPrompt, detailLevels, MAX_ANSWER_FILE_BYTES, MAX_SUB_STEPS, type DetailLevel } from "../../lib/personalAi";
import { advancedDraft, type AdvancedKind } from "../../store";
import type { JsaPromptRules } from "../../lib/api";

const textAreaClass = "w-full min-w-0 resize-y rounded-lg border border-line bg-surface p-3 text-base focus-visible:outline-2 focus-visible:outline-navy";

type PreviewStep = { no: number; procedure: string; hazards?: unknown[]; sub_steps?: { hazards?: unknown[]; action?: string }[] };
type PreviewDraft = { steps: PreviewStep[]; work_activity?: string; header?: { work_activity: string } };

/** The outside AIs the prompt is written for, opened in a new tab so this
 * page — and everything typed on it — stays where it is. On a phone with the
 * app installed, these addresses usually open the app. */
const OUTSIDE_AIS = [
  { name: "ChatGPT", href: "https://chatgpt.com/" },
  { name: "Claude", href: "https://claude.ai/new" },
  { name: "Gemini", href: "https://gemini.google.com/app" },
] as const;

function AiLink({ name, href, className = "" }: { name: string; href: string; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`font-medium text-navy underline underline-offset-2 hover:text-ink ${className}`}>
      {name}
    </a>
  );
}

/** One preview line's note: a JSA step's hazards (or its sub-steps and
 * theirs), a WP step's sub-steps */
function previewDetail(kind: AdvancedKind, step: PreviewStep) {
  const subs = step.sub_steps?.length ?? 0;
  if (kind === "wp") return `· ขั้นตอนย่อย ${subs} ข้อ`;
  if (!subs) return `· อันตราย ${step.hazards?.length ?? 0} ข้อ`;
  const hazards = step.sub_steps!.reduce((n, sub) => n + (sub.hazards?.length ?? 0), 0);
  return `· ขั้นตอนย่อย ${subs} ข้อ · อันตราย ${hazards} ข้อ`;
}

export function AdvancedDraftScreen<T extends PreviewDraft>({ kind, description, scope, backLabel, onBack, parse, onImport, jsaRules }: {
  kind: AdvancedKind;
  description: string;
  scope?: string;
  backLabel: string;
  onBack: () => void;
  parse: (answer: string) => T;
  onImport: (draft: T) => void;
  /** config/jsa-rules.yaml's lists (the WP prompt uses only its terminology). */
  jsaRules?: JsaPromptRules;
}) {
  const [saved] = useState(() => {
    const value = advancedDraft.load(kind, scope);
    if (!value) return null;
    const hasEdits = value.work !== value.source || value.answer.trim() || value.instructions.trim() || value.level !== "มาตรฐาน" || value.split || value.target;
    return value.source === description || hasEdits ? value : null;
  });
  const [source, setSource] = useState(saved?.source ?? description);
  const [level, setLevel] = useState<DetailLevel>(saved?.level ?? "มาตรฐาน");
  const [work, setWork] = useState(saved?.work ?? description);
  const [instructions, setInstructions] = useState(saved?.instructions ?? "");
  const [split, setSplit] = useState(saved?.split ?? false);
  const [target, setTarget] = useState(saved?.target ?? "");
  const [answer, setAnswer] = useState(saved?.answer ?? "");
  const [draft, setDraft] = useState<T | null>(null);
  useEffect(() => {
    advancedDraft.save(kind, { source, work, level, instructions, answer, split, target }, scope);
  }, [kind, source, work, level, instructions, answer, split, target, scope]);
  const [error, setError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const promptField = useRef<HTMLTextAreaElement>(null);
  const answerField = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const promptDetails = useRef<HTMLDetailsElement>(null);
  const [fileStatus, setFileStatus] = useState("");
  const [dragging, setDragging] = useState(false);
  // The rough sub-step total (only with split). Main steps the user listed
  // as "1." / "2)" — not "1.1" — cap it: each takes at most MAX_SUB_STEPS
  const targetNumber = /^\d{1,4}$/.test(target.trim()) && Number(target) > 0 ? Number(target) : undefined;
  const listedMainSteps = (work.match(/^\s*\d+\s*[.)](?!\d)/gm) ?? []).length;
  const targetCap = listedMainSteps ? listedMainSteps * MAX_SUB_STEPS : undefined;
  const overCap = !!(targetNumber && targetCap && targetNumber > targetCap);
  const subStepTarget = targetNumber && targetCap ? Math.min(targetNumber, targetCap) : targetNumber;
  const prompt = kind === "wp"
    ? buildPersonalProcedurePrompt(work, level, instructions, jsaRules)
    : buildPersonalPrompt(work, level, instructions, jsaRules, split, split ? subStepTarget : undefined);
  const sourceChanged = source !== description;
  const subCount = draft?.steps.reduce((n, step) => n + (step.sub_steps?.length ?? 0), 0) ?? 0;
  const fileName = answerFileNames[kind];

  const check = (text: string) => {
    if (sourceChanged) return;
    try {
      setDraft(parse(text));
      setError("");
    } catch (caught) {
      setDraft(null);
      setError(caught instanceof Error ? caught.message : "อ่านคำตอบไม่ได้");
      answerField.current?.focus();
    }
  };

  /* A file lands in the same answer box as pasted text, so there is one
   * answer to check, keep in the session draft, and edit if it's slightly off. */
  const readFile = async (file: File) => {
    setFileStatus("");
    if (file.size > MAX_ANSWER_FILE_BYTES) {
      setError("ไฟล์ใหญ่เกิน 2 MB กรุณาตรวจว่าเลือกไฟล์คำตอบที่ถูกต้อง");
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      setError("เปิดไฟล์ไม่ได้ กรุณาดาวน์โหลดไฟล์จาก AI ใหม่แล้วลองอีกครั้ง");
      return;
    }
    setAnswer(text);
    setFileStatus(`นำเข้าไฟล์ ${file.name} แล้ว`);
    check(text);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopyStatus("คัดลอกคำสั่งแล้ว");
    } catch {
      // No clipboard access (some iOS cases): open the prompt and select it
      // so the device's own copy menu works on it
      if (promptDetails.current) promptDetails.current.open = true;
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
        <h1 className="text-2xl font-semibold text-navy sm:text-[1.75rem]">ใช้ AI ภายนอก</h1>
        <p className="mt-1.5 text-muted">{kind === "wp" ? "ร่างขั้นตอนปฏิบัติงานจาก JSA" : "ร่าง JSA"}</p>
      </header>
      {sourceChanged ? (
        <section className="grid min-w-0 gap-2 rounded-card border border-line bg-raised p-4">
          <p role="status" className="text-sm text-ink">รายละเอียดงานเปลี่ยนจากครั้งก่อน จะใช้คำสั่งและคำตอบเดิม หรือเริ่มใหม่?</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setSource(description)}>ใช้ของเดิม</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => {
              setSource(description);
              setWork(description);
              setAnswer("");
              setDraft(null);
              setError("");
              setCopyStatus("");
            }}>เริ่มใหม่</Button>
          </div>
        </section>
      ) : null}
      <section aria-labelledby="personal-prompt-heading" className="grid gap-3 rounded-card border border-line p-4 sm:p-5">
        <h2 id="personal-prompt-heading" className="text-lg font-semibold text-ink">1. เตรียมคำสั่ง</h2>
        <p className="text-muted">
          ตัดข้อมูลภายในที่ไม่ควรแชร์ออกก่อนคัดลอก
        </p>
        <div>
          <Label htmlFor="personal-work">รายละเอียดงานที่จะส่ง</Label>
          <textarea id="personal-work" rows={3} maxLength={kind === "jsa" ? 5000 : undefined} className={textAreaClass} value={work}
            aria-describedby={kind === "jsa" ? "personal-work-hint" : undefined}
            onChange={(e) => { setWork(e.target.value); setCopyStatus(""); }} />
          {kind === "jsa" ? (
            <p id="personal-work-hint" className="mt-1.5 text-sm text-muted">
              มีขั้นตอนอยู่แล้ว พิมพ์เป็นรายการ 1. 2. 3. ไว้ที่นี่ AI จะยึดลำดับนั้น
            </p>
          ) : null}
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
        {kind === "jsa" ? (
          <label className="flex min-h-12 items-start gap-2 py-2">
            <input type="checkbox" checked={split} className="mt-1 size-4 shrink-0 accent-navy"
              onChange={(e) => { setSplit(e.target.checked); setCopyStatus(""); }} />
            <span>
              <span className="font-medium text-ink">แตกขั้นตอนหลักเป็นขั้นตอนย่อย (1.1, 1.2 …)</span>
            </span>
          </label>
        ) : null}
        {kind === "jsa" && split ? (
          <div className="-mt-1 ps-6">
            <Label htmlFor="personal-target">จำนวนขั้นตอนย่อยรวมโดยประมาณ (ไม่บังคับ)</Label>
            <Input id="personal-target" type="number" inputMode="numeric" min={1} max={9999} className="w-32"
              value={target} aria-describedby={overCap ? "personal-target-hint" : undefined}
              onChange={(e) => { setTarget(e.target.value); setCopyStatus(""); }} />
            {overCap ? (
              <p id="personal-target-hint" className="mt-1 text-sm text-danger-text">
                {`ขั้นตอนหลัก ${listedMainSteps} ข้อ แตกได้ข้อละไม่เกิน ${MAX_SUB_STEPS} รวมสูงสุด ${targetCap} ข้อย่อย`}
              </p>
            ) : null}
          </div>
        ) : null}
        <div>
          <Label htmlFor="personal-instructions">คำขอเพิ่มเติม (ไม่บังคับ)</Label>
          <textarea id="personal-instructions" rows={2} maxLength={2000} className={textAreaClass} value={instructions} onChange={(e) => { setInstructions(e.target.value); setCopyStatus(""); }} />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button type="button" onClick={() => void copy()}><Copy className="size-4" aria-hidden="true" /> คัดลอกคำสั่ง</Button>
          <span role="status" className="text-muted">{copyStatus}</span>
        </div>
        {/* Copy, then straight on to an AI — no scrolling back up for the links */}
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
          <span className="flex items-center gap-1"><ExternalLink className="size-4" aria-hidden="true" /> แล้วเปิด</span>
          {OUTSIDE_AIS.map((ai) => <AiLink key={ai.name} {...ai} className="inline-flex min-h-11 items-center" />)}
        </p>
        {/* The prompt itself, closed by default: the copy button is what most
            people need, but the text stays one tap away so anyone can check
            what is about to leave for an outside AI. */}
        <details ref={promptDetails} className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 text-sm text-muted hover:text-ink [&::-webkit-details-marker]:hidden">
            <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden="true" />
            ดูคำสั่งที่จะส่ง
          </summary>
          <label htmlFor="personal-prompt" className="sr-only">คำสั่งที่จะคัดลอก</label>
          <textarea id="personal-prompt" ref={promptField} rows={8} readOnly className={textAreaClass} value={prompt} />
        </details>
      </section>
      <form aria-labelledby="personal-import-heading"
        className={`grid gap-3 rounded-card border p-4 sm:p-5 ${dragging ? "border-navy bg-navy-soft" : "border-line"}`}
        onSubmit={(event) => { event.preventDefault(); check(answer); }}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(event) => {
          const file = event.dataTransfer.files[0];
          if (!file) return;
          event.preventDefault();
          setDragging(false);
          void readFile(file);
        }}>
        <h2 id="personal-import-heading" className="text-lg font-semibold text-ink">2. นำคำตอบกลับมา</h2>
        {/* The drop zone. The whole card takes a drop too (the form's own
            handlers); this box is what says so. Phones can't drag files, so
            there it's just the button. */}
        <div className={`grid justify-items-center gap-2 rounded-field border-2 border-dashed p-5 text-center transition-colors ${
          dragging ? "border-navy bg-navy-soft" : "border-line"
        }`}>
          <FileUp className="size-7 text-muted pointer-coarse:hidden" aria-hidden="true" />
          <p className="text-ink pointer-coarse:hidden">ลากไฟล์คำตอบ ({fileName}) มาวางที่นี่</p>
          <p className="text-sm text-muted pointer-coarse:hidden">หรือ</p>
          <Button type="button" variant="outline" disabled={sourceChanged} onClick={() => fileInput.current?.click()}>
            <FileUp className="size-4" aria-hidden="true" /> เลือกไฟล์คำตอบ
          </Button>
          <span role="status" className="text-sm text-muted [overflow-wrap:anywhere]">{fileStatus}</span>
          <input ref={fileInput} type="file" accept=".json,.txt,application/json,text/plain" className="hidden"
            aria-label="เลือกไฟล์คำตอบจาก AI"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void readFile(file);
            }} />
        </div>
        <div>
          <Label htmlFor="personal-answer">หรือวางคำตอบที่เป็นข้อความ</Label>
          <textarea id="personal-answer" name="answer" ref={answerField} rows={4} className={textAreaClass} value={answer}
            aria-invalid={!!error} aria-describedby={error ? "personal-answer-error" : undefined}
            onChange={(e) => { setAnswer(e.target.value); setDraft(null); setError(""); setFileStatus(""); }} />
          <FieldError id="personal-answer-error">{error}</FieldError>
        </div>
        {/* The way forward, so it's the primary button — until the answer
            checks out, when "เปิดร่างเพื่อตรวจทาน" below takes its place */}
        {draft && !sourceChanged ? null : (
          <Button type="submit" disabled={sourceChanged || !answer.trim()} className="justify-self-start">ตรวจคำตอบ</Button>
        )}
        {draft && !sourceChanged ? (
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 rounded-lg bg-navy-soft p-3 [overflow-wrap:anywhere]">
            <p role="status" className="font-medium">
              {draft.work_activity ?? draft.header?.work_activity ?? "ตรวจรูปแบบแล้ว"} · {draft.steps.length} ขั้นตอน
              {kind === "jsa" && subCount ? ` · ${subCount} ขั้นตอนย่อย` : ""}
              {kind === "jsa" && split && subStepTarget ? ` (ตั้งไว้ประมาณ ${subStepTarget})` : ""}
            </p>
            <ol className="max-h-32 list-decimal overflow-y-auto ps-5">
              {draft.steps.map((step) => (
                <li key={step.no}>
                  {step.procedure} <span className="text-muted">{previewDetail(kind, step)}</span>
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
