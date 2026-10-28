/* Build the F-ปธบ.-1202 form PDF in the browser with jsPDF
 *
 * Why we hand-roll the layout: jsPDF has no HTML/CSS-style layout engine, so
 * we have to measure text height, wrap lines, compute row heights, break
 * pages, and draw every table line ourselves.
 *
 * Every value (sizes, margins, colors, column proportions) comes from
 * config/pdf.yaml via GET /api/config/public — nothing is hard-coded here.
 *
 * Thai line wrapping breaks between words (engine.ts's splitLines, using
 * the browser's Intl.Segmenter) — never overflows a column, and only cuts
 * mid-word for a single word wider than the whole column.
 */

import type { CompanyLogo } from "../companyLogo";
import type { JsaDocument } from "../schema";
import { formatThaiDate } from "../thaidate";
import { createEngine, type Line } from "./engine";
import { pdfFileName, projectJsaPdfFileName } from "./fileName";
import {
  FALLBACK_DOCUMENT,
  FALLBACK_LAYOUT,
  mmToPt,
  type CompanyMeta,
  type DocumentMeta,
  type PdfLayout,
} from "./layout";

type Row = { cells: [Line[], Line[], Line[]] };

type BuildOptions = {
  layout?: PdfLayout;
  document?: DocumentMeta;
  company?: CompanyMeta;
  /** Logo of the company that prepared this document, when it isn't PTTOR
   * — printed opposite the OR logo. Browser-only, see lib/companyLogo.ts. */
  companyLogo?: CompanyLogo | null;
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
  const E = await createEngine(L, { companyLogo: options.companyLogo });
  drawJsa(E, jsa, L, D);

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
  E.doc.setProperties({ title: pdfFileName(jsa) });

  return E.doc.output("blob");
}

type Engine = Awaited<ReturnType<typeof createEngine>>;

/** Draw one JSA — header, table and analyst line — starting at the top of
 * the engine's current page, which must be empty. Every page it adds pushes
 * its own pageFrames entry, so several JSAs can be drawn one after another
 * into one document (buildProjectJsaPdf) and still frame correctly. */
