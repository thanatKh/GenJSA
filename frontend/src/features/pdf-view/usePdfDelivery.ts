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

import { useEffect, useRef, useState } from "react";

// How long the success checkmark stays on the button before reverting to
// idle — long enough to register as a deliberate confirmation, short enough
// not to look stuck once the user's attention has moved on. Not tied to any
// --duration-* token: those are for a single transition's own animation
// length, not how long a whole state persists on screen (same category as
// UndoToast's 6s window elsewhere in the app, just shorter — this is a
// lower-stakes confirmation, not something to actively undo).
const SUCCESS_FLASH_MS = 2000;

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
  // Transient "it worked" flash on the save/share button itself (Button's
  // status="success", see components/ui/button.tsx) — before this there was
  // no visible confirmation at all once a save/share completed: the button
  // just reverted from spinner to plain idle, identical to how it looked
  // before the click was ever made. Cleared automatically after a couple
  // seconds rather than lingering, and just as important, cleared immediately
  // on the NEXT save/share attempt (see handleSave/handleShare below) so a
  // stale checkmark from a previous success never shows while a new attempt
  // is genuinely in flight.
  const [savedFlash, setSavedFlash] = useState(false);
  const [sharedFlash, setSharedFlash] = useState(false);
  const savedFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sharedFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup only — these timers just flip a boolean back to false, so a
  // stray one firing after unmount would be a no-op on an unmounted
  // component's state (React warns about exactly this), not a real bug.
  // Cleared anyway rather than relying on that being harmless forever.
  useEffect(() => {
    return () => {
      if (savedFlashTimer.current) clearTimeout(savedFlashTimer.current);
      if (sharedFlashTimer.current) clearTimeout(sharedFlashTimer.current);
    };
  }, []);

  // setUrl/setFile/setError right inside this effect reset state for a NEW
  // build; they don't feed back into `deps` (doc/photos/config), so this
  // can't become the setState-in-effect loop react-hooks/exhaustive-deps is
  // guarding against below — it only ever fires once per real deps change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    // Clear the previous build's URL/file immediately, not just on cleanup.
    // Cleanup already revokes the old objectUrl, but revoking it doesn't
    // touch `url` state — without this, `<a href={url}>` above kept pointing
    // at a blob that had just been revoked for the whole window between a
    // deps change (e.g. config finishing its async load) and this new
    // build() resolving, so a click there in that window opened
    // ERR_FILE_NOT_FOUND instead of either the old or the new PDF.
    setUrl(null);
    setFile(null);
    setError(null);

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
  //
  // Wrapped in try/catch: canShare({files}) is documented to throw rather
  // than return false in some browser builds (older Chromium, some in-app
  // WebViews, and non-secure http:// origins on a local LAN, where the File
  // System/Web Share APIs are restricted). This runs during render, with no
  // error boundary above it in this app, so an uncaught throw here would take
  // down the whole page instead of just hiding this one button.
  const canShareFile = (() => {
    if (!file || typeof navigator === "undefined") return false;
    try {
      return typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });
    } catch {
      return false;
    }
  })();

  const handleSave = async () => {
    if (!file || !window.showSaveFilePicker) return;
    setSaving(true);
    // A previous flash still showing when a new attempt starts would read as
    // "already done" while the picker is genuinely reopening — clear it
    // immediately rather than waiting for SUCCESS_FLASH_MS to catch up.
    setSavedFlash(false);
    if (savedFlashTimer.current) clearTimeout(savedFlashTimer.current);
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
      setSavedFlash(true);
      savedFlashTimer.current = setTimeout(() => setSavedFlash(false), SUCCESS_FLASH_MS);
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
    setSharedFlash(false);
    if (sharedFlashTimer.current) clearTimeout(sharedFlashTimer.current);
    try {
      // Called synchronously off the click, before any await, so the
      // browser's user-activation check (required to open the share sheet)
      // still sees this as a direct response to the tap.
      await navigator.share({ files: [file], title: fileName });
      setSharedFlash(true);
      sharedFlashTimer.current = setTimeout(() => setSharedFlash(false), SUCCESS_FLASH_MS);
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
    savedFlash,
    sharedFlash,
    handleSave,
    handleShare,
  };
}
