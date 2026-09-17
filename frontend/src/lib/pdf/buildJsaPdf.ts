/* Build the F-ปธบ.-1202 form PDF in the browser with jsPDF
 *
 * Why we hand-roll the layout: jsPDF has no HTML/CSS-style layout engine, so
 * we have to measure text height, wrap lines, compute row heights, break
 * pages, and draw every table line ourselves.
 *
 * Every value (sizes, margins, colors, column proportions) comes from
 * config/pdf.yaml via GET /api/config/public — nothing is hard-coded here.
 *
 * Accepted limitation: Thai line wrapping uses jsPDF's splitTextToSize,
 * which has no word-segmentation dictionary, so a break can land mid-word
 * (Thai doesn't use spaces between words). Still readable and never
 * overflows the column.
 */

import type { JsaDocument } from "../schema";
import { formatThaiDate } from "../thaidate";
import { createEngine, type Line } from "./engine";
import { pdfFileName } from "./fileName";
import {
  FALLBACK_DOCUMENT,
  FALLBACK_LAYOUT,
  mmToPt,
  type CompanyMeta,
  type DocumentMeta,
  type PdfLayout,
} from "./layout";

type Row = { cells: [Line[], Line[], Line[]] };

export type BuildOptions = {
  layout?: PdfLayout;
  document?: DocumentMeta;
  company?: CompanyMeta;
};

