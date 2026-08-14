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

import { jsPDF } from "jspdf";

import logoUrl from "../../assets/logo.png";
import type { JsaDocument } from "../schema";
import { formatThaiDate } from "../thaidate";
import { pdfFileName } from "./fileName";
import { FONT_NAME, registerThaiFont } from "./fonts";
import {
  FALLBACK_DOCUMENT,
  FALLBACK_LAYOUT,
  hexToRgb,
  mmToPt,
  type CompanyMeta,
  type DocumentMeta,
  type PdfLayout,
} from "./layout";

type Weight = "normal" | "bold";

/** One line ready to draw — the marker is kept separate to support hanging indent */
type Line = {
  text: string;
  weight: Weight;
  marker?: string;
  indent: number;
};

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

  const doc = new jsPDF({
    unit: "pt",
    format: L.page.size.toLowerCase() as "a4",
    orientation: L.page.orientation === "landscape" ? "landscape" : "portrait",
    compress: true,
  });
  await registerThaiFont(doc);

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const mL = mmToPt(L.page.margin_left_mm);
  const mR = mmToPt(L.page.margin_right_mm);
  const mT = mmToPt(L.page.margin_top_mm);
  const mB = mmToPt(L.page.margin_bottom_mm);

  const contentW = pageW - mL - mR;
  const bodyBottom = pageH - mB;
  const pad = mmToPt(L.table.cell_padding_mm);
  const lineH = L.font.body_pt * L.font.line_height;
  // Distance from the top of the line box to the baseline — leaves room for Thai tone marks above
  const baselineDrop = lineH * 0.74;

  const colW = L.table.column_widths_percent.map((p) => (contentW * p) / 100);
  // Adjust the last column so the total matches content width exactly, avoiding a misaligned right border
  colW[2] = contentW - colW[0] - colW[1];
  const colX = [mL, mL + colW[0], mL + colW[0] + colW[1]];

  const border = hexToRgb(L.table.border_color);
  const fill = hexToRgb(L.table.header_fill);

  const logo = await loadLogo();

  // Per-page bounds of the main table (header fields + column headers + rows),
  // used to draw one crisp outer_border_width_pt frame per page at the end —
  // everything drawn while building rows uses the thinner border_width_pt for
  // the cell grid (see drawRowSlice / drawHeader below)
  const pageFrames: { top: number; bottom: number }[] = [];

  // ---------------------------------------------------------------- helpers --
  const setFont = (weight: Weight, size: number) => {
    doc.setFont(FONT_NAME, weight);
    doc.setFontSize(size);
  };

  /** Wrap text to fit a given width, returning ready-to-draw lines */
  const wrap = (
    text: string,
    width: number,
    weight: Weight,
    size: number,
    marker?: string,
  ): Line[] => {
    const clean = (text ?? "").trim();
    if (!clean) return [];

    setFont(weight, size);
    const markerW = marker ? doc.getTextWidth(marker) + mmToPt(1.4) : 0;
    const parts = doc.splitTextToSize(clean, Math.max(width - markerW, 10));

    return parts.map((part: string, index: number) => ({
      text: part,
      weight,
      // Marker only appears on the first line — later lines indent to align with the text (hanging indent)
      marker: index === 0 ? marker : undefined,
      indent: markerW,
    }));
  };

  const drawLines = (lines: Line[], x: number, top: number, cellW: number) => {
    lines.forEach((line, index) => {
      const baseline = top + index * lineH + baselineDrop;
      setFont(line.weight, L.font.body_pt);
      // Marker matches the line's own weight rather than always being bold —
      // the procedure column's "1." stays bold (its text is bold too), but
      // อันตรายที่อาจเกิดขึ้น/มาตรการป้องกัน/ควบคุม's "1."/"1.1" numbering
      // sits next to normal-weight text, so it stays normal as well.
      if (line.marker) {
        doc.text(line.marker, x, baseline);
      }
      doc.text(line.text, x + line.indent, baseline, {
        maxWidth: cellW - line.indent,
      });
    });
  };

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
    const titleGap = mmToPt(1.2);
    setFont("bold", L.font.title_th_pt);
    const titleThLines = doc.splitTextToSize(D.titleTh, contentW * 0.6);
    setFont("bold", L.font.title_en_pt);
    const titleEnLines = D.titleEn ? doc.splitTextToSize(D.titleEn, contentW * 0.6) : [];

    const titleTextH =
      titleThLines.length * L.font.title_th_pt * 1.3 +
      titleEnLines.length * L.font.title_en_pt * 1.3 +
      (titleEnLines.length ? titleGap : 0);

    const logoH = logo ? Math.min(mmToPt(L.logo.max_height_mm), mmToPt(L.logo.max_height_mm)) : 0;
    const logoW = logo ? Math.min(logoH * logo.ratio, mmToPt(L.logo.max_width_mm)) : 0;
    const barH = Math.max(titleTextH, logoH) + mmToPt(4);

    doc.setDrawColor(...border);
    // Thin — this is just the divider between the title bar and the fields
    // below, not a standalone box; the thick outer frame is drawn once, at
    // the very end, around the title bar + fields + table together
    doc.setLineWidth(L.table.border_width_pt);
    doc.rect(mL, y, contentW, barH);

    if (logo) {
      doc.addImage(
        logo.data,
        "PNG",
        mL + mmToPt(3),
        y + (barH - logoH) / 2,
        logoW,
        logoH,
      );
    }

    let titleY = y + (barH - titleTextH) / 2;
    setFont("bold", L.font.title_th_pt);
    titleThLines.forEach((line: string) => {
      titleY += L.font.title_th_pt * 1.3;
      doc.text(line, pageW / 2, titleY - L.font.title_th_pt * 0.32, { align: "center" });
    });
    if (titleEnLines.length) {
      titleY += titleGap;
      setFont("bold", L.font.title_en_pt);
      titleEnLines.forEach((line: string) => {
        titleY += L.font.title_en_pt * 1.3;
        doc.text(line, pageW / 2, titleY - L.font.title_en_pt * 0.32, { align: "center" });
      });
    }
    y += barH;

    // --- header fields ---
    // fieldLineH stays >= the 1.45 floor documented in config/pdf.yaml (Thai
    // tone marks/stacked vowels start colliding below that) — lines here are
    // drawn one at a time at this exact spacing (not jsPDF's own automatic
    // wrap spacing, which defaults to a tighter ~1.15x and would desync from
    // the box height reserved below).
    const fieldLineH = L.font.header_label_pt * 1.45;
    const fieldBaselineDrop = fieldLineH * 0.74;

    // One source of truth for how a field's value wraps, used both to size
    // its box (before drawing) and to draw it (after) — previously these were
    // two separately-computed widths that could drift out of sync, and the
    // box height didn't account for wrapping at all for supervisor/date,
    // so a long supervisor name would overflow straight through the row's
    // own border into the table header below it.
    const measureFieldLines = (label: string, value: string, width: number): string[] => {
      setFont("bold", L.font.header_label_pt);
      const labelW = doc.getTextWidth(`${label}:`) + mmToPt(1.5);
      setFont("normal", L.font.header_label_pt);
      return doc.splitTextToSize(value || "", Math.max(width - pad * 2 - labelW, 10));
    };

    const fieldRowHeight = (lines: string[]) => Math.max(lines.length, 1) * fieldLineH + mmToPt(1);

    const drawField = (
      label: string,
      lines: string[],
      x: number,
      width: number,
      rowY: number,
      rowH: number,
    ) => {
      setFont("bold", L.font.header_label_pt);
      const labelText = `${label}:`;
      const labelW = doc.getTextWidth(labelText) + mmToPt(1.5);
      const blockH = Math.max(lines.length, 1) * fieldLineH;
      const top = rowY + (rowH - blockH) / 2;

      doc.text(labelText, x + pad, top + fieldBaselineDrop);
      setFont("normal", L.font.header_label_pt);
      const valueX = x + pad + labelW;
      const maxWidth = width - pad * 2 - labelW;
      (lines.length ? lines : [""]).forEach((line, index) => {
        doc.text(line, valueX, top + index * fieldLineH + fieldBaselineDrop, { maxWidth });
      });
    };

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
  const sig = L.signature ?? FALLBACK_LAYOUT.signature;
  const analystName = jsa.header.analyst?.trim() || jsa.header.supervisor?.trim();

  if (sig.show && analystName) {
    const label = D.labels.analyst ?? FALLBACK_DOCUMENT.labels.analyst;
    setFont("bold", sig.label_pt);
    const labelW = doc.getTextWidth(label) + mmToPt(1.5);

    // Wrapped (not a single unbounded doc.text call) — an analyst name long
    // enough to fill the schema's own 200-char allowance would otherwise run
    // straight off the right edge of the page with no maxWidth to stop it.
    const sigLineH = sig.label_pt * L.font.line_height;
    const sigBaselineDrop = sigLineH * 0.74;
    setFont("normal", sig.label_pt);
    const nameLines = doc.splitTextToSize(analystName, Math.max(contentW - labelW, 10));
    const blockH = Math.max(nameLines.length, 1) * sigLineH;

    if (bodyBottom - y < mmToPt(sig.gap_above_mm) + blockH) {
      // Deliberately a bare addPage, not startNewPage() — that would redraw the
      // whole title bar and column headers for a one-line page. Nothing is
      // pushed to pageFrames either: an entry with top === bottom makes the frame
      // pass below stroke a zero-height rect, i.e. a stray horizontal line.
      doc.addPage();
      y = mT;
    }

    // Bold label, normal name — the same treatment the header fields get
    // (see drawField above), so the document reads consistently
    const top = y + mmToPt(sig.gap_above_mm);
    doc.setTextColor(0, 0, 0);

    setFont("bold", sig.label_pt);
    doc.text(label, mL, top + sigBaselineDrop);

    setFont("normal", sig.label_pt);
    nameLines.forEach((line: string, index: number) => {
      doc.text(line, mL + labelW, top + index * sigLineH + sigBaselineDrop, {
        maxWidth: contentW - labelW,
      });
    });
  }

  // Thick outer table border, one crisp frame per page — drawn after all rows so it stays
  // on top of the thinner border_width_pt cell grid already drawn (see drawRowSlice/drawHeader).
  // setLineWidth/setDrawColor are called INSIDE the loop, after each setPage — jsPDF tracks line
  // width as a single instance property, not per page, so calling setLineWidth once before the
  // loop only actually gets written into whichever page happened to be active at that moment
  // (the last page from the main drawing loop above); every other page then silently keeps
  // whatever width its own content last set (the thin border_width_pt grid), leaving it with the
  // wrong, thinner frame. Re-asserting the width on every page forces jsPDF to re-emit it there.
  pageFrames.forEach((frame, index) => {
    doc.setPage(index + 1);
    doc.setLineWidth(L.table.outer_border_width_pt);
    doc.setDrawColor(...border);
    doc.rect(mL, frame.top, contentW, frame.bottom - frame.top);
  });

  // ----------------------------------------------------------- footer pass --
  // Draw the footer last, since we need the total page count before printing "Page X / Y"
  const total = doc.getNumberOfPages();
  // Company name only — department dropped per request, kept only the
  // top-level owner rather than department · owner
  const footerRight = L.footer.show_company && C?.name ? C.name : "";
  const footerLeft = `${D.formCode} ${D.footerText}`.trim();

  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page);
    setFont("normal", L.font.footer_pt);
    doc.setTextColor(0, 0, 0);
    const baseline = pageH - mB + mmToPt(6);

    doc.text(footerLeft, mL, baseline);
    if (footerRight) {
      doc.text(footerRight, pageW - mR, baseline, { align: "right" });
    }

    if (L.footer.show_page_number) {
      const label = L.footer.page_number_format
        .replace("{page}", String(page))
        .replace("{total}", String(total));
      const labelW = doc.getTextWidth(label);

      // Center the page number in the actual gap between the left/right
      // footer text, not a fixed pageW/2 — config/company.yaml's name is
      // meant to be edited by non-developers, so a longer department name
      // must never silently start overlapping the page number
      const gapBuffer = mmToPt(3);
      const footerLeftW = doc.getTextWidth(footerLeft);
      const footerRightW = footerRight ? doc.getTextWidth(footerRight) : 0;
      const gapStart = mL + footerLeftW + gapBuffer;
      const gapEnd = pageW - mR - footerRightW - gapBuffer;

      if (gapEnd - gapStart >= labelW) {
        doc.text(label, (gapStart + gapEnd) / 2, baseline, { align: "center" });
      } else if (gapEnd > gapStart) {
        // Not enough room to center it — left-align in whatever's left rather than overlap
        doc.text(label, gapStart, baseline);
      }
      // else: left/right footer text already fills the row — omit rather than overlap
    }
  }

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

type Logo = { data: string; ratio: number };
let logoCache: Promise<Logo | null> | null = null;

function loadLogo(): Promise<Logo | null> {
  logoCache ??= new Promise<Logo | null>((resolve) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(null);
      ctx.drawImage(image, 0, 0);
      resolve({
        data: canvas.toDataURL("image/png"),
        ratio: image.naturalWidth / image.naturalHeight,
      });
    };
    // A missing logo must not fail the whole document — still produce one without it
    image.onerror = () => resolve(null);
    image.src = logoUrl;
  });
  return logoCache;
}
