/* Load TH Sarabun New into jsPDF
 *
 * Fonts are imported as a URL (?url) and fetched on demand, not embedded as
 * base64 in the main bundle — the two files together are ~800KB, and if
 * embedded directly, users who never open a PDF would still pay to load them.
 *
 * The result is cached in memory, so generating a PDF multiple times only
 * loads the fonts once.
 */

import type { jsPDF } from "jspdf";
import regularUrl from "../../assets/fonts/THSarabunNew-Regular.ttf?url";
import boldUrl from "../../assets/fonts/THSarabunNew-Bold.ttf?url";

export const FONT_NAME = "THSarabun";

type FontPair = { regular: string; bold: string };

let cache: Promise<FontPair> | null = null;

async function toBase64(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load font: ${url}`);
  const bytes = new Uint8Array(await response.arrayBuffer());

  // Convert to base64 in chunks — String.fromCharCode(...bytes) on a 400KB+
  // file overflows the call stack on Safari
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function loadFonts(): Promise<FontPair> {
  cache ??= (async () => {
    const [regular, bold] = await Promise.all([
      toBase64(regularUrl),
      toBase64(boldUrl),
    ]);
    return { regular, bold };
  })();
  return cache;
}

/** Register the Thai font with a jsPDF instance (must be called before drawing any Thai text) */
export async function registerThaiFont(doc: jsPDF): Promise<void> {
  const { regular, bold } = await loadFonts();

  doc.addFileToVFS("THSarabunNew-Regular.ttf", regular);
  doc.addFont("THSarabunNew-Regular.ttf", FONT_NAME, "normal");

  doc.addFileToVFS("THSarabunNew-Bold.ttf", bold);
  doc.addFont("THSarabunNew-Bold.ttf", FONT_NAME, "bold");

  doc.setFont(FONT_NAME, "normal");
}
