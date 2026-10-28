/* The work procedure as an editable Word file — the twin of
 * buildProcedurePdf.ts: a cover page, then the header block, the numbered
 * sections and the numbered steps/sub-steps with their photos.
 *
 * Two Word sections do what the PDF does by hand:
 * - the cover is its own section, so it prints no footer;
 * - the content section is "different first page": its first page opens
 *   with the full header block in the body, every later page gets the
 *   compact one-line header — the PDF's compact continuation header.
 * Page numbers run through the whole file, so page 2 still says "2 / N",
 * as in the PDF.
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  Header,
  HeadingLevel,
  LevelFormat,
  Paragraph,
  Table,
  TableRow,
  WidthType,
} from "docx";

import type { CompanyLogo } from "../companyLogo";
import { loadOrLogo } from "../orLogo";
import { procedureDocxFileName } from "../pdf/fileName";
import {
  FALLBACK_DOCUMENT,
  FALLBACK_LAYOUT,
  FALLBACK_PROCEDURE,
  photoKey,
  type CompanyMeta,
  type DocumentMeta,
  type PdfLayout,
  type PhotoMap,
  type ProcedureMeta,
} from "../pdf/layout";
import type { ProjectProcedureLayout } from "../pdf/buildProcedurePdf";
import type { ProcedureDocument } from "../schema";
import { formatThaiDate } from "../thaidate";
import { createWordKit, halfPt, markerIndent, mm, toBlob } from "./common";

type BuildProcedureOptions = {
  /** Project Mode — the same layout buildProcedurePdf takes: phases as
   * sections numbered by phase (2.1, 2.1.1), then notes and the tag list */
  project?: ProjectProcedureLayout;
  layout?: PdfLayout;
  document?: DocumentMeta;
  procedure?: ProcedureMeta;
  company?: CompanyMeta;
  photos?: PhotoMap;
  companyLogo?: CompanyLogo | null;
};

