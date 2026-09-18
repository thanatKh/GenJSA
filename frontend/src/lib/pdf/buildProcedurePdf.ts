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
  const { doc, mL, mT, contentW, bodyBottom, lineH, wrap, drawLines } = E;

  const headingPt = L.font.body_pt + 2;
  const headingLineH = headingPt * L.font.line_height;
  // Sub-steps hang under their step, which hangs under the section — indents
  // are in mm so they hold at any body_pt
  const stepIndent = mmToPt(6);
  const subIndent = mmToPt(14);
  const sectionGap = mmToPt(4);
  const blockGap = mmToPt(2);

  let y = mT;

  /** Title bar + the work-activity/supervisor/date fields, framed the same
   * way on every page. Returns the y below it. Pushes one pageFrames entry
   * per call, so drawFrames() (one call per page, by index) always has an
   * entry waiting for the page it's about to stroke.
   *
   * Repeating the full header — not just the title — on every page: a
   * continuation page that opens straight into step content with no
   * work-activity/date visible reads as loose text, not the same document,
   * especially once printed or read as a standalone sheet. */
  const drawHeader = (top: number): number => {
    let cursor = E.drawTitleBar(P.titleTh, P.titleEn, top);
    const frameTop = top;

    const activityLines = E.measureFieldLines(
      D.labels.work_activity,
      procedure.header.work_activity,
      contentW,
    );
    const activityH = E.fieldRowHeight(activityLines);
    doc.setLineWidth(L.table.border_width_pt);
    doc.setDrawColor(...E.border);
    doc.rect(mL, cursor, contentW, activityH);
    E.drawField(D.labels.work_activity, activityLines, mL, contentW, cursor, activityH);
    cursor += activityH;

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
    doc.rect(mL, cursor, splitW, infoH);
    doc.rect(mL + splitW, cursor, contentW - splitW, infoH);
    E.drawField(D.labels.supervisor, supervisorLines, mL, splitW, cursor, infoH);
    E.drawField(P.labels.date, dateLines, mL + splitW, contentW - splitW, cursor, infoH);
    cursor += infoH;

    E.pageFrames.push({ top: frameTop, bottom: cursor });
    return cursor + sectionGap;
  };

  /** Start a new page, redraw the full header, and reset the cursor. */
  const newPage = () => {
    doc.addPage();
    y = drawHeader(mT);
  };

  const need = (height: number) => {
    if (y + height > bodyBottom) newPage();
  };

  /** Draw a wrapped block line-by-line, breaking to a new page mid-block if
   * it runs out of room — instead of drawParagraph's old one-shot drawLines,
   * which just drew straight past bodyBottom and off the visible page for
   * any block taller than the space left. A single block that's taller than
   * one whole page (a long purpose/scope, or one long sub-step) needs this
   * even right after a fresh newPage(), not just at the ragged bottom of a
   * partially-used page.
   *
   * `need(1 line)` is checked per line — cheap, and the natural unit here
   * since nothing in this document ever needs to keep two lines of body text
   * together mid-paragraph. */
  const drawFlowing = (lines: Line[], x: number, cellW: number, step: number = lineH) => {
    lines.forEach((line) => {
      if (y + step > bodyBottom) newPage();
      drawLines([line], x, y, cellW, L.font.body_pt, step);
      y += step;
    });
  };

  y = drawHeader(y);

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
    drawFlowing(lines, mL + indent, contentW - indent);
  };

  /** A section whose body is one paragraph (วัตถุประสงค์, ขอบเขต). */
  const textSection = (title: string, body: string) => {
    if (!body.trim()) return; // empty section prints nothing, not a bare heading
    const bodyLines = wrap(body, contentW - stepIndent, "normal", L.font.body_pt);
    // Only reserve room for the heading plus the first line here — the rest
    // of the paragraph flows and paginates itself via drawParagraph below,
    // same reasoning as the step/sub-step loop further down.
    need(headingLineH + Math.min(bodyLines.length, 1) * lineH);
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
    need(headingLineH + Math.min(wrapped[0].length, 1) * lineH);
    drawHeading(title);
    wrapped.forEach((lines) => {
      drawFlowing(lines, mL + stepIndent, contentW - stepIndent);
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
    // of a page is the one pagination problem a flowing layout still has.
    // Only reserved for the title's first line plus the first sub-step's
    // first line: a title or sub-step longer than that flows and paginates
    // itself via drawFlowing below, same as the section paragraphs above.
    const firstSub = step.sub_steps[0];
    const firstSubH = firstSub
      ? Math.min(
          wrap(firstSub.action, contentW - subIndent, "normal", L.font.body_pt, "0.0.0").length,
          1,
        ) * lineH
      : 0;
    need(Math.min(titleLines.length, 1) * lineH + firstSubH);

    drawFlowing(titleLines, mL + stepIndent, contentW - stepIndent);

    step.sub_steps.forEach((sub) => {
      const marker = `${stepsHeadingNo}.${step.no}.${sub.no}`;
      const actionLines = wrap(
        sub.action,
        contentW - subIndent,
        "normal",
        L.font.body_pt,
        marker,
      );

      drawFlowing(actionLines, mL + subIndent, contentW - subIndent);
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
