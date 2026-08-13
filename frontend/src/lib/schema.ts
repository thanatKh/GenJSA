/* Zod schema — mirrors backend/app/models/jsa.py
 * Changes here must be kept in sync with the backend.
 */

import { z } from "zod";
import { isValidIsoDate } from "./thaidate";

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
});

export const jsaDocumentSchema = z.object({
  header: jsaHeaderSchema,
  steps: z.array(stepSchema),
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
  analysis_date: z
    .string()
    .refine(isValidIsoDate, "กรุณาเลือกวันที่วิเคราะห์"),
  work_description: z
    .string()
    .trim()
    .min(10, "กรุณาอธิบายงานให้ละเอียดขึ้นอีกนิด (อย่างน้อย 10 ตัวอักษร)")
    .max(5000, "รายละเอียดยาวเกินกำหนด กรุณาย่อหรือแยกเป็นหลาย JSA"),
});

export type Hazard = z.infer<typeof hazardSchema>;
export type JsaStep = z.infer<typeof stepSchema>;
export type JsaDocument = z.infer<typeof jsaDocumentSchema>;
export type InputForm = z.infer<typeof inputFormSchema>;
