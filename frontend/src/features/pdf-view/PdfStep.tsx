/* Step 3 — PDF document (built in the browser)
 *
 * The PDF is built client-side with jsPDF — JSA content is never sent back
 * to the server at this stage, and the server needs no Chromium.
 *
 * On popups: the document is built as soon as this page is entered, and the
 * button is an <a target="_blank"> pointing at a blob URL that's already
 * ready — clicking a real link is never blocked as a popup (unlike
 * window.open called after an await, which mobile Safari will block).
 *
 * On iOS Safari specifically: a PDF opened from a blob: URL (as opposed to a
 * real network URL) renders without the native viewer's own toolbar — no
 * share/save icon at all, confirmed against a real device. There's no fix for
 * that view itself; the workaround is a second button, right here, that calls
 * the Web Share API directly with the file. That opens the OS share sheet
 * (Save to Files, AirDrop, Messages, ...) without depending on whatever
 * chrome the browser decided to draw around the blob.
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
import {
  ArrowLeft,
  CircleCheck,
  FilePlus2,
  FileText,
  LoaderCircle,
  Save,
  Share2,
} from "lucide-react";

import { Alert, Button, Card } from "../../components/ui";
import { pdfFileName } from "../../lib/pdf/fileName";
import { formatThaiDate } from "../../lib/thaidate";
import type { JsaDocument } from "../../lib/schema";
import type { PublicConfig } from "../../lib/api";

export function PdfStep({
  doc,
  config,
  onBack,
  onNewJsa,
}: {
  doc: JsaDocument;
  config: PublicConfig | null;
  onBack: () => void;
  onNewJsa: () => void;
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
        // Dynamic import: jsPDF drags in html2canvas + dompurify (~230KB) via
        // the .html() plugin, which we never use — load it only once this
        // page is actually reached, so users who haven't generated a JSA
        // don't pay for this weight for nothing.
        const { buildJsaPdf } = await import("../../lib/pdf/buildJsaPdf");
        const blob = await buildJsaPdf(doc, {
          layout: config?.pdf,
          document: config?.document,
          company: config?.company,
        });
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
        setFile(new File([blob], pdfFileName(doc), { type: "application/pdf" }));
      } catch {
        if (!cancelled) {
          setError(
            "สร้างไฟล์ PDF ไม่สำเร็จ ข้อมูล JSA ของคุณยังอยู่ครบ " +
              "กรุณากลับไปแก้ไขแล้วลองอีกครั้ง",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      // Release the blob's memory when leaving this page
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [doc, config]);

  const hazardCount = doc.steps.reduce(
    (total, step) => total + step.hazards.length,
    0,
  );

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
        suggestedName: pdfFileName(doc),
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
      await navigator.share({ files: [file], title: pdfFileName(doc) });
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

  return (
    <section>
      <h1 className="text-[1.75rem] font-semibold text-navy">เอกสาร JSA</h1>
      <p className="mt-1.5 text-muted">
        {savePickerSupported
          ? "กด “เปิดเอกสาร PDF” เพื่อดูหรือพิมพ์เอกสารในเบราว์เซอร์ หรือกด “บันทึกไฟล์” เพื่อเลือกที่จัดเก็บในเครื่อง"
          : "กดปุ่มด้านล่างเพื่อเปิดเอกสารในโปรแกรมอ่าน PDF ของเบราว์เซอร์ จากนั้นเลือกบันทึก พิมพ์ หรือแชร์ได้เองจากเมนูของเบราว์เซอร์"}
      </p>

      <Card className="mt-6">
        <div className="flex items-start gap-3">
          {url ? (
            <CircleCheck className="size-6 shrink-0 text-navy" aria-hidden="true" />
          ) : (
            <FileText className="size-6 shrink-0 text-muted" aria-hidden="true" />
          )}
          <div className="min-w-0">
            <h2 className="font-display font-semibold text-ink break-words">
              {doc.header.work_activity}
            </h2>
            <dl className="mt-2 grid gap-1 text-sm">
              <div className="flex gap-1.5">
                <dt className="text-muted">หัวหน้างาน:</dt>
                <dd className="text-ink">{doc.header.supervisor}</dd>
              </div>
              <div className="flex gap-1.5">
                <dt className="text-muted">วันที่วิเคราะห์:</dt>
                <dd className="text-ink">
                  {formatThaiDate(doc.header.analysis_date)}
                </dd>
              </div>
              <div className="flex gap-1.5">
                <dt className="text-muted">เนื้อหา:</dt>
                <dd className="text-ink">
                  {doc.steps.length} ขั้นตอน · {hazardCount} รายการอันตราย
                </dd>
              </div>
            </dl>
          </div>
        </div>

        {/* Open/save live inside the same card as the document they act on,
            not as a detached row below it — a divider (not a new Card) marks
            "info" from "actions" while keeping them one visual unit. Open PDF
            spans both columns when there's no save/share button to sit
            beside it, so this stays exactly one row either way. */}
        <div className="mt-4 grid grid-cols-2 gap-2 border-t border-line pt-4">
          {url ? (
            // ⚠️ Never add a `download` attribute here — it forces an
            // immediate download (on mobile Chrome this saves silently to
            // Downloads with no dialog at all), which violates the "no
            // auto-download" requirement. Let target="_blank" open the native
            // viewer instead, and let the user save/print/share from its menu.
            // The save button below is not a loophole in that rule: the file
            // picker always shows a dialog and always lets the user choose the
            // destination, which is exactly what `download` skips.
            // asChild merges Button's classes onto the real <a> below without
            // introducing a <button> or JS-mediated navigation — the anchor
            // must stay a real, directly-clickable link to avoid mobile
            // Safari's popup blocking.
            <Button
              asChild
              className={canSavePicker || canShareFile ? undefined : "col-span-2"}
            >
              <a href={url} target="_blank" rel="noopener">
                <FileText className="size-4" aria-hidden="true" />
                เปิดเอกสาร PDF
              </a>
            </Button>
          ) : (
            <Button disabled className="col-span-2">
              {error ? null : (
                <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              )}
              {error ? "สร้างเอกสารไม่สำเร็จ" : "กำลังสร้างเอกสาร…"}
            </Button>
          )}

          {/* Exactly one of these two ever renders — see the routing table in
              the file header. Both are explicit, user-chosen actions behind a
              dedicated button, never a silent auto-save. */}
          {canSavePicker ? (
            <Button variant="outline" onClick={handleSave} loading={saving}>
              <Save className="size-4" aria-hidden="true" />
              บันทึกไฟล์
            </Button>
          ) : canShareFile ? (
            <Button variant="outline" onClick={handleShare} loading={sharing}>
              <Share2 className="size-4" aria-hidden="true" />
              แชร์ / บันทึกไฟล์
            </Button>
          ) : null}
        </div>

        {/* Kept inside the card too — right under the action that would have
            produced it, rather than floating between the card and the
            back/new-JSA row below */}
        {error ? (
          <div className="mt-3">
            <Alert>{error}</Alert>
          </div>
        ) : null}
      </Card>

      {/* Text links, not buttons — these leave the page rather than act on
          the document, so they shouldn't carry the same visual weight as
          "เปิดเอกสาร PDF"/"บันทึกไฟล์" above (matches the ข้ามขั้นตอนนี้ link
          style already used on step 1). No confirm on either: กลับไปแก้ไข is
          just navigation, and by this point the document is already saved to
          the history list on step 1, so สร้าง JSA ใหม่ costs the user nothing
          they can't get back in one click. */}
      <div className="mt-5 flex items-center justify-center gap-4 text-sm">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 text-muted underline decoration-dotted underline-offset-4 hover:text-navy"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          กลับไปแก้ไข
        </button>
        <span className="text-line" aria-hidden="true">
          ·
        </span>
        <button
          type="button"
          onClick={onNewJsa}
          className="flex items-center gap-1 text-muted underline decoration-dotted underline-offset-4 hover:text-navy"
        >
          <FilePlus2 className="size-3.5" aria-hidden="true" />
          สร้าง JSA ใหม่
        </button>
      </div>
    </section>
  );
}
