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
import { docxFileName } from "../pdf/fileName";
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

  const colW = L.table.column_widths_percent.map((p) => Math.round((K.contentW * p) / 100));
  colW[2] = K.contentW - colW[0] - colW[1];
  const repeat = L.table.repeat_header_each_page;
  const headerRow = (cells: TableCell[]) => new TableRow({ tableHeader: repeat, children: cells });
  type TableCell = ReturnType<typeof K.cell>;

  // ---------------------------------------------------------------- header --
  const header: TableRow[] = [
    headerRow([
      K.cell([K.titleBar(D.titleTh, D.titleEn, orLogo, options.companyLogo ?? null, K.contentW - mm(L.table.cell_padding_mm) * 2)], {
        span: 3,
        width: K.contentW,
      }),
    ]),
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
    new Paragraph({ alignment: AlignmentType.CENTER, children: [K.run(text, { bold: true, size: headSize })] }),
    ...(hint
      ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [K.run(hint, { size: halfPt(L.font.table_header_pt - 1) })] })]
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
              K.run(`${D.labels.analyst ?? FALLBACK_DOCUMENT.labels.analyst} `, { bold: true, size: halfPt(sig.label_pt) }),
              K.run(analystName, { size: halfPt(sig.label_pt) }),
            ],
          }),
        ]
      : [];

  const doc = new Document({
    title: docxFileName(jsa),
    creator: "GenJSA",
    styles: K.styles,
    sections: [
      {
        properties: K.pageProperties,
        footers: { default: K.footer(D.formCode, D.footerText, options.company?.name ?? "") },
        children: [
          new Table({
            width: { size: K.contentW, type: WidthType.DXA },
            columnWidths: colW,
            borders: K.tableBorders,
            rows: [...header, ...rows],
          }),
          ...signature,
        ],
      },
    ],
  });
  return toBlob(doc);
}
