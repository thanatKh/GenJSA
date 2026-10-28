/* The F-ปธบ.-1202 JSA as an editable Word file — the twin of buildJsaPdf.ts.
 *
 * One table, like the form: title bar, header fields and column heads as
 * header rows (repeated on every page when config/pdf.yaml says so, as the
 * PDF does), then one row per step. Word paginates and splits rows itself,
 * which is why none of buildJsaPdf's orphan/widow logic is needed here.
 */

import { AlignmentType, Document, Paragraph, Table, TableRow, WidthType } from "docx";

import type { CompanyLogo } from "../companyLogo";
import { loadOrLogo } from "../orLogo";
import { docxFileName, projectJsaDocxFileName } from "../pdf/fileName";
import {
  FALLBACK_DOCUMENT,
  FALLBACK_LAYOUT,
  type CompanyMeta,
  type DocumentMeta,
  type PdfLayout,
} from "../pdf/layout";
import type { JsaDocument } from "../schema";
import { formatThaiDate } from "../thaidate";
import { createWordKit, halfPt, mm, toBlob } from "./common";

type BuildOptions = {
  layout?: PdfLayout;
  document?: DocumentMeta;
  company?: CompanyMeta;
  companyLogo?: CompanyLogo | null;
};

export async function buildJsaDocx(jsa: JsaDocument, options: BuildOptions = {}): Promise<Blob> {
  const L = options.layout ?? FALLBACK_LAYOUT;
  const D = options.document ?? FALLBACK_DOCUMENT;
  const K = createWordKit(L);
  const orLogo = await loadOrLogo();
  const doc = new Document({
    title: docxFileName(jsa),
    creator: "GenJSA",
    styles: K.styles,
    sections: [
      {
        properties: K.pageProperties,
        footers: { default: K.footer(D.formCode, D.footerText, options.company?.name ?? "") },
        children: jsaBody(K, jsa, L, D, orLogo, options.companyLogo ?? null),
      },
    ],
  });
  return toBlob(doc);
}

type Kit = ReturnType<typeof createWordKit>;

/** One JSA's form table and analyst line — the body of a JSA's Word file, or
 * of one JSA's section in a project's combined file (buildProjectJsaDocx) */
function jsaBody(
  K: Kit,
  jsa: JsaDocument,
  L: PdfLayout,
  D: DocumentMeta,
  orLogo: Awaited<ReturnType<typeof loadOrLogo>>,
  companyLogo: CompanyLogo | null,
): (Table | Paragraph)[] {

  const colW = L.table.column_widths_percent.map((p) => Math.round((K.contentW * p) / 100));
  colW[2] = K.contentW - colW[0] - colW[1];
  const repeat = L.table.repeat_header_each_page;
  const headerRow = (cells: TableCell[]) => new TableRow({ tableHeader: repeat, children: cells });
  type TableCell = ReturnType<typeof K.cell>;

  // ---------------------------------------------------------------- header --
  const header: TableRow[] = [
    headerRow([
      K.cell([K.titleBar(D.titleTh, D.titleEn, orLogo, companyLogo, K.contentW - mm(L.table.cell_padding_mm) * 2)], {
        span: 3,
        width: K.contentW,
      }),
    ]),
    // Project Mode: "โครงการ" above งาน/กิจกรรม, same as the PDF
    ...(jsa.header.project?.trim()
      ? [
          headerRow([
            K.cell([K.fieldParagraph(D.labels.project ?? "โครงการ", jsa.header.project.trim())], {
              span: 3,
              width: K.contentW,
            }),
          ]),
        ]
      : []),
    headerRow([
      K.cell([K.fieldParagraph(D.labels.work_activity, jsa.header.work_activity)], { span: 3, width: K.contentW }),
    ]),
    // Supervisor spans the first two columns so the date's left edge is the
    // control column's — the same continuous line the PDF draws
    headerRow([
      K.cell([K.fieldParagraph(D.labels.supervisor, jsa.header.supervisor)], { span: 2, width: colW[0] + colW[1] }),
      K.cell([K.fieldParagraph(D.labels.analysis_date, formatThaiDate(jsa.header.analysis_date))], { width: colW[2] }),
    ]),
  ];
  const company = jsa.header.company?.trim();
  if (company) {
    header.push(
      headerRow([K.cell([K.fieldParagraph(D.labels.company ?? "บริษัท", company)], { span: 3, width: K.contentW })]),
    );
  }

  const headSize = halfPt(L.font.table_header_pt);
  const columnHead = (text: string, hint?: string) => [
    new Paragraph({ alignment: AlignmentType.CENTER, children: [...K.run(text, { bold: true, size: headSize })] }),
    ...(hint
      ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [...K.run(hint, { size: halfPt(L.font.table_header_pt - 1) })] })]
      : []),
  ];
  header.push(
    headerRow([
      K.cell(columnHead(D.columns.procedure, D.columns.procedure_hint), { width: colW[0], shaded: true }),
      K.cell(columnHead(D.columns.hazard), { width: colW[1], shaded: true }),
      K.cell(columnHead(D.columns.control), { width: colW[2], shaded: true }),
    ]),
  );

  // ------------------------------------------------------------------ steps --
  const dash = () => K.markedParagraph("—");
  const rows = jsa.steps.map((step, stepIndex) => {
    const procedure = [K.markedParagraph(step.procedure, { marker: `${stepIndex + 1}.`, bold: true })];
    if (step.details.trim()) procedure.push(K.markedParagraph(step.details));

    const multiple = step.hazards.length > 1;
    const hazards: Paragraph[] = [];
    const controls: Paragraph[] = [];
    step.hazards.forEach((hazard, hazardIndex) => {
      hazards.push(K.markedParagraph(hazard.hazard, { marker: multiple ? `${hazardIndex + 1}.` : undefined }));
      const list = hazard.controls.filter((c) => c && c.trim());
      if (list.length === 0) controls.push(dash());
      list.forEach((control, controlIndex) => {
        // Multiple hazards: 1.1 / 1.2 pair up with the numbers in the hazard column
        controls.push(K.markedParagraph(control, { marker: multiple ? `${hazardIndex + 1}.${controlIndex + 1}` : "-" }));
      });
    });
    if (hazards.length === 0) hazards.push(dash());

    return new TableRow({
      children: [
        K.cell(procedure, { width: colW[0], top: true }),
        K.cell(hazards, { width: colW[1], top: true }),
        K.cell(controls.length ? controls : [dash()], { width: colW[2], top: true }),
      ],
    });
  });

  // ------------------------------------------------------------ analyst line --
  // Same rule as the PDF: a blank analyst means the supervisor did the analysis
  const sig = L.signature ?? FALLBACK_LAYOUT.signature;
  const analystName = jsa.header.analyst?.trim() || jsa.header.supervisor?.trim();
  const signature =
    sig.show && analystName
      ? [
          new Paragraph({
            spacing: { before: mm(sig.gap_above_mm) },
            children: [
              ...K.run(`${D.labels.analyst ?? FALLBACK_DOCUMENT.labels.analyst} `, { bold: true, size: halfPt(sig.label_pt) }),
              ...K.run(analystName, { size: halfPt(sig.label_pt) }),
            ],
          }),
        ]
      : [];

  return [
    new Table({
      width: { size: K.contentW, type: WidthType.DXA },
      columnWidths: colW,
      borders: K.tableBorders,
      rows: [...header, ...rows],
    }),
    ...signature,
  ];
}

