/* Build the work procedure (ขั้นตอนปฏิบัติงาน) PDF in the browser with jsPDF
 *
 * Unlike the JSA — a bordered 3-column table locked to the F-ปธบ.-1202 form —
 * this document has no official form, so it's laid out as a flowing document:
 * a header block, then numbered sections, then numbered steps and sub-steps.
 * No grid, no columns, no cell borders.
 *
 * That choice isn't only aesthetic. A table would have needed full-width
 * "span" rows for step titles, which interact badly with buildJsaPdf's
 * orphan/widow guard and row-splitting. Flowing text needs none of that: the
 * only pagination rule here is "don't strand a heading at the bottom of a page".
 *
 * Shared drawing primitives (fonts, wrapping, title bar, header fields,
 * signature, footer) come from engine.ts, so this file and buildJsaPdf.ts
 * can't drift apart on Thai typography or jsPDF's quirks.
 */

import type { ProcedureDocument } from "../schema";
import { formatThaiDate } from "../thaidate";
import { createEngine, type Line } from "./engine";
import { procedurePdfFileName } from "./fileName";
import {
  FALLBACK_DOCUMENT,
  FALLBACK_LAYOUT,
  FALLBACK_PROCEDURE,
  mmToPt,
  type CompanyMeta,
  type DocumentMeta,
  type PdfLayout,
  type ProcedureMeta,
} from "./layout";

export type BuildProcedureOptions = {
  layout?: PdfLayout;
  document?: DocumentMeta;
  procedure?: ProcedureMeta;
  company?: CompanyMeta;
};

