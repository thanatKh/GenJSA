/* Step 3 — PDF document (built in the browser)
 *
 * The PDF is built client-side with jsPDF — JSA content is never sent back
 * to the server at this stage, and the server needs no Chromium.
 *
 * On popups: the document is built as soon as this page is entered, and the
 * button is an <a target="_blank"> pointing at a blob URL that's already
 * ready — clicking a real link is never blocked as a popup (unlike
 * window.open called after an await, which mobile Safari will block).
 */

import { useEffect, useState } from "react";
import { ArrowLeft, CircleCheck, FileText, LoaderCircle } from "lucide-react";

import { Alert, Button, Card } from "../../components/ui";
import { formatThaiDate } from "../../lib/thaidate";
import type { JsaDocument } from "../../lib/schema";
import type { PublicConfig } from "../../lib/api";

export function PdfStep({
  doc,
  config,
  onBack,
}: {
  doc: JsaDocument;
  config: PublicConfig | null;
  onBack: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

      <div className="mt-5 grid gap-2">
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
          <Button asChild size="lg">
            <a href={url} target="_blank" rel="noopener">
              <FileText className="size-5" aria-hidden="true" />
              เปิดเอกสาร PDF
            </a>
          </Button>
        ) : (
          <Button size="lg" disabled>
            {error ? null : (
              <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
            )}
            {error ? "สร้างเอกสารไม่สำเร็จ" : "กำลังสร้างเอกสาร…"}
          </Button>
        )}

        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          กลับไปแก้ไข
        </Button>
      </div>
    </section>
  );
}
