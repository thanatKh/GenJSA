/* The PDF's suggested file name — split out from buildJsaPdf.ts on purpose.
 *
 * buildJsaPdf.ts statically imports jsPDF (which drags in html2canvas +
 * dompurify, ~230KB), and PdfStep.tsx loads that module dynamically so pages
 * before step 3 never pay for that weight. This function has no such
 * dependency, so it lives here where PdfStep.tsx can import it statically
 * (e.g. to name a file for the Web Share API) without pulling jsPDF back
 * into the eagerly-loaded main bundle.
 */

import type { JsaDocument } from "../schema";

export function pdfFileName(jsa: JsaDocument): string {
  const safe = jsa.header.work_activity
    .replace(/[\\/:*?"<>|]/g, "")
    .trim()
    .slice(0, 60);
  return `JSA-${safe || "document"}-${jsa.header.analysis_date}.pdf`;
}