/** Project Mode's second file as Word: a cover with the contents (JSA n /
 * งาน), then each phase's JSA in a section of its own, so each starts on a
 * new page with the form's footer. Unlike the PDF, the contents carry no
 * page numbers — Word only knows them after laying the file out, and a field
 * to fill them in makes Word ask about updating fields every time it opens. */
export async function buildProjectJsaDocx(
  project: { name: string; supervisor: string; company: string; date: string },
  jsas: JsaDocument[],
  options: BuildOptions = {},
): Promise<Blob> {
  const L = options.layout ?? FALLBACK_LAYOUT;
  const D = options.document ?? FALLBACK_DOCUMENT;
  const K = createWordKit(L);
  const orLogo = await loadOrLogo();

  const centered = (value: string, size: number, bold = false, after = 0) =>
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after }, children: K.run(value, { size: halfPt(size), bold }) });
  const info = (label: string, value: string) =>
    value.trim()
      ? [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              ...K.run(`${label}: `, { bold: true, size: halfPt(L.font.header_label_pt + 1) }),
              ...K.run(value, { size: halfPt(L.font.header_label_pt + 1) }),
            ],
          }),
        ]
      : [];

  const widths = [Math.round(K.contentW * 0.18), 0];
  widths[1] = K.contentW - widths[0];
  const contents = new Table({
    width: { size: K.contentW, type: WidthType.DXA },
    columnWidths: widths,
    borders: K.tableBorders,
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          K.cell([K.markedParagraph("ลำดับ", { bold: true })], { width: widths[0], shaded: true }),
          K.cell([K.markedParagraph("งาน", { bold: true })], { width: widths[1], shaded: true }),
        ],
      }),
      ...jsas.map(
        (jsa, i) =>
          new TableRow({
            children: [
              K.cell([K.markedParagraph(`JSA ${i + 1}`)], { width: widths[0] }),
              K.cell([K.markedParagraph(jsa.header.work_activity)], { width: widths[1] }),
            ],
          }),
      ),
    ],
  });

  const companyLogo = options.companyLogo ?? null;
  const cover = [
    new Paragraph({ spacing: { before: mm(20) }, children: [] }),
    // The same logo pair as the procedure's Word cover (and the PDF's)
    ...(orLogo
      ? [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: mm(10) },
            children: [
              K.image(orLogo, 60, 16),
              ...(companyLogo ? [...K.run("          "), K.image(companyLogo, 60, 16)] : []),
            ],
          }),
        ]
      : []),
    centered(D.titleTh, L.font.title_th_pt + 12, true),
    ...(D.titleEn ? [centered(D.titleEn, L.font.title_en_pt + 4, false, mm(8))] : []),
    centered(project.name, L.font.title_en_pt + 6, true, mm(4)),
    ...info(D.labels.company ?? "บริษัท", project.company),
    ...info(D.labels.supervisor, project.supervisor),
    ...info(D.labels.analysis_date, formatThaiDate(project.date)),
    new Paragraph({ spacing: { before: mm(10), after: mm(2) }, children: K.run("สารบัญ", { bold: true, size: halfPt(L.font.table_header_pt + 2) }) }),
    contents,
  ];

  const footer = K.footer(D.formCode, D.footerText, options.company?.name ?? "");
  const doc = new Document({
    title: projectJsaDocxFileName(project.name, project.date),
    creator: "GenJSA",
    styles: K.styles,
    sections: [
      // The cover: no footer, like the PDF's
      { properties: K.pageProperties, children: cover },
      ...jsas.map((jsa) => ({
        properties: K.pageProperties,
        footers: { default: footer },
        children: jsaBody(K, jsa, L, D, orLogo, options.companyLogo ?? null),
      })),
    ],
  });
  return toBlob(doc);
}
