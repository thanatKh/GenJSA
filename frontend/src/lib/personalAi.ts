import { z } from "zod";
import type { JsaPromptRules } from "./api";
import { FALLBACK_PROCEDURE } from "./pdf/layout";
import { jsaFingerprint, type JsaDocument, type ProcedureDocument } from "./schema";
import { formatThaiDate } from "./thaidate";

export const detailLevels = ["กระชับ", "มาตรฐาน", "ละเอียด"] as const;
export type DetailLevel = (typeof detailLevels)[number];

/** The file each prompt asks the outside AI to hand back. Long answers are
 * hard to copy out of a chat, so the answer comes as a download; pasting the
 * text still works when the AI can't make files. */
export const answerFileNames = { jsa: "genjsa-jsa.json", wp: "genjsa-wp.json" } as const;
/** Upper bound for an answer file — well past any real answer, and the text
 * itself is still held to parseDraft's length cap. */
export const MAX_ANSWER_FILE_BYTES = 2 * 1024 * 1024;

/** config/jsa-rules.yaml's terminology, worded as prompts/*.md word it. */
function terminology(rules?: JsaPromptRules) {
  const terms = rules?.terminology ?? [];
  if (!terms.length) return "";
  return `ใช้ศัพท์ของหน้างานนี้เสมอ:\n${terms.map(({ use, insteadOf }) =>
    `- เขียน "${use}"${insteadOf.length ? ` ห้ามใช้ ${insteadOf.map((word) => `"${word}"`).join(" หรือ ")}` : ""}`).join("\n")}`;
}

function answerAsFile(fileName: string) {
  return `ส่งคำตอบเป็นไฟล์ให้ดาวน์โหลด ชื่อ ${fileName} เนื้อหาในไฟล์เป็น JSON ล้วน (UTF-8) ไม่มีข้อความอื่นปน และไม่ต้องแสดง JSON ซ้ำในแชต หากสร้างไฟล์ไม่ได้ ให้ตอบ JSON ทั้งชุดในกล่องโค้ดเดียวแทน`;
}

/* Without config (an older backend, or it failed to load) the prompt still
 * asks for a per-step scan, naming a few sources instead of the full list. */
function hazardScan(rules?: JsaPromptRules) {
  const list = rules?.hazardChecklist.length
    ? `\n${rules.hazardChecklist.map((item) => `- ${item}`).join("\n")}`
    : " เช่น แรงดันและพลังงานสะสม สารไวไฟ ก๊าซพิษ ไฟฟ้า เครื่องจักร ที่สูงและวัตถุตกหล่น ความร้อน การยก และสภาพแวดล้อม";
  return `ก่อนเขียนอันตรายของแต่ละขั้นตอน ให้ไล่ตรวจแหล่งอันตรายต่อไปนี้ทีละข้อ แล้วใส่ทุกข้อที่เกิดได้จริงในขั้นตอนนั้น${list}`;
}

/* Mirrors backend/app/models/jsa.py's MAX_SUB_STEPS */
export const MAX_SUB_STEPS = 30;

/** The outside-AI-only line for the "แตกขั้นตอนหลักเป็นขั้นตอนย่อย" box, with
 * its optional rough total. The shared rules already allow sub-steps; this
 * asks for them on every main step. */
function splitRequest(target?: number) {
  const total = target
    ? ` รวมทั้งเอกสารประมาณ ${target} ขั้นตอนย่อย กระจายตามความซับซ้อนของแต่ละขั้นตอนหลัก ขั้นตอนที่งานเยอะแตกได้หลายข้อ ขั้นตอนง่ายแตกน้อยข้อ`
    : "";
  return `แตกแต่ละขั้นตอนหลักเป็นขั้นตอนย่อย (1.1, 1.2 …) ใน sub_steps ตามลำดับการทำงานจริง${total} ขั้นตอนหลักละไม่เกิน ${MAX_SUB_STEPS} ข้อ ห้ามแตกหรือเติมข้อเพียงเพื่อให้ได้จำนวน ถ้าขั้นตอนหลักใดไม่มีอะไรต้องแตกจริง ให้ sub_steps เป็น [] และใส่ hazards ที่ขั้นตอนหลักนั้นแทน`;
}

