import { z } from "zod";
import * as history from "../history";
import * as projects from "../projects";
import { jsaDocumentSchema, procedureDocumentSchema, projectDocumentSchema } from "./schema";
import { exportAssets, importAssets, clearForHistoryIds } from "./photoStore";

const entrySchema = z.object({ id: z.string().min(1), savedAt: z.number().finite(), doc: jsaDocumentSchema, procedure: procedureDocumentSchema.optional() });
const projectEntrySchema = z.object({ id: z.string().min(1), savedAt: z.number().finite(), project: projectDocumentSchema });
const assetSchema = z.object({
  historyId: z.string().min(1), stepNo: z.union([z.string(), z.number()]),
  data: z.string().regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=\r\n]+$/),
  ratio: z.number().finite().positive(), savedAt: z.number().finite(),
});
const backupSchema = z.object({
  kind: z.literal("genjsa-backup"), version: z.literal(1), createdAt: z.string(),
  entries: z.array(entrySchema).max(history.MAX_ENTRIES),
  projects: z.array(projectEntrySchema).max(projects.MAX_PROJECTS),
  assets: z.array(assetSchema),
});
export type Backup = z.infer<typeof backupSchema>;
export const MAX_BACKUP_BYTES = 100 * 1024 * 1024;

export async function createBackup(): Promise<Backup> {
  const entries = history.list(); const savedProjects = projects.list();
  return { kind: "genjsa-backup", version: 1, createdAt: new Date().toISOString(), entries, projects: savedProjects,
    assets: await exportAssets([...entries.map((e) => e.id), ...savedProjects.map((e) => e.id)]) };
}

export function parseBackup(text: string): Backup {
  const result = backupSchema.safeParse(JSON.parse(text));
  if (!result.success) throw new Error("ไฟล์นี้ไม่ใช่ไฟล์สำรอง GenJSA ที่รองรับ หรือข้อมูลไม่ครบ");
  const data = result.data;
  const ids = [...data.entries.map((e) => e.id), ...data.projects.map((e) => e.id)];
  if (new Set(ids).size !== ids.length) throw new Error("ไฟล์สำรองมีรหัสงานซ้ำ");
  if (data.assets.some((a) => !ids.includes(a.historyId))) throw new Error("ไฟล์สำรองมีรูปภาพที่ไม่ตรงกับงาน");
  const assetKeys = data.assets.map((a) => JSON.stringify([a.historyId, a.stepNo]));
  if (new Set(assetKeys).size !== assetKeys.length) throw new Error("ไฟล์สำรองมีรูปภาพซ้ำตำแหน่ง");
  return data;
}

/** Merge as new copies. Validate capacity first and roll back storage changes
 * on failure; importing never overwrites an existing job or its photos. */
export async function restoreBackup(data: Backup): Promise<Map<string, string>> {
  const existing = history.list(); const savedProjects = projects.list();
  if (existing.length + data.entries.length > history.MAX_ENTRIES || savedProjects.length + data.projects.length > projects.MAX_PROJECTS) {
    throw new Error("จำนวนงานจะเกินพื้นที่ประวัติ กรุณาสำรองและลบรายการที่ไม่ใช้ก่อนนำเข้า");
  }
  const ids = new Map([...data.entries, ...data.projects].map((e) => [e.id, history.newId()]));
  const entries = data.entries.map((e) => ({ ...e, id: ids.get(e.id)! }));
  const importedProjects = data.projects.map((e) => ({ ...e, id: ids.get(e.id)! }));
  const assets = data.assets.map((a) => ({ ...a, historyId: ids.get(a.historyId)! }));
  const keys = ["genjsa.history.v1", "genjsa.projects.v1"];
  const previous = keys.map((key) => localStorage.getItem(key));
  let wroteDocuments = false;
  try {
    await importAssets(assets);
    if (keys.some((key, i) => localStorage.getItem(key) !== previous[i])) {
      throw new Error("ประวัติเปลี่ยนระหว่างนำเข้า กรุณาลองใหม่อีกครั้ง");
    }
    wroteDocuments = true;
    localStorage.setItem(keys[0], JSON.stringify({ v: 1, entries: [...entries, ...existing].sort((a, b) => b.savedAt - a.savedAt) }));
    localStorage.setItem(keys[1], JSON.stringify({ v: 1, entries: [...importedProjects, ...savedProjects].sort((a, b) => b.savedAt - a.savedAt) }));
  } catch (error) {
    for (let i = 0; wroteDocuments && i < keys.length; i++) {
      try { if (previous[i] === null) localStorage.removeItem(keys[i]); else localStorage.setItem(keys[i], previous[i]!); } catch { /* best-effort rollback */ }
    }
    await clearForHistoryIds([...ids.values()]);
    throw error instanceof Error ? error : new Error("นำเข้าไม่สำเร็จ พื้นที่อาจไม่เพียงพอ");
  }
  window.dispatchEvent(new Event("genjsa-library-changed"));
  return ids;
}

export async function duplicateJob(entry: history.HistoryEntry): Promise<history.HistoryEntry> {
  const copy = structuredClone(entry);
  copy.id = history.newId(); copy.savedAt = Date.now();
  copy.doc.header.work_activity = `${copy.doc.header.work_activity} (สำเนา)`.slice(0, 500);
  if (copy.procedure) { copy.procedure.header = { ...copy.doc.header }; delete copy.procedure.sourceFingerprint; }
  await restoreCopy(copy, undefined, entry.id);
  return copy;
}
export async function duplicateProject(entry: projects.ProjectEntry): Promise<projects.ProjectEntry> {
  const copy = structuredClone(entry);
  copy.id = history.newId(); copy.savedAt = Date.now();
  copy.project.name = `${copy.project.name} (สำเนา)`.slice(0, 300);
  copy.project.phases = copy.project.phases.map((phase) => ({ ...phase, reviewed: false,
    jsa: phase.jsa ? { ...phase.jsa, header: { ...phase.jsa.header, project: copy.project.name } } : null }));
  await restoreCopy(undefined, copy, entry.id);
  return copy;
}
async function restoreCopy(entry: history.HistoryEntry | undefined, project: projects.ProjectEntry | undefined, sourceId: string) {
  // Use the same capacity checks and rollback as imports; restore remaps IDs.
  const assets = await exportAssets([sourceId]);
  const targetId = entry?.id ?? project!.id;
  const remapped = await restoreBackup({ kind: "genjsa-backup", version: 1, createdAt: new Date().toISOString(),
    entries: entry ? [entry] : [], projects: project ? [project] : [],
    assets: assets.map((a) => ({ ...a, historyId: targetId })) });
  if (entry) entry.id = remapped.get(targetId)!;
  if (project) project.id = remapped.get(targetId)!;
}
