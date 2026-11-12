/* Small JSA / WP documents for the unit tests. Not imported by the app. */
import type { Hazard, JsaDocument, JsaStep } from "../lib/schema";

export const hz = (hazard: string, ...controls: string[]): Hazard => ({ hazard, controls: controls.length ? controls : ["มาตรการ"] });

export function step(procedure: string, hazards: Hazard[], subs: { procedure: string; hazards: Hazard[]; details?: string }[] = []): JsaStep {
  return {
    no: 0,
    procedure,
    details: "",
    hazards,
    sub_steps: subs.map((sub, i) => ({ no: i + 1, details: "", ...sub })),
  };
}

export function jsa(steps: JsaStep[]): JsaDocument {
  return {
    header: { work_activity: "เปลี่ยนวาล์ว", supervisor: "สมชาย", analysis_date: "2026-11-12", analyst: "", company: "", project: "" },
    steps: steps.map((s, i) => ({ ...s, no: i + 1 })),
    assumptions: [],
  };
}

/** Step 1 split into 1.1–1.2; step 2 plain with two hazards */
export const splitJsa = () =>
  jsa([
    step("เตรียมพื้นที่", [], [
      { procedure: "กั้นเขต", hazards: [hz("สะดุดล้ม")] },
      { procedure: "Check Gas", hazards: [hz("ไอน้ำมันติดไฟ", "Check Gas ก่อนเริ่ม", "ตรวจซ้ำทุก 2 ชม.")] },
    ]),
    step("ตัดแยกระบบ", [hz("น้ำมันรั่ว"), hz("แรงดันค้าง")]),
  ]);
