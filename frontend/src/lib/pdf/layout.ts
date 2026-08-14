/* Document layout values
 *
 * Real values come from config/pdf.yaml via GET /api/config/public.
 * This file only holds "fallback values" for when the API is unreachable,
 * so a document can still be produced.
 * To adjust size/margins/colors, edit config/pdf.yaml — not this file.
 */

export type PdfLayout = {
  page: {
    size: string;
    orientation: string;
    margin_top_mm: number;
    margin_bottom_mm: number;
    margin_left_mm: number;
    margin_right_mm: number;
  };
  font: {
    family: string;
    body_pt: number;
    header_label_pt: number;
    table_header_pt: number;
    title_th_pt: number;
    title_en_pt: number;
    footer_pt: number;
    line_height: number;
  };
  table: {
    column_widths_percent: number[];
    header_fill: string;
    border_color: string;
    border_width_pt: number;
    outer_border_width_pt: number;
    cell_padding_mm: number;
    repeat_header_each_page: boolean;
    avoid_row_split: boolean;
  };
  logo: { max_height_mm: number; max_width_mm: number };
  footer: {
    show_page_number: boolean;
    page_number_format: string;
    show_company: boolean;
  };
  signature: { show: boolean; gap_above_mm: number; label_pt: number };
};

export type DocumentMeta = {
  formCode: string;
  footerText: string;
  titleTh: string;
  titleEn: string;
  labels: {
    work_activity: string;
    supervisor: string;
    analysis_date: string;
    analyst: string;
  };
  columns: {
    procedure: string;
    procedure_hint: string;
    hazard: string;
    control: string;
  };
};

export type CompanyMeta = { name: string; department: string };

/** Must match config/pdf.yaml — used when config can't be loaded from the API */
export const FALLBACK_LAYOUT: PdfLayout = {
  page: {
    size: "A4",
    orientation: "portrait",
    margin_top_mm: 12,
    margin_bottom_mm: 14,
    margin_left_mm: 12,
    margin_right_mm: 12,
  },
  font: {
    family: "TH Sarabun New",
    body_pt: 14,
    header_label_pt: 16,
    table_header_pt: 14,
    title_th_pt: 20,
    title_en_pt: 18,
    footer_pt: 10,
    line_height: 1.5,
  },
  table: {
    column_widths_percent: [35.0, 31.7, 33.3],
    header_fill: "#FCD5B4",
    border_color: "#000000",
    border_width_pt: 0.75,
    outer_border_width_pt: 0.75,
    cell_padding_mm: 1.5,
    repeat_header_each_page: true,
    avoid_row_split: true,
  },
  logo: { max_height_mm: 11, max_width_mm: 32 },
  footer: {
    show_page_number: true,
    page_number_format: "หน้า {page} / {total}",
    show_company: true,
  },
  signature: { show: true, gap_above_mm: 8, label_pt: 14 },
};

export const FALLBACK_DOCUMENT: DocumentMeta = {
  formCode: "F-ปธบ.-1202",
  footerText: "ประกาศใช้ครั้งที่ 1",
  titleTh: "การวิเคราะห์งานเพื่อความปลอดภัย",
  titleEn: "(Job Safety Analysis : JSA)",
  labels: {
    work_activity: "งาน/กิจกรรม",
    supervisor: "ชื่อหัวหน้างาน",
    analysis_date: "วันที่วิเคราะห์",
    analyst: "ผู้วิเคราะห์",
  },
  columns: {
    procedure: "ขั้นตอนการทำงาน",
    procedure_hint: "(ระบุทุกขั้นตอน)",
    hazard: "อันตรายที่อาจเกิดขึ้น",
    control: "มาตรการป้องกัน/ควบคุม",
  },
};

export const MM_PER_PT = 0.352777778;

export function mmToPt(mm: number): number {
  return mm / MM_PER_PT;
}

/** "#FCD5B4" -> [252, 213, 180] */
export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "").trim();
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  return [
    parseInt(full.slice(0, 2), 16) || 0,
    parseInt(full.slice(2, 4), 16) || 0,
    parseInt(full.slice(4, 6), 16) || 0,
  ];
}
