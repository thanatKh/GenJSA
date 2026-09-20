/* Shared jsPDF drawing primitives for GenJSA's documents
 *
 * jsPDF has no HTML/CSS layout engine, so every document here measures text,
 * wraps lines, and positions boxes by hand. This module holds the parts of
 * that work which carry no knowledge of *which* document is being drawn —
 * fonts, text wrapping, the title bar, header fields, the signature line and
 * the footer — so buildJsaPdf.ts (a bordered 3-column table) and
 * buildProcedurePdf.ts (a flowing numbered document) can't drift apart on the
 * details that were expensive to get right.
 *
 * Several functions here look over-commented. They aren't: the notes about
 * Thai tone marks, jsPDF's per-instance line width, and the bare addPage in
 * drawSignature each mark a bug that was found in a real generated PDF.
 *
 * Deliberately NOT here: the table pagination loop, its orphan/widow guard and
 * row-splitting. Those stay in buildJsaPdf.ts — they're specific to a bordered
 * table, and the flowing procedure document has no use for them.
 *
 * Bundle note: this imports jspdf, which drags in ~230KB. It must only ever be
 * reached through a dynamic import (see PdfStep.tsx), never from the eager
 * bundle — that's the whole reason fileName.ts exists separately.
 */

import { jsPDF } from "jspdf";

import logoUrl from "../../assets/logo.png";
import { FONT_NAME, registerThaiFont } from "./fonts";
import {
  FALLBACK_LAYOUT,
  hexToRgb,
  mmToPt,
  type PdfLayout,
} from "./layout";

// Re-exported so document builders don't need a second import just to set a font
export { FONT_NAME };

export type Weight = "normal" | "bold";

/** One line ready to draw — the marker is kept separate to support hanging indent */
export type Line = {
  text: string;
  weight: Weight;
  marker?: string;
  indent: number;
};

export type Logo = { data: string; ratio: number };

/** The drawing context a document builder works against. */
export type Engine = Awaited<ReturnType<typeof createEngine>>;

/**
 * Create a jsPDF instance with the Thai font registered and every derived
 * geometry value precomputed, plus the drawing helpers that operate on it.
 */