/* Used only when the server's rules (prompts/jsa-rules.md, through
 * /api/config/public) didn't arrive — config failed to load. A short stand-in
 * for them, not a second copy to keep in step: the real rules are the file. */
function fallbackJsaRules(rules?: JsaPromptRules) {
  return [
    "เรียงขั้นตอนตามลำดับงาน ถ้ารายละเอียดงานมีรายการขั้นตอนมาแล้ว ให้ยึดตามลำดับและความหมายนั้น ห้ามรวม แยก หรือตัดขั้นตอนหลัก เกลาถ้อยคำได้แต่ห้ามแก้เลขอุปกรณ์ ค่าตัวเลข หรือชื่อเฉพาะ",
    `ขั้นตอนย่อยอยู่ใน sub_steps ของขั้นตอนหลัก (ไม่เกิน ${MAX_SUB_STEPS} ข้อ) ขั้นตอนหลักที่มี sub_steps เป็นหัวข้อ ให้ hazards เป็น [] ถ้าไม่ใช้ให้ sub_steps เป็น []`,
    hazardScan(rules),
    "แยกหนึ่งอันตรายต่อหนึ่ง object พร้อม controls ของอันตรายนั้น มาตรการต้องทำได้จริงหน้างาน ใช้ข้อมูลที่ให้มา อย่าเดาค่าทางวิศวกรรม สิ่งที่ต้องยืนยันให้ใส่ใน assumptions",
    terminology(rules),
  ].filter(Boolean).join("\n\n");
}

export function buildPersonalPrompt(
  description: string,
  level: DetailLevel,
  instructions: string,
  rules?: JsaPromptRules,
  /** The screen's "แตกขั้นตอนหลักเป็นขั้นตอนย่อย" box: split every main step */
  splitSubSteps = false,
  /** Its optional rough total of sub-steps */
  subStepTarget?: number,
) {
  return [
    "ร่างการวิเคราะห์งานเพื่อความปลอดภัย (JSA) ภาษาไทยสำหรับให้ผู้รับผิดชอบตรวจทาน",
    `ระดับรายละเอียด: ${level} โดยยังคงอันตรายและมาตรการสำคัญครบถ้วน`,
    splitSubSteps ? splitRequest(subStepTarget) : "",
    // The same rules the built-in AI follows (prompts/jsa-rules.md)
    rules?.prompts?.jsa || fallbackJsaRules(rules),
    "# สิ่งที่ต้องตอบ",
    "ตอบเป็น JSON หนึ่ง object เท่านั้น ไม่ต้องใส่เลขข้อหรือข้อมูลหัวเอกสาร ใช้โครงสร้างนี้",
    answerAsFile(answerFileNames.jsa),
    '{"work_activity":"ชื่องาน","steps":[{"procedure":"ขั้นตอนที่ไม่แบ่งย่อย","details":"รายละเอียดงาน","hazards":[{"hazard":"อันตรายข้อแรก","controls":["มาตรการของข้อแรก"]},{"hazard":"อันตรายอีกข้อ","controls":["มาตรการของอีกข้อ"]}],"sub_steps":[]},{"procedure":"ขั้นตอนหลักที่แบ่งย่อย","details":"","hazards":[],"sub_steps":[{"procedure":"ขั้นตอนย่อย","details":"รายละเอียดงาน","hazards":[{"hazard":"อันตรายของขั้นตอนย่อย","controls":["มาตรการ"]}]}]}],"assumptions":["ข้อมูลที่ต้องยืนยัน"]}',
    `# รายละเอียดงาน\n${description.trim()}`,
    instructions.trim() && `# คำขอเพิ่มเติม\n${instructions.trim()}`,
  ].filter(Boolean).join("\n\n");
}

const hazardsSchema = z.array(z.object({
  hazard: z.string().trim().min(1).max(1000),
  controls: z.array(z.string().trim().min(1).max(4000)).min(1).max(20),
})).max(30);

const draftSubStepSchema = z.object({
  procedure: z.string().trim().min(1).max(2000),
  details: z.string().trim().max(4000).default(""),
  hazards: hazardsSchema.min(1),
});

