/* Build a PDF in the browser and hand it to the user — blob lifecycle plus
 * capability routing, shared by the JSA and work-procedure document pages.
 *
 * Every rule below is a fix for something that actually broke. Re-implementing
 * this inline for a new document type will quietly reintroduce them:
 *
 * On popups: the document is built as soon as the page is entered, not on
 * click, so the open button can be an <a target="_blank"> pointing at a blob
 * URL that's already ready — clicking a real link is never blocked as a popup
 * (unlike window.open called after an await, which mobile Safari will block).
 *
 * On iOS Safari specifically: a PDF opened from a blob: URL (as opposed to a
 * real network URL) renders without the native viewer's own toolbar — no
 * share/save icon at all, confirmed against a real device. There's no fix for
 * that view itself; the workaround is a second button that calls the Web Share
 * API directly with the file. That opens the OS share sheet (Save to Files,
 * AirDrop, Messages, ...) without depending on whatever chrome the browser
 * decided to draw around the blob.
 *
 * That second button is capability-routed rather than one-size-fits-all,
 * because desktop Chromium satisfies canShare({files}) too — and there the
 * share sheet is the wrong answer entirely (on Windows 11 it opens the OS
 * share flyout when all the user wanted was the file on disk). So:
 *
 *   showSaveFilePicker  -> "บันทึกไฟล์", a real Save-as dialog   (desktop Chromium)
 *   canShare({files})   -> "แชร์ / บันทึกไฟล์", the OS share sheet (mobile)
 *   neither             -> no second button                       (desktop FF/Safari)
 *
 * The picker is checked first precisely because desktop matches both; it is
 * absent on Android Chrome and iOS Safari, so mobile still lands on share.
 */

import { useEffect, useState } from "react";

export function usePdfDelivery({
  build,
  fileName,
  deps,
  buildErrorMessage,
}: {
  /** Produces the PDF. Called once per change in `deps`. */
  build: () => Promise<Blob>;
  /** Suggested name for the save dialog and the share sheet */
  fileName: string;
  deps: unknown[];
  buildErrorMessage: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    void (async () => {
      try {
        const blob = await build();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
        setFile(new File([blob], fileName, { type: "application/pdf" }));
      } catch {
        if (!cancelled) setError(buildErrorMessage);
      }
    })();

    return () => {
      cancelled = true;
      // Release the blob's memory when leaving this page
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // Split from canSavePicker below on purpose: this is a pure browser
  // capability check with no dependency on `file`, so it's the same on the
  // very first render as it is once the PDF finishes building — used only
  // for the paragraph text, so that text never flips (and reflows the page
  // under the user) the moment the build completes.
  const savePickerSupported =
    typeof window !== "undefined" && "showSaveFilePicker" in window;

  // Feature-detect rather than sniff the platform. Chromium desktop only —
  // deliberately checked before canShareFile below (see the file header).
  const canSavePicker = !!file && savePickerSupported;

  // canShare({files}) is false on the older Safari/Chrome versions that
  // support navigator.share for text/links only, so this only surfaces where
  // it actually works (iOS Safari 15+, most mobile Chrome).
  const canShareFile =
    !!file &&
    typeof navigator !== "undefined" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [file] });

  const handleSave = async () => {
    if (!file || !window.showSaveFilePicker) return;
    setSaving(true);
    try {
      // Opened before any await, for the same user-activation reason as
      // handleShare below. The dialog is the whole point: unlike an <a
      // download>, the file only lands where the user chose to put it, under
      // the name they confirmed.
      const handle = await window.showSaveFilePicker({
        suggestedName: fileName,
        types: [
          {
            description: "เอกสาร PDF",
            accept: { "application/pdf": [".pdf"] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(file);
      await writable.close();
    } catch (caught) {
      // AbortError = the user pressed Cancel, which is a normal outcome
      if (!(caught instanceof Error && caught.name === "AbortError")) {
        setError(
          "บันทึกไฟล์ไม่สำเร็จ ลองใหม่อีกครั้ง หรือใช้ปุ่ม \"เปิดเอกสาร PDF\" ด้านบนแทน",
        );
      }
    } finally {
      setSaving(false);
    }
  };

  const handleShare = async () => {
    if (!file) return;
    setSharing(true);
    try {
      // Called synchronously off the click, before any await, so the
      // browser's user-activation check (required to open the share sheet)
      // still sees this as a direct response to the tap.
      await navigator.share({ files: [file], title: fileName });
    } catch (caught) {
      // AbortError = the user closed the share sheet without picking
      // anything — that's a normal outcome, not a failure to report
      if (!(caught instanceof Error && caught.name === "AbortError")) {
        setError(
          "แชร์ไฟล์ไม่สำเร็จ ลองใหม่อีกครั้ง หรือใช้ปุ่ม \"เปิดเอกสาร PDF\" ด้านบนแทน",
        );
      }
    } finally {
      setSharing(false);
    }
  };

  return {
    url,
    file,
    error,
    setError,
    savePickerSupported,
    canSavePicker,
    canShareFile,
    saving,
    sharing,
    handleSave,
    handleShare,
  };
}
