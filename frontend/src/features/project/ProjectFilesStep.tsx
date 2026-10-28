/* Project Mode, step 4 — ไฟล์ที่ส่ง
 *
 * What a big job is submitted as: two files, each as PDF and Word.
 *   1. The project's work procedure — one document, phases as sections
 *      numbered by phase (buildProcedurePdf / buildProcedureDocx with their
 *      `project` option).
 *   2. Every phase's JSA in one file, a cover with the contents first
 *      (buildProjectJsaPdf / buildProjectJsaDocx).
 * Same PdfDeliveryCard + usePdfDelivery as the Single Mode PDF pages — read
 * usePdfDelivery's header before changing how these buttons behave.
 */

import { useMemo } from "react";
import { ArrowLeft, TriangleAlert } from "lucide-react";

import type { PublicConfig } from "../../lib/api";
import type { CompanyLogo } from "../../lib/companyLogo";
import { procedureDocxFileName, procedurePdfFileName, projectJsaDocxFileName, projectJsaPdfFileName } from "../../lib/pdf/fileName";
import { FALLBACK_DOCUMENT, type PhotoMap } from "../../lib/pdf/layout";
import type { JsaDocument, ProcedureDocument, ProjectDocument } from "../../lib/schema";
import { formatThaiDate, todayIso } from "../../lib/thaidate";
import { PdfDeliveryCard } from "../pdf-view/PdfDeliveryCard";
import { usePdfDelivery } from "../pdf-view/usePdfDelivery";
import { sectionStale } from "./projectModel";