const draftSchema = z.object({
  work_activity: z.string().trim().min(1).max(500),
  steps: z.array(z.object({
    procedure: z.string().trim().min(1).max(2000),
    details: z.string().trim().max(4000).default(""),
    // A heading step (one with sub-steps) carries none, so only required below
    hazards: hazardsSchema.default([]),
    sub_steps: z.array(draftSubStepSchema).max(MAX_SUB_STEPS).default([]),
  }).refine((step) => step.sub_steps.length > 0 || step.hazards.length > 0, {
    message: "ขั้นตอนที่ไม่มีขั้นตอนย่อยต้องมีอันตรายอย่างน้อยหนึ่งข้อ",
    path: ["hazards"],
  })).min(1).max(200),
  assumptions: z.array(z.string().trim().min(1).max(4000)).max(30).default([]),
});

const FIELD_NAMES: Record<string, string> = {
  work_activity: "ชื่องาน",
  procedure: "ชื่อขั้นตอน",
  details: "รายละเอียด",
  hazards: "อันตราย",
  hazard: "อันตราย",
  controls: "มาตรการ",
  action: "วิธีปฏิบัติ",
  assumptions: "ข้อสันนิษฐาน",
  purpose: "วัตถุประสงค์",
  scope: "ขอบเขต",
  tools: "เครื่องมือ",
};

/** A zod issue's path in the user's terms: ["steps", 0, "sub_steps", 1,
 * "hazards"] → "ขั้นตอน 1.2 · อันตราย", not "steps.0.sub_steps.1.hazards" */
function describePath(path: PropertyKey[]): string {
  const step: number[] = [];
  let field = "";
  for (let i = 0; i < path.length; i++) {
    const key = path[i];
    const next = path[i + 1];
    if ((key === "steps" || key === "sub_steps") && typeof next === "number") {
      step.push(next + 1);
      i++;
    } else if (typeof key === "string" && FIELD_NAMES[key]) {
      field = FIELD_NAMES[key];
    }
  }
  return [step.length ? ` ขั้นตอน ${step.join(".")}` : "", field ? ` ${step.length ? "· " : ""}${field}` : ""].join("");
}

function parseDraft<T>(answer: string, schema: z.ZodType<T>): T {
  if (answer.length > 250_000) throw new Error("คำตอบยาวเกินไป กรุณาขอให้ AI ตอบกระชับขึ้น");
  const trimmed = answer.replace(/^\uFEFF/, "").trim();
  const fenced = [...trimmed.matchAll(/```(?:json)?[ \t]*\r?\n([\s\S]*?)```/gi)];
  let data: unknown;
  try {
    data = JSON.parse(fenced.length === 1 ? fenced[0][1] : trimmed);
  } catch {
    throw new Error("อ่านคำตอบไม่ได้ กรุณาคัดลอก JSON จาก AI ให้ครบทั้งชุดแล้วลองอีกครั้ง");
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const field = describePath(parsed.error.issues[0]?.path ?? []);
    throw new Error(`คำตอบไม่ครบหรือผิดรูปแบบ${field ? ` ที่${field}` : ""} ให้ AI ตอบใหม่ตามคำสั่ง`);
  }
  return parsed.data;
}

export function parsePersonalDraft(answer: string) {
  const draft = parseDraft(answer, draftSchema);
  return {
    ...draft,
    steps: draft.steps.map((step, index) => ({
      ...step,
      no: index + 1,
      // A heading's own hazards never print, so drop them here (as the backend does)
      hazards: step.sub_steps.length ? [] : step.hazards,
      sub_steps: step.sub_steps.map((sub, subIndex) => ({ ...sub, no: subIndex + 1 })),
    })),
  };
}

export type PersonalDraft = ReturnType<typeof parsePersonalDraft>;

export function procedureSourceText(jsa: JsaDocument) {
  return [
    jsa.header.work_activity,
    ...jsa.steps.map((step, index) =>
      [
        `${index + 1}. ${step.procedure}`,
        step.details,
        ...step.sub_steps.map((sub, subIndex) =>
          [`   ${index + 1}.${subIndex + 1} ${sub.procedure}`, sub.details && `      ${sub.details}`].filter(Boolean).join("\n")),
      ].filter(Boolean).join("\n"),
    ),
  ].join("\n\n");
}

