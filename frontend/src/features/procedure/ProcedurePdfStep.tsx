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

import { ArrowLeft, FilePlus2 } from "lucide-react";

import { pdfFileName, procedurePdfFileName } from "../../lib/pdf/fileName";
import { FALLBACK_DOCUMENT, FALLBACK_PROCEDURE } from "../../lib/pdf/layout";
import { formatThaiDate } from "../../lib/thaidate";
import type { CompanyLogo } from "../../lib/companyLogo";
import type { PhotoMap } from "../../lib/pdf/layout";
import type { JsaDocument, ProcedureDocument } from "../../lib/schema";
import type { PublicConfig } from "../../lib/api";
import { PdfDeliveryCard } from "../pdf-view/PdfDeliveryCard";
import { usePdfDelivery } from "../pdf-view/usePdfDelivery";

export function ProcedurePdfStep({
  procedure,
  doc,
  photos,
  companyLogo,
  config,
  onBack,
  onBackToJsa,
  onNewJsa,
}: {
  procedure: ProcedureDocument;
  /** The JSA this procedure was generated from — always available here: a
   * procedure can only exist once its source JSA does (see App.tsx's
   * handleCreateProcedure guard). Its own PDF is offered on this page too, so
   * finishing the procedure doesn't mean detouring back through onBackToJsa
   * just to download the JSA. */
  doc: JsaDocument;
  /** Sub-step photos, keyed by photoKey(step.no, sub.no) — persisted in IndexedDB, see usePhotos.ts */
  photos: PhotoMap;
  /** The document's company logo (browser-only) — printed opposite the OR logo */
  companyLogo: CompanyLogo | null;
  config: PublicConfig | null;
  onBack: () => void;
  onBackToJsa: () => void;
  /** Same action as PdfStep's "สร้าง JSA ใหม่" — this was the one page in the
   * two-document flow missing it, leaving no way out but the header logo or
   * several taps back through กลับไปแก้ไข / กลับไปหน้าเอกสาร JSA. */
  onNewJsa: () => void;
}) {
  // Same wording as the printed PDFs (config/document.yaml, config/procedure.yaml)
  const labels = (config?.document ?? FALLBACK_DOCUMENT).labels;
  const procedureLabels = (config?.procedure ?? FALLBACK_PROCEDURE).labels;
  const procedureDelivery = usePdfDelivery({
    build: async () => {
      const { buildProcedurePdf } = await import("../../lib/pdf/buildProcedurePdf");
      return buildProcedurePdf(procedure, {
        layout: config?.pdf,
        document: config?.document,
        procedure: config?.procedure,
        company: config?.company,
        photos,
        companyLogo,
      });
    },
    fileName: procedurePdfFileName(procedure),
    deps: [procedure, photos, config, companyLogo],
    buildErrorMessage:
      "สร้างไฟล์ PDF ไม่สำเร็จ ข้อมูลขั้นตอนปฏิบัติงานยังอยู่ครบ " +
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
        companyLogo,
      });
    },
    fileName: pdfFileName(doc),
    deps: [doc, config, companyLogo],
    buildErrorMessage:
      "สร้างไฟล์ PDF ไม่สำเร็จ ข้อมูล JSA ยังอยู่ครบ " +
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
      {/* Above the H1 — this is the second document of two, so the way back
          to the first belongs where the eye starts, not only in the link row
          past the cards. (The procedure editor doesn't repeat this: its fixed
          bottom bar already carries the same action.) */}
      <button
        type="button"
        onClick={onBackToJsa}
        className="mb-3 flex items-center gap-1 text-sm text-muted hover:text-navy"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        กลับไปหน้าเอกสาร JSA
      </button>

      <h1 className="text-2xl font-semibold sm:text-[1.75rem] text-navy">
        เอกสารขั้นตอนปฏิบัติงาน (Work Procedure)
      </h1>
      <p className="mt-1.5 text-muted">
        {procedureDelivery.savePickerSupported
          ? "กด “เปิดเอกสาร PDF” เพื่อดูหรือพิมพ์เอกสารในเบราว์เซอร์ หรือกด “บันทึกไฟล์” เพื่อเลือกที่จัดเก็บในเครื่อง"
          : "กดปุ่มด้านล่างเพื่อเปิดเอกสารในโปรแกรมอ่าน PDF ของเบราว์เซอร์ จากนั้นเลือกบันทึก พิมพ์ หรือแชร์ได้เองจากเมนูของเบราว์เซอร์"}
      </p>

      {/* The procedure first — it's what this page is about. It used to come
          second, after the JSA, with identical solid buttons on both cards,
          so nothing said which document was the point of the page. */}
      <PdfDeliveryCard
        className="mt-6"
        kicker="เอกสารขั้นตอนปฏิบัติงาน (Work Procedure)"
        title={procedure.header.work_activity}
        summary={[
          { label: labels.supervisor, value: procedure.header.supervisor },
          { label: procedureLabels.date, value: formatThaiDate(procedure.header.analysis_date) },
          {
            label: "เนื้อหา",
            value: `${procedure.steps.length} ขั้นตอน · ${subStepCount} ขั้นตอนย่อย`,
          },
        ]}
        delivery={procedureDelivery}
      />

      {/* The JSA second, as a supporting document: outline buttons, so the
          procedure above keeps the page's only solid button. Its own card,
          not folded into the procedure's: two separate files with two
          separate blobs. Both titles read identically (same job), so the
          kicker is what tells them apart at a glance. */}
      <PdfDeliveryCard
        className="mt-4"
        secondary
        kicker="เอกสาร JSA"
        title={doc.header.work_activity}
        summary={[
          { label: labels.supervisor, value: doc.header.supervisor },
          { label: labels.analysis_date, value: formatThaiDate(doc.header.analysis_date) },
          { label: "เนื้อหา", value: `${doc.steps.length} ขั้นตอน · ${hazardCount} รายการอันตราย` },
        ]}
        delivery={jsaDelivery}
      />

      {/* กลับไปแก้ไข plus สร้าง JSA ใหม่ — the way back to the JSA itself moved
          above the H1, so this row only needs the two actions PdfStep's own
          footer has, not a third repeating that link. Without สร้าง JSA ใหม่
          here, this was the one page in the whole two-document flow with no
          way to start over except the header logo. */}
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
