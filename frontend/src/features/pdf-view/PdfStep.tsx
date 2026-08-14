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
 */

import { useEffect, useState } from "react";
import {
  ArrowLeft,
  CircleCheck,
  FilePlus2,
  FileText,
  LoaderCircle,
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

  // Feature-detect rather than sniff the platform — canShare({files}) is
  // false on desktop browsers and on the older Safari/Chrome versions that
  // support navigator.share for text/links only, so this only surfaces where
  // it actually works (iOS Safari 15+, most mobile Chrome).
  const canShareFile =
    !!file &&
    typeof navigator !== "undefined" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [file] });

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
        กดปุ่มด้านล่างเพื่อเปิดเอกสารในโปรแกรมอ่าน PDF ของเบราว์เซอร์
        จากนั้นเลือกบันทึก พิมพ์ หรือแชร์ได้เองจากเมนูของเบราว์เซอร์
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
      </Card>

      {error ? (
        <div className="mt-5">
          <Alert>{error}</Alert>
        </div>
      ) : null}

      {/* A single 2-column grid, two rows: "do something with this PDF" on
          top, "leave this page" below — same visual weight throughout
          instead of mixing lg/default sizes across a tall stacked column.
          Open PDF spans both columns when Share isn't offered, so the grid
          stays exactly two rows either way. */}
      <div className="mt-5 grid grid-cols-2 gap-2">
        {url ? (
          // ⚠️ Never add a `download` attribute here — it forces an
          // immediate download (on mobile Chrome this saves silently to
          // Downloads with no dialog at all), which violates the "no
          // auto-download" requirement. Let target="_blank" open the native
          // viewer instead, and let the user save/print/share from its menu.
          // asChild merges Button's classes onto the real <a> below without
          // introducing a <button> or JS-mediated navigation — the anchor
          // must stay a real, directly-clickable link to avoid mobile
          // Safari's popup blocking.
          <Button asChild className={canShareFile ? undefined : "col-span-2"}>
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

        {/* Only rendered where navigator.canShare({files}) actually works —
            mainly iOS Safari, where the blob PDF view above has no save/share
            icon of its own (see the file header comment). Calls the OS share
            sheet directly instead of a `download` attribute: it's an explicit,
            user-chosen action via a dedicated button, not a silent auto-save,
            so it doesn't run into the "no auto-download" concern noted below. */}
        {canShareFile ? (
          <Button variant="outline" onClick={handleShare} loading={sharing}>
            <Share2 className="size-4" aria-hidden="true" />
            แชร์ / บันทึกไฟล์
          </Button>
        ) : null}

        {/* No confirm here, unlike EditorStep's "เริ่มใหม่": by this point the
            document is already saved to the history list on step 1, so starting
            a new JSA costs the user nothing they can't get back in one click. */}
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          กลับไปแก้ไข
        </Button>
        <Button variant="outline" onClick={onNewJsa}>
          <FilePlus2 className="size-4" aria-hidden="true" />
          สร้าง JSA ใหม่
        </Button>
      </div>

      {canShareFile ? (
        <p className="mt-2 text-center text-sm text-muted">
          ใช้ปุ่ม "แชร์ / บันทึกไฟล์" หากหน้าเอกสาร PDF ที่เปิดไม่มีปุ่มบันทึกหรือแชร์ในตัว
        </p>
      ) : null}
    </section>
  );
}
