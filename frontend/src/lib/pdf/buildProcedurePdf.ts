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
  type StepPhoto,
} from "./layout";

export type BuildProcedureOptions = {
  layout?: PdfLayout;
  document?: DocumentMeta;
  procedure?: ProcedureMeta;
  company?: CompanyMeta;
  /** Optional photo per main step, keyed by ProcedureStep.no. Held outside the
   * document because it never reaches the backend and is never persisted —
   * see StepPhoto in layout.ts. */
  photos?: Record<number, StepPhoto>;
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
  const photos = options.photos ?? {};

  const E = await createEngine(L);
  const { doc, pageW, mL, mT, contentW, bodyBottom, lineH, wrap, drawLines, logo, border } = E;

  const headingPt = L.font.body_pt + 2;
  const headingLineH = headingPt * L.font.line_height;
  // Sub-steps hang under their step, which hangs under the section — indents
  // are in mm so they hold at any body_pt
  const stepIndent = mmToPt(6);
  const subIndent = mmToPt(14);
  const sectionGap = mmToPt(4);
  const blockGap = mmToPt(2);
  const photoGap = mmToPt(2);
  // ~a third of an A4 page. Big enough to read a gauge or a valve tag, small
  // enough that a step with a photo still shares its page with other steps.
  const photoMaxH = mmToPt(80);

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

  /** Drawn size of a photo: fits inside BOTH a width and a height budget,
   * preserving aspect ratio.
   *
   * The height cap is what keeps this a work instruction rather than a photo
   * album: without it a 4:3 photo at full column width eats two-thirds of the
   * page and a portrait one takes a whole page to itself. Landscape shots end
   * up width-limited, portrait ones height-limited, and both stay comfortably
   * beside their text.
   *
   * Capping against usableBodyH too is what guarantees need() terminates: an
   * image that can't fit even a freshly-headed page would otherwise be pushed
   * to a new page forever and still overflow it. */
  const photoSize = (photo: StepPhoto) => {
    const maxW = contentW - subIndent;
    const maxH = Math.min(photoMaxH, usableBodyH);
    const ratio = photo.ratio > 0 ? photo.ratio : 1;

    let w = maxW;
    let h = w / ratio;
    if (h > maxH) {
      h = maxH;
      w = h * ratio;
    }
    return { w, h };
  };

  /** One atomic block — never split across pages, unlike drawFlowing's text.
   * Centered in the text column rather than flush-left: a narrow (portrait or
   * panorama) image left-aligned at the sub-step indent reads as accidentally
   * placed, especially once its width is well short of maxW. */
  const drawPhoto = (photo: StepPhoto) => {
    const { w, h } = photoSize(photo);
    const maxW = contentW - subIndent;
    const x = mL + subIndent + (maxW - w) / 2;

    y += photoGap;
    need(h);
    doc.addImage(photo.data, "JPEG", x, y, w, h);
    y += h;
  };

  // ------------------------------------------------------------- cover --
  /** A dedicated title page before the content starts: logo, document title,
   * the job name, then the header fields laid out spaciously and centered —
   * a report cover, not another copy of the bordered header block.
   *
   * Pushes a full-page pageFrames entry for itself (mT to bodyBottom) so it
   * gets the same thick outer border every content page gets — a bare title
   * page with no frame at all read as an unfinished draft next to the framed
   * pages that follow it, unlike drawSignature's own zero-height convention,
   * which is for a page that's genuinely just an overflow tail with no frame
   * of its own. pageFrames is indexed by page number (drawFrames below does
   * doc.setPage(index + 1)), so every page must push exactly one entry,
   * whether real or the zero-height placeholder — skipping this page's push
   * entirely would shift every later frame onto the wrong physical page. */
  const drawCoverPage = () => {
    E.pageFrames.push({ top: mT, bottom: bodyBottom });

    const centerX = pageW / 2;

    // ---- measure the whole block's height first, so it can be centered on
    // the page rather than started at a fixed offset from the top. A fixed
    // mT + 30mm start left the block sitting in the upper third on a normal
    // A4 page — short content, most of the page unused below it — instead of
    // looking centered the way a title page should. ----
    const titleThPt = L.font.title_th_pt + 24;
    const titleEnPt = L.font.title_en_pt + 8;
    const activityPt = L.font.title_en_pt + 6;
    const activityLineH = activityPt * L.font.line_height;
    const infoPt = L.font.header_label_pt;
    const infoLineH = infoPt * L.font.line_height;

    const logoH = logo ? mmToPt(16) : 0;
    const logoGap = logo ? mmToPt(12) : 0;

    const activityLines = wrap(procedure.header.work_activity, contentW * 0.8, "bold", activityPt);

    const supervisorShown = !!procedure.header.supervisor?.trim();
    const dateShown = !!procedure.header.analysis_date?.trim();
    const authorName = procedure.header.analyst?.trim() || procedure.header.supervisor?.trim();
    const authorShown = !!authorName && authorName !== procedure.header.supervisor?.trim();
    const infoLinesCount = [supervisorShown, dateShown, authorShown].filter(Boolean).length;

    const blockH =
      logoH +
      logoGap +
      titleThPt * 1.3 +
      (P.titleEn ? titleEnPt * 1.3 : 0) +
      mmToPt(6 + 16) + // rule gap above + below
      activityLines.length * activityLineH +
      mmToPt(12) + // gap after activity name
      infoLinesCount * infoLineH;

    // Centered between the page's top and bottom margins, then nudged
    // further down — a title page reads better slightly below true center
    // than dead-centered, and "move it down a bit" was the explicit ask.
    const available = bodyBottom - mT;
    let cursor = mT + Math.max((available - blockH) / 2, mmToPt(16)) + mmToPt(18);

    if (logo) {
      // A masthead-sized logo, not the compact title-bar one (L.logo is sized
      // for a slim header row) — this is the one page where the logo is a
      // visual anchor, not a corner mark. Not larger than this, though: at
      // 28mm it visually outweighed the title below it, reading as the
      // page's actual subject instead of a mark above one — 16mm keeps it
      // clearly present without competing with the document title's own
      // weight.
      const logoW = Math.min(logoH * logo.ratio, contentW * 0.5);
      doc.addImage(logo.data, "PNG", centerX - logoW / 2, cursor, logoW, logoH);
      cursor += logoH + logoGap;
    }

    // +24/+8, not the old +10/+4 — the document title is this page's actual
    // subject and needs to read as clearly larger than the job name below it
    // (title_en_pt + a smaller step), which a shrunk logo no longer does the
    // job of announcing on its own.
    E.setFont("bold", titleThPt);
    doc.setTextColor(0, 0, 0);
    doc.text(P.titleTh, centerX, cursor, { align: "center" });
    cursor += titleThPt * 1.3;

    if (P.titleEn) {
      E.setFont("normal", titleEnPt);
      doc.text(P.titleEn, centerX, cursor, { align: "center" });
      cursor += titleEnPt * 1.3;
    }

    // A rule under the title, sized to the longer of the two title lines
    // rather than the full page width — a full-width rule this high up reads
    // as a header bar, not a title page's own accent.
    cursor += mmToPt(6);
    const ruleW = mmToPt(60);
    doc.setDrawColor(...border);
    doc.setLineWidth(1.2);
    doc.line(centerX - ruleW / 2, cursor, centerX + ruleW / 2, cursor);
    cursor += mmToPt(16);

    // The job name — the one piece of content worth setting larger than body
    // text on a cover, since it's the answer to "which job is this for".
    // +6 over title_en_pt (was title_en_pt exactly, same size as the small
    // English subtitle above it — too quiet for the answer to the cover's
    // most-asked question) without approaching the document title's own
    // size, which stays the clearly biggest element on the page.
    activityLines.forEach((line) => {
      E.setFont("bold", activityPt);
      doc.text(line.text, centerX, cursor, { align: "center", maxWidth: contentW * 0.8 });
      cursor += activityLineH;
    });
    cursor += mmToPt(12);

    // Supervisor / date, centered as a simple two-line summary rather than
    // the bordered field boxes the content pages use — those boxes are a
    // form convention, and this page is deliberately not a form.
    const infoLine = (label: string, value: string) => {
      if (!value.trim()) return;
      E.setFont("bold", infoPt);
      const labelText = `${label}: `;
      const labelW = doc.getTextWidth(labelText);
      E.setFont("normal", infoPt);
      const valueW = doc.getTextWidth(value);
      const startX = centerX - (labelW + valueW) / 2;
      E.setFont("bold", infoPt);
      doc.text(labelText, startX, cursor);
      E.setFont("normal", infoPt);
      doc.text(value, startX + labelW, cursor);
      cursor += infoLineH;
    };
    infoLine(D.labels.supervisor, procedure.header.supervisor);
    infoLine(P.labels.date, formatThaiDate(procedure.header.analysis_date));

    // ผู้จัดทำ — moved here from the sign-off that used to close the document
    // after the last step, so the "who made this" credit sits with the rest
    // of the cover's summary instead of trailing off after the content.
    // Same analyst-falls-back-to-supervisor rule the old sign-off used, but
    // only printed when it's a genuinely different name from the supervisor
    // line just above — an identical repeat would read as a copy-paste
    // mistake, not a second name worth stating.
    if (authorShown) {
      infoLine(P.labels.author, authorName!);
    }

    doc.addPage();
  };

  drawCoverPage();

  y = drawHeader(mT);

  // Every page repeats the same header, so the first one's height is the height
  // on all of them — i.e. this is exactly what a fresh page has room for, and
  // the ceiling drawPhoto clamps to. Captured after the call because drawHeader
  // measures wrapped header fields rather than using a fixed height.
  const usableBodyH = bodyBottom - y - photoGap;

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
    const photo = photos[step.no];

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

    // A photo is part of the step it illustrates, so try to keep the whole
    // step — title, sub-steps and photo — together. Without this the photo
    // lands alone at the top of the next page while its title stays behind on
    // the previous one, which reads as an unrelated image.
    //
    // Only when the step genuinely fits a page: a long step is going to break
    // across pages regardless, and reserving room it can never have would push
    // every such step onto a fresh page for nothing.
    let keepTogether = Math.min(titleLines.length, 1) * lineH + firstSubH;
    if (photo) {
      const stepH =
        titleLines.length * lineH +
        step.sub_steps.reduce(
          (total, sub) =>
            total +
            wrap(
              sub.action,
              contentW - subIndent,
              "normal",
              L.font.body_pt,
              `${stepsHeadingNo}.${step.no}.${sub.no}`,
            ).length *
              lineH,
          0,
        ) +
        photoGap +
        photoSize(photo).h;
      if (stepH <= usableBodyH) keepTogether = stepH;
    }
    need(keepTogether);

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

    // After the sub-steps: the photo illustrates the step as a whole, so it
    // reads as the result of the instructions rather than interrupting them.
    if (photo) drawPhoto(photo);

    y += blockGap;
  });

  // ผู้จัดทำ used to be printed here as a sign-off after the last step —
  // moved to the cover page's info summary instead (drawCoverPage above),
  // so the document now simply ends after its last step, the same way
  // buildJsaPdf.ts ends after its last table row.

  E.drawFrames();
  // skipPage1: the cover page prints no footer/page-number of its own,
  // matching how it already has no border frame (drawCoverPage's
  // zero-height pageFrames entry) — see drawFooter's doc comment.
  E.drawFooter(P.formCode, P.footerText, C?.name ?? "", true);

  // Gives the browser's own PDF viewer something meaningful to show instead of
  // a blob URL fragment (see the note in buildJsaPdf.ts — no <a download> here)
  doc.setProperties({ title: procedurePdfFileName(procedure) });

  return doc.output("blob");
}
