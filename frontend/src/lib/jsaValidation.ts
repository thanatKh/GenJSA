import type { JsaDocument } from "./schema";

export function jsaProblems(doc: JsaDocument): { id: string; message: string }[] {
  const issues: { id: string; message: string }[] = [];
  if (!doc.header.work_activity.trim()) issues.push({ id: "work_activity", message: "กรุณากรอกงาน/กิจกรรม" });
  if (!doc.header.supervisor.trim()) issues.push({ id: "supervisor", message: "กรุณากรอกชื่อหัวหน้างาน" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(doc.header.analysis_date)) issues.push({ id: "analysis_date", message: "กรุณาเลือกวันที่วิเคราะห์" });
  doc.steps.forEach((step, i) => {
    if (!step.procedure.trim()) issues.push({ id: `procedure-${i}`, message: `กรุณากรอกชื่อขั้นตอนที่ ${i + 1}` });
    step.hazards.forEach((hazard, h) => {
      if (!hazard.hazard.trim()) issues.push({ id: `hazard-${i}-${h}`, message: `ขั้นตอน ${i + 1}: กรุณาระบุอันตรายที่ ${h + 1}` });
      if (!hazard.controls.some((c) => c.trim())) issues.push({ id: `controls-${i}-${h}-0`, message: `ขั้นตอน ${i + 1}: กรุณาระบุมาตรการของอันตรายที่ ${h + 1}` });
    });
  });
  return issues;
}

export function focusJsaField(id: string) {
  const candidates = [id, id.replace(/^(procedure|hazard|controls)-/, "$1-m-")];
  const target = candidates.map((key) => document.getElementById(key)).find((el) => el && el.getClientRects().length);
  target?.focus(); target?.scrollIntoView({ block: "center" });
}
