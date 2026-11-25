import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ArrowLeft, Copy, FileUp } from "lucide-react";
import { Button, Disclosure, FieldError, Input, Label, Reveal } from "../../components/ui";
import { useFlash } from "../../lib/useFlash";
import { buildPersonalProcedurePrompt, buildPersonalPrompt, detailLevels, MAX_ANSWER_FILE_BYTES, MAX_SUB_STEPS, type DetailLevel } from "../../lib/personalAi";
import { advancedDraft, type AdvancedKind } from "../../store";
import type { JsaPromptRules } from "../../lib/api";

const textAreaClass = "block w-full min-w-0 resize-y rounded-lg border border-line bg-surface px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-navy";
const panelClass = "grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 rounded-card border border-line p-3.5 sm:p-4";
const DEFAULT_DETAIL: DetailLevel = "ละเอียด";

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

function AiLink({ name, href }: { name: string; href: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="press inline-flex min-h-11 items-center rounded-full border border-line px-2.5 text-sm font-medium text-navy hover:bg-navy-soft lg:pointer-fine:min-h-9">
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
  const defaultSplit = kind === "jsa";
  const [saved] = useState(() => {
    const value = advancedDraft.load(kind, scope);
    if (!value) return null;
    const hasEdits = value.work !== value.source || value.answer.trim() || value.instructions.trim() ||
      value.level !== DEFAULT_DETAIL || value.split !== defaultSplit || value.target;
    return value.source === description || hasEdits ? value : null;
  });
  const [source, setSource] = useState(saved?.source ?? description);
  const [level, setLevel] = useState<DetailLevel>(saved?.level ?? DEFAULT_DETAIL);
  const [work, setWork] = useState(saved?.work ?? description);
  const [instructions, setInstructions] = useState(saved?.instructions ?? "");
  const [instructionsOpen, setInstructionsOpen] = useState(() => !!saved?.instructions.trim());
  const [split, setSplit] = useState(saved?.split ?? defaultSplit);
  const [target, setTarget] = useState(saved?.target ?? "");
  const [answer, setAnswer] = useState(saved?.answer ?? "");
  const [draft, setDraft] = useState<T | null>(null);
  useEffect(() => {
    advancedDraft.save(kind, { source, work, level, instructions, answer, split, target }, scope);
  }, [kind, source, work, level, instructions, answer, split, target, scope]);
  const [error, setError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  // The copy button itself confirms: its icon turns into a tick and its label
  // to "คัดลอกแล้ว" for a moment, then it goes back (Button's status="success")
  const [copied, flashCopied, clearCopied] = useFlash();
  /** The prompt changed (or the copy was only a selection): forget the last copy */
  const clearCopy = () => {
    setCopyStatus("");
    clearCopied();
  };
  // Same beat on the file button once an answer file has been read
  const [imported, flashImported] = useFlash();
  const [promptOpen, setPromptOpen] = useState(false);
  // Blocks that leave (an error, the checked-answer card) keep their last
  // content while they animate out, instead of emptying first
  const lastError = useRef("");
  if (error) lastError.current = error;
  const lastDraft = useRef<T | null>(null);
  if (draft) lastDraft.current = draft;
  const promptField = useRef<HTMLTextAreaElement>(null);
  const answerHeading = useRef<HTMLHeadingElement>(null);
  const answerField = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
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
  const subCount = lastDraft.current?.steps.reduce((n, step) => n + (step.sub_steps?.length ?? 0), 0) ?? 0;

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
    flashImported();
    check(text);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      clearCopy();
      flashCopied();
    } catch {
      // No clipboard access (some iOS cases): open the prompt and select it
      // so the device's own copy menu works on it
      // flushSync: the field has to be open and laid out before it can be selected
      flushSync(() => setPromptOpen(true));
      promptField.current?.focus();
      promptField.current?.select();
      setCopyStatus("เลือกข้อความแล้ว กรุณาคัดลอกด้วยเมนูของอุปกรณ์");
    }
  };

  return (
    <section className="mx-auto grid min-w-0 max-w-[45rem] grid-cols-[minmax(0,1fr)] gap-3 lg:max-w-[70rem] lg:gap-4">
      <header>
        <Button type="button" variant="ghost" size="sm" onClick={onBack} className="-ms-2 mb-1 min-h-11 lg:pointer-fine:min-h-7">
          <ArrowLeft className="size-4" aria-hidden="true" />
          {backLabel}
        </Button>
        <h1 className="text-2xl font-semibold text-navy sm:text-[1.75rem]">ใช้โมเดลภายนอก</h1>
        <p className="mt-0.5 text-sm text-muted">{kind === "wp" ? "ร่างขั้นตอนปฏิบัติงานจาก JSA" : "ร่าง JSA"}</p>
      </header>
      <Reveal show={sourceChanged} className="-m-1 p-1">
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
              clearCopy();
            }}>เริ่มใหม่</Button>
          </div>
        </section>
      </Reveal>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] items-start gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-4">
        <section aria-labelledby="personal-prompt-heading" className={panelClass}>
          <h2 id="personal-prompt-heading" className="text-lg font-semibold text-ink">1. เตรียมคำสั่ง</h2>
          <div>
            <Label htmlFor="personal-work">รายละเอียดงานที่จะส่ง</Label>
            <textarea id="personal-work" rows={4} maxLength={kind === "jsa" ? 5000 : undefined} className={textAreaClass} value={work}
              aria-describedby={kind === "jsa" ? "personal-work-hint" : undefined}
              onChange={(e) => { setWork(e.target.value); clearCopy(); }} />
            {kind === "jsa" ? (
              <p id="personal-work-hint" className="mt-1.5 text-sm text-muted">
                มีขั้นตอนอยู่แล้ว พิมพ์เป็นรายการ 1. 2. 3. ไว้ที่นี่ AI จะยึดลำดับนั้น
              </p>
            ) : null}
          </div>
          <div className="min-w-0 rounded-lg bg-raised px-3 py-2">
            <fieldset className="min-w-0">
              <legend className="text-sm font-medium text-ink">ระดับรายละเอียด</legend>
              <div className="flex flex-wrap gap-x-3">
                {detailLevels.map((option) => (
                  <label key={option} className="flex min-h-11 items-center gap-1.5 text-sm lg:pointer-fine:min-h-9">
                    <input type="radio" name="personal-detail" checked={level === option} className="accent-navy" onChange={() => { setLevel(option); clearCopy(); }} />
                    {option}
                  </label>
                ))}
              </div>
            </fieldset>
            {kind === "jsa" ? (
              <label className="flex min-h-11 items-center gap-2 border-t border-line py-1.5 text-sm lg:pointer-fine:min-h-9">
                <input type="checkbox" checked={split} className="size-4 shrink-0 accent-navy"
                  onChange={(e) => { setSplit(e.target.checked); clearCopy(); }} />
                <span className="font-medium text-ink">แตกขั้นตอนหลักเป็นขั้นตอนย่อย (1.1, 1.2 …)</span>
              </label>
            ) : null}
            <Reveal show={kind === "jsa" && split} className="-m-1 p-1">
              <div className="grid grid-cols-[minmax(0,1fr)_5rem] items-center gap-x-2 ps-6 sm:grid-cols-[fit-content(18rem)_5rem]">
                <Label htmlFor="personal-target">จำนวนข้อย่อยรวมโดยประมาณ (ไม่บังคับ)</Label>
                <Input id="personal-target" type="number" inputMode="numeric" min={1} max={9999}
                  value={target} aria-describedby={overCap ? "personal-target-hint" : undefined}
                  onChange={(e) => { setTarget(e.target.value); clearCopy(); }} />
                <Reveal show={overCap} className="col-span-full">
                  <p id="personal-target-hint" className="mt-1 text-sm text-danger-text">
                    {`ขั้นตอนหลัก ${listedMainSteps} ข้อ แตกได้ข้อละไม่เกิน ${MAX_SUB_STEPS} รวมสูงสุด ${targetCap} ข้อย่อย`}
                  </p>
                </Reveal>
              </div>
            </Reveal>
          </div>
          <Disclosure open={instructionsOpen} onOpenChange={setInstructionsOpen}
            label={instructions.trim() ? "คำขอเพิ่มเติม (มีข้อความแล้ว)" : "คำขอเพิ่มเติม (ไม่บังคับ)"}>
            <div className="p-1">
              <label htmlFor="personal-instructions" className="sr-only">คำขอเพิ่มเติม</label>
              <textarea id="personal-instructions" rows={2} maxLength={2000} className={textAreaClass} value={instructions} onChange={(e) => { setInstructions(e.target.value); clearCopy(); }} />
            </div>
          </Disclosure>
          <div className="grid min-w-0 gap-1.5 border-t border-line pt-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Button
                type="button"
                onClick={() => void copy()}
                status={copied ? "success" : undefined}
                successText="คัดลอกแล้ว"
                // Green while it says "copied", then back to the brand blue
                className={`min-h-11 lg:pointer-fine:min-h-10 ${copied ? "bg-[var(--success)] text-white hover:bg-[var(--success)]" : ""}`}
              >
                {/* Button puts its own tick in front while status is success */}
                {copied ? null : <Copy className="size-4" aria-hidden="true" />}
                {copied ? null : " "}คัดลอกคำสั่ง
              </Button>
              {/* Said aloud for screen readers; shown only for the select-instead fallback */}
              <span role="status" className={copyStatus ? "text-sm text-muted" : "sr-only"}>{copied ? "คัดลอกคำสั่งแล้ว" : copyStatus}</span>
            </div>
            {/* Copy, then straight on to an AI — no scrolling back up for the links */}
            <p className="text-sm text-muted">
              วางคำสั่งในแชตที่เลือก แล้วกลับมาที่{" "}
              <button type="button" className="cursor-pointer rounded-sm text-navy underline decoration-dotted underline-offset-2"
                aria-label="ไปที่ช่องคำตอบ" onClick={() => answerHeading.current?.focus()}>ช่องคำตอบ</button>
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              {OUTSIDE_AIS.map((ai) => <AiLink key={ai.name} {...ai} />)}
            </div>
            {/* The prompt itself, closed by default: the copy button is what most
                people need, but the text stays one tap away so anyone can check
                what is about to leave for an outside AI. */}
            <Disclosure open={promptOpen} onOpenChange={setPromptOpen} label="ดูคำสั่งที่จะคัดลอก">
              <label htmlFor="personal-prompt" className="sr-only">คำสั่งที่จะคัดลอก</label>
              <textarea id="personal-prompt" ref={promptField} rows={8} readOnly className={`${textAreaClass} mt-1`} value={prompt} />
            </Disclosure>
          </div>
        </section>
        <form aria-labelledby="personal-import-heading"
          className={`${panelClass} ${dragging ? "border-navy! bg-navy-soft" : ""}`}
          onSubmit={(event) => { event.preventDefault(); check(answer); }}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes("Files")) return;
            event.preventDefault();
            if (!sourceChanged) setDragging(true);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
          }}
          onDrop={(event) => {
            const file = event.dataTransfer.files[0];
            if (!file) return;
            event.preventDefault();
            setDragging(false);
            if (!sourceChanged) void readFile(file);
          }}>
          <h2 id="personal-import-heading" ref={answerHeading} tabIndex={-1} className="text-lg font-semibold text-ink">2. นำคำตอบกลับมา</h2>
          <div>
            <Label htmlFor="personal-answer">วางคำตอบจาก AI</Label>
            <textarea id="personal-answer" name="answer" ref={answerField} rows={4} className={textAreaClass} value={answer}
              aria-invalid={!!error} aria-describedby={error ? "personal-answer-error" : undefined}
              onChange={(e) => { setAnswer(e.target.value); setDraft(null); setError(""); setFileStatus(""); }} />
            <Reveal show={!!error}>
              <FieldError id="personal-answer-error">{error || lastError.current}</FieldError>
            </Reveal>
          </div>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg border border-dashed border-line px-2.5 py-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={sourceChanged}
              onClick={() => fileInput.current?.click()}
              status={imported ? "success" : undefined}
              successText="นำเข้าแล้ว"
              className={`min-h-11 lg:pointer-fine:min-h-8 ${imported ? "border-[var(--success)] text-[var(--success)]" : ""}`}
            >
              {/* Button puts its own tick in front while status is success */}
              {imported ? null : <FileUp className="size-4" aria-hidden="true" />}
              {imported ? null : " "}เลือกไฟล์คำตอบ
            </Button>
            <p className="text-xs text-muted">
              .json หรือ .txt<span className="hidden sm:pointer-fine:inline"> · ลากไฟล์คำตอบมาวางในส่วนนี้ได้</span>
            </p>
            {/* Which file, for screen readers — the button itself shows that it worked */}
            <span role="status" className="sr-only">{fileStatus}</span>
            <input ref={fileInput} type="file" accept=".json,.txt,application/json,text/plain" className="hidden"
              aria-label="เลือกไฟล์คำตอบจาก AI"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void readFile(file);
              }} />
          </div>
          {/* The way forward, so it's the primary button — until the answer
              checks out, when "เปิดร่างเพื่อตรวจทาน" below takes its place */}
          <Reveal show={!(draft && !sourceChanged)} className="-m-1 p-1">
            <Button type="submit" disabled={sourceChanged || !answer.trim()} className="min-h-11 lg:pointer-fine:min-h-10">ตรวจคำตอบ</Button>
          </Reveal>
          <Reveal show={!!draft && !sourceChanged} className="-m-1 p-1">
            {lastDraft.current ? (
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 rounded-lg bg-navy-soft p-3 [overflow-wrap:anywhere]">
              <p role="status" className="font-medium">
                {lastDraft.current.work_activity ?? lastDraft.current.header?.work_activity ?? "ตรวจรูปแบบแล้ว"} · {lastDraft.current.steps.length} ขั้นตอน
                {kind === "jsa" && subCount ? ` · ${subCount} ขั้นตอนย่อย` : ""}
                {kind === "jsa" && split && subStepTarget ? ` (ตั้งไว้ประมาณ ${subStepTarget})` : ""}
              </p>
              <ol className="max-h-32 list-decimal overflow-y-auto ps-5">
                {lastDraft.current.steps.map((step) => (
                  <li key={step.no}>
                    {step.procedure} <span className="text-muted">{previewDetail(kind, step)}</span>
                  </li>
                ))}
              </ol>
              <Button type="button" className="justify-self-start" onClick={() => { if (draft) onImport(draft); }}>เปิดร่างเพื่อตรวจทาน</Button>
            </div>
            ) : null}
          </Reveal>
        </form>
      </div>
    </section>
  );
}
