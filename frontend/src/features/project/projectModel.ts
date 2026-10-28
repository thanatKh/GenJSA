/* Project Mode's data rules, in one place for the screens and App.tsx.
 *
 * The one rule worth knowing before editing: a phase's work name and its
 * JSA's งาน/กิจกรรม are the same thing typed in two places (the project page
 * and the JSA editor), and the project name is printed on every phase's JSA.
 * withPhaseJsa / withProject below keep those copies in step, so no screen
 * has to remember to.
 */

import { loadCompanyProfile } from "../../lib/companyLogo";
import { photoKey } from "../../lib/pdf/layout";
import { loadNames } from "../../lib/rememberedNames";
import {
  stepFingerprint,
  type JsaDocument,
  type ProcedureDocument,
  type ProjectDocument,
  type ProjectPhase,
} from "../../lib/schema";
import { todayIso } from "../../lib/thaidate";
import { newId } from "../../projects";

// Same floor as the Single Mode form's work description — it's the prompt
export const DESCRIPTION_MIN = 10;

export function newPhase(): ProjectPhase {
  return { id: newId(), work: "", description: "", jsa: null, reviewed: false, procedure: null };
}

/** A fresh project, starting from the names remembered from last time */
export function blankProject(): ProjectDocument {
  const names = loadNames();
  return {
    name: "",
    supervisor: names.supervisor,
    analyst: names.analyst,
    company: loadCompanyProfile()?.name ?? "",
    notes: "",
    references: [{ tag: "", note: "" }],
    phases: [newPhase()],
    procedureIntro: null,
  };
}

/** Anything typed beyond what a blank project starts with */
export function hasContent(project: ProjectDocument): boolean {
  return (
    !!project.name.trim() ||
    !!project.notes.trim() ||
    project.references.some((ref) => ref.tag.trim() || ref.note.trim()) ||
    project.phases.some((phase) => phase.work.trim() || phase.description.trim() || phase.jsa)
  );
}

export type ProjectProblems = {
  name?: string;
  supervisor?: string;
  noPhases?: string;
  phases: Record<string, { work?: string; description?: string }>;
};

/** What has to be fixed before the project's JSAs can be drafted. A phase
 * that already has its JSA doesn't need a description any more. */
export function findProblems(project: ProjectDocument): ProjectProblems | null {
  const problems: ProjectProblems = { phases: {} };
  if (!project.name.trim()) problems.name = "กรุณากรอกชื่อโครงการ";
  if (!project.supervisor.trim()) problems.supervisor = "กรุณากรอกชื่อหัวหน้างาน";
  if (project.phases.length === 0) problems.noPhases = "กรุณาเพิ่มอย่างน้อย 1 ขั้นตอน";
  for (const phase of project.phases) {
    const issue: { work?: string; description?: string } = {};
    if (!phase.work.trim()) issue.work = "กรุณากรอกชื่องานของขั้นตอนนี้";
    if (!phase.jsa && phase.description.trim().length < DESCRIPTION_MIN)
      issue.description = `กรุณาระบุรายละเอียดงานอย่างน้อย ${DESCRIPTION_MIN} ตัวอักษร`;
    if (issue.work || issue.description) problems.phases[phase.id] = issue;
  }
  const any =
    problems.name || problems.supervisor || problems.noPhases || Object.keys(problems.phases).length;
  return any ? problems : null;
}

/** Apply a project-level edit, carrying the shared header fields down into
 * every phase's JSA (they're printed there) */
export function withProject(next: ProjectDocument): ProjectDocument {
  return {
    ...next,
    phases: next.phases.map((phase) =>
      phase.jsa
        ? {
            ...phase,
            jsa: {
              ...phase.jsa,
              header: { ...phase.jsa.header, project: next.name.trim(), work_activity: phase.work },
            },
          }
        : phase,
    ),
  };
}

/** Replace one phase's JSA (from the editor or a fresh draft), carrying its
 * งาน/กิจกรรม back up to the phase's work name */