export async function createEngine(L: PdfLayout) {
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

  const border = hexToRgb(L.table.border_color);
  const fill = hexToRgb(L.table.header_fill);

  const logo = await loadLogo();

  /** Per-page bounds of the framed area, for the single outer-frame pass at the end */
  const pageFrames: { top: number; bottom: number }[] = [];

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

  /** Draw wrapped lines at `size` (defaults to body text), one per lineHeight step */
  const drawLines = (
    lines: Line[],
    x: number,
    top: number,
    cellW: number,
    size: number = L.font.body_pt,
    step: number = lineH,
  ) => {
    const drop = step * 0.74;
    lines.forEach((line, index) => {
      const baseline = top + index * step + drop;
      setFont(line.weight, size);
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

  // ------------------------------------------------------------ title bar --
  /**
   * Logo + centred Thai/English title in a bordered bar. Returns the y below it.
   * Does not touch pageFrames — the caller decides where its frame starts, since
   * the JSA wraps the title bar and table in one continuous outer border.
   */
  const drawTitleBar = (titleTh: string, titleEn: string, top: number): number => {
    const titleGap = mmToPt(1.2);
    setFont("bold", L.font.title_th_pt);
    const titleThLines = doc.splitTextToSize(titleTh, contentW * 0.6);
    setFont("bold", L.font.title_en_pt);
    const titleEnLines = titleEn ? doc.splitTextToSize(titleEn, contentW * 0.6) : [];

    const titleTextH =
      titleThLines.length * L.font.title_th_pt * 1.3 +
      titleEnLines.length * L.font.title_en_pt * 1.3 +
      (titleEnLines.length ? titleGap : 0);

    const logoH = logo ? mmToPt(L.logo.max_height_mm) : 0;
    const logoW = logo ? Math.min(logoH * logo.ratio, mmToPt(L.logo.max_width_mm)) : 0;
    const barH = Math.max(titleTextH, logoH) + mmToPt(4);

    doc.setDrawColor(...border);
    // Thin — this is just the divider between the title bar and whatever sits
    // below it, not a standalone box; a thick outer frame (when the document
    // uses one) is drawn once at the very end around everything together
    doc.setLineWidth(L.table.border_width_pt);
    doc.rect(mL, top, contentW, barH);

    if (logo) {
      doc.addImage(logo.data, "PNG", mL + mmToPt(3), top + (barH - logoH) / 2, logoW, logoH);
    }

    let titleY = top + (barH - titleTextH) / 2;
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

    return top + barH;
  };

  // -------------------------------------------------------- header fields --
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

  // ---------------------------------------------------------- signature --
  /**
   * "<label> <name>" below the body on the last page, outside any table border.
   * Returns nothing — it's always the last thing drawn before the frame pass.
   */
  const drawSignature = (label: string, name: string, y: number) => {
    // Fall back per-section, not just per-config: PublicConfig is an unchecked
    // cast (see lib/api.ts), so a backend older than this field would leave it
    // undefined and take the whole PDF down.
    const sig = L.signature ?? FALLBACK_LAYOUT.signature;
    const trimmed = name?.trim();
    if (!sig.show || !trimmed) return;

    setFont("bold", sig.label_pt);
    const labelW = doc.getTextWidth(label) + mmToPt(1.5);

    // Wrapped (not a single unbounded doc.text call) — a name long enough to
    // fill the schema's own 200-char allowance would otherwise run straight
    // off the right edge of the page with no maxWidth to stop it.
    const sigLineH = sig.label_pt * L.font.line_height;
    const sigBaselineDrop = sigLineH * 0.74;
    setFont("normal", sig.label_pt);
    const nameLines = doc.splitTextToSize(trimmed, Math.max(contentW - labelW, 10));
    const blockH = Math.max(nameLines.length, 1) * sigLineH;

    let cursor = y;
    if (bodyBottom - cursor < mmToPt(sig.gap_above_mm) + blockH) {
      // Deliberately a bare addPage, not a full new-page routine — that would
      // redraw the whole title bar and column headers for a one-line page.
      // Nothing is pushed to pageFrames either: an entry with top === bottom
      // makes the frame pass stroke a zero-height rect, i.e. a stray line.
      doc.addPage();
      cursor = mT;
    }

    // Bold label, normal name — the same treatment the header fields get
    // (see drawField above), so the document reads consistently
    const top = cursor + mmToPt(sig.gap_above_mm);
    doc.setTextColor(0, 0, 0);

    setFont("bold", sig.label_pt);
    doc.text(label, mL, top + sigBaselineDrop);

    setFont("normal", sig.label_pt);
    nameLines.forEach((line: string, index: number) => {
      doc.text(line, mL + labelW, top + index * sigLineH + sigBaselineDrop, {
        maxWidth: contentW - labelW,
      });
    });
  };

  // -------------------------------------------------------- frame pass --
  /**
   * Thick outer border, one crisp frame per page, from whatever the document
   * pushed into pageFrames. Call after all content is drawn so it sits on top
   * of the thinner cell grid.
   *
   * setLineWidth/setDrawColor are called INSIDE the loop, after each setPage —
   * jsPDF tracks line width as a single instance property, not per page, so
   * calling setLineWidth once before the loop only actually gets written into
   * whichever page happened to be active at that moment (the last page from the
   * main drawing loop); every other page then silently keeps whatever width its
   * own content last set (the thin border_width_pt grid), leaving it with the
   * wrong, thinner frame. Re-asserting the width on every page forces jsPDF to
   * re-emit it there.
   */
  const drawFrames = () => {
    pageFrames.forEach((frame, index) => {
      // top === bottom is the documented "no frame on this page" placeholder
      // (pushed to keep this array's index aligned with the physical page
      // number — see drawSignature's and buildProcedurePdf's cover page use
      // of it) — draw nothing rather than a zero-height rect, which jsPDF
      // renders as a visible stray horizontal line.
      if (frame.bottom === frame.top) return;
      doc.setPage(index + 1);
      doc.setLineWidth(L.table.outer_border_width_pt);
      doc.setDrawColor(...border);
      doc.rect(mL, frame.top, contentW, frame.bottom - frame.top);
    });
  };

  // ------------------------------------------------------------- footer --
  /** Draw the footer on every page. Must run last — it needs the total page count.
   *
   * `skipPage1` is for buildProcedurePdf's standalone cover page: a title
   * page prints no form code, company name or "หน้า N / total" of its own,
   * matching how the pageFrames border already skips it (see drawFrames'
   * top===bottom convention). buildJsaPdf has no cover page and never passes
   * this, so its page 1 — real form content — keeps its footer as before.
   * `total` stays the real jsPDF page count either way, so page 2's "2/N"
   * here still matches physical page 2 in a printed stack rather than being
   * renumbered around the cover. */
  const drawFooter = (
    formCode: string,
    footerText: string,
    companyName: string,
    skipPage1 = false,
  ) => {
    const total = doc.getNumberOfPages();
    const footerRight = L.footer.show_company && companyName ? companyName : "";
    const footerLeft = `${formCode} ${footerText}`.trim();

    for (let page = skipPage1 ? 2 : 1; page <= total; page += 1) {
      doc.setPage(page);
      setFont("normal", L.font.footer_pt);
      doc.setTextColor(0, 0, 0);
      const baseline = pageH - mB + mmToPt(6);

      if (footerLeft) doc.text(footerLeft, mL, baseline);
      if (footerRight) {
        doc.text(footerRight, pageW - mR, baseline, { align: "right" });
      }

      if (L.footer.show_page_number) {
        const label = L.footer.page_number_format
          .replace("{page}", String(page))
          .replace("{total}", String(total));
        const labelW = doc.getTextWidth(label);

        // True page center (pageW / 2) first — that's what "centered" means
        // to anyone looking at the page, and it's correct whenever either
        // side is short enough (or empty, as buildProcedurePdf's footerLeft
        // always is — see drawFooter's own doc comment) to leave room there.
        // Only when the true center would land inside either side's text
        // (a long company name, or a long form-code/footer-text pair) do we
        // fall back to centering in the gap between them instead — that
        // gap-centering used to be the ONLY behavior, which is what put the
        // page number visibly off true-center on any page with an empty
        // side (the procedure PDF, always): centering "in the gap" against
        // one truly empty side and one populated side just reproduces that
        // side's own off-center skew, it doesn't cancel it out.
        const gapBuffer = mmToPt(3);
        const footerLeftW = footerLeft ? doc.getTextWidth(footerLeft) : 0;
        const footerRightW = footerRight ? doc.getTextWidth(footerRight) : 0;
        const gapStart = mL + footerLeftW + gapBuffer;
        const gapEnd = pageW - mR - footerRightW - gapBuffer;

        const trueCenter = pageW / 2;
        const trueCenterFits =
          trueCenter - labelW / 2 >= gapStart && trueCenter + labelW / 2 <= gapEnd;

        if (trueCenterFits) {
          doc.text(label, trueCenter, baseline, { align: "center" });
        } else if (gapEnd - gapStart >= labelW) {
          doc.text(label, (gapStart + gapEnd) / 2, baseline, { align: "center" });
        } else if (gapEnd > gapStart) {
          // Not enough room to center it — left-align in whatever's left rather than overlap
          doc.text(label, gapStart, baseline);
        }
        // else: left/right footer text already fills the row — omit rather than overlap
      }
    }
  };

  return {
    doc,
    L,
    pageW,
    pageH,
    mL,
    mR,
    mT,
    mB,
    contentW,
    bodyBottom,
    pad,
    lineH,
    baselineDrop,
    border,
    fill,
    logo,
    pageFrames,
    setFont,
    wrap,
    drawLines,
    drawTitleBar,
    fieldLineH,
    measureFieldLines,
    fieldRowHeight,
    drawField,
    drawSignature,
    drawFrames,
    drawFooter,
  };
}

// ----------------------------------------------------------------- logo --
let logoCache: Promise<Logo | null> | null = null;

/** Memoized across documents — generating both PDFs decodes the logo once. */
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
