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

import { ArrowLeft, FilePlus2, ListOrdered } from "lucide-react";

import { Alert, Button, Card } from "../../components/ui";
import { pdfFileName } from "../../lib/pdf/fileName";
import { FALLBACK_DOCUMENT } from "../../lib/pdf/layout";
import { formatThaiDate } from "../../lib/thaidate";
import type { CompanyLogo } from "../../lib/companyLogo";
import type { JsaDocument } from "../../lib/schema";
import type { PublicConfig } from "../../lib/api";
import { PdfDeliveryCard } from "./PdfDeliveryCard";
import { usePdfDelivery } from "./usePdfDelivery";

export function PdfStep({
  doc,
  companyLogo,
  config,
  onBack,
  onNewJsa,
  onCreateProcedure,
  procedureBusy,
  procedureError,
  hasProcedure,
}: {
  doc: JsaDocument;
  /** The document's company logo (browser-only) — printed opposite the OR logo */
  companyLogo: CompanyLogo | null;
  config: PublicConfig | null;
  onBack: () => void;
  onNewJsa: () => void;
  onCreateProcedure: () => void;
  procedureBusy: boolean;
  procedureError: string | null;
  /** A procedure already exists for this JSA — the action re-opens it */
  hasProcedure: boolean;
}) {
  // Same wording as the printed PDF (config/document.yaml)
  const labels = (config?.document ?? FALLBACK_DOCUMENT).labels;
  const delivery = usePdfDelivery({
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
        companyLogo,
      });
    },
    fileName: pdfFileName(doc),
    deps: [doc, config, companyLogo],
    buildErrorMessage:
      "สร้างไฟล์ PDF ไม่สำเร็จ ข้อมูล JSA ยังอยู่ครบ " +
      "กรุณากลับไปแก้ไขแล้วลองอีกครั้ง",
  });

  const hazardCount = doc.steps.reduce(
    (total, step) => total + step.hazards.length,
    0,
  );

  return (
    <section>
      <h1 className="text-2xl font-semibold sm:text-[1.75rem] text-navy">เอกสาร JSA</h1>
      <p className="mt-1.5 text-muted">
        {delivery.savePickerSupported
          ? "กด “เปิดเอกสาร PDF” เพื่อดูหรือพิมพ์เอกสารในเบราว์เซอร์ หรือกด “บันทึกไฟล์” เพื่อเลือกที่จัดเก็บในเครื่อง"
          : "กดปุ่มด้านล่างเพื่อเปิดเอกสารในโปรแกรมอ่าน PDF ของเบราว์เซอร์ จากนั้นเลือกบันทึก พิมพ์ หรือแชร์ได้เองจากเมนูของเบราว์เซอร์"}
      </p>

      <PdfDeliveryCard
        className="mt-6"
        title={doc.header.work_activity}
        summary={[
          { label: labels.supervisor, value: doc.header.supervisor },
          { label: labels.analysis_date, value: formatThaiDate(doc.header.analysis_date) },
          { label: "เนื้อหา", value: `${doc.steps.length} ขั้นตอน · ${hazardCount} รายการอันตราย` },
        ]}
        delivery={delivery}
      />

      {/* A card, not a text link beside "กลับไปแก้ไข" below — this starts an
          AI generation with a real cost and a wait, so it shouldn't carry the
          same weight as plain navigation. Its own card also keeps it clearly
          separate from the JSA actions above: this produces a second,
          different document rather than another view of this one. */}
      <Card className="mt-4">
        {/* Icon in a navy tile, the same as the "สร้างขั้นตอนปฏิบัติงานด้วย"
            card on step 1 — one look for "the procedure" wherever it's
            offered, instead of a muted gray icon that read as decoration */}
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-navy-soft text-navy">
            <ListOrdered className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold text-ink">
              ขั้นตอนปฏิบัติงาน (Work Procedure)
            </h2>
            <p className="mt-1 text-sm text-muted">
              {hasProcedure
                ? "สร้างขั้นตอนปฏิบัติงานจาก JSA นี้ไว้แล้ว เปิดเพื่อตรวจทานหรือสร้างเอกสาร"
                : "ขยายแต่ละขั้นตอนใน JSA นี้เป็นวิธีทำงานทีละขั้นสำหรับใช้หน้างาน แนบรูปภาพประกอบได้"}
            </p>
          </div>
        </div>

        <div className="mt-4 border-t border-line pt-4">
          {/* Always outline, even when the procedure already exists: as a
              full-width solid button it outweighed the half-width "เปิดเอกสาร
              PDF" above — the one action this page exists for. The JSA PDF
              keeps the only solid button; this stays clearly second. */}
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
