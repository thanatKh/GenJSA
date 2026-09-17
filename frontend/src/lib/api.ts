/* API client
 *
 * Every error must become a Thai message the user can understand.
 * Never show the status code or server-side details to the user.
 */

import {
  jsaDocumentSchema,
  procedureDocumentSchema,
  type JsaDocument,
  type ProcedureDocument,
} from "./schema";
import type { DocumentMeta, PdfLayout, ProcedureMeta } from "./pdf/layout";

const FALLBACK_ERROR =
  "เกิดข้อผิดพลาดที่ไม่คาดคิด ข้อมูลของคุณยังอยู่ กรุณาลองอีกครั้ง";

const NETWORK_ERROR =
  "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง " +
  "ข้อมูลที่กรอกไว้ยังอยู่ครบ";

// Backend's own worst case (3 retry attempts x 120s AI timeout + backoff, see
// config/ai.yaml) is ~6 minutes — stay comfortably above that so this only
// fires on a genuine hang, never on a legitimate slow-but-working retry cycle.
const GENERATE_TIMEOUT_MS = 6 * 60 * 1000;

export class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiError";
  }
}

// Thrown only when the caller's own signal fired — i.e. the user clicked
// "ยกเลิก", not a timeout or a network failure. Callers should treat this as
// a silent, expected outcome (return to the form), never show it as an error.
export class CancelledError extends Error {
  constructor() {
    super("cancelled");
    this.name = "CancelledError";
  }
}

export type GenerateInput = {
  supervisor: string;
  analysis_date: string;
  work_description: string;
  // "วิเคราะห์อย่างละเอียด" — see InputStep.tsx for why this isn't part of InputForm/the draft
  detailed?: boolean;
};

/** POST JSON to a generate endpoint, with the shared timeout/abort handling. */
async function postGenerate(
  path: string,
  body: unknown,
  externalSignal: AbortSignal | undefined,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS);
  // Relay the caller's abort onto our own controller rather than passing
  // externalSignal straight to fetch — this way one signal (ours) always
  // drives the request, whether the abort came from the caller, the timeout
  // above, or both, and AbortSignal.any() (not available on older Safari) is
  // never needed.
  const relayAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", relayAbort);
  }

  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    // fetch rejecting = network down / server not responding / aborted on
    // timeout or by the user — tell those apart by which signal fired
    if (externalSignal?.aborted) throw new CancelledError();
    throw new ApiError(NETWORK_ERROR);
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", relayAbort);
  }

  if (!response.ok) {
    throw new ApiError(await extractMessage(response));
  }
  return response;
}

const SHAPE_ERROR = "ระบบตอบกลับในรูปแบบที่ไม่คาดคิด กรุณากดลองอีกครั้ง";

export async function generateJsa(
  input: GenerateInput,
  options?: { signal?: AbortSignal },
): Promise<JsaDocument> {
  const response = await postGenerate("/api/jsa/generate", input, options?.signal);
  try {
    return jsaDocumentSchema.parse(await response.json());
  } catch {
    throw new ApiError(SHAPE_ERROR);
  }
}

/** Expand a finished JSA into a step-by-step work procedure.
 *
 * The one call that sends a document back to the server. It's used for this
 * request only and never stored — see the persistence notes in CLAUDE.md. */
export async function generateProcedure(
  jsa: JsaDocument,
  options?: { signal?: AbortSignal },
): Promise<ProcedureDocument> {
  const response = await postGenerate("/api/procedure/generate", { jsa }, options?.signal);
  try {
    return procedureDocumentSchema.parse(await response.json());
  } catch {
    throw new ApiError(SHAPE_ERROR);
  }
}

export type PublicConfig = {
  appName: string;
  company: { name: string; department: string };
  document: DocumentMeta;
  // The work procedure document (config/procedure.yaml)
  procedure: ProcedureMeta;
  // Values used to draw the PDF client-side — the full config/pdf.yaml
  pdf: PdfLayout;
};

export async function fetchPublicConfig(): Promise<PublicConfig | null> {
  // Config is a nice-to-have — if it fails to load, fall back to on-screen defaults, no error needed
  try {
    const response = await fetch("/api/config/public");
    if (!response.ok) return null;
    return (await response.json()) as PublicConfig;
  } catch {
    return null;
  }
}

async function extractMessage(response: Response): Promise<string> {
  try {
    const body = await response.json();
    const message = body?.error?.message;
    if (typeof message === "string" && message.trim()) return message;
  } catch {
    // Response wasn't JSON — use the fallback message
  }
  return FALLBACK_ERROR;
}
