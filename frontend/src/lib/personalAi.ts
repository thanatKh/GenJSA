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

export function buildPersonalPrompt(description: string, level: DetailLevel, instructions: string, rules?: JsaPromptRules) {
  return [
    "ร่างการวิเคราะห์งานเพื่อความปลอดภัย (JSA) ภาษาไทยสำหรับให้ผู้รับผิดชอบตรวจทาน",
    `ระดับรายละเอียด: ${level} โดยยังคงอันตรายและมาตรการสำคัญครบถ้วน`,
    "เรียงขั้นตอนตามลำดับงาน ขั้นตอนเดียวมีอันตรายได้หลายข้อ ให้สำรวจอันตรายที่เกี่ยวข้องให้ครบก่อนเขียนมาตรการ",
    hazardScan(rules),
    "ใน hazards ให้แยกหนึ่งอันตรายต่อหนึ่ง object พร้อม controls ของอันตรายนั้นเอง หากพบหลายข้อให้ใส่หลาย object ในขั้นตอนเดิม อย่ารวมหลายอันตรายไว้ในข้อความเดียวหรือแยกขั้นตอนเพียงเพื่อให้เหลือข้อเดียว",
    "จำนวนอันตรายให้เป็นไปตามงานจริง ตัวอย่างด้านล่างแสดงสองข้อเพื่อสาธิตโครงสร้างเท่านั้น ใส่อันตรายเพียงข้อเดียวได้ก็ต่อเมื่อไล่ตรวจครบแล้วพบจริงเพียงข้อเดียว และห้ามเติมข้อที่ไม่เกี่ยวข้องเพื่อให้ได้จำนวน",
    rules?.considerWhenRelevant.length
      ? `พิจารณาหัวข้อต่อไปนี้ถ้าเกี่ยวข้องกับงาน (ถ้าไม่เกี่ยวข้องไม่ต้องใส่):\n${rules.considerWhenRelevant.map((item) => `- ${item}`).join("\n")}`
      : "",
    "ใช้ข้อมูลที่ให้มา อย่าเดาค่าทางวิศวกรรม ข้อกำหนด หรือสภาพหน้างาน สิ่งที่ต้องยืนยันให้ใส่ใน assumptions",
    "ตอบเป็น JSON หนึ่ง object เท่านั้น ไม่ต้องใส่เลขข้อหรือข้อมูลหัวเอกสาร ใช้โครงสร้างนี้",
    answerAsFile(answerFileNames.jsa),
    '{"work_activity":"ชื่องาน","steps":[{"procedure":"ชื่อขั้นตอน","details":"รายละเอียดงาน","hazards":[{"hazard":"อันตรายข้อแรก","controls":["มาตรการของข้อแรก"]},{"hazard":"อันตรายอีกข้อ","controls":["มาตรการของอีกข้อ"]}]}],"assumptions":["ข้อมูลที่ต้องยืนยัน"]}',
    `รายละเอียดงาน:\n${description.trim()}`,
    instructions.trim() && `คำขอเพิ่มเติม:\n${instructions.trim()}`,
  ].filter(Boolean).join("\n\n");
}

const draftSchema = z.object({
  work_activity: z.string().trim().min(1).max(500),
  steps: z.array(z.object({
    procedure: z.string().trim().min(1).max(2000),
    details: z.string().trim().max(4000).default(""),
    hazards: z.array(z.object({
      hazard: z.string().trim().min(1).max(1000),
      controls: z.array(z.string().trim().min(1).max(4000)).min(1).max(20),
    })).min(1).max(30),
  })).min(1).max(200),
  assumptions: z.array(z.string().trim().min(1).max(4000)).max(30).default([]),
});

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
    const field = parsed.error.issues[0]?.path.join(".");
    throw new Error(`ข้อมูลไม่ครบหรือผิดรูปแบบ${field ? ` ที่ ${field}` : ""} กรุณาให้ AI ตอบตามโครงสร้างในคำสั่ง`);
  }
  return parsed.data;
}

export function parsePersonalDraft(answer: string) {
  const draft = parseDraft(answer, draftSchema);
  return { ...draft, steps: draft.steps.map((step, index) => ({ ...step, no: index + 1 })) };
}

export type PersonalDraft = ReturnType<typeof parsePersonalDraft>;

export function procedureSourceText(jsa: JsaDocument) {
  return [
    jsa.header.work_activity,
    ...jsa.steps.map((step, index) =>
      [`${index + 1}. ${step.procedure}`, step.details].filter(Boolean).join("\n"),
    ),
  ].join("\n\n");
}

export function buildPersonalProcedurePrompt(work: string, level: DetailLevel, instructions: string) {
  return [
    "ร่างขั้นตอนปฏิบัติงาน (WP) ภาษาไทยจาก JSA ที่ตรวจทานแล้ว",
    `ระดับรายละเอียด: ${level}`,
    "ขยายแต่ละขั้นตอนหลักเป็นขั้นตอนย่อยที่ปฏิบัติได้ ส่ง steps หนึ่งรายการต่อเลขขั้นตอนหลัก no ให้ครบทุกข้อ ห้ามเพิ่ม ลบ หรือรวมเลขขั้นตอนหลัก",
    "ใช้ข้อมูลที่ให้มา อย่าเดาค่าทางวิศวกรรม ข้อกำหนด หรือเอกสารอ้างอิง สิ่งที่ต้องยืนยันให้ใส่ใน assumptions",
    "ตอบ JSON หนึ่ง object ตามตัวอย่างนี้ ขยาย steps ให้ครบตามรายการด้านล่าง",
    answerAsFile(answerFileNames.wp),
    '{"purpose":"วัตถุประสงค์","scope":"ขอบเขต","tools":["เครื่องมือ"],"steps":[{"no":1,"sub_steps":[{"action":"งานย่อย"}]}],"assumptions":[]}',
    `ขั้นตอนหลักจาก JSA:\n${work.trim()}`,
    instructions.trim() && `คำขอเพิ่มเติม:\n${instructions.trim()}`,
  ].filter(Boolean).join("\n\n");
}

const procedureSchema = z.object({
  purpose: z.string().trim().max(1000).default(""),
  scope: z.string().trim().max(1000).default(""),
  tools: z.array(z.string().trim().min(1).max(1000)).max(40).default([]),
  assumptions: z.array(z.string().trim().min(1).max(4000)).max(30).default([]),
  steps: z.array(z.object({
    no: z.number().int().positive(),
    sub_steps: z.array(z.object({ action: z.string().trim().min(1).max(1000) })).min(1).max(20),
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
    steps: jsa.steps.map((step, index) => ({
      no: index + 1,
      procedure: step.procedure,
      sub_steps: byNumber.get(index + 1)!.map((sub, i) => ({ no: i + 1, action: sub.action })),
    })),
  };
}
