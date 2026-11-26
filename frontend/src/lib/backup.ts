import { z } from "zod";
import * as history from "../history";
import { jsaDocumentSchema, procedureDocumentSchema } from "./schema";
import { exportAssets, importAssets, clearForHistoryIds } from "./photoStore";

const entrySchema = z.object({ id: z.string().min(1), savedAt: z.number().finite(), doc: jsaDocumentSchema, procedure: procedureDocumentSchema.optional() });
const assetSchema = z.object({
  historyId: z.string().min(1), stepNo: z.union([z.string(), z.number()]),
  data: z.string().regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=\r\n]+$/),
  ratio: z.number().finite().positive(), savedAt: z.number().finite(),
});
const backupSchema = z.object({
  kind: z.literal("genjsa-backup"), version: z.literal(1), createdAt: z.string(),
  entries: z.array(entrySchema).max(history.MAX_ENTRIES),
  assets: z.array(assetSchema),
});
export type Backup = z.infer<typeof backupSchema>;
export const MAX_BACKUP_BYTES = 100 * 1024 * 1024;

export async function createBackup(): Promise<Backup> {
  const entries = history.list();
  return { kind: "genjsa-backup", version: 1, createdAt: new Date().toISOString(), entries,
    assets: await exportAssets(entries.map((entry) => entry.id)) };
}

export function parseBackup(text: string): Backup {
  const result = backupSchema.extend({ projects: z.array(z.unknown()).optional() }).safeParse(JSON.parse(text));
  if (!result.success) throw new Error("ไฟล์นี้ไม่ใช่ไฟล์สำรอง GenJSA ที่รองรับ หรือข้อมูลไม่ครบ");
  const { projects, ...data } = result.data;
  if (projects?.length) throw new Error("ไฟล์สำรองนี้มีข้อมูลโครงการ ซึ่ง GenJSA รุ่นนี้ไม่นำเข้า");
  const ids = data.entries.map((e) => e.id);
  if (new Set(ids).size !== ids.length) throw new Error("ไฟล์สำรองมีรหัสงานซ้ำ");
  if (data.assets.some((a) => !ids.includes(a.historyId))) throw new Error("ไฟล์สำรองมีรูปภาพที่ไม่ตรงกับงาน");
  const assetKeys = data.assets.map((a) => JSON.stringify([a.historyId, a.stepNo]));
  if (new Set(assetKeys).size !== assetKeys.length) throw new Error("ไฟล์สำรองมีรูปภาพซ้ำตำแหน่ง");
  return data;
}

/** Merge as new copies. Validate capacity first and roll back storage changes
 * on failure; importing never overwrites an existing job or its photos. */
export async function restoreBackup(data: Backup): Promise<Map<string, string>> {
  const ids = new Map(data.entries.map((e) => [e.id, history.newId()]));
  const entries = data.entries.map((e) => ({ ...e, id: ids.get(e.id)! }));
  const assets = data.assets.map((a) => ({ ...a, historyId: ids.get(a.historyId)! }));
  const key = "genjsa.history.v1";
  try {
    await importAssets(assets);
    await history.withHistoryLock(() => {
      const existing = history.list();
      if (existing.length + entries.length > history.MAX_ENTRIES) {
        throw new Error("ประวัติจะเกิน 100 งาน กรุณาสำรองและลบรายการที่ไม่ใช้แล้วลองอีกครั้ง");
      }
      try {
        localStorage.setItem(key, JSON.stringify({ v: 1, entries: [...entries, ...existing].sort((a, b) => b.savedAt - a.savedAt) }));
      } catch {
        throw new Error("พื้นที่จัดเก็บไม่เพียงพอ กรุณาเพิ่มพื้นที่แล้วลองอีกครั้ง");
      }
    });
  } catch (error) {
    await clearForHistoryIds([...ids.values()]);
    throw error instanceof Error ? error : new Error("นำเข้าไม่สำเร็จ พื้นที่อาจไม่เพียงพอ");
  }
  window.dispatchEvent(new Event("genjsa-library-changed"));
  return ids;
}

export async function duplicateJob(entry: history.HistoryEntry, preserveDocument = false): Promise<history.HistoryEntry> {
  const copy = structuredClone(entry);
  copy.id = history.newId(); copy.savedAt = Date.now();
  delete copy.revision;
  if (!preserveDocument) {
    copy.doc.header.work_activity = `${copy.doc.header.work_activity} (สำเนา)`.slice(0, 500);
    if (copy.procedure) { copy.procedure.header = { ...copy.doc.header }; delete copy.procedure.sourceFingerprint; }
  }
  const assets = await exportAssets([entry.id]);
  const remapped = await restoreBackup({
    kind: "genjsa-backup", version: 1, createdAt: new Date().toISOString(),
    entries: [copy],
    assets: assets.map((asset) => ({ ...asset, historyId: copy.id })),
  });
  copy.id = remapped.get(copy.id)!;
  return copy;
}
