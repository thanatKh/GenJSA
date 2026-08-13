/* Thai-style dates — Buddhist era year and Thai month names
 *
 * Same logic as backend/app/core/thaidate.py — keep both in sync.
 * Never display a date as 12/08/2026 anywhere.
 */

export const THAI_MONTHS = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
] as const;

const BUDDHIST_OFFSET = 543;

/** "2026-08-12" -> "12 สิงหาคม 2569" */
export function formatThaiDate(iso: string): string {
  const parsed = parseIsoDate(iso);
  if (!parsed) return "";
  const { year, month, day } = parsed;
  return `${day} ${THAI_MONTHS[month - 1]} ${year + BUDDHIST_OFFSET}`;
}

/** Today in ISO format, using the user's local device time (not toISOString, which would be UTC) */
export function todayIso(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function parseIsoDate(
  iso: string,
): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

export function isValidIsoDate(iso: string): boolean {
  return parseIsoDate(iso) !== null;
}
