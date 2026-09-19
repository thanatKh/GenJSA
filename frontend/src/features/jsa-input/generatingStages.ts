/* What GeneratingPanel narrates while the LLM works.
 *
 * Separate from the component so it can export more than one list without
 * breaking Vite's fast refresh (which needs a module to export components
 * only). The panel's honest parts — elapsed counter, typical range, slow
 * warning — are the same for every document; only the wording differs.
 *
 * IMPORTANT — none of this is telemetry. The backend makes one blocking
 * call to ThaiLLM and returns once, whole; there is no streaming, no
 * intermediate status, no way to know what the model is actually doing at
 * any given moment. This list is a fixed, scripted narration advanced by a
 * wall-clock timer (see GeneratingPanel's STAGE_MS), not a live trace of
 * real events — same honesty trade-off the panel already makes explicit for
 * why it shows an elapsed-seconds counter instead of a fake progress bar.
 * Keep every line plausible-but-generic for that reason: specific enough to
 * not read as filler, vague enough that it's never technically a lie about
 * what's happening right now.
 */

export const JSA_STAGES = [
  "อ่านรายละเอียดงานที่อธิบายไว้",
  "ระบุประเภทงานและขอบเขต",
  "แยกขั้นตอนหลักของงาน",
  "เรียงลำดับขั้นตอนตามลำดับการทำงานจริง",
  "ตรวจหาอันตรายที่อาจเกิดขึ้นในแต่ละขั้นตอน",
  "จับคู่มาตรการป้องกัน/ควบคุมให้ตรงกับอันตราย",
  "ตรวจสอบความครบถ้วนตามแบบฟอร์ม F-ปธบ.-1202",
  "จัดรูปแบบเอกสาร",
] as const;

/** The work procedure expands an existing JSA rather than analysing a job
 * from scratch, so it narrates different work. */
export const PROCEDURE_STAGES = [
  "อ่านขั้นตอนหลักจาก JSA",
  "ขยายแต่ละขั้นตอนเป็นขั้นตอนย่อย",
  "เรียงลำดับขั้นตอนย่อยให้ปฏิบัติตามได้จริง",
  "เพิ่มข้อควรระวังเฉพาะจุด",
  "เพิ่มเกณฑ์ตรวจสอบระหว่างงาน",
  "จัดรูปแบบเอกสาร",
] as const;

/** When "สร้างขั้นตอนปฏิบัติงานด้วย" is checked on step 1, generation runs as
 * one continuous wait — JSA_STAGES' messages, then PROCEDURE_STAGES' — rather
 * than resetting the elapsed counter partway through, which would make the
 * second half look like a stuck restart instead of the natural continuation
 * it is. */
export const COMBINED_STAGES = [...JSA_STAGES, ...PROCEDURE_STAGES] as const;
