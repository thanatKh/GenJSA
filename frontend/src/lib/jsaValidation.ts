import type { JsaDocument } from "./schema";

export function jsaProblems(doc: JsaDocument): { id: string; message: string }[] {
  const issues: { id: string; message: string }[] = [];
  if (!doc.header.work_activity.trim()) issues.push({ id: "work_activity", message: "กรุณากรอกงาน/กิจกรรม" });
  if (!doc.header.supervisor.trim()) issues.push({ id: "supervisor", message: "กรุณากรอกชื่อหัวหน้างาน" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(doc.header.analysis_date)) issues.push({ id: "analysis_date", message: "กรุณาเลือกวันที่วิเคราะห์" });
  // A row's ids carry its path: "0" for step 1, "0-s1" for step 1.2 (StepCard's idBase)
  const checkRow = (row: { procedure: string; hazards: JsaDocument["steps"][number]["hazards"] }, idBase: string, label: string) => {
    if (!row.procedure.trim()) issues.push({ id: `procedure-${idBase}`, message: `กรุณากรอกชื่อขั้นตอนที่ ${label}` });
    row.hazards.forEach((hazard, h) => {
      if (!hazard.hazard.trim()) issues.push({ id: `hazard-${idBase}-${h}`, message: `ขั้นตอน ${label}: กรุณาระบุอันตรายที่ ${h + 1}` });
      if (!hazard.controls.some((c) => c.trim())) issues.push({ id: `controls-${idBase}-${h}-0`, message: `ขั้นตอน ${label}: กรุณาระบุมาตรการของอันตรายที่ ${h + 1}` });
    });
  };
  doc.steps.forEach((step, i) => {
    checkRow(step, `${i}`, `${i + 1}`);
    step.sub_steps.forEach((sub, j) => checkRow(sub, `${i}-s${j}`, `${i + 1}.${j + 1}`));
  });
  return issues;
}

export function focusJsaField(id: string) {
  const candidates = [id, id.replace(/^(procedure|hazard|controls)-/, "$1-m-")];
  const target = candidates.map((key) => document.getElementById(key)).find((el) => el && el.getClientRects().length);
  target?.focus(); target?.scrollIntoView({ block: "center" });
}
