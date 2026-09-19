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
import { formatThaiDate } from "../../lib/thaidate";
import type { JsaDocument } from "../../lib/schema";
import type { PublicConfig } from "../../lib/api";
import { PdfDeliveryCard } from "./PdfDeliveryCard";
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
        {delivery.savePickerSupported
          ? "กด “เปิดเอกสาร PDF” เพื่อดูหรือพิมพ์เอกสารในเบราว์เซอร์ หรือกด “บันทึกไฟล์” เพื่อเลือกที่จัดเก็บในเครื่อง"
          : "กดปุ่มด้านล่างเพื่อเปิดเอกสารในโปรแกรมอ่าน PDF ของเบราว์เซอร์ จากนั้นเลือกบันทึก พิมพ์ หรือแชร์ได้เองจากเมนูของเบราว์เซอร์"}
      </p>
      {/* Names the second document before the user scrolls — the card that
          offers it sits a full card below, and a reader who stops at the PDF
          button never learns it exists. Deliberately a plain sentence, not a
          banner: the procedure is optional and most users stop here. */}
      <p className="mt-1.5 text-sm text-muted">
        {hasProcedure
          ? "เอกสารนี้มี “ขั้นตอนปฏิบัติงาน” ที่สร้างไว้แล้ว เปิดดูได้จากด้านล่าง"
          : "หากต้องการเอกสารวิธีทำงานอย่างละเอียดสำหรับใช้หน้างาน สร้าง “ขั้นตอนปฏิบัติงาน” ได้จากด้านล่าง"}
      </p>

      <PdfDeliveryCard
        className="mt-6"
        title={doc.header.work_activity}
        summary={[
          { label: "หัวหน้างาน", value: doc.header.supervisor },
          { label: "วันที่วิเคราะห์", value: formatThaiDate(doc.header.analysis_date) },
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
          {/* Primary weight only when the procedure already exists: that's
              navigation back to something the user already invested in. While
              it doesn't, it stays outline — a primary button costing an AI call
              and a 30s+ wait would read as a required next step, and the JSA
              PDF above must keep its place as the answer to "I came here to
              make a JSA". */}
          <Button
            variant={hasProcedure ? "default" : "outline"}
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
