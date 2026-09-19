/* The work procedure document, built in the browser.
 *
 * By the time a user reaches this page they're done with both documents, so
 * this offers both PDFs — the procedure and the JSA it was generated from —
 * rather than making JSA download a detour back through onBackToJsa. Each
 * card is independent: two separate usePdfDelivery() calls, two separate
 * blobs, built in parallel as soon as this page mounts.
 *
 * The JSA's PdfStep and this page share PdfDeliveryCard for exactly that
 * reason — same blob lifecycle, same capability-routed save/share, same
 * "never <a download>" rule. Read usePdfDelivery's header before changing how
 * the buttons here behave.
 */

import { ArrowLeft } from "lucide-react";

import { pdfFileName, procedurePdfFileName } from "../../lib/pdf/fileName";
import { formatThaiDate } from "../../lib/thaidate";
import type { StepPhoto } from "../../lib/pdf/layout";
import type { JsaDocument, ProcedureDocument } from "../../lib/schema";
import type { PublicConfig } from "../../lib/api";
import { PdfDeliveryCard } from "../pdf-view/PdfDeliveryCard";
import { usePdfDelivery } from "../pdf-view/usePdfDelivery";

export function ProcedurePdfStep({
  procedure,
  doc,
  photos,
  config,
  onBack,
  onBackToJsa,
}: {
  procedure: ProcedureDocument;
  /** The JSA this procedure was generated from — always available here: a
   * procedure can only exist once its source JSA does (see App.tsx's
   * handleCreateProcedure guard). Its own PDF is offered on this page too, so
   * finishing the procedure doesn't mean detouring back through onBackToJsa
   * just to download the JSA. */
  doc: JsaDocument;
  /** Step photos, keyed by step number — memory-only, see App.tsx */
  photos: Record<number, StepPhoto>;
  config: PublicConfig | null;
  onBack: () => void;
  onBackToJsa: () => void;
}) {
  const procedureDelivery = usePdfDelivery({
    build: async () => {
      const { buildProcedurePdf } = await import("../../lib/pdf/buildProcedurePdf");
      return buildProcedurePdf(procedure, {
        layout: config?.pdf,
        document: config?.document,
        procedure: config?.procedure,
        company: config?.company,
        photos,
      });
    },
    fileName: procedurePdfFileName(procedure),
    deps: [procedure, photos, config],
    buildErrorMessage:
      "สร้างไฟล์ PDF ไม่สำเร็จ ข้อมูลขั้นตอนปฏิบัติงานของคุณยังอยู่ครบ " +
      "กรุณากลับไปแก้ไขแล้วลองอีกครั้ง",
  });

  // Same build this JSA's own PdfStep uses — see the dynamic-import note
  // there for why buildJsaPdf is loaded lazily rather than imported eagerly.
  const jsaDelivery = usePdfDelivery({
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

  const subStepCount = procedure.steps.reduce(
    (total, step) => total + step.sub_steps.length,
    0,
  );
  const hazardCount = doc.steps.reduce(
    (total, step) => total + step.hazards.length,
    0,
  );

  return (
    <section>
      {/* Above the H1, mirroring ProcedureEditorStep — this is the second
          document of two, so the way back to the first belongs where the eye
          starts, not only in the link row past the cards. */}
      <button
        type="button"
        onClick={onBackToJsa}
        className="mb-3 flex items-center gap-1 text-sm text-muted hover:text-navy"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        กลับไปหน้าเอกสาร JSA
      </button>

      <h1 className="text-[1.75rem] font-semibold text-navy">เอกสารขั้นตอนปฏิบัติงาน</h1>
      <p className="mt-1.5 text-muted">
        {procedureDelivery.savePickerSupported
          ? "กด “เปิดเอกสาร PDF” เพื่อดูหรือพิมพ์เอกสารในเบราว์เซอร์ หรือกด “บันทึกไฟล์” เพื่อเลือกที่จัดเก็บในเครื่อง"
          : "กดปุ่มด้านล่างเพื่อเปิดเอกสารในโปรแกรมอ่าน PDF ของเบราว์เซอร์ จากนั้นเลือกบันทึก พิมพ์ หรือแชร์ได้เองจากเมนูของเบราว์เซอร์"}
      </p>

      <PdfDeliveryCard
        className="mt-6"
        kicker="เอกสารขั้นตอนปฏิบัติงาน"
        title={procedure.header.work_activity}
        summary={[
          { label: "หัวหน้างาน", value: procedure.header.supervisor },
          { label: "วันที่จัดทำ", value: formatThaiDate(procedure.header.analysis_date) },
          {
            label: "เนื้อหา",
            value: `${procedure.steps.length} ขั้นตอน · ${subStepCount} ขั้นตอนย่อย`,
          },
        ]}
        delivery={procedureDelivery}
      />

      {/* The JSA this procedure came from, offered here too — by this point
          the user has finished both documents, and having only the procedure
          downloadable on the final screen meant a detour back through
          "กลับไปหน้าเอกสาร JSA" just to get the JSA's own PDF. Its own card,
          not folded into the one above: they're two separate files with two
          separate blobs. Both cards' titles read identically (same job, same
          work_activity), so the kicker is what actually tells them apart at
          a glance rather than relying on the metadata rows alone. */}
      <PdfDeliveryCard
        className="mt-4"
        kicker="เอกสาร JSA"
        title={doc.header.work_activity}
        summary={[
          { label: "หัวหน้างาน", value: doc.header.supervisor },
          { label: "วันที่วิเคราะห์", value: formatThaiDate(doc.header.analysis_date) },
          { label: "เนื้อหา", value: `${doc.steps.length} ขั้นตอน · ${hazardCount} รายการอันตราย` },
        ]}
        delivery={jsaDelivery}
      />

      {/* Only "กลับไปแก้ไข" here — the way back to the JSA moved above the H1,
          and having it in both places put the same destination on screen twice. */}
      <div className="mt-5 flex items-center justify-center gap-4 text-sm">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 text-muted underline decoration-dotted underline-offset-4 hover:text-navy"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          กลับไปแก้ไข
        </button>
      </div>
    </section>
  );
}
