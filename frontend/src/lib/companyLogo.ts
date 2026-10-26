/* Company logo for documents prepared in another company's name — e.g. a
 * vendor preparing a JSA to submit to PTTOR for a permit to work on site.
 * The OR logo always stays where it is; this logo prints opposite it.
 *
 * Two jobs here, both browser-only (nothing in this file ever reaches the
 * backend, same rule as step photos):
 *
 * 1. fileToCompanyLogo — shrink an uploaded logo before it reaches state or
 *    the PDF. A logo prints at most ~32×16 mm, so a 3000px, 2 MB original
 *    adds megabytes to every PDF for detail nobody can see. It is resized to
 *    LOGO_MAX_EDGE_PX, encoded as PNG or JPEG — whichever is smaller — and
 *    stepped down further until it's under LOGO_TARGET_BYTES. A logo that
 *    still can't get under LOGO_HARD_MAX_BYTES is refused.
 *
 * 2. The remembered default ("จำไว้ในเบราว์เซอร์นี้") — name + logo in
 *    localStorage, so a company that uses GenJSA often doesn't re-enter them
 *    for every job. Each document still keeps its own copy (the name on its
 *    header, the logo in photoStore.ts under COMPANY_LOGO_KEY), so changing
 *    the default later never rewrites an old document.
 *
 * jsPDF-free, like photo.ts: InputStep imports this eagerly.
 */

import { decode } from "./photo";

export type CompanyLogo = {
  /** PNG or JPEG data URL, already resized */
  data: string;
  /** naturalWidth / naturalHeight */
  ratio: number;
};

/** ~470 dpi across the 32 mm header slot, ~380 dpi on the cover — sharp in
 * print, a fraction of a raw original's size */
export const LOGO_MAX_EDGE_PX = 600;
/** What the resize loop aims for; a flat-colour logo usually lands far below */
const LOGO_TARGET_BYTES = 120 * 1024;
/** Refused above this even at the smallest size tried */
const LOGO_HARD_MAX_BYTES = 300 * 1024;
const LOGO_MIN_EDGE_PX = 240;
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;

export class LogoError extends Error {}

/** Bytes of the file a data URL encodes (base64 is 4 chars per 3 bytes) */
function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  return Math.floor(((dataUrl.length - comma - 1) * 3) / 4);
}

/** jsPDF's format name for a data URL this module produced */
export function logoFormat(logo: CompanyLogo): "PNG" | "JPEG" {
  return logo.data.startsWith("data:image/png") ? "PNG" : "JPEG";
}

export async function fileToCompanyLogo(file: File): Promise<CompanyLogo> {
  if (!file.type.startsWith("image/")) {
    throw new LogoError("ไฟล์นี้ไม่ใช่รูปภาพ กรุณาเลือกไฟล์โลโก้ (PNG หรือ JPG)");
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new LogoError("ไฟล์โลโก้ใหญ่เกินไป (เกิน 10 MB) กรุณาใช้ไฟล์ที่เล็กกว่านี้");
  }

  const source = await decode(file);
  try {
    const longest = Math.max(source.width, source.height);
    // Never upscale a small logo
    let edge = Math.min(LOGO_MAX_EDGE_PX, longest);

    for (;;) {
      const scale = edge / longest;
      const w = Math.max(1, Math.round(source.width * scale));
      const h = Math.max(1, Math.round(source.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new LogoError("เบราว์เซอร์นี้ไม่รองรับการเพิ่มรูปภาพ กรุณาใช้เบราว์เซอร์อื่น");
      // White ground: the logo always prints on a white title bar, and a
      // flattened image is what makes JPEG a safe option at all (a
      // transparent area would otherwise turn black)
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(source, 0, 0, w, h);

      // PNG wins for flat-colour logos (crisp, small); JPEG for photographic ones
      const png = canvas.toDataURL("image/png");
      const jpeg = canvas.toDataURL("image/jpeg", 0.9);
      const data = dataUrlBytes(png) <= dataUrlBytes(jpeg) ? png : jpeg;

      if (dataUrlBytes(data) <= LOGO_TARGET_BYTES || edge <= LOGO_MIN_EDGE_PX) {
        if (dataUrlBytes(data) > LOGO_HARD_MAX_BYTES) {
          throw new LogoError("ไฟล์โลโก้นี้ใหญ่เกินไป กรุณาใช้ไฟล์ที่เล็กหรือเรียบง่ายกว่านี้");
        }
        return { data, ratio: w / h };
      }
      edge = Math.max(LOGO_MIN_EDGE_PX, Math.round(edge * 0.8));
    }
  } finally {
    if (typeof (source as ImageBitmap).close === "function") {
      (source as ImageBitmap).close();
    }
  }
}

// ------------------------------------------------- remembered default --
const PROFILE_KEY = "genjsa.company.v1";

type CompanyProfile = { name: string; logo: CompanyLogo | null };

/** The remembered default, or null. Never throws: storage can be disabled
 * (private browsing, policy), and a broken record just means "nothing
 * remembered". */
export function loadCompanyProfile(): CompanyProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CompanyProfile>;
    const name = typeof parsed.name === "string" ? parsed.name : "";
    const logo =
      parsed.logo && typeof parsed.logo.data === "string" && typeof parsed.logo.ratio === "number"
        ? parsed.logo
        : null;
    return name.trim() || logo ? { name, logo } : null;
  } catch {
    return null;
  }
}

export function saveCompanyProfile(profile: CompanyProfile): void {
  try {
    if (!profile.name.trim() && !profile.logo) {
      localStorage.removeItem(PROFILE_KEY);
      return;
    }
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // Quota or disabled storage — remembering is a convenience, never required
  }
}

export function clearCompanyProfile(): void {
  try {
    localStorage.removeItem(PROFILE_KEY);
  } catch {
    // see saveCompanyProfile
  }
}
