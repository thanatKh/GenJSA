/* Zod schema — mirrors backend/app/models/jsa.py
 * Changes here must be kept in sync with the backend.
 */

import { z } from "zod";

export const hazardSchema = z.object({
  hazard: z.string(),
  controls: z.array(z.string()),
});

export const stepSchema = z.object({
  no: z.number(),
  procedure: z.string(),
  details: z.string().default(""),
  hazards: z.array(hazardSchema),
});

export const jsaHeaderSchema = z.object({
  work_activity: z.string(),
  supervisor: z.string(),
  analysis_date: z.string(),
  // Optional — printed as "ผู้วิเคราะห์ <name>" at the end of the PDF, falling
  // back to the supervisor's name when blank.
  // Defaulted so documents saved before this field existed still parse.
  analyst: z.string().default(""),
  // The company that prepared the document when it isn't PTTOR (e.g. a
  // vendor) — printed as an extra header row only when filled in. Defaulted
  // for the same reason as `analyst`.
  company: z.string().default(""),
  // Project Mode: the project this JSA is one phase of, printed as a row
  // above งาน/กิจกรรม. Blank on a Single Mode JSA. Defaulted like the above.
  project: z.string().default(""),
});

export const jsaDocumentSchema = z.object({
  header: jsaHeaderSchema,
  steps: z.array(stepSchema),
  assumptions: z.array(z.string()).default([]),
});

/* Work procedure (ขั้นตอนปฏิบัติงาน) — mirrors backend/app/models/procedure.py.
 * Generated from a finished JSA, so it inherits that document's header.
 * Every optional field is defaulted so records saved before a field existed
 * still parse (same reasoning as `analyst` above). */

export const subStepSchema = z.object({
  no: z.number(),
  action: z.string(),
});

export const procedureStepSchema = z.object({
  no: z.number(),
  // Copied from the source JSA — the AI never writes this
  procedure: z.string(),
  sub_steps: z.array(subStepSchema).default([]),
});

export const procedureDocumentSchema = z.object({
  header: jsaHeaderSchema,
  purpose: z.string().default(""),
  scope: z.string().default(""),
  references: z.array(z.string()).default([]),
  tools: z.array(z.string()).default([]),
  steps: z.array(procedureStepSchema),
  assumptions: z.array(z.string()).default([]),
});

/** The first-step form — the 3 required fields plus the optional analyst name */
export const inputFormSchema = z.object({
  supervisor: z
    .string()
    .trim()
    .min(1, "กรุณากรอกชื่อหัวหน้างาน")
    .max(200, "ชื่อยาวเกินไป"),
  // Optional in meaning (no min length) but always present in the form state —
  // InputStep seeds it with "" so the input is never uncontrolled
  analyst: z.string().trim().max(200, "ชื่อยาวเกินไป"),
  // Optional, like analyst — see jsaHeaderSchema.company
  company: z.string().trim().max(200, "ชื่อบริษัทยาวเกินไป"),
  // No analysis_date: the first screen doesn't ask for one. App.tsx stamps
  // today's date when the document is created, and it stays editable in the
  // JSA editor's header card (see EditorStep).
  work_description: z
    .string()
    .trim()
    .min(10, "กรุณาระบุรายละเอียดงานอย่างน้อย 10 ตัวอักษร")
    .max(5000, "รายละเอียดยาวเกิน 5,000 ตัวอักษร กรุณาย่อหรือแยกเป็นหลาย JSA"),
});

/* Project Mode — a big job split into phases, one JSA per phase. Browser-only
 * (projects.ts); the backend only ever sees one phase's request at a time, as
 * GenerateRequest.project (backend/app/models/jsa.py's ProjectContext). */

/** One row of the shared tag list — a valve, blind or tag and what's done with it */
export const projectReferenceSchema = z.object({
  tag: z.string(),
  note: z.string().default(""),
});

export const projectPhaseSchema = z.object({
  /** Stable on-screen identity — phases can be reordered */
  id: z.string(),
  /** This phase's work name. Becomes its JSA's งาน/กิจกรรม, and the two are kept in step */
  work: z.string(),
  /** What's done in this phase — the prompt for its JSA */
  description: z.string(),
  jsa: jsaDocumentSchema.nullable().default(null),
  /** Ticked when the user finishes reviewing this JSA ("ตรวจแล้ว") */
  reviewed: z.boolean().default(false),
  /** This phase's section of the project's work procedure, drafted from its
   * JSA. Only its steps are used; the project-level sections live in
   * ProjectDocument.procedureIntro. */
  procedure: procedureDocumentSchema.nullable().default(null),
});

/** The project procedure's own opening sections, written once for the whole
 * project (the first drafted section supplies them; tools grow as sections
 * are drafted) */
export const projectProcedureIntroSchema = z.object({
  purpose: z.string().default(""),
  scope: z.string().default(""),
  tools: z.array(z.string()).default([]),
});

export const projectDocumentSchema = z.object({
  name: z.string(),
  supervisor: z.string(),
  analyst: z.string().default(""),
  company: z.string().default(""),
  /** ข้อจำกัด / หมายเหตุ — sent to the system as background for every phase */
  notes: z.string().default(""),
  references: z.array(projectReferenceSchema).default([]),
  phases: z.array(projectPhaseSchema),
  procedureIntro: projectProcedureIntroSchema.nullable().default(null),
});

export type Hazard = z.infer<typeof hazardSchema>;
export type JsaStep = z.infer<typeof stepSchema>;
export type JsaDocument = z.infer<typeof jsaDocumentSchema>;
export type InputForm = z.infer<typeof inputFormSchema>;
export type SubStep = z.infer<typeof subStepSchema>;
export type ProcedureStep = z.infer<typeof procedureStepSchema>;
export type ProcedureDocument = z.infer<typeof procedureDocumentSchema>;
export type ProjectReference = z.infer<typeof projectReferenceSchema>;
export type ProjectPhase = z.infer<typeof projectPhaseSchema>;
export type ProjectDocument = z.infer<typeof projectDocumentSchema>;
export type ProjectProcedureIntro = z.infer<typeof projectProcedureIntroSchema>;

/** Identifies the JSA step list a procedure was generated from.
 *
 * A procedure mirrors its JSA's steps, so editing those steps afterwards
 * leaves it describing work that no longer matches. Comparing this against the
 * current JSA is enough to warn the user; it deliberately ignores hazards and
 * details, which the procedure never reflected in the first place. */
export function stepFingerprint(doc: JsaDocument | ProcedureDocument): string {
  return doc.steps.map((step) => step.procedure.trim()).join("|");
}
