/* Turn a user-supplied image file into a StepPhoto
 *
 * Photos are attached to work-procedure steps by drag-and-drop, Ctrl-V paste,
 * or the file picker. They are downscaled here, on the way in, so an oversized
 * original never reaches React state or the PDF: a raw 12MP phone photo is
 * several megabytes, and embedding a handful of those makes the generated PDF
 * huge and jsPDF's addImage slow, for detail nobody can see on an A4 page.
 *
 * No persistence in this file itself — decoding/resizing only. See StepPhoto
 * in lib/pdf/layout.ts and lib/photoStore.ts for where the result actually
 * gets saved (IndexedDB, via App.tsx's updatePhoto).
 *
 * jsPDF-free on purpose: the editor imports this eagerly, and the PDF builders
 * are behind a dynamic import (see the bundle note in lib/pdf/engine.ts).
 */

import {
  PHOTO_JPEG_QUALITY,
  PHOTO_MAX_EDGE_PX,
  photoKey,
  type PhotoMap,
  type StepPhoto,
} from "./pdf/layout";

/** Anything larger than this is refused before decoding. Generous — a 12MP
 * JPEG is ~5MB — but it stops someone dropping a 200MB TIFF and freezing the
 * tab while the browser tries to decode it. */
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const EXPORT_MAX_EDGE_PX = 1400;
const EXPORT_JPEG_QUALITY = 0.8;

export class PhotoError extends Error {}

/** Decode, downscale and re-encode to a JPEG data URL.
 *
 * Always re-encodes as JPEG, even when the source is already small: it makes
 * the size predictable, and it flattens any alpha channel (a transparent PNG
 * would otherwise render with a black background in the PDF).
 */
export async function fileToStepPhoto(file: File): Promise<StepPhoto> {
  if (!file.type.startsWith("image/")) {
    throw new PhotoError("ไฟล์นี้ไม่ใช่รูปภาพ กรุณาเลือกไฟล์รูปภาพ");
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new PhotoError("ไฟล์รูปภาพใหญ่เกินไป กรุณาใช้รูปที่เล็กกว่านี้");
  }

  return resizePhoto(file, PHOTO_MAX_EDGE_PX, PHOTO_JPEG_QUALITY);
}

async function resizePhoto(
  source: Blob,
  maxEdge: number,
  quality: number,
  original?: StepPhoto,
): Promise<StepPhoto> {
  const bitmap = await decode(source);
  try {
    const longestEdge = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(
      1,
      maxEdge / longestEdge,
    );
    // Never upscale: a small source stays its own size rather than being
    // blown up into a blurry, larger file.
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new PhotoError("เบราว์เซอร์นี้ไม่รองรับการเพิ่มรูปภาพ กรุณาใช้เบราว์เซอร์อื่น");

    // White ground so a transparent source doesn't turn black once flattened
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);

    const data = canvas.toDataURL("image/jpeg", quality);
    // Keep an already small JPEG if re-encoding would add bytes and blur.
    if (scale === 1 && original?.data.startsWith("data:image/jpeg;") && original.data.length <= data.length) {
      return original;
    }
    return { data, ratio: original?.ratio ?? w / h };
  } finally {
    // createImageBitmap allocates outside the JS heap; the <img> fallback
    // below has nothing to release, so this no-ops for it.
    if (typeof (bitmap as ImageBitmap).close === "function") {
      (bitmap as ImageBitmap).close();
    }
  }
}

type PhotoSteps = {
  steps: readonly { no: number; sub_steps: readonly { no: number }[] }[];
  photoPrefix: string;
};

/** Prepare only the photos used by this export, one at a time to bound decoded
 * image memory on phones. The saved photos stay at their editing resolution. */
export async function prepareExportPhotos(
  photos: PhotoMap | undefined,
  groups: readonly PhotoSteps[],
): Promise<PhotoMap> {
  const output: PhotoMap = {};
  if (!photos) return output;
  for (const { steps, photoPrefix } of groups) {
    for (const step of steps) {
      for (const no of [0, ...step.sub_steps.map((sub) => sub.no)]) {
        const key = photoPrefix + photoKey(step.no, no);
        const photo = photos[key];
        if (!photo || output[key]) continue;
        const source = await (await fetch(photo.data)).blob();
        output[key] = await resizePhoto(source, EXPORT_MAX_EDGE_PX, EXPORT_JPEG_QUALITY, photo);
      }
    }
  }
  return output;
}

type Decoded = ImageBitmap | HTMLImageElement;

/** createImageBitmap where available (faster, off the main thread, and it
 * applies EXIF orientation so phone photos aren't sideways); an <img> +
 * object URL otherwise. Also used by companyLogo.ts. */
export async function decode(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Fall through — some browsers reject the options bag, others the file
    }
  }

  const url = URL.createObjectURL(file);
  try {
    return await new Promise<Decoded>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () =>
        reject(new PhotoError("เปิดไฟล์รูปภาพไม่สำเร็จ ไฟล์อาจเสียหาย"));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The first FILE in a paste or drop (any type), or null if there wasn't one
 * at all — e.g. plain text pasted with no attachment. Left unfiltered by MIME
 * type so a dropped non-image still reaches fileToStepPhoto and gets a real
 * "not an image" message, rather than the zone silently doing nothing. */
export function fileFrom(
  source: DataTransfer | ClipboardEvent["clipboardData"],
): File | null {
  if (!source) return null;
  if (source.files.length) return source.files[0];
  // A screenshot pasted from the clipboard arrives as an item, not a file
  for (const item of Array.from(source.items ?? [])) {
    if (item.kind === "file") {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return null;
}