export async function buildProcedurePdf(
  procedure: ProcedureDocument,
  options: BuildProcedureOptions = {},
): Promise<Blob> {
  // Fall back per-section, not per-config: PublicConfig is an unchecked cast
  // (see lib/api.ts), so a backend older than any one of these would otherwise
  // take the whole document down
  const L = options.layout ?? FALLBACK_LAYOUT;
  const D = options.document ?? FALLBACK_DOCUMENT;
  const P = options.procedure ?? FALLBACK_PROCEDURE;
  const C = options.company;

  const E = await createEngine(L);
  const { doc, mL, mT, contentW, bodyBottom, lineH, pad, wrap, drawLines } = E;

  const headingPt = L.font.body_pt + 2;
  const headingLineH = headingPt * L.font.line_height;
  // Sub-steps hang under their step, which hangs under the section — indents
  // are in mm so they hold at any body_pt
  const stepIndent = mmToPt(6);
  const subIndent = mmToPt(14);
  const sectionGap = mmToPt(4);
  const blockGap = mmToPt(2);

  let y = mT;

  /** Start a new page and reset the cursor. No header is repeated — a flowing
   * document doesn't need the title bar restated, and the footer already
   * carries the page number. */
  const newPage = () => {
    doc.addPage();
    y = mT;
  };

  const need = (height: number) => {
    if (y + height > bodyBottom) newPage();
  };

  // ------------------------------------------------------------- header --
  const frameTop = y;
  y = E.drawTitleBar(P.titleTh, P.titleEn, y);

  const activityLines = E.measureFieldLines(
    D.labels.work_activity,
    procedure.header.work_activity,
    contentW,
  );
  const activityH = E.fieldRowHeight(activityLines);
  doc.setLineWidth(L.table.border_width_pt);
  doc.setDrawColor(...E.border);
  doc.rect(mL, y, contentW, activityH);
  E.drawField(D.labels.work_activity, activityLines, mL, contentW, y, activityH);
  y += activityH;

  // Supervisor and date share a row, split at the same 2/3 point the JSA uses
  const splitW = contentW * 0.665;
  const supervisorLines = E.measureFieldLines(
    D.labels.supervisor,
    procedure.header.supervisor,
    splitW,
  );
  const dateLines = E.measureFieldLines(
    P.labels.date,
    formatThaiDate(procedure.header.analysis_date),
    contentW - splitW,
  );
  const infoH = Math.max(E.fieldRowHeight(supervisorLines), E.fieldRowHeight(dateLines));
  doc.rect(mL, y, splitW, infoH);
  doc.rect(mL + splitW, y, contentW - splitW, infoH);
  E.drawField(D.labels.supervisor, supervisorLines, mL, splitW, y, infoH);
  E.drawField(P.labels.date, dateLines, mL + splitW, contentW - splitW, y, infoH);
  y += infoH;

  // The header block is the only framed part of this document
  E.pageFrames.push({ top: frameTop, bottom: y });
  y += sectionGap;

  // ------------------------------------------------------------ sections --
  let sectionNo = 0;

  /** "N. <title>" — returns the y below the heading. Kept with whatever
   * follows it by the caller reserving room for both. */
  const drawHeading = (title: string): void => {
    sectionNo += 1;
    const lines = wrap(`${sectionNo}. ${title}`, contentW, "bold", headingPt);
    drawLines(lines, mL, y, contentW, headingPt, headingLineH);
    y += lines.length * headingLineH;
  };

  const drawParagraph = (text: string, indent: number) => {
    const lines = wrap(text, contentW - indent, "normal", L.font.body_pt);
    drawLines(lines, mL + indent, y, contentW - indent);
    y += lines.length * lineH;
  };

  /** A section whose body is one paragraph (วัตถุประสงค์, ขอบเขต). */
  const textSection = (title: string, body: string) => {
    if (!body.trim()) return; // empty section prints nothing, not a bare heading
    const bodyLines = wrap(body, contentW - stepIndent, "normal", L.font.body_pt);
    need(headingLineH + bodyLines.length * lineH);
    drawHeading(title);
    drawParagraph(body, stepIndent);
    y += sectionGap;
  };

  /** A section whose body is a bulleted list (เอกสารอ้างอิง, เครื่องมือ). */
  const listSection = (title: string, items: string[]) => {
    const clean = items.map((i) => i.trim()).filter(Boolean);
    if (!clean.length) return;

    const wrapped: Line[][] = clean.map((item) =>
      wrap(item, contentW - stepIndent, "normal", L.font.body_pt, "•"),
    );
    need(headingLineH + wrapped[0].length * lineH);
    drawHeading(title);
    wrapped.forEach((lines) => {
      need(lines.length * lineH);
      drawLines(lines, mL + stepIndent, y, contentW - stepIndent);
      y += lines.length * lineH;
    });
    y += sectionGap;
  };

  textSection(P.sections.purpose, procedure.purpose);
  textSection(P.sections.scope, procedure.scope);
  listSection(P.sections.references, procedure.references);
  listSection(P.sections.tools, procedure.tools);

  // ------------------------------------------------- the procedure itself --
  const stepsHeadingNo = sectionNo + 1;
  // Reserve the heading plus the first step title, so the section never opens
  // on the last line of a page
  need(headingLineH + lineH * 2);
  drawHeading(P.sections.procedure);
  y += blockGap;

  procedure.steps.forEach((step) => {
    const titleLines = wrap(
      step.procedure,
      contentW - stepIndent,
      "bold",
      L.font.body_pt,
      `${stepsHeadingNo}.${step.no}`,
    );

    // Keep a step title with its first sub-step — a heading alone at the foot
    // of a page is the one pagination problem a flowing layout still has
    const firstSub = step.sub_steps[0];
    const firstSubH = firstSub
      ? wrap(firstSub.action, contentW - subIndent, "normal", L.font.body_pt, "0.0.0").length * lineH
      : 0;
    need(titleLines.length * lineH + firstSubH);

    drawLines(titleLines, mL + stepIndent, y, contentW - stepIndent);
    y += titleLines.length * lineH;

    step.sub_steps.forEach((sub) => {
      const marker = `${stepsHeadingNo}.${step.no}.${sub.no}`;
      const actionLines = wrap(
        sub.action,
        contentW - subIndent,
        "normal",
        L.font.body_pt,
        marker,
      );
      // Bold "หมายเหตุ:" marker rather than a glyph like ▸ — TH Sarabun has no
      // such glyph and silently drew nothing, leaving cautions looking exactly
      // like another instruction line
      const noteLines = sub.note.trim()
        ? wrap(sub.note, contentW - subIndent - pad * 2, "normal", L.font.body_pt, P.labels.note)
        : [];

      need(actionLines.length * lineH + noteLines.length * lineH);
      drawLines(actionLines, mL + subIndent, y, contentW - subIndent);
      y += actionLines.length * lineH;

      if (noteLines.length) {
        drawLines(noteLines, mL + subIndent + pad * 2, y, contentW - subIndent - pad * 2);
        y += noteLines.length * lineH;
      }
    });

    y += blockGap;
  });

  // ---------------------------------------------------------- sign-off --
  const authorName =
    procedure.header.analyst?.trim() || procedure.header.supervisor?.trim();
  E.drawSignature(P.labels.author, authorName, y);

  E.drawFrames();
  E.drawFooter(P.formCode, P.footerText, C?.name ?? "");

  // Gives the browser's own PDF viewer something meaningful to show instead of
  // a blob URL fragment (see the note in buildJsaPdf.ts — no <a download> here)
  doc.setProperties({ title: procedurePdfFileName(procedure) });

  return doc.output("blob");
}
