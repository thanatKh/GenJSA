import { z } from "zod";

export const detailLevels = ["กระชับ", "มาตรฐาน", "ละเอียด"] as const;
export type DetailLevel = (typeof detailLevels)[number];

export function buildPersonalPrompt(description: string, level: DetailLevel, instructions: string) {
  return [
    "ร่างการวิเคราะห์งานเพื่อความปลอดภัย (JSA) ภาษาไทยสำหรับให้ผู้รับผิดชอบตรวจทาน",
    `ระดับรายละเอียด: ${level} โดยยังคงอันตรายและมาตรการสำคัญครบถ้วน`,
    "เรียงขั้นตอนตามลำดับงาน ระบุอันตรายทีละข้อและจับคู่กับมาตรการที่เกี่ยวข้อง",
    "ใช้ข้อมูลที่ให้มา อย่าเดาค่าทางวิศวกรรม ข้อกำหนด หรือสภาพหน้างาน สิ่งที่ต้องยืนยันให้ใส่ใน assumptions",
    "ตอบเป็น JSON หนึ่ง object เท่านั้น ไม่ต้องใส่เลขข้อหรือข้อมูลหัวเอกสาร ใช้โครงสร้างนี้",
    '{"work_activity":"ชื่องาน","steps":[{"procedure":"ชื่อขั้นตอน","details":"รายละเอียดงาน","hazards":[{"hazard":"อันตราย","controls":["มาตรการ"]}]}],"assumptions":["ข้อมูลที่ต้องยืนยัน"]}',
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

export function parsePersonalDraft(answer: string) {
  if (answer.length > 250_000) throw new Error("คำตอบยาวเกินไป กรุณาขอให้ AI ตอบกระชับขึ้น");
  const trimmed = answer.trim();
  const fenced = [...trimmed.matchAll(/```(?:json)?[ \t]*\r?\n([\s\S]*?)```/gi)];
  let data: unknown;
  try {
    data = JSON.parse(fenced.length === 1 ? fenced[0][1] : trimmed);
  } catch {
    throw new Error("อ่านคำตอบไม่ได้ กรุณาคัดลอก JSON จาก AI ให้ครบทั้งชุดแล้วลองอีกครั้ง");
  }
  const parsed = draftSchema.safeParse(data);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path.join(".");
    throw new Error(`ข้อมูลไม่ครบหรือผิดรูปแบบ${field ? ` ที่ ${field}` : ""} กรุณาให้ AI ตอบตามโครงสร้างในคำสั่ง`);
  }
  return {
    ...parsed.data,
    steps: parsed.data.steps.map((step, index) => ({ ...step, no: index + 1 })),
  };
}

export type PersonalDraft = ReturnType<typeof parsePersonalDraft>;