export async function buildProcedureDocx(
  procedure: ProcedureDocument,
  options: BuildProcedureOptions = {},
): Promise<Blob> {
  const L = options.layout ?? FALLBACK_LAYOUT;
  const D = options.document ?? FALLBACK_DOCUMENT;
  const P = options.procedure ?? FALLBACK_PROCEDURE;
  const photos = options.photos ?? {};
  const companyLogo = options.companyLogo ?? null;
  const K = createWordKit(L);
  const orLogo = await loadOrLogo();
  const h = procedure.header;

  // Same scale as the PDF
  const headingPt = L.font.body_pt + 2;
  const stepPt = L.font.body_pt + 1;
  const captionPt = Math.max(L.font.body_pt - 2, 8);
  const stepIndent = mm(6);
  const subIndent = mm(14);
  const sectionGap = mm(4);
  const stepGap = mm(4);
  const photoMaxHmm = 80;

  // ------------------------------------------------------------------ cover --
  const authorName = h.analyst?.trim() || h.supervisor?.trim();
  const authorShown = !!authorName && authorName !== h.supervisor?.trim();
  const infoPt = L.font.header_label_pt + 2;
  const infoLine = (label: string, value: string) =>
    value.trim()
      ? [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: mm(1.5) },
            children: [
              ...K.run(`${label}: `, { bold: true, size: halfPt(infoPt) }),
              ...K.run(value, { size: halfPt(infoPt) }),
            ],
          }),
        ]
      : [];
  const ruleIndent = Math.round((K.contentW - mm(60)) / 2);

  const cover = [
    new Paragraph({ spacing: { before: mm(55) }, children: [] }),
    ...(orLogo
      ? [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: mm(12) },
            children: [
              K.image(orLogo, 60, 16),
              ...(companyLogo ? [...K.run("          "), K.image(companyLogo, 60, 16)] : []),
            ],
          }),
        ]
      : []),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [...K.run(P.titleTh, { bold: true, size: halfPt(L.font.title_th_pt + 24) })],
    }),
    ...(P.titleEn
      ? [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [...K.run(P.titleEn, { size: halfPt(L.font.title_en_pt + 8) })],
          }),
        ]
      : []),
    // The short rule under the title: a bottom border on an empty paragraph
    // indented in from both sides to 60 mm wide
    new Paragraph({
      indent: { left: ruleIndent, right: ruleIndent },
      spacing: { before: mm(4), after: mm(14) },
      border: { bottom: { style: BorderStyle.SINGLE, size: 10, color: L.table.border_color.replace("#", "") } },
      children: [],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: mm(12) },
      children: [...K.run(h.work_activity, { bold: true, size: halfPt(L.font.title_en_pt + 6) })],
    }),
    ...infoLine(D.labels.company ?? "บริษัท", h.company?.trim() ?? ""),
    ...infoLine(D.labels.supervisor, h.supervisor),
    ...infoLine(P.labels.date, formatThaiDate(h.analysis_date)),
    ...(authorShown ? infoLine(P.labels.author, authorName!) : []),
  ];

  // ----------------------------------------------------- full header block --
  const splitW = Math.round(K.contentW * 0.665);
  const headerRows = [
    new TableRow({
      children: [
        K.cell([K.titleBar(P.titleTh, P.titleEn, orLogo, companyLogo, K.contentW - mm(L.table.cell_padding_mm) * 2)], {
          span: 2,
          width: K.contentW,
        }),
      ],
    }),
    new TableRow({
      children: [K.cell([K.fieldParagraph(D.labels.work_activity, h.work_activity)], { span: 2, width: K.contentW })],
    }),
    new TableRow({
      children: [
        K.cell([K.fieldParagraph(D.labels.supervisor, h.supervisor)], { width: splitW }),
        K.cell([K.fieldParagraph(P.labels.date, formatThaiDate(h.analysis_date))], { width: K.contentW - splitW }),
      ],
    }),
  ];
  if (h.company?.trim()) {
    headerRows.push(
      new TableRow({
        children: [
          K.cell([K.fieldParagraph(D.labels.company ?? "บริษัท", h.company.trim())], { span: 2, width: K.contentW }),
        ],
      }),
    );
  }
  const headerBlock = new Table({
    width: { size: K.contentW, type: WidthType.DXA },
    columnWidths: [splitW, K.contentW - splitW],
    borders: K.tableBorders,
    rows: headerRows,
  });

  // Every page after the first content page: one bordered line naming the
  // document and the job
  const compactHeader = new Header({
    children: [
      new Table({
        width: { size: K.contentW, type: WidthType.DXA },
        columnWidths: [K.contentW],
        borders: K.tableBorders,
        rows: [new TableRow({ children: [K.cell([K.fieldParagraph(P.titleTh, h.work_activity)], { width: K.contentW })] })],
      }),
      new Paragraph({ children: [] }),
    ],
  });

  // ------------------------------------------- styles + numbering (editing) --
  // Unlike the JSA (a form table people edit cell by cell), the procedure is
  // running text that people extend in Word — so it's built from real Word
  // styles with numbering attached to them, not hand-formatted paragraphs:
  // - sections are Heading 1 and steps Heading 2: they show in Word's
  //   Navigation Pane, and a table of contents can be inserted;
  // - one numbering list drives "1." (section), "1." (step) and "1.1"
  //   (sub-step), carried by the styles themselves, so Enter after a step
  //   gives sub-step 1.1, Enter after a sub-step gives the next one, and
  //   inserting or deleting any of them renumbers the rest;
  // - runs carry no size or bold of their own, so changing a style in Word
  //   changes every paragraph that uses it.
  // Looks the same as the PDF; only the way it's built differs.
  const font = { ascii: L.font.family, hAnsi: L.font.family, cs: L.font.family, eastAsia: L.font.family };
  const LIST = "procedure";
  const BULLETS = "procedure-bullets";
  // Project Mode numbers its steps by phase — "2." phase, "2.1" step,
  // "2.1.1" sub-step — from a list of its own, one level deeper, still
  // carried by the styles so Word renumbers on insert/delete the same way
  const PHASES = "procedure-phases";
  const project = options.project;
  const deeper = mm(6);
  const subTextLeft = project
    ? markerIndent("1.1.1", subIndent + deeper).left
    : markerIndent("1.1", subIndent).left;

  const numbering = {
    config: [
      {
        reference: LIST,
        levels: [
          { level: 0, format: LevelFormat.DECIMAL, text: "%1.", style: { paragraph: { indent: markerIndent("1.") } } },
          { level: 1, format: LevelFormat.DECIMAL, text: "%2.", style: { paragraph: { indent: markerIndent("1.", stepIndent) } } },
          { level: 2, format: LevelFormat.DECIMAL, text: "%2.%3", style: { paragraph: { indent: markerIndent("1.1", subIndent) } } },
        ],
      },
      {
        reference: BULLETS,
        levels: [
          { level: 0, format: LevelFormat.BULLET, text: "•", style: { paragraph: { indent: markerIndent("•", stepIndent) } } },
        ],
      },
      {
        reference: PHASES,
        levels: [
          { level: 0, format: LevelFormat.DECIMAL, text: "%1.", style: { paragraph: { indent: markerIndent("1.", stepIndent) } } },
          { level: 1, format: LevelFormat.DECIMAL, text: "%1.%2", style: { paragraph: { indent: markerIndent("1.1", stepIndent + deeper) } } },
          { level: 2, format: LevelFormat.DECIMAL, text: "%1.%2.%3", style: { paragraph: { indent: markerIndent("1.1.1", subIndent + deeper) } } },
        ],
      },
    ],
  };

  const STYLE = {
    body: "ProcedureBody",
    bullet: "ProcedureBullet",
    subStep: "ProcedureSubStep",
    photo: "ProcedurePhoto",
    caption: "ProcedureCaption",
  } as const;

  const styles = {
    default: {
      ...K.styles.default,
      heading1: {
        run: { font, size: halfPt(headingPt), bold: true, color: "000000" },
        paragraph: { keepNext: true, spacing: { before: sectionGap, after: 0 }, numbering: { reference: LIST, level: 0 } },
      },
      // Single Mode: Heading 2 = step. Project Mode: Heading 2 = phase and
      // Heading 3 = step, so phases and steps both show in the Navigation Pane
      heading2: project
        ? {
            run: { font, size: halfPt(headingPt), bold: true, color: "000000" },
            paragraph: { keepNext: true, spacing: { before: sectionGap, after: 0 }, numbering: { reference: PHASES, level: 0 } },
          }
        : {
            next: STYLE.subStep,
            run: { font, size: halfPt(stepPt), bold: true, color: "000000" },
            paragraph: { keepNext: true, spacing: { before: stepGap, after: 0 }, numbering: { reference: LIST, level: 1 } },
          },
      heading3: {
        next: STYLE.subStep,
        run: { font, size: halfPt(stepPt), bold: true, color: "000000" },
        paragraph: { keepNext: true, spacing: { before: stepGap, after: 0 }, numbering: { reference: PHASES, level: 1 } },
      },
    },
    // Thai names: what people see in Word's Styles list
    paragraphStyles: [
      { id: STYLE.body, name: "เนื้อหา", basedOn: "Normal", next: STYLE.body, quickFormat: true, paragraph: { indent: { left: stepIndent } } },
      {
        id: STYLE.bullet,
        name: "รายการ",
        basedOn: "Normal",
        next: STYLE.bullet,
        quickFormat: true,
        paragraph: { numbering: { reference: BULLETS, level: 0 } },
      },
      {
        id: STYLE.subStep,
        name: "ขั้นตอนย่อย",
        basedOn: "Normal",
        next: STYLE.subStep,
        quickFormat: true,
        paragraph: { numbering: { reference: project ? PHASES : LIST, level: 2 } },
      },
      {
        id: STYLE.photo,
        name: "ภาพประกอบ",
        basedOn: "Normal",
        next: STYLE.caption,
        paragraph: { keepNext: true, indent: { left: subTextLeft }, spacing: { before: mm(2) } },
      },
      {
        id: STYLE.caption,
        name: "คำบรรยายภาพ",
        basedOn: "Normal",
        next: STYLE.subStep,
        quickFormat: true,
        run: { size: halfPt(captionPt), color: "6E6E6E" },
        paragraph: { indent: { left: subTextLeft } },
      },
    ],
  };

  /** Plain runs only — the style decides how they look; K.run adds just the
   * language tag for spellcheck. A line per \n. */
  const text = (value: string) =>
    value.split("\n").flatMap((part, i) => K.run(part, { break: i > 0 ? 1 : 0 }));

  // --------------------------------------------------------------- sections --
  const body: (Paragraph | Table)[] = [headerBlock];
  const heading = (title: string) =>
    body.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: text(title) }));

  const textSection = (title: string, value: string) => {
    if (!value.trim()) return;
    heading(title);
    body.push(new Paragraph({ style: STYLE.body, children: text(value) }));
  };
  const listSection = (title: string, items: string[]) => {
    const clean = items.map((i) => i.trim()).filter(Boolean);
    if (!clean.length) return;
    heading(title);
    clean.forEach((item) => body.push(new Paragraph({ style: STYLE.bullet, children: text(item) })));
  };

  textSection(P.sections.purpose, procedure.purpose);
  textSection(P.sections.scope, procedure.scope);
  listSection(P.sections.references, procedure.references);
  listSection(P.sections.tools, procedure.tools);
  if (project) {
    textSection(P.sections.notes ?? "ข้อจำกัด / หมายเหตุ", project.notes);
    listSection(
      P.sections.tags ?? "รายการวาล์ว / Blind / Tag",
      project.references.map((ref) => (ref.note.trim() ? `${ref.tag}: ${ref.note}` : ref.tag)),
    );
  }

  // ------------------------------------------------- the procedure itself --
  heading(P.sections.procedure);
  const pushSteps = (steps: ProcedureDocument["steps"], prefix: string, photoPrefix: string) =>
  steps.forEach((step) => {
    body.push(
      new Paragraph({ heading: project ? HeadingLevel.HEADING_3 : HeadingLevel.HEADING_2, children: text(step.procedure) }),
    );
    step.sub_steps.forEach((sub) => {
      const photo = photos[photoPrefix + photoKey(step.no, sub.no)];
      // keepNext: a photo never lands on the next page without its sub-step
      body.push(new Paragraph({ style: STYLE.subStep, keepNext: !!photo, children: text(sub.action) }));
      if (!photo) return;
      // Under its own sub-step, aligned with its text, and captioned — same
      // as the PDF, so it can't be read as belonging to the next sub-step.
      // The caption is plain text: it won't follow a renumbering in Word.
      const maxWmm = ((K.contentW - subTextLeft) / 1440) * 25.4;
      body.push(
        new Paragraph({
          style: STYLE.photo,
          children: [K.image({ data: photo.data, ratio: photo.ratio > 0 ? photo.ratio : 1 }, maxWmm, photoMaxHmm)],
        }),
        new Paragraph({ style: STYLE.caption, children: text(`ภาพประกอบขั้นตอน ${prefix}${step.no}.${sub.no}`) }),
      );
    });
  });
  if (project) {
    project.phases.forEach((phase, index) => {
      body.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: text(phase.title) }));
      pushSteps(phase.steps, `${index + 1}.`, phase.photoPrefix);
    });
  } else {
    pushSteps(procedure.steps, "", "");
  }

  const footer = K.footer(P.formCode, P.footerText, options.company?.name ?? "");
  const doc = new Document({
    title: procedureDocxFileName(procedure),
    creator: "GenJSA",
    styles,
    numbering,
    sections: [
      // The cover: no header, no footer
      { properties: K.pageProperties, children: cover },
      {
        properties: { ...K.pageProperties, titlePage: true },
        headers: { default: compactHeader, first: new Header({ children: [] }) },
        footers: { default: footer, first: footer },
        children: body,
      },
    ],
  });
  return toBlob(doc);
}
