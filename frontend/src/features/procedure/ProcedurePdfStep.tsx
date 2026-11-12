/* JSA + Procedure's last step, เอกสาร PDF: both documents of the job.
 *
 * By the time a user reaches this page they've reviewed both, so this is the
 * one place they get their files — the procedure and the JSA it was drafted
 * from, as two numbered files like Project Mode's own เอกสาร PDF page. Each
 * card is independent: two separate usePdfDelivery() calls, two separate
 * blobs, built in parallel as soon as this page mounts.
 *
 * The JSA's PdfStep and this page share PdfDeliveryCard for exactly that
 * reason — same blob lifecycle, same capability-routed save/share, same
 * "never <a download>" rule. Read usePdfDelivery's header before changing how
 * the buttons here behave.
 */

import { ArrowLeft, FilePlus2 } from "lucide-react";

import {
  docxFileName,
  pdfFileName,
  procedureDocxFileName,
  procedurePdfFileName,
} from "../../lib/pdf/fileName";
import { FALLBACK_DOCUMENT, FALLBACK_PROCEDURE } from "../../lib/pdf/layout";
import { formatThaiDate } from "../../lib/thaidate";
import type { CompanyLogo } from "../../lib/companyLogo";
import type { PhotoMap } from "../../lib/pdf/layout";
import type { JsaDocument, ProcedureDocument } from "../../lib/schema";
import { hazardCount as countHazards, subStepCount as countSubSteps } from "../../lib/schema";
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
  onNewJsa,
}: {
  procedure: ProcedureDocument;
  /** The JSA this procedure was generated from — always available here: a
   * procedure can only exist once its source JSA does (see App.tsx's
   * handleCreateProcedure guard). */
  doc: JsaDocument;
  /** Sub-step photos, keyed by photoKey(step.no, sub.no) — persisted in IndexedDB, see usePhotos.ts */
  photos: PhotoMap;
  /** The document's company logo (browser-only) — printed opposite the OR logo */
  companyLogo: CompanyLogo | null;
  config: PublicConfig | null;
  onBack: () => void;
  /** Same action as PdfStep's "สร้าง JSA ใหม่" */
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

  // The editable Word twins (lib/word/) — see the same note on PdfStep
  const procedureWord = usePdfDelivery({
    format: "docx",
    build: async () => {
      const { buildProcedureDocx } = await import("../../lib/word/buildProcedureDocx");
      return buildProcedureDocx(procedure, {
        layout: config?.pdf,
        document: config?.document,
        procedure: config?.procedure,
        company: config?.company,
        photos,
        companyLogo,
      });
    },
    fileName: procedureDocxFileName(procedure),
    deps: [procedure, photos, config, companyLogo],
    buildErrorMessage: "สร้างไฟล์ Word ไม่สำเร็จ กรุณาลองอีกครั้ง หรือใช้ไฟล์ PDF แทน",
  });

  const jsaWord = usePdfDelivery({
    format: "docx",
    build: async () => {
      const { buildJsaDocx } = await import("../../lib/word/buildJsaDocx");
      return buildJsaDocx(doc, {
        layout: config?.pdf,
        document: config?.document,
        company: config?.company,
        companyLogo,
      });
    },
    fileName: docxFileName(doc),
    deps: [doc, config, companyLogo],
    buildErrorMessage: "สร้างไฟล์ Word ไม่สำเร็จ กรุณาลองอีกครั้ง หรือใช้ไฟล์ PDF แทน",
  });

  const subStepCount = procedure.steps.reduce(
    (total, step) => total + step.sub_steps.length,
    0,
  );
  const hazardCount = countHazards(doc);

  return (
    <section>
      <h1 className="text-2xl font-semibold sm:text-[1.75rem] text-navy">เอกสาร PDF</h1>
      <p className="mt-1.5 text-muted">
        2 ไฟล์ แต่ละไฟล์เปิดเป็น PDF หรือดาวน์โหลดเป็น Word ได้
      </p>

      {/* Two equal files, numbered — the same as Project Mode's page. The
          kicker is what tells them apart: both titles are the same job. */}
      <PdfDeliveryCard
        className="mt-4"
        kicker="ไฟล์ 1 · ขั้นตอนปฏิบัติงาน (Work Procedure)"
        title={procedure.header.work_activity}
        summary={[
          { label: procedureLabels.author, value: procedure.header.analyst?.trim() || procedure.header.supervisor.trim() },
          { label: procedureLabels.date, value: formatThaiDate(procedure.header.analysis_date) },
          {
            label: "เนื้อหา",
            value: `${procedure.steps.length} ขั้นตอน · ${subStepCount} ขั้นตอนย่อย`,
          },
        ]}
        delivery={procedureDelivery}
        word={procedureWord}
      />

      <PdfDeliveryCard
        className="mt-4"
        kicker="ไฟล์ 2 · JSA"
        title={doc.header.work_activity}
        summary={[
          { label: labels.supervisor, value: doc.header.supervisor },
          { label: labels.analysis_date, value: formatThaiDate(doc.header.analysis_date) },
          { label: "เนื้อหา", value: `${doc.steps.length} ขั้นตอน${countSubSteps(doc) ? ` · ${countSubSteps(doc)} ขั้นตอนย่อย` : ""} · ${hazardCount} รายการอันตราย` },
        ]}
        delivery={jsaDelivery}
        word={jsaWord}
      />

      {/* The same two links as PdfStep's footer: back to the step before
          (the procedure), or a new job */}
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
