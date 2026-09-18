/* The work procedure document, built in the browser.
 *
 * The JSA's PdfStep and this page are near-identical by intent: same blob
 * lifecycle, same capability-routed save/share, same "never <a download>"
 * rule. All of that lives in usePdfDelivery — read its header before changing
 * how the buttons here behave.
 */

import { ArrowLeft, CircleCheck, FileText, LoaderCircle, Save, Share2 } from "lucide-react";

import { Alert, Button, Card } from "../../components/ui";
import { procedurePdfFileName } from "../../lib/pdf/fileName";
import { formatThaiDate } from "../../lib/thaidate";
import type { StepPhoto } from "../../lib/pdf/layout";
import type { ProcedureDocument } from "../../lib/schema";
import type { PublicConfig } from "../../lib/api";
import { usePdfDelivery } from "../pdf-view/usePdfDelivery";

export function ProcedurePdfStep({
  procedure,
  photos,
  config,
  onBack,
  onBackToJsa,
}: {
  procedure: ProcedureDocument;
  /** Step photos, keyed by step number — memory-only, see App.tsx */
  photos: Record<number, StepPhoto>;
  config: PublicConfig | null;
  onBack: () => void;
  onBackToJsa: () => void;
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

  const subStepCount = procedure.steps.reduce(
    (total, step) => total + step.sub_steps.length,
    0,
  );

  return (
    <section>
      {/* Above the H1, mirroring ProcedureEditorStep — this is the second
          document of two, so the way back to the first belongs where the eye
          starts, not only in the link row past the card. */}
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
              {procedure.header.work_activity}
            </h2>
            <dl className="mt-2 grid gap-1 text-sm">
              <div className="flex gap-1.5">
                <dt className="text-muted">หัวหน้างาน:</dt>
                <dd className="text-ink">{procedure.header.supervisor}</dd>
              </div>
              <div className="flex gap-1.5">
                <dt className="text-muted">วันที่จัดทำ:</dt>
                <dd className="text-ink">
                  {formatThaiDate(procedure.header.analysis_date)}
                </dd>
              </div>
              <div className="flex gap-1.5">
                <dt className="text-muted">เนื้อหา:</dt>
                <dd className="text-ink">
                  {procedure.steps.length} ขั้นตอน · {subStepCount} ขั้นตอนย่อย
                </dd>
              </div>
            </dl>
          </div>
        </div>

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

          {/* Exactly one of these two ever renders — see usePdfDelivery's
              header for why the picker is checked first */}
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

        {error ? (
          <div className="mt-3">
            <Alert>{error}</Alert>
          </div>
        ) : null}
      </Card>

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