export function withPhaseJsa(
  project: ProjectDocument,
  phaseId: string,
  jsa: JsaDocument,
  reviewed?: boolean,
): ProjectDocument {
  return {
    ...project,
    phases: project.phases.map((phase) =>
      phase.id === phaseId
        ? {
            ...phase,
            jsa,
            work: jsa.header.work_activity,
            reviewed: reviewed ?? phase.reviewed,
          }
        : phase,
    ),
  };
}

/** A blank JSA for a phase the user would rather fill in by hand */
export function blankPhaseJsa(project: ProjectDocument, phase: ProjectPhase): JsaDocument {
  return {
    header: {
      work_activity: phase.work,
      supervisor: project.supervisor,
      analyst: project.analyst,
      company: project.company,
      project: project.name.trim(),
      analysis_date: todayIso(),
    },
    steps: [{ no: 1, procedure: "", details: "", hazards: [{ hazard: "", controls: [""] }] }],
    assumptions: [],
  };
}

/** The request for drafting one phase's JSA */
export function generateInput(project: ProjectDocument, index: number) {
  const phase = project.phases[index];
  return {
    supervisor: project.supervisor.trim(),
    analyst: project.analyst.trim(),
    company: project.company.trim(),
    analysis_date: todayIso(),
    work_description: phase.description.trim(),
    project: {
      name: project.name.trim(),
      notes: project.notes.trim(),
      references: project.references
        .filter((ref) => ref.tag.trim())
        .map((ref) => ({ tag: ref.tag.trim(), note: ref.note.trim() })),
      phases: project.phases.map((p) => p.work.trim()),
      phase_index: index,
    },
  };
}

// ---------------------------------------------------------------- procedure --

/** The phase's JSA steps changed after its procedure section was drafted —
 * the same check as Single Mode's stale-procedure warning */
export function sectionStale(phase: ProjectPhase): boolean {
  return !!phase.jsa && !!phase.procedure && stepFingerprint(phase.jsa) !== stepFingerprint(phase.procedure);
}

/** Put a freshly drafted section on its phase. The first section drafted
 * also supplies the project-wide วัตถุประสงค์/ขอบเขต (its prompt asks for
 * them at project level); every section adds any tools not listed yet. */
export function withPhaseProcedure(
  project: ProjectDocument,
  phaseId: string,
  section: ProcedureDocument,
): ProjectDocument {
  const intro = project.procedureIntro ?? { purpose: section.purpose, scope: section.scope, tools: [] };
  const known = new Set(intro.tools.map((tool) => tool.trim()));
  const tools = [...intro.tools, ...section.tools.filter((tool) => tool.trim() && !known.has(tool.trim()))];
  return {
    ...project,
    procedureIntro: { ...intro, tools },
    phases: project.phases.map((phase) => (phase.id === phaseId ? { ...phase, procedure: section } : phase)),
  };
}

/** The request for drafting one phase's section */
export function procedureInput(project: ProjectDocument, index: number) {
  return {
    name: project.name.trim(),
    notes: project.notes.trim(),
    references: project.references
      .filter((ref) => ref.tag.trim())
      .map((ref) => ({ tag: ref.tag.trim(), note: ref.note.trim() })),
    phases: project.phases.map((phase) => ({
      work: phase.work.trim() || "-",
      steps: (phase.jsa?.steps ?? []).map((step) => step.procedure.trim()).filter(Boolean),
    })),
    phase_index: index,
  };
}

/** Where a project sub-step's photo is stored: "<phase id>:<step>.<sub>".
 * The phase id, not its number, so reordering phases never moves a photo to
 * another phase. buildProcedurePdf/Docx find it through
 * ProjectProcedureLayout.photoPrefix ("<phase id>:"). */
export function projectPhotoKey(phaseId: string, stepNo: number, subNo: number): string {
  return `${phaseId}:${photoKey(stepNo, subNo)}`;
}