export async function buildJsaPdf(
  jsa: JsaDocument,
  options: BuildOptions = {},
): Promise<Blob> {
  const L = options.layout ?? FALLBACK_LAYOUT;
  const D = options.document ?? FALLBACK_DOCUMENT;
  const C = options.company;

  // Shared drawing context — fonts, geometry, text wrapping, the title bar,
  // header fields, the signature line, the frame pass and the footer all live
  // in engine.ts so this file and buildProcedurePdf.ts can't drift apart on them
  const E = await createEngine(L);
  const {
    doc,
    mL,
    mT,
    contentW,
    bodyBottom,
    pad,
    lineH,
    border,
    fill,
    pageFrames,
    setFont,
    wrap,
    drawLines,
  } = E;

  const colW = L.table.column_widths_percent.map((p) => (contentW * p) / 100);
  // Adjust the last column so the total matches content width exactly, avoiding a misaligned right border
  colW[2] = contentW - colW[0] - colW[1];
  const colX = [mL, mL + colW[0], mL + colW[0] + colW[1]];

  // ------------------------------------------------------------ build rows --
  const rows: Row[] = jsa.steps.map((step, stepIndex) => {
    const innerW = colW.map((w) => w - pad * 2);

    const procedure: Line[] = [
      ...wrap(step.procedure, innerW[0], "bold", L.font.body_pt, `${stepIndex + 1}.`),
      ...wrap(step.details, innerW[0], "normal", L.font.body_pt),
    ];

    const multiple = step.hazards.length > 1;
    const hazards: Line[] = [];
    const controls: Line[] = [];

    step.hazards.forEach((hazard, hazardIndex) => {
      hazards.push(
        ...wrap(
          hazard.hazard,
          innerW[1],
          "normal",
          L.font.body_pt,
          multiple ? `${hazardIndex + 1}.` : undefined,
        ),
      );

      const list = hazard.controls.filter((c) => c && c.trim());
      if (list.length === 0) {
        controls.push(...wrap("—", innerW[2], "normal", L.font.body_pt));
      }
      list.forEach((control, controlIndex) => {
        controls.push(
          ...wrap(
            control,
            innerW[2],
            "normal",
            L.font.body_pt,
            // Multiple hazards: sub-numbers 1.1 / 1.2 pair up with the numbers in the hazard column
            multiple ? `${hazardIndex + 1}.${controlIndex + 1}` : "-",
          ),
        );
      });
    });

    if (hazards.length === 0) hazards.push(...wrap("—", innerW[1], "normal", L.font.body_pt));

    return { cells: [procedure, hazards, controls] };
  });

  // --------------------------------------------------------- header drawing --
  /** Draw the document header (logo, title, header fields, column heads) and return the y where the table body begins */
  const drawHeader = (): number => {
    let y = mT;
    // Top of the page's single outer frame — includes the title bar, not just
    // the table below it, so the whole document gets one continuous
    // outer_border_width_pt perimeter instead of the title bar drawing its
    // own separate thick box (which looked disproportionately heavy sitting
    // right above the table's own thick frame)
    const frameTop = y;

    // --- title bar ---
    y = E.drawTitleBar(D.titleTh, D.titleEn, y);

    // --- header fields ---
    const { measureFieldLines, fieldRowHeight, drawField } = E;

    const activityLines = measureFieldLines(D.labels.work_activity, jsa.header.work_activity, contentW);
    const activityH = fieldRowHeight(activityLines);

    doc.setLineWidth(L.table.border_width_pt);
    doc.rect(mL, y, contentW, activityH);
    drawField(D.labels.work_activity, activityLines, mL, contentW, y, activityH);
    y += activityH;

    // The date box's left edge lines up with the table's own third column
    // (มาตรการป้องกัน/ควบคุม, colX[2]) instead of being sized off the field
    // text — that way one continuous vertical line runs from the header
    // fields straight down through the table below it, rather than the two
    // boundaries drifting apart depending on how long the supervisor's name
    // happens to be. colW[2] (33.3% of contentW by default) comfortably
    // fits a Thai date's label + value with room to spare.
    const splitW = colX[2] - mL;
    const supervisorLines = measureFieldLines(D.labels.supervisor, jsa.header.supervisor, splitW);
    const dateLines = measureFieldLines(
      D.labels.analysis_date,
      formatThaiDate(jsa.header.analysis_date),
      contentW - splitW,
    );
    // Both cells share one row, so its height is set by whichever field
    // needs more lines — a long supervisor name grows the whole row instead
    // of overflowing its own box (the date cell's short value just sits
    // centered in the extra height).
    const infoH = Math.max(fieldRowHeight(supervisorLines), fieldRowHeight(dateLines));
    doc.rect(mL, y, splitW, infoH);
    doc.rect(mL + splitW, y, contentW - splitW, infoH);
    drawField(D.labels.supervisor, supervisorLines, mL, splitW, y, infoH);
    drawField(D.labels.analysis_date, dateLines, mL + splitW, contentW - splitW, y, infoH);
    y += infoH;

    // --- column headers ---
    setFont("bold", L.font.table_header_pt);
    const headTexts = [D.columns.procedure, D.columns.hazard, D.columns.control];
    const headLines = headTexts.map((text, i) =>
      doc.splitTextToSize(text, colW[i] - pad * 2),
    );
    const hintLines = D.columns.procedure_hint ? 1 : 0;
    const headRows = Math.max(...headLines.map((l) => l.length)) + hintLines;
    const headH = headRows * L.font.table_header_pt * 1.35 + mmToPt(2);

    doc.setFillColor(...fill);
    colW.forEach((w, i) => {
      doc.rect(colX[i], y, w, headH, "FD");
    });

    headLines.forEach((lines, i) => {
      const isProcedure = i === 0;
      const total = lines.length + (isProcedure ? hintLines : 0);
      let textY = y + (headH - total * L.font.table_header_pt * 1.35) / 2;
      setFont("bold", L.font.table_header_pt);
      lines.forEach((line: string) => {
        textY += L.font.table_header_pt * 1.35;
        doc.text(line, colX[i] + colW[i] / 2, textY - L.font.table_header_pt * 0.35, {
          align: "center",
        });
      });
      if (isProcedure && hintLines) {
        setFont("normal", L.font.table_header_pt - 1);
        textY += L.font.table_header_pt * 1.35;
        doc.text(
          D.columns.procedure_hint,
          colX[i] + colW[i] / 2,
          textY - L.font.table_header_pt * 0.35,
          { align: "center" },
        );
      }
    });

    pageFrames.push({ top: frameTop, bottom: y + headH });
    return y + headH;
  };

  // ------------------------------------------------------------ draw pages --
  const startNewPage = (): number => {
    doc.addPage();
    if (L.table.repeat_header_each_page) return drawHeader();
    pageFrames.push({ top: mT, bottom: mT });
    return mT;
  };

  let y = drawHeader();

  const drawRowSlice = (row: Row, from: number, count: number, top: number) => {
    const height = count * lineH + pad * 2;
    doc.setLineWidth(L.table.border_width_pt);
    doc.setDrawColor(...border);
    colW.forEach((w, i) => {
      doc.rect(colX[i], top, w, height);
      drawLines(row.cells[i].slice(from, from + count), colX[i] + pad, top + pad, w - pad * 2);
    });
    return height;
  };

  // Never leave fewer than this many lines stranded alone on either side of
  // a forced mid-row page break — a lone line at the bottom of one page
  // (orphan) or top of the next (widow) reads as a layout glitch even though
  // nothing is technically wrong. Only engages once a row is already too
  // long to keep together on one page (avoid_row_split handles the "keep
  // whole" case above); this just makes an unavoidable split land cleanly.
  const MIN_SPLIT_LINES = 2;

  // True from the moment a fresh page is started until the first row-slice
  // is actually drawn on it — a brand-new page is the most room this row
  // will ever get, so the orphan/widow guard below has nothing to gain by
  // deferring further once the page is already fresh. Starts true: the very
  // first page has only the header on it at this point, same as any other
  // freshly-started page.
  let freshPage = true;

  for (const row of rows) {
    const totalLines = Math.max(...row.cells.map((c) => c.length), 1);
    let drawn = 0;

    while (drawn < totalLines) {
      const remaining = totalLines - drawn;
      const available = bodyBottom - y;
      let fits = Math.floor((available - pad * 2) / lineH);

      if (fits < 1) {
        // If a page we just started fresh still can't fit a single line, no
        // amount of further pagination will ever fit this row — config/pdf.yaml
        // leaves less than one line height of body space per page. Stop instead
        // of looping forever.
        if (freshPage) {
          throw new Error(
            "PDF layout error: a page cannot fit even one line of table content — check config/pdf.yaml margins/font sizes.",
          );
        }
        y = startNewPage();
        freshPage = true;
        continue;
      }

      // Don't split a row if a fresh page could fit it whole — avoids splitting a row unnecessarily
      if (
        L.table.avoid_row_split &&
        drawn === 0 &&
        fits < remaining &&
        remaining * lineH + pad * 2 <= bodyBottom - (mT + mmToPt(60))
      ) {
        y = startNewPage();
        freshPage = true;
        continue;
      }

      // Orphan/widow guard — a split is about to happen on this page
      // (fits < remaining). Skipped on an already-fresh page: there's no
      // more room to wait for, so whatever fits there is what gets drawn.
      if (fits < remaining && !freshPage) {
        const canSplitCleanly = remaining >= MIN_SPLIT_LINES * 2;
        if (!canSplitCleanly || fits < MIN_SPLIT_LINES) {
          // Either splitting anywhere would strand fewer than the minimum on
          // one side no matter where the cut lands, or this page can't even
          // offer the minimum right now — defer the whole rest of the row.
          y = startNewPage();
          freshPage = true;
          continue;
        }
        if (remaining - fits < MIN_SPLIT_LINES) {
          // Hold back enough lines that the leftover on the next page meets
          // the minimum too, instead of stranding a lone widow line there.
          fits = remaining - MIN_SPLIT_LINES;
        }
      }

      fits = Math.min(fits, remaining);
      y += drawRowSlice(row, drawn, fits, y);
      pageFrames[pageFrames.length - 1].bottom = y;
      drawn += fits;
      freshPage = false;

      if (drawn < totalLines) {
        y = startNewPage();
        freshPage = true;
      }
    }
  }

  // ---------------------------------------------------------- analyst line --
  // "ผู้วิเคราะห์ <name>" below the table on the last page. Drawn BEFORE the
  // outer-frame pass so it sits outside the table's border.
  //
  // The analyst field is optional; when it's blank the supervisor is the one
  // who did the analysis, so their name is used. (supervisor is required, so
  // in practice this always resolves to something.)
  //
  // Fall back per-section, not just per-config: PublicConfig is an unchecked
  // cast (see lib/api.ts), so a backend older than this field would leave it
  // undefined and take the whole PDF down.
  // The analyst field is optional; when it's blank the supervisor is the one
  // who did the analysis, so their name is used. (supervisor is required, so
  // in practice this always resolves to something.)
  //
  // Fall back per-section, not just per-config: PublicConfig is an unchecked
  // cast (see lib/api.ts), so a backend older than this field would leave it
  // undefined and take the whole PDF down.
  const analystName = jsa.header.analyst?.trim() || jsa.header.supervisor?.trim();
  E.drawSignature(D.labels.analyst ?? FALLBACK_DOCUMENT.labels.analyst, analystName, y);

  E.drawFrames();
  // Company name only — department dropped per request, kept only the
  // top-level owner rather than department · owner
  E.drawFooter(D.formCode, D.footerText, C?.name ?? "");

  // Set the PDF's internal /Title metadata. We deliberately don't use the
  // <a download> attribute (that forces an immediate silent save on mobile
  // Chrome, violating the "no auto-download" requirement) — so for anyone
  // reading the blob in the browser's own viewer, this Title is the only way
  // it gets a meaningful name to show/suggest instead of a random blob URL
  // fragment. (Desktop Chromium additionally gets a real Save-as dialog from
  // PdfStep.tsx, pre-filled from the same pdfFileName().)
  doc.setProperties({ title: pdfFileName(jsa) });

  return doc.output("blob");
}
