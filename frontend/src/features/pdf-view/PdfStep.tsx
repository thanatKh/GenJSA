/* Step 3 — PDF document (built in the browser)
 *
 * The PDF is built client-side with jsPDF — the JSA is never sent back to the
 * server to render it, and the server needs no Chromium.
 *
 * The blob lifecycle and the save/share capability routing live in
 * usePdfDelivery, shared with the work-procedure page. Its header explains the
 * popup-blocking and iOS-viewer constraints that shape both — read it before
 * changing how the buttons below behave.
 */

import {
  ArrowLeft,
  CircleCheck,
  FilePlus2,
  FileText,
  ListOrdered,
  LoaderCircle,
  Save,
  Share2,
} from "lucide-react";

import { Alert, Button, Card } from "../../components/ui";
import { pdfFileName } from "../../lib/pdf/fileName";
import { formatThaiDate } from "../../lib/thaidate";
import type { JsaDocument } from "../../lib/schema";
import type { PublicConfig } from "../../lib/api";
import { usePdfDelivery } from "./usePdfDelivery";

export function PdfStep({
  doc,
  config,
  onBack,
  onNewJsa,
  onCreateProcedure,
  procedureBusy,
  procedureError,
  hasProcedure,
}: {
  doc: JsaDocument;
  config: PublicConfig | null;
  onBack: () => void;
  onNewJsa: () => void;
  onCreateProcedure: () => void;
  procedureBusy: boolean;
  procedureError: string | null;
  /** A procedure already exists for this JSA — the action re-opens it */
  hasProcedure: boolean;
}) {
  const {
    url,
    error,
    savePickerSupported,
    canSavePicker,
    canShareFile,
    saving,
    sharing,
    handleSave,
    handleShare,
  } = usePdfDelivery({
    // Dynamic import: jsPDF drags in html2canvas + dompurify (~230KB) via
    // the .html() plugin, which we never use — load it only once this
    // page is actually reached, so users who haven't generated a JSA
    // don't pay for this weight for nothing.
    build: async () => {
      const { buildJsaPdf } = await import("../../lib/pdf/buildJsaPdf");
      return buildJsaPdf(doc, {
        layout: config?.pdf,
        document: config?.document,
        company: config?.company,
      });
    },
    fileName: pdfFileName(doc),
    deps: [doc, config],
    buildErrorMessage:
      "สร้างไฟล์ PDF ไม่สำเร็จ ข้อมูล JSA ของคุณยังอยู่ครบ " +
      "กรุณากลับไปแก้ไขแล้วลองอีกครั้ง",
  });

  const hazardCount = doc.steps.reduce(
    (total, step) => total + step.hazards.length,
    0,
  );

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

      {/* A card, not a text link beside "กลับไปแก้ไข" below — this starts an
          AI generation with a real cost and a wait, so it shouldn't carry the
          same weight as plain navigation. Its own card also keeps it clearly
          separate from the JSA actions above: this produces a second,
          different document rather than another view of this one. */}
      <Card className="mt-4">
        <div className="flex items-start gap-3">
          <ListOrdered className="size-6 shrink-0 text-muted" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="font-display font-semibold text-ink">ขั้นตอนปฏิบัติงาน</h2>
            <p className="mt-1 text-sm text-muted">
              {hasProcedure
                ? "คุณสร้างขั้นตอนปฏิบัติงานจาก JSA นี้ไว้แล้ว เปิดเพื่อตรวจทานหรือสร้างเอกสาร"
                : "ขยายแต่ละขั้นตอนใน JSA นี้เป็นวิธีปฏิบัติงานอย่างละเอียด สำหรับใช้หน้างานจริง"}
            </p>
          </div>
        </div>

        <div className="mt-4 border-t border-line pt-4">
          <Button
            variant="outline"
            onClick={onCreateProcedure}
            loading={procedureBusy}
            className="w-full"
          >
            <ListOrdered className="size-4" aria-hidden="true" />
            {hasProcedure ? "เปิดขั้นตอนปฏิบัติงาน" : "สร้างขั้นตอนปฏิบัติงาน"}
          </Button>
        </div>

        {procedureError ? (
          <div className="mt-3">
            <Alert>{procedureError}</Alert>
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
