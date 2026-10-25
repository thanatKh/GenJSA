/* What the two Word (.docx) builders share — the Word counterpart of
 * lib/pdf/engine.ts.
 *
 * The Word file is the editable twin of the PDF: same content, same order,
 * same config/pdf.yaml sizes and colors, so a document edited in Word still
 * reads as the same F-ปธบ.-1202 form. It is not a pixel copy — Word lays out
 * its own pages, which is the point (the user wants to change it).
 *
 * Built in the browser like the PDF and never sent anywhere. Like engine.ts,
 * this pulls in a heavy library (docx), so it must only ever be reached
 * through a dynamic import().
 *
 * Thai text needs no help here: Word breaks Thai lines between words with
 * its own dictionary, unlike jsPDF (see engine.ts's splitLines).
 */

import {
  AlignmentType,
  BorderStyle,
  Footer,
  ImageRun,
  type IBorderOptions,
  Packer,
  PageNumber,
  Paragraph,
  Tab,
  Table,
  TableBorders,
  TableCell,
  TableRow,
  TabStopType,
  TextRun,
  VerticalAlignTable,
  WidthType,
  type Document,
  type IRunOptions,
  type ParagraphChild,
} from "docx";

import { type CompanyLogo, logoFormat } from "../companyLogo";
import type { Logo } from "../orLogo";
import type { PdfLayout } from "../pdf/layout";

/** Twips per mm (Word measures page geometry in twentieths of a point) */
const TWIP_PER_MM = 1440 / 25.4;
export const mm = (value: number) => Math.round(value * TWIP_PER_MM);
/** Font sizes are half-points */
export const halfPt = (pt: number) => Math.round(pt * 2);
/** Image sizes are pixels at 96 dpi */
export const mmToPx = (value: number) => (value * 96) / 25.4;

/** A4 portrait — the only page config/pdf.yaml uses */
const A4 = { width: mm(210), height: mm(297) };

/** Indent for a "1." / "1.1" / "•" marker hanging in front of its text */
export function markerIndent(marker: string, left = 0) {
  const hanging = mm(marker.length <= 1 ? 4 : marker.length <= 2 ? 5.5 : 7.5);
  return { left: left + hanging, hanging };
}

