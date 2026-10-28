/* The PDF's suggested file name — split out from buildJsaPdf.ts on purpose.
 *
 * buildJsaPdf.ts statically imports jsPDF (which drags in html2canvas +
 * dompurify, ~230KB), and PdfStep.tsx loads that module dynamically so pages
 * before step 3 never pay for that weight. This function has no such
 * dependency, so it lives here where PdfStep.tsx can import it statically
 * (e.g. to name a file for the Web Share API) without pulling jsPDF back
 * into the eagerly-loaded main bundle.
 */

import type { JsaDocument, ProcedureDocument } from "../schema";

/** Strip the characters Windows/macOS reject in a file name, and cap the length */
function safeActivity(workActivity: string): string {
  return workActivity.replace(/[\\/:*?"<>|]/g, "").trim().slice(0, 60);
}

export function pdfFileName(jsa: JsaDocument): string {
  return `JSA-${safeActivity(jsa.header.work_activity) || "document"}-${jsa.header.analysis_date}.pdf`;
}

/** ASCII "WP-" prefix rather than a Thai one — file names travel through
 * share sheets, email and Windows shares, and a Thai prefix survives all of
 * those far less reliably than the document's own (Thai) title does. */
export function procedurePdfFileName(procedure: ProcedureDocument): string {
  const safe = safeActivity(procedure.header.work_activity);
  return `WP-${safe || "document"}-${procedure.header.analysis_date}.pdf`;
}

/** The editable Word twin's name — the PDF's, with .docx (lib/word/) */
export function docxFileName(jsa: JsaDocument): string {
  return pdfFileName(jsa).replace(/\.pdf$/, ".docx");
}

export function procedureDocxFileName(procedure: ProcedureDocument): string {
  return procedurePdfFileName(procedure).replace(/\.pdf$/, ".docx");
}

/** Project Mode's file of every phase's JSA. The project's procedure needs no
 * helper of its own: it's a ProcedureDocument whose work_activity is the
 * project name, so procedurePdfFileName already names it. */
export function projectJsaPdfFileName(projectName: string, isoDate: string): string {
  return `JSA-${safeActivity(projectName) || "project"}-${isoDate}.pdf`;
}

export function projectJsaDocxFileName(projectName: string, isoDate: string): string {
  return projectJsaPdfFileName(projectName, isoDate).replace(/\.pdf$/, ".docx");
}
