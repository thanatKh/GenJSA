/* API client
 *
 * Every error must become a Thai message the user can understand.
 * Never show the status code or server-side details to the user.
 */

import { jsaDocumentSchema, type JsaDocument } from "./schema";
import type { DocumentMeta, PdfLayout } from "./pdf/layout";

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

export type GenerateInput = {
  supervisor: string;
  analysis_date: string;
  work_description: string;
};

export async function generateJsa(input: GenerateInput): Promise<JsaDocument> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch("/api/jsa/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
  } catch {
    // fetch rejecting = network down / server not responding / aborted on timeout —
    // not an error the backend sent
    throw new ApiError(NETWORK_ERROR);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new ApiError(await extractMessage(response));
  }

  try {
    return jsaDocumentSchema.parse(await response.json());
  } catch {
    throw new ApiError(
      "ระบบตอบกลับในรูปแบบที่ไม่คาดคิด กรุณากดลองอีกครั้ง",
    );
  }
}

export type PublicConfig = {
  appName: string;
  company: { name: string; department: string };
  document: DocumentMeta;
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