export function createWordKit(L: PdfLayout) {
  const contentW = A4.width - mm(L.page.margin_left_mm) - mm(L.page.margin_right_mm);
  const pad = mm(L.table.cell_padding_mm);
  const borderColor = L.table.border_color.replace("#", "");
  const fill = L.table.header_fill.replace("#", "");
  // Border sizes are eighths of a point
  const line: IBorderOptions = {
    style: BorderStyle.SINGLE,
    size: Math.max(2, Math.round(L.table.border_width_pt * 8)),
    color: borderColor,
  };
  const tableBorders = {
    top: line,
    bottom: line,
    left: line,
    right: line,
    insideHorizontal: line,
    insideVertical: line,
  };
  const cellMargins = { top: pad, bottom: pad, left: pad, right: pad };

  const run = (text: string, options: Omit<IRunOptions, "text"> = {}) =>
    new TextRun({ text, ...options });

  /** A paragraph of text with an optional hanging marker ("1.", "1.1", "•") */
  const markedParagraph = (
    text: string,
    {
      marker,
      bold = false,
      size = L.font.body_pt,
      left = 0,
      keepNext = false,
      spaceBefore = 0,
    }: {
      marker?: string;
      bold?: boolean;
      size?: number;
      left?: number;
      keepNext?: boolean;
      spaceBefore?: number;
    } = {},
  ) =>
    new Paragraph({
      keepNext,
      spacing: { before: spaceBefore },
      indent: marker ? markerIndent(marker, left) : left ? { left } : undefined,
      children: [
        ...(marker ? [run(marker, { bold, size: halfPt(size) }), new TextRun({ children: [new Tab()] })] : []),
        // A line per \n, so a multi-line field keeps its line breaks
        ...text.split("\n").map((part, i) => run(part, { bold, size: halfPt(size), break: i > 0 ? 1 : 0 })),
      ],
    });

  /** "label: value" — bold label, normal value, at the header-field size */
  const fieldParagraph = (label: string, value: string) =>
    new Paragraph({
      children: [
        run(`${label}: `, { bold: true, size: halfPt(L.font.header_label_pt) }),
        run(value, { size: halfPt(L.font.header_label_pt) }),
      ],
    });

  const image = (logo: Logo | CompanyLogo, maxWmm: number, maxHmm: number) => {
    let h = maxHmm;
    let w = h * logo.ratio;
    if (w > maxWmm) {
      w = maxWmm;
      h = w / logo.ratio;
    }
    return new ImageRun({
      type: logoFormat(logo) === "PNG" ? "png" : "jpg",
      data: logo.data,
      transformation: { width: mmToPx(w), height: mmToPx(h) },
    });
  };

  /** The form's title bar: OR logo | Thai + English title | company logo.
   * A borderless table nested in one full-width cell of the caller's table,
   * so it repeats with the rest of the header on every page. */
  const titleBar = (
    titleTh: string,
    titleEn: string,
    orLogo: Logo | null,
    companyLogo: CompanyLogo | null,
    width: number,
  ) => {
    const logoColW = mm(L.logo.max_width_mm + 4);
    const middleW = width - logoColW * 2;
    const logoCell = (logo: Logo | CompanyLogo | null, align: (typeof AlignmentType)[keyof typeof AlignmentType]) =>
      new TableCell({
        width: { size: logoColW, type: WidthType.DXA },
        verticalAlign: VerticalAlignTable.CENTER,
        children: [
          new Paragraph({
            alignment: align,
            children: logo ? [image(logo, L.logo.max_width_mm, L.logo.max_height_mm)] : [],
          }),
        ],
      });
    return new Table({
      width: { size: width, type: WidthType.DXA },
      columnWidths: [logoColW, middleW, logoColW],
      borders: TableBorders.NONE,
      rows: [
        new TableRow({
          children: [
            logoCell(orLogo, AlignmentType.LEFT),
            new TableCell({
              width: { size: middleW, type: WidthType.DXA },
              verticalAlign: VerticalAlignTable.CENTER,
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [run(titleTh, { bold: true, size: halfPt(L.font.title_th_pt) })],
                }),
                ...(titleEn
                  ? [
                      new Paragraph({
                        alignment: AlignmentType.CENTER,
                        children: [run(titleEn, { bold: true, size: halfPt(L.font.title_en_pt) })],
                      }),
                    ]
                  : []),
              ],
            }),
            logoCell(companyLogo, AlignmentType.RIGHT),
          ],
        }),
      ],
    });
  };

  /** A full-width bordered header cell. A cell holding a nested table must
   * still end on a paragraph (Word reports the file as damaged otherwise),
   * hence the tiny trailing one. */
  const cell = (
    children: (Paragraph | Table)[],
    options: { span?: number; width: number; shaded?: boolean; top?: boolean },
  ) => {
    const last = children[children.length - 1];
    return new TableCell({
      columnSpan: options.span,
      width: { size: options.width, type: WidthType.DXA },
      margins: cellMargins,
      // Body rows read from the top, like the PDF; header cells are centred
      verticalAlign: options.top ? VerticalAlignTable.TOP : VerticalAlignTable.CENTER,
      shading: options.shaded ? { fill, color: "auto", type: "clear" } : undefined,
      children:
        last instanceof Table
          ? [...children, new Paragraph({ children: [run("", { size: 2 })], spacing: { line: 20, lineRule: "exact" } })]
          : children,
    });
  };

  /** Vertical space of an exact height. An empty paragraph would be a whole
   * blank line of body text plus the gap. */
  const gap = (height: number) =>
    new Paragraph({ spacing: { line: Math.max(height, 20), lineRule: "exact" }, children: [] });

  /** Form code + text on the left, page number in the middle, company name on
   * the right — the same footer the PDF prints. */
  const footer = (formCode: string, footerText: string, companyName: string) => {
    const left = `${formCode} ${footerText}`.trim();
    const right = L.footer.show_company && companyName ? companyName : "";
    const size = halfPt(L.font.footer_pt);
    const pageParts: ParagraphChild[] = [];
    if (L.footer.show_page_number) {
      // "หน้า {page} / {total}" → text, live page field, text, live total field
      const children: (string | (typeof PageNumber)[keyof typeof PageNumber])[] = [];
      L.footer.page_number_format.split(/(\{page\}|\{total\})/).forEach((part) => {
        if (part === "{page}") children.push(PageNumber.CURRENT);
        else if (part === "{total}") children.push(PageNumber.TOTAL_PAGES);
        else if (part) children.push(part);
      });
      pageParts.push(new TextRun({ children, size }));
    }
    return new Footer({
      children: [
        new Paragraph({
          tabStops: [
            { type: TabStopType.CENTER, position: Math.round(contentW / 2) },
            { type: TabStopType.RIGHT, position: contentW },
          ],
          children: [
            run(left, { size }),
            new TextRun({ children: [new Tab()] }),
            ...pageParts,
            new TextRun({ children: [new Tab()] }),
            run(right, { size }),
          ],
        }),
      ],
    });
  };

  const pageProperties = {
    page: {
      size: A4,
      margin: {
        top: mm(L.page.margin_top_mm),
        bottom: mm(L.page.margin_bottom_mm),
        left: mm(L.page.margin_left_mm),
        right: mm(L.page.margin_right_mm),
        footer: mm(Math.max(L.page.margin_bottom_mm - 10, 4)),
      },
    },
  };

  /** Document-wide defaults: the PDF's Thai font for every script, body size,
   * no extra paragraph spacing */
  const styles = {
    default: {
      document: {
        run: {
          font: { ascii: L.font.family, hAnsi: L.font.family, cs: L.font.family, eastAsia: L.font.family },
          size: halfPt(L.font.body_pt),
        },
        paragraph: { spacing: { after: 0, before: 0 } },
      },
    },
  };

  return {
    contentW,
    tableBorders,
    run,
    markedParagraph,
    fieldParagraph,
    image,
    titleBar,
    cell,
    gap,
    footer,
    pageProperties,
    styles,
  };
}

export type WordKit = ReturnType<typeof createWordKit>;

export async function toBlob(doc: Document): Promise<Blob> {
  return Packer.toBlob(doc);
}