/* As fallbackJsaRules, for prompts/procedure-rules.md */
function fallbackProcedureRules(rules?: JsaPromptRules) {
  return [
    "ขยายแต่ละขั้นตอนหลักเป็นขั้นตอนย่อยที่ปฏิบัติได้ ส่ง steps หนึ่งรายการต่อเลขขั้นตอนหลัก no ให้ครบทุกข้อ ห้ามเพิ่ม ลบ หรือรวมเลขขั้นตอนหลัก",
    "ขั้นตอนหลักที่ JSA แบ่งขั้นตอนย่อยไว้แล้ว (1.1, 1.2 …) ให้ส่ง sub_steps จำนวนเท่ากับใน JSA พอดี เรียงตามลำดับเดิม",
    "ใช้ข้อมูลที่ให้มา อย่าเดาค่าทางวิศวกรรม ข้อกำหนด หรือเอกสารอ้างอิง สิ่งที่ต้องยืนยันให้ใส่ใน assumptions",
    terminology(rules),
  ].filter(Boolean).join("\n\n");
}

export function buildPersonalProcedurePrompt(work: string, level: DetailLevel, instructions: string, rules?: JsaPromptRules) {
  return [
    "ร่างขั้นตอนปฏิบัติงาน (WP) ภาษาไทยจาก JSA ที่ตรวจทานแล้ว",
    `ระดับรายละเอียด: ${level}`,
    // The same rules the built-in AI follows (prompts/procedure-rules.md)
    rules?.prompts?.procedure || fallbackProcedureRules(rules),
    "# สิ่งที่ต้องตอบ",
    "ตอบ JSON หนึ่ง object ตามตัวอย่างนี้ ขยาย steps ให้ครบตามรายการขั้นตอนหลักด้านล่าง",
    answerAsFile(answerFileNames.wp),
    '{"purpose":"วัตถุประสงค์","scope":"ขอบเขต","tools":["เครื่องมือ"],"steps":[{"no":1,"sub_steps":[{"action":"งานย่อย"}]}],"assumptions":[]}',
    `# ขั้นตอนหลักจาก JSA\n${work.trim()}`,
    instructions.trim() && `# คำขอเพิ่มเติม\n${instructions.trim()}`,
  ].filter(Boolean).join("\n\n");
}

const procedureSchema = z.object({
  purpose: z.string().trim().max(1000).default(""),
  scope: z.string().trim().max(1000).default(""),
  tools: z.array(z.string().trim().min(1).max(1000)).max(40).default([]),
  assumptions: z.array(z.string().trim().min(1).max(4000)).max(30).default([]),
  steps: z.array(z.object({
    no: z.number().int().positive(),
    sub_steps: z.array(z.object({ action: z.string().trim().min(1).max(1000) })).min(1).max(MAX_SUB_STEPS),
  })).min(1).max(200),
});

export function parsePersonalProcedure(
  answer: string,
  jsa: JsaDocument,
  referenceLabel = FALLBACK_PROCEDURE.jsaReferenceLabel,
): ProcedureDocument {
  const draft = parseDraft(answer, procedureSchema);
  const byNumber = new Map(draft.steps.map((step) => [step.no, step.sub_steps]));
  if (draft.steps.length !== jsa.steps.length || byNumber.size !== jsa.steps.length ||
      jsa.steps.some((_, index) => !byNumber.has(index + 1))) {
    throw new Error("เลขขั้นตอนหลักไม่ตรงกับ JSA กรุณาให้ AI ส่งทุกเลขให้ครบและไม่ซ้ำกัน");
  }
  return {
    ...draft,
    header: jsa.header,
    sourceFingerprint: jsaFingerprint(jsa),
    references: [`${referenceLabel}: ${jsa.header.work_activity.trim()} — ${formatThaiDate(jsa.header.analysis_date)}`],
    steps: jsa.steps.map((step, index) => {
      const answered = byNumber.get(index + 1)!;
      // Like procedure_service._sub_steps: a JSA step with sub-steps fixes the
      // WP's to one line each, in order — a short answer falls back to the
      // JSA sub-step's title, extras are dropped
      const actions = step.sub_steps.length
        ? step.sub_steps.map((sub, i) => answered[i]?.action ?? sub.procedure)
        : answered.map((sub) => sub.action);
      return {
        no: index + 1,
        procedure: step.procedure,
        sub_steps: actions.map((action, i) => ({ no: i + 1, action })),
      };
    }),
  };
}
