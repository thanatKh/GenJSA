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

import { type CompanyLogo, logoFormat } from "../companyLogo";
import { loadOrLogo } from "../orLogo";
import { FONT_NAME, registerThaiFont } from "./fonts";
import {
  FALLBACK_LAYOUT,
  hexToRgb,
  mmToPt,
  type PdfLayout,
} from "./layout";

export type Weight = "normal" | "bold";

/** One line ready to draw — the marker is kept separate to support hanging indent */
export type Line = {
  text: string;
  weight: Weight;
  marker?: string;
  indent: number;
};

/** Thai word boundaries for splitLines, built once per page load. Null where
 * the browser has no Intl.Segmenter — splitLines then falls back to jsPDF's
 * own space-only breaking. */
const thaiWords =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter("th", { granularity: "word" })
    : null;

/** Never start a line with these — "23.5" then "%)" alone on the next line,
 * or a line opening with ")" or "," or Thai ๆ / ฯ. Each is glued onto the
 * piece before it. */
const NO_LINE_START = /^[%)\]}、。,.:;!?ๆฯ’”]/;
/** …and never end a line with these: "(" sticks to the piece after it. */
const NO_LINE_END = /[([{‘“]$/;

/** The segmenter's words, regrouped so a line break can only fall where a
 * reader expects one (see NO_LINE_START / NO_LINE_END). */
function breakUnits(paragraph: string, words: Intl.Segmenter): string[] {
  const units: string[] = [];
  let carry = "";
  for (const { segment } of words.segment(paragraph)) {
    const prev = units[units.length - 1];
    if (prev !== undefined && !carry && NO_LINE_START.test(segment) && prev.trim()) {
      units[units.length - 1] = prev + segment;
    } else if (NO_LINE_END.test(segment)) {
      carry += segment;
    } else {
      units.push(carry + segment);
      carry = "";
    }
  }
  if (carry) units.push(carry);
  return units;
}

// Subscript/superscript digits → plain ones. TH Sarabun New has no glyphs
// for them, so "N₂" printed as "N" — the 2 silently gone, in a document
// about nitrogen purging. "N2" reads the same on site.
const SCRIPT_DIGITS: Record<string, string> = {
  "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9",
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
};
function printable(text: string): string {
  return text.replace(/[₀-₉⁰¹²³⁴-⁹]/g, (c) => SCRIPT_DIGITS[c] ?? c);
}

/**
 * Create a jsPDF instance with the Thai font registered and every derived
 * geometry value precomputed, plus the drawing helpers that operate on it.
 */
export async function createEngine(
  L: PdfLayout,
  /** A document prepared in another company's name prints that company's
   * logo opposite the OR logo (see lib/companyLogo.ts) */
  extras: { companyLogo?: CompanyLogo | null } = {},
) {
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

  const logo = await loadOrLogo();
  const companyLogo = extras.companyLogo ?? null;

  /** Draw a logo inside a max box, keeping its aspect ratio. The alias makes
   * jsPDF embed each image ONCE per document however many pages draw it,
   * instead of a copy per page. */
  const fitLogo = (ratio: number, maxW: number, maxH: number) => {
    let h = maxH;
    let w = h * ratio;
    if (w > maxW) {
      w = maxW;
      h = w / ratio;
    }
    return { w, h };
  };
  const drawOrLogo = (x: number, y: number, w: number, h: number) => {
    if (logo) doc.addImage(logo.data, "PNG", x, y, w, h, "or-logo");
  };
  const drawCompanyLogo = (x: number, y: number, w: number, h: number) => {
    if (companyLogo) {
      doc.addImage(companyLogo.data, logoFormat(companyLogo), x, y, w, h, "company-logo");
    }
  };

  /** Per-page bounds of the framed area, for the single outer-frame pass at the end */
  const pageFrames: { top: number; bottom: number }[] = [];

  const setFont = (weight: Weight, size: number) => {
    doc.setFont(FONT_NAME, weight);
    doc.setFontSize(size);
  };

  /** Split text into lines no wider than `maxW` at the CURRENT font — the
   * one line-breaker for everything the PDFs draw.
   *
   * Breaks between Thai words, using the browser's built-in Thai word
   * segmentation (Intl.Segmenter, no dictionary to ship). jsPDF's own
   * splitTextToSize only breaks at spaces, and Thai puts none between words,
   * so a long Thai phrase used to be cut wherever it ran out of room —
   * mid-word ("ระเบีย / บ"). Words are packed greedily, the same as before,
   * just at word boundaries now.
   *
   * Kept from splitTextToSize: explicit newlines start a new line, and a
   * single "word" wider than the whole line (a long code, URL or part
   * number) still gets cut by jsPDF per character — the only case a
   * mid-word break remains. Falls back to splitTextToSize entirely where
   * Intl.Segmenter doesn't exist (old browsers), never worse than before. */
  const splitLines = (raw: string, maxW: number): string[] => {
    const text = printable(raw);
    if (!thaiWords) return doc.splitTextToSize(text, maxW);

    const lines: string[] = [];
    for (const paragraph of text.split(/\r?\n/)) {
      let line = "";
      for (const segment of breakUnits(paragraph, thaiWords)) {
        const blank = !segment.trim();
        // A wrapped line never starts with the space it broke at
        if (!line && blank) continue;
        if (doc.getTextWidth(line + segment) <= maxW) {
          line += segment;
          continue;
        }
        if (line) lines.push(line.trimEnd());
        line = "";
        if (blank) continue;
        if (doc.getTextWidth(segment) <= maxW) {
          line = segment;
          continue;
        }
        const pieces: string[] = doc.splitTextToSize(segment, maxW);
        lines.push(...pieces.slice(0, -1));
        line = pieces[pieces.length - 1] ?? "";
      }
      lines.push(line.trimEnd());
    }
    return lines;
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
    const parts = splitLines(clean, Math.max(width - markerW, 10));

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
    const titleThLines = splitLines(titleTh, contentW * 0.6);
    setFont("bold", L.font.title_en_pt);
    const titleEnLines = titleEn ? splitLines(titleEn, contentW * 0.6) : [];

    const titleTextH =
      titleThLines.length * L.font.title_th_pt * 1.3 +
      titleEnLines.length * L.font.title_en_pt * 1.3 +
      (titleEnLines.length ? titleGap : 0);

    const logoH = logo ? mmToPt(L.logo.max_height_mm) : 0;
    const logoW = logo ? Math.min(logoH * logo.ratio, mmToPt(L.logo.max_width_mm)) : 0;
    // The company logo gets the same box as the OR logo, mirrored on the right
    const companyBox = companyLogo
      ? fitLogo(companyLogo.ratio, mmToPt(L.logo.max_width_mm), mmToPt(L.logo.max_height_mm))
      : { w: 0, h: 0 };
    const barH = Math.max(titleTextH, logoH, companyBox.h) + mmToPt(4);

    doc.setDrawColor(...border);
    // Thin — this is just the divider between the title bar and whatever sits
    // below it, not a standalone box; a thick outer frame (when the document
    // uses one) is drawn once at the very end around everything together
    doc.setLineWidth(L.table.border_width_pt);
    doc.rect(mL, top, contentW, barH);

    drawOrLogo(mL + mmToPt(3), top + (barH - logoH) / 2, logoW, logoH);
    drawCompanyLogo(
      mL + contentW - mmToPt(3) - companyBox.w,
      top + (barH - companyBox.h) / 2,
      companyBox.w,
      companyBox.h,
    );

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
    return splitLines(value || "", Math.max(width - pad * 2 - labelW, 10));
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

  /** The "บริษัท: …" header row — full width, bordered like the rows above
   * it. Only for documents prepared in another company's name: callers skip
   * it when the company is blank, so PTTOR's own documents are unchanged.
   * Returns the y below it. */
  const drawCompanyRow = (label: string, company: string, top: number): number => {
    const lines = measureFieldLines(label, company, contentW);
    const rowH = fieldRowHeight(lines);
    doc.setLineWidth(L.table.border_width_pt);
    doc.setDrawColor(...border);
    doc.rect(mL, top, contentW, rowH);
    drawField(label, lines, mL, contentW, top, rowH);
    return top + rowH;
  };

  // ---------------------------------------------------------- signature --
  /**
   * "<label> <name>" below the body on the last page, outside any table border.
   * Returns nothing — it's always the last thing drawn before the frame pass.
   */
  /** Height drawSignature needs below the body, gap included — 0 when it
   * draws nothing. Lets a caller keep its last row on the signature's page
   * instead of leaving the signature alone on a page of its own. */
  const signatureHeight = (label: string, name: string): number => {
    const sig = L.signature ?? FALLBACK_LAYOUT.signature;
    const trimmed = name?.trim();
    if (!sig.show || !trimmed) return 0;
    setFont("bold", sig.label_pt);
    const labelW = doc.getTextWidth(label) + mmToPt(1.5);
    setFont("normal", sig.label_pt);
    const lines = splitLines(trimmed, Math.max(contentW - labelW, 10)).length;
    return mmToPt(sig.gap_above_mm) + Math.max(lines, 1) * sig.label_pt * L.font.line_height;
  };

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
    const nameLines = splitLines(trimmed, Math.max(contentW - labelW, 10));
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

    // Taken once, before the page loop, so every page of one PDF prints the
    // same moment — the time this PDF was built, i.e. when the user opened,
    // saved or shared it (each of those builds a fresh one).
    const now = new Date();
    const two = (n: number) => String(n).padStart(2, "0");
    const generatedAt =
      `${two(now.getDate())}/${two(now.getMonth() + 1)}/${now.getFullYear()}` +
      ` : ${two(now.getHours())}:${two(now.getMinutes())}`;

    for (let page = skipPage1 ? 2 : 1; page <= total; page += 1) {
      doc.setPage(page);
      setFont("normal", L.font.footer_pt);
      doc.setTextColor(0, 0, 0);
      const baseline = pageH - mB + mmToPt(6);

      if (footerLeft) doc.text(footerLeft, mL, baseline);
      if (footerRight) {
        doc.text(footerRight, pageW - mR, baseline, { align: "right" });
      }

      // True center is tracked (not just whether the page number was drawn)
      // because the "GenJSA" attribution line below is stacked directly
      // under it — stacking a second centered line under a page number that
      // itself fell back to gap-centering (or was omitted) would either sit
      // under empty space or collide with the gap-centered number, neither
      // of which reads as "centered" the way true-center placement does.
      let pageNumberAtTrueCenter = false;

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
          pageNumberAtTrueCenter = true;
        } else if (gapEnd - gapStart >= labelW) {
          doc.text(label, (gapStart + gapEnd) / 2, baseline, { align: "center" });
        } else if (gapEnd > gapStart) {
          // Not enough room to center it — left-align in whatever's left rather than overlap
          doc.text(label, gapStart, baseline);
        }
        // else: left/right footer text already fills the row — omit rather than overlap
      }

      // "This document is generated on <date> : <time>" — a small line
      // under the page number, not alongside the form-code/footer-text
      // (left) or company name (right): both of those slots are real
      // document content already in active use on both documents. Smaller
      // than the footer text (footer_pt - 2) and in muted gray so it reads
      // as a note, not a second heading-weight label.
      //
      // Only drawn when BOTH: the page number itself landed at true center
      // (see pageNumberAtTrueCenter's own comment above — stacking this
      // under a gap-centered or omitted page number wouldn't actually sit
      // under anything), AND this sentence measures narrower than the same gap the page
      // number was centered in — a long company name or long
      // formCode/footerText pair can otherwise leave too little room, and
      // this note isn't content worth overlapping real document
      // text for. Silently omitted rather than wrapped or shrunk further:
      // a 2-line footer note would outweigh its own purpose.
      if (pageNumberAtTrueCenter) {
        const appLabelPt = Math.max(L.font.footer_pt - 2, 6);
        const appLabel = `This document is generated on ${generatedAt}`;
        setFont("normal", appLabelPt);
        const appLabelW = doc.getTextWidth(appLabel);
        const gapBuffer = mmToPt(3);
        const footerLeftW = footerLeft ? doc.getTextWidth(footerLeft) : 0;
        const footerRightW = footerRight ? doc.getTextWidth(footerRight) : 0;
        const gapStart = mL + footerLeftW + gapBuffer;
        const gapEnd = pageW - mR - footerRightW - gapBuffer;

        if (appLabelW <= gapEnd - gapStart) {
          doc.setTextColor(140, 140, 140);
          doc.text(appLabel, pageW / 2, baseline + mmToPt(3.2), { align: "center" });
          doc.setTextColor(0, 0, 0);
        }
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
    companyLogo,
    fitLogo,
    drawOrLogo,
    drawCompanyLogo,
    drawCompanyRow,
    pageFrames,
    setFont,
    splitLines,
    wrap,
    drawLines,
    drawTitleBar,
    fieldLineH,
    measureFieldLines,
    fieldRowHeight,
    drawField,
    signatureHeight,
    drawSignature,
    drawFrames,
    drawFooter,
  };
}
