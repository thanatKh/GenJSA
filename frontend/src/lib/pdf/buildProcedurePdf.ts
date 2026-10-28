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

import type { CompanyLogo } from "../companyLogo";
import type { ProcedureDocument, ProcedureStep } from "../schema";
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
  type PhotoMap,
  photoKey,
  type ProcedureMeta,
  type StepPhoto,
} from "./layout";

/** Project Mode: one procedure for the whole project. Its steps are printed
 * as one section per phase, numbered by phase — phase 2's steps 2.1, 2.2…
 * and their sub-steps 2.1.1… — followed the project's notes and tag list
 * as their own sections. The ProcedureDocument passed alongside supplies the
 * header and the opening sections only; its own `steps` are not printed. */
export type ProjectProcedureLayout = {
  phases: {
    title: string;
    steps: ProcedureStep[];
    /** Prepended to photoKey(step, sub) — a project's photos are keyed per phase */
    photoPrefix: string;
  }[];
  notes: string;
  references: { tag: string; note: string }[];
};

type BuildProcedureOptions = {
  /** Project Mode — see ProjectProcedureLayout */
  project?: ProjectProcedureLayout;
  layout?: PdfLayout;
  document?: DocumentMeta;
  procedure?: ProcedureMeta;
  company?: CompanyMeta;
  /** Optional photo per sub-step, keyed by photoKey(step.no, sub.no). Held
   * outside the document because it never reaches the backend — see
   * StepPhoto in layout.ts. */
  photos?: PhotoMap;
  /** Logo of the company that prepared this document — see BuildOptions in
   * buildJsaPdf.ts */
  companyLogo?: CompanyLogo | null;
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

  const E = await createEngine(L, { companyLogo: options.companyLogo });
  const { doc, pageW, mL, mT, contentW, bodyBottom, lineH, wrap, drawLines, logo, border } = E;

  const headingPt = L.font.body_pt + 2;
  const headingLineH = headingPt * L.font.line_height;
  // Step titles sit between section headings and body text: one point above
  // body, bold. At body size they read as just another line of the list
  // (only bold set them apart), so on a page of steps nothing grouped.
  const stepPt = L.font.body_pt + 1;
  const stepLineH = stepPt * L.font.line_height;
  // Photo captions — small and gray, a label rather than content
  const captionPt = Math.max(L.font.body_pt - 2, 8);
  const captionLineH = captionPt * L.font.line_height;
  // Sub-steps hang under their step, which hangs under the section — indents
  // are in mm so they hold at any body_pt
  const stepIndent = mmToPt(6);
  const subIndent = mmToPt(14);
  const sectionGap = mmToPt(4);
  const blockGap = mmToPt(2);
  // Before each step after the first: clearly more than the line gap inside
  // a step (it used to be 6pt over a plain line, so steps ran together)
  const stepGap = mmToPt(4);
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
   * The full header (title bar + work activity + supervisor/date) prints on
   * the first content page only. Continuation pages get `compact`: one
   * bordered row naming the document and the job — still enough that a
   * loose printed sheet reads as part of this document, without the 20/18pt
   * title bar outweighing every heading on the page and taking ~15% of it
   * (the cover and first page already carry the full details). */
  const drawHeader = (top: number, compact = false): number => {
    if (compact) {
      const lines = E.measureFieldLines(P.titleTh, procedure.header.work_activity, contentW);
      const rowH = E.fieldRowHeight(lines);
      doc.setLineWidth(L.table.border_width_pt);
      doc.setDrawColor(...E.border);
      doc.rect(mL, top, contentW, rowH);
      E.drawField(P.titleTh, lines, mL, contentW, top, rowH);
      E.pageFrames.push({ top, bottom: top + rowH });
      return top + rowH + sectionGap;
    }

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

    // Same "บริษัท: …" row as the JSA header — only when one is filled in
    const company = procedure.header.company?.trim();
    if (company) cursor = E.drawCompanyRow(D.labels.company ?? "บริษัท", company, cursor);

    E.pageFrames.push({ top: frameTop, bottom: cursor });
    return cursor + sectionGap;
  };

  /** Start a new page with the compact header, and reset the cursor. */
  const newPage = () => {
    doc.addPage();
    y = drawHeader(mT, true);
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
  const drawFlowing = (
    lines: Line[],
    x: number,
    cellW: number,
    step: number = lineH,
    size: number = L.font.body_pt,
  ) => {
    lines.forEach((line) => {
      if (y + step > bodyBottom) newPage();
      drawLines([line], x, y, cellW, size, step);
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
  const photoSize = (photo: StepPhoto, maxW: number) => {
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

  /** Photo + caption height, for keep-together reservations */
  const photoBlockH = (photo: StepPhoto, maxW: number) =>
    photoGap + photoSize(photo, maxW).h + captionLineH;

  /** One atomic block — never split across pages, unlike drawFlowing's text.
   * Left-aligned with its sub-step's own text (x = where the text starts,
   * after "1.1") and captioned "ภาพประกอบขั้นตอน 1.1". It used to be centered
   * on the page with no caption, so a photo between 1.1 and 1.2 could belong
   * to either — on paper there was nothing to say which. */
  const drawPhoto = (photo: StepPhoto, x: number, maxW: number, label: string) => {
    const { w, h } = photoSize(photo, maxW);

    y += photoGap;
    need(h + captionLineH);
    doc.addImage(photo.data, "JPEG", x, y, w, h);
    y += h;

    E.setFont("normal", captionPt);
    doc.setTextColor(110, 110, 110);
    doc.text(label, x, y + captionPt * 1.05);
    doc.setTextColor(0, 0, 0);
    y += captionLineH;
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
    // +2 over the header label size, with a little more line spacing: at
    // header_label_pt the supervisor/date lines read as fine print under a
    // much larger job name
    const infoPt = L.font.header_label_pt + 2;
    const infoLineH = infoPt * (L.font.line_height + 0.2);

    const logoH = logo ? mmToPt(16) : 0;
    const logoGap = logo ? mmToPt(12) : 0;

    const activityLines = wrap(procedure.header.work_activity, contentW * 0.8, "bold", activityPt);

    const supervisorShown = !!procedure.header.supervisor?.trim();
    const dateShown = !!procedure.header.analysis_date?.trim();
    const authorName = procedure.header.analyst?.trim() || procedure.header.supervisor?.trim();
    const authorShown = !!authorName && authorName !== procedure.header.supervisor?.trim();
    const companyName = procedure.header.company?.trim() ?? "";
    const infoLinesCount = [supervisorShown, dateShown, authorShown, !!companyName].filter(Boolean).length;

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
      //
      // With a company logo, the two sit side by side as one centred pair
      // (OR first), each in the same height box, separated by a thin rule.
      const orBox = E.fitLogo(logo.ratio, contentW * 0.4, logoH);
      const companyBox = E.companyLogo
        ? E.fitLogo(E.companyLogo.ratio, contentW * 0.4, logoH)
        : null;
      const pairGap = mmToPt(10);
      const totalW = orBox.w + (companyBox ? pairGap + companyBox.w : 0);
      let x = centerX - totalW / 2;
      E.drawOrLogo(x, cursor + (logoH - orBox.h) / 2, orBox.w, orBox.h);
      if (companyBox) {
        x += orBox.w + pairGap / 2;
        doc.setDrawColor(...border);
        doc.setLineWidth(0.8);
        doc.line(x, cursor + logoH * 0.15, x, cursor + logoH * 0.85);
        x += pairGap / 2;
        E.drawCompanyLogo(x, cursor + (logoH - companyBox.h) / 2, companyBox.w, companyBox.h);
      }
      cursor += logoH + logoGap;
    }

    // +24/+8, not the old +10/+4 — the document title is this page's actual
    // subject and needs to read as clearly larger than the job name below it
    // (title_en_pt + a smaller step), which a shrunk logo no longer does the
    // job of announcing on its own.
    // doc.text() places text by its BASELINE, so the title's tall Thai vowels
    // and tone marks rose above `cursor` — straight into the gap reserved
    // under the logo, and visibly touching it. Step down by the title's
    // ascent first so that gap is real; the total advance stays 1.3x.
    E.setFont("bold", titleThPt);
    doc.setTextColor(0, 0, 0);
    cursor += titleThPt * 0.85;
    doc.text(P.titleTh, centerX, cursor, { align: "center" });
    cursor += titleThPt * 0.35;

    // Same baseline rule for the English line: step down by its own ascent
    // before drawing, or it rises into the Thai title's descenders above.
    if (P.titleEn) {
      E.setFont("normal", titleEnPt);
      cursor += titleEnPt * 0.95;
      doc.text(P.titleEn, centerX, cursor, { align: "center" });
      cursor += titleEnPt * 0.35;
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
    if (companyName) infoLine(D.labels.company ?? "บริษัท", companyName);
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

  // The first content page has the full header and every later page the
  // compact one, so this — the room below the FULL header — is the smallest
  // a page ever has: a safe ceiling for drawPhoto to clamp to. Captured
  // after the call because drawHeader measures wrapped header fields rather
  // than using a fixed height.
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
  const project = options.project;
  if (project) {
    textSection(P.sections.notes ?? "ข้อจำกัด / หมายเหตุ", project.notes);
    listSection(
      P.sections.tags ?? "รายการวาล์ว / Blind / Tag",
      project.references.map((ref) => (ref.note.trim() ? `${ref.tag}: ${ref.note}` : ref.tag)),
    );
  }

  // ------------------------------------------------- the procedure itself --
  // Steps are numbered on their own — "1.", sub-steps "1.1" — exactly as the
  // editor and its photo slots show them. They used to carry this section's
  // number too ("5.1.1"), and that number shifted with whether a reference
  // section existed (4.x.x in one document, 5.x.x in another), so "check
  // step 1.2" said on screen pointed at nothing on paper.
  // Reserve the heading plus the first step title, so the section never opens
  // on the last line of a page
  need(headingLineH + stepLineH + lineH);
  drawHeading(P.sections.procedure);
  y += blockGap;

  /** One run of steps and their sub-steps. Single Mode: "1." / "1.1".
   * Project Mode passes the phase's number as `prefix` ("2.") for "2.1" /
   * "2.1.1", indented one level further under the phase's own heading. */
  const drawSteps = (steps: ProcedureStep[], prefix: string, extraIndent: number, photoPrefix: string) => {
  const stepX = stepIndent + extraIndent;
  const subX = subIndent + extraIndent;
  steps.forEach((step, stepIndex) => {
    if (stepIndex > 0) y += stepGap;
    const titleLines = wrap(step.procedure, contentW - stepX, "bold", stepPt, prefix ? `${prefix}${step.no}` : `${step.no}.`);

    const subLines = step.sub_steps.map((sub) =>
      wrap(
        sub.action,
        contentW - subX,
        "normal",
        L.font.body_pt,
        `${prefix}${step.no}.${sub.no}`,
      ),
    );
    const subPhotos = step.sub_steps.map((sub) => photos[photoPrefix + photoKey(step.no, sub.no)]);

    // Keep a step title with its first sub-step — a heading alone at the foot
    // of a page is the one pagination problem a flowing layout still has.
    // Only reserved for the title's first line plus the first sub-step's
    // first line: a title or sub-step longer than that flows and paginates
    // itself via drawFlowing below, same as the section paragraphs above.
    // When that first sub-step has a photo, the reservation covers the
    // whole sub-step and its photo instead — otherwise the per-sub-step
    // keep-together below would carry them to the next page and strand the
    // title on this one anyway.
    // Photos align with their sub-step's text, after the "1.1" marker
    const photoX = (lines: Line[]) => mL + subX + (lines[0]?.indent ?? 0);
    const photoMaxW = (lines: Line[]) => contentW - subX - (lines[0]?.indent ?? 0);

    let keepTogether = Math.min(titleLines.length, 1) * stepLineH;
    if (subLines.length) {
      const firstPhoto = subPhotos[0];
      const withPhoto = firstPhoto
        ? titleLines.length * stepLineH +
          subLines[0].length * lineH +
          photoBlockH(firstPhoto, photoMaxW(subLines[0]))
        : 0;
      keepTogether =
        firstPhoto && withPhoto <= usableBodyH ? withPhoto : keepTogether + Math.min(subLines[0].length, 1) * lineH;
    }
    need(keepTogether);

    drawFlowing(titleLines, mL + stepX, contentW - stepX, stepLineH, stepPt);

    step.sub_steps.forEach((_, subIndex) => {
      const actionLines = subLines[subIndex];
      const photo = subPhotos[subIndex];

      // A photo belongs to the sub-step it shows, so keep the two together
      // when they fit one page — otherwise the photo lands alone at the top
      // of the next page while its text stays behind, which reads as an
      // unrelated image. A sub-step too long for that is going to break
      // across pages regardless, so nothing is reserved for it.
      if (photo) {
        const blockH = actionLines.length * lineH + photoBlockH(photo, photoMaxW(actionLines));
        if (blockH <= usableBodyH) need(blockH);
      }

      drawFlowing(actionLines, mL + subX, contentW - subX);

      // Right under its own line, so it reads as "this is what that action
      // looks like" rather than a picture of the step as a whole.
      if (photo) {
        drawPhoto(
          photo,
          photoX(actionLines),
          photoMaxW(actionLines),
          `ภาพประกอบขั้นตอน ${prefix}${step.no}.${step.sub_steps[subIndex].no}`,
        );
      }
    });
  });
  };

  if (project) {
    project.phases.forEach((phase, phaseIndex) => {
      if (phaseIndex > 0) y += sectionGap;
      const titleLines = wrap(phase.title, contentW - stepIndent, "bold", headingPt, `${phaseIndex + 1}.`);
      // The phase heading with its first step title and sub-step line, so a
      // phase never opens on the last line of a page
      need(titleLines.length * headingLineH + stepLineH + lineH);
      drawFlowing(titleLines, mL + stepIndent, contentW - stepIndent, headingLineH, headingPt);
      y += blockGap;
      drawSteps(phase.steps, `${phaseIndex + 1}.`, mmToPt(6), phase.photoPrefix);
    });
  } else {
    drawSteps(procedure.steps, "", 0, "");
  }

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
