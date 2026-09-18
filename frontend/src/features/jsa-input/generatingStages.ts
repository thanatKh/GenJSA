/* What GeneratingPanel narrates while the LLM works.
 *
 * Separate from the component so it can export more than one list without
 * breaking Vite's fast refresh (which needs a module to export components
 * only). The panel's honest parts — elapsed counter, typical range, slow
 * warning — are the same for every document; only the wording differs.
 */

export const JSA_STAGES = [
  "กำลังทำความเข้าใจงาน…",
  "กำลังแยกขั้นตอนหลัก…",
  "กำลังระบุอันตรายและมาตรการป้องกัน…",
  "กำลังจัดรูปแบบเอกสาร…",
] as const;

/** The work procedure expands an existing JSA rather than analysing a job
 * from scratch, so it narrates different work. */
export const PROCEDURE_STAGES = [
  "กำลังอ่านขั้นตอนใน JSA…",
  "กำลังขยายเป็นขั้นตอนย่อย…",
  "กำลังเพิ่มข้อควรระวังและเกณฑ์ตรวจสอบ…",
  "กำลังจัดรูปแบบเอกสาร…",
] as const;