export function ProjectFilesStep({
  project,
  config,
  companyLogo,
  photos,
  onBack,
}: {
  project: ProjectDocument;
  /** Sub-step photos, keyed as ProjectProcedureStep stores them */
  photos: PhotoMap;
  config: PublicConfig | null;
  companyLogo: CompanyLogo | null;
  onBack: () => void;
}) {
  const labels = config?.document.labels ?? FALLBACK_DOCUMENT.labels;

  // Built once per project change, so the four deliveries' deps are stable
  const files = useMemo(() => {
    const jsas = project.phases.map((phase) => phase.jsa).filter((jsa): jsa is JsaDocument => !!jsa);
    // The project's date: its first JSA's, so the two files carry the same one
    const date = jsas[0]?.header.analysis_date ?? todayIso();
    const intro = project.procedureIntro;
    // The procedure's header and opening sections; its steps come from `layout`
    const procedure: ProcedureDocument = {
      header: {
        work_activity: project.name.trim(),
        supervisor: project.supervisor,
        analyst: project.analyst,
        company: project.company,
        project: "",
        analysis_date: date,
      },
      purpose: intro?.purpose ?? "",
      scope: intro?.scope ?? "",
      // Built from the project, never by the system — the JSAs this procedure comes from
      references: project.phases.map((phase, i) => `JSA ${i + 1}: ${phase.work}`),
      tools: intro?.tools ?? [],
      steps: [],
      assumptions: [],
    };
    const layout = {
      phases: project.phases.map((phase) => ({
        title: phase.work,
        steps: phase.procedure?.steps ?? [],
        photoPrefix: `${phase.id}:`,
      })),
      notes: project.notes,
      references: project.references.filter((ref) => ref.tag.trim()),
    };
    const cover = { name: project.name.trim(), supervisor: project.supervisor, company: project.company, date };
    return { jsas, procedure, layout, cover };
  }, [project]);

  const shared = {
    layout: config?.pdf,
    document: config?.document,
    company: config?.company,
    companyLogo,
  };

  const procedurePdf = usePdfDelivery({
    build: async () => {
      const { buildProcedurePdf } = await import("../../lib/pdf/buildProcedurePdf");
      return buildProcedurePdf(files.procedure, { ...shared, procedure: config?.procedure, project: files.layout, photos });
    },
    fileName: procedurePdfFileName(files.procedure),
    deps: [files, config, companyLogo, photos],
    buildErrorMessage: "สร้างเอกสารขั้นตอนปฏิบัติงานไม่สำเร็จ กรุณาลองอีกครั้ง",
  });
  const procedureWord = usePdfDelivery({
    format: "docx",
    build: async () => {
      const { buildProcedureDocx } = await import("../../lib/word/buildProcedureDocx");
      return buildProcedureDocx(files.procedure, { ...shared, procedure: config?.procedure, project: files.layout, photos });
    },
    fileName: procedureDocxFileName(files.procedure),
    deps: [files, config, companyLogo, photos],
    buildErrorMessage: "สร้างไฟล์ Word ไม่สำเร็จ กรุณาลองอีกครั้ง หรือใช้ไฟล์ PDF แทน",
  });
  const jsaPdf = usePdfDelivery({
    build: async () => {
      const { buildProjectJsaPdf } = await import("../../lib/pdf/buildJsaPdf");
      return buildProjectJsaPdf(files.cover, files.jsas, shared);
    },
    fileName: projectJsaPdfFileName(files.cover.name, files.cover.date),
    deps: [files, config, companyLogo],
    buildErrorMessage: "สร้างเอกสาร JSA ไม่สำเร็จ กรุณาลองอีกครั้ง",
  });
  const jsaWord = usePdfDelivery({
    format: "docx",
    build: async () => {
      const { buildProjectJsaDocx } = await import("../../lib/word/buildJsaDocx");
      return buildProjectJsaDocx(files.cover, files.jsas, shared);
    },
    fileName: projectJsaDocxFileName(files.cover.name, files.cover.date),
    deps: [files, config, companyLogo],
    buildErrorMessage: "สร้างไฟล์ Word ไม่สำเร็จ กรุณาลองอีกครั้ง หรือใช้ไฟล์ PDF แทน",
  });

  // Worth saying before anything is submitted: a section with no sub-steps
  // prints as bare step titles, and a flagged one may not match its JSA
  const undrafted = project.phases.filter((phase) => !phase.procedure).length;
  const stale = project.phases.filter(sectionStale).length;
  const subSteps = project.phases.reduce(
    (total, phase) => total + (phase.procedure?.steps.reduce((n, step) => n + step.sub_steps.length, 0) ?? 0),
    0,
  );
  const jsaSteps = files.jsas.reduce((total, jsa) => total + jsa.steps.length, 0);

  return (
    <section>
      <h1 className="text-2xl font-semibold text-navy sm:text-[1.75rem]">ไฟล์ที่ส่ง</h1>
      <p className="mt-1.5 text-muted">2 ไฟล์ แต่ละไฟล์เปิดเป็น PDF หรือดาวน์โหลดเป็น Word ได้</p>

      {undrafted || stale ? (
        <div className="mt-4 rounded-card border border-[var(--warning-border)] bg-[var(--warning-soft)] p-3">
          <p className="flex items-start gap-2 text-sm text-[var(--warning-text)]">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-[var(--warning)]" aria-hidden="true" />
            <span>
              {undrafted ? `ขั้นตอนปฏิบัติงานยังไม่ได้ร่าง ${undrafted} ส่วน (จะมีแต่ชื่อขั้นตอน) ` : ""}
              {stale ? `มี ${stale} ส่วนที่ JSA ถูกแก้ไขหลังจากร่าง ` : ""}
              — กลับไปตรวจที่หน้าขั้นตอนปฏิบัติงานได้
            </span>
          </p>
        </div>
      ) : null}

      <PdfDeliveryCard
        className="mt-4"
        kicker="ไฟล์ 1 · ขั้นตอนปฏิบัติงานโครงการ"
        title={files.cover.name}
        summary={[
          { label: labels.supervisor, value: project.supervisor },
          { label: labels.analysis_date, value: formatThaiDate(files.cover.date) },
          { label: "เนื้อหา", value: `${project.phases.length} ส่วน · ${subSteps} ขั้นตอนย่อย` },
        ]}
        delivery={procedurePdf}
        word={procedureWord}
      />

      <PdfDeliveryCard
        className="mt-4"
        kicker="ไฟล์ 2 · JSA ทุกขั้นตอน"
        title={files.cover.name}
        summary={[
          { label: labels.supervisor, value: project.supervisor },
          { label: "เนื้อหา", value: `หน้าปกและสารบัญ · JSA ${files.jsas.length} ฉบับ · ${jsaSteps} ขั้นตอน` },
        ]}
        delivery={jsaPdf}
        word={jsaWord}
      />

      <div className="mt-5 flex justify-center text-sm">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 text-muted underline decoration-dotted underline-offset-4 hover:text-navy"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          กลับไปขั้นตอนปฏิบัติงาน
        </button>
      </div>
    </section>
  );
}
