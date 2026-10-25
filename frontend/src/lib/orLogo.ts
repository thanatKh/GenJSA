/* The OR logo, decoded and shrunk once for every generated document — the
 * PDF (lib/pdf/engine.ts) and the Word file (lib/word/) both draw it.
 *
 * Its own module, jsPDF-free on purpose: engine.ts imports jsPDF statically,
 * so if the Word builders imported this from there, every Word export would
 * download jsPDF too.
 */

import logoUrl from "../assets/logo.png";
import { LOGO_MAX_EDGE_PX } from "./companyLogo";

export type Logo = { data: string; ratio: number };

let logoCache: Promise<Logo | null> | null = null;

/** Memoized across documents — generating both documents decodes the logo once. */
export function loadOrLogo(): Promise<Logo | null> {
  logoCache ??= new Promise<Logo | null>((resolve) => {
    const image = new Image();
    image.onload = () => {
      // Shrunk to the same LOGO_MAX_EDGE_PX as a company logo: it was
      // embedded at its full 2453x999 (66 KB of every PDF) to print ~30 mm wide
      const scale = Math.min(1, LOGO_MAX_EDGE_PX / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(null);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve({
        data: canvas.toDataURL("image/png"),
        ratio: image.naturalWidth / image.naturalHeight,
      });
    };
    // A missing logo must not fail the whole document — still produce one without it
    image.onerror = () => resolve(null);
    image.src = logoUrl;
  });
  return logoCache;
}