function drawJsa(E: Engine, jsa: JsaDocument, L: PdfLayout, D: DocumentMeta): void {
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

    // "โครงการ: …" — Project Mode only, above งาน/กิจกรรม so the project and
    // this phase's work read together. A Single Mode JSA has no project and
    // keeps the F-ปธบ.-1202 header exactly as it was.
    const project = jsa.header.project?.trim();
    if (project) y = E.drawCompanyRow(D.labels.project ?? "โครงการ", project, y);

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

    // "บริษัท: …" — only on documents prepared in another company's name, so
    // PTTOR's own copy of the F-ปธบ.-1202 header is unchanged
    const company = jsa.header.company?.trim();
    if (company) y = E.drawCompanyRow(D.labels.company ?? "บริษัท", company, y);

    // --- column headers ---
    setFont("bold", L.font.table_header_pt);
    const headTexts = [D.columns.procedure, D.columns.hazard, D.columns.control];
    const headLines = headTexts.map((text, i) =>
      E.splitLines(text, colW[i] - pad * 2),
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

  // The analyst line goes under the last row. Worked out up front so the
  // last row can follow it: if the row fits this page but the line under it
  // doesn't, the line used to land alone on an otherwise empty page.
  const analystLabel = D.labels.analyst ?? FALLBACK_DOCUMENT.labels.analyst;
  const analystName = jsa.header.analyst?.trim() || jsa.header.supervisor?.trim();
  const signatureH = E.signatureHeight(analystLabel, analystName);

  rows.forEach((row, rowIndex) => {
    const totalLines = Math.max(...row.cells.map((c) => c.length), 1);
    let drawn = 0;

    // Last row: carry it to a new page with the analyst line when the two
    // don't fit together here but do fit together on a fresh page
    if (signatureH && rowIndex === rows.length - 1 && !freshPage) {
      const rowH = totalLines * lineH + pad * 2;
      const fitsHere = y + rowH + signatureH <= bodyBottom;
      const fitsFresh = rowH + signatureH <= bodyBottom - (mT + mmToPt(60));
      if (!fitsHere && y + rowH <= bodyBottom && fitsFresh) {
        y = startNewPage();
        freshPage = true;
      }
    }

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
  });

  // ---------------------------------------------------------- analyst line --
  // "ผู้วิเคราะห์ <name>" below the table on the last page (name and label
  // worked out above the row loop). Drawn BEFORE the outer-frame pass so it
  // sits outside the table's border. A blank analyst means the supervisor did
  // the analysis, so their name is used; the label falls back per-section
  // because PublicConfig is an unchecked cast (see lib/api.ts) and an older
  // backend would leave it undefined.
  E.drawSignature(analystLabel, analystName, y);
}

/** Project Mode's second file: every phase's JSA in one PDF.
 *
 * Page 1 is a cover with the contents — JSA n / งาน / หน้า — and each JSA
 * then starts on a page of its own, drawn exactly as it prints alone (same
 * drawJsa). Page numbers run through the whole file so the contents can
 * point at them; like the procedure's cover, page 1 has no frame or footer.
 * The cover is drawn last, once every JSA's first page is known. */
export async function buildProjectJsaPdf(
  project: { name: string; supervisor: string; company: string; date: string },
  jsas: JsaDocument[],
  options: BuildOptions = {},
): Promise<Blob> {
  const L = options.layout ?? FALLBACK_LAYOUT;
  const D = options.document ?? FALLBACK_DOCUMENT;
  const C = options.company;
  const E = await createEngine(L, { companyLogo: options.companyLogo });
  const { doc, pageW, mL, mT, contentW, bodyBottom, pad, lineH, border, fill, setFont, wrap, drawLines, logo } = E;

  // Page 1: the cover, kept frameless (the zero-height placeholder keeps
  // pageFrames' index in step with the page number)
  E.pageFrames.push({ top: mT, bottom: mT });
  const firstPages = jsas.map((jsa) => {
    doc.addPage();
    const page = doc.getNumberOfPages();
    drawJsa(E, jsa, L, D);
    return page;
  });

  // ---------------------------------------------------------------- cover --
  doc.setPage(1);
  const centerX = pageW / 2;
  let y = mT + mmToPt(12);

  if (logo) {
    // The same OR (+ company) logo pair as the procedure's cover
    const logoH = mmToPt(16);
    const orBox = E.fitLogo(logo.ratio, contentW * 0.4, logoH);
    const companyBox = E.companyLogo ? E.fitLogo(E.companyLogo.ratio, contentW * 0.4, logoH) : null;
    const gap = mmToPt(10);
    let x = centerX - (orBox.w + (companyBox ? gap + companyBox.w : 0)) / 2;
    E.drawOrLogo(x, y + (logoH - orBox.h) / 2, orBox.w, orBox.h);
    if (companyBox) {
      x += orBox.w + gap / 2;
      doc.setDrawColor(...border);
      doc.setLineWidth(0.8);
      doc.line(x, y + logoH * 0.15, x, y + logoH * 0.85);
      E.drawCompanyLogo(x + gap / 2, y + (logoH - companyBox.h) / 2, companyBox.w, companyBox.h);
    }
    y += logoH + mmToPt(10);
  }

  // Text is placed by its baseline: step down by each line's ascent first
  doc.setTextColor(0, 0, 0);
  const titlePt = L.font.title_th_pt + 12;
  setFont("bold", titlePt);
  y += titlePt * 0.85;
  doc.text(D.titleTh, centerX, y, { align: "center" });
  y += titlePt * 0.35;
  if (D.titleEn) {
    setFont("normal", L.font.title_en_pt + 4);
    y += (L.font.title_en_pt + 4) * 0.95;
    doc.text(D.titleEn, centerX, y, { align: "center" });
  }
  y += mmToPt(5);
  doc.setDrawColor(...border);
  doc.setLineWidth(1.2);
  doc.line(centerX - mmToPt(30), y, centerX + mmToPt(30), y);
  y += mmToPt(8);

  // The project — the answer to "which job is this file for"
  const namePt = L.font.title_en_pt + 6;
  const nameLines = wrap(project.name, contentW * 0.85, "bold", namePt);
  nameLines.forEach((line) => {
    setFont("bold", namePt);
    y += namePt * 1.1;
    doc.text(line.text, centerX, y, { align: "center", maxWidth: contentW * 0.85 });
    y += namePt * (L.font.line_height - 1.1);
  });
  y += mmToPt(4);

  const infoPt = L.font.header_label_pt + 1;
  const info = (label: string, value: string) => {
    if (!value.trim()) return;
    setFont("bold", infoPt);
    const labelText = `${label}: `;
    const labelW = doc.getTextWidth(labelText);
    setFont("normal", infoPt);
    const startX = centerX - (labelW + doc.getTextWidth(value)) / 2;
    y += infoPt * 1.1;
    setFont("bold", infoPt);
    doc.text(labelText, startX, y);
    setFont("normal", infoPt);
    doc.text(value, startX + labelW, y);
    y += infoPt * 0.5;
  };
  info(D.labels.company ?? "บริษัท", project.company);
  info(D.labels.supervisor, project.supervisor);
  info(D.labels.analysis_date, formatThaiDate(project.date));
  y += mmToPt(10);

  // ------------------------------------------------------------- contents --
  const headPt = L.font.table_header_pt;
  setFont("bold", headPt + 2);
  y += (headPt + 2) * 0.95;
  doc.text("สารบัญ", mL, y);
  y += mmToPt(3);

  const widths = [contentW * 0.16, contentW * 0.68, contentW * 0.16];
  const xs = [mL, mL + widths[0], mL + widths[0] + widths[1]];
  doc.setLineWidth(L.table.border_width_pt);
  doc.setDrawColor(...border);

  const headH = headPt * 1.35 + pad * 2;
  ["ลำดับ", "งาน", "หน้า"].forEach((label, i) => {
    // Set per cell: drawing text resets jsPDF's fill colour to the text's
    doc.setFillColor(...fill);
    doc.rect(xs[i], y, widths[i], headH, "FD");
    setFont("bold", headPt);
    doc.text(label, xs[i] + widths[i] / 2, y + pad + headPt, { align: "center" });
  });
  y += headH;

  jsas.forEach((jsa, i) => {
    const cells = [
      wrap(`JSA ${i + 1}`, widths[0] - pad * 2, "normal", L.font.body_pt),
      wrap(jsa.header.work_activity, widths[1] - pad * 2, "normal", L.font.body_pt),
      wrap(String(firstPages[i]), widths[2] - pad * 2, "normal", L.font.body_pt),
    ];
    const rowH = Math.max(...cells.map((c) => c.length), 1) * lineH + pad * 2;
    // A contents list long enough to reach the footer would need its own
    // pages; projects run to a handful of phases, so stop rather than overprint
    if (y + rowH > bodyBottom) return;
    cells.forEach((lines, c) => {
      doc.rect(xs[c], y, widths[c], rowH);
      drawLines(lines, xs[c] + pad, y + pad, widths[c] - pad * 2);
    });
    y += rowH;
  });

  E.drawFrames();
  E.drawFooter(D.formCode, D.footerText, C?.name ?? "", true);
  doc.setProperties({ title: projectJsaPdfFileName(project.name, project.date) });
  return doc.output("blob");
}
