import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { Alert, Button, ConfirmDialog, Reveal } from "../../components/ui";
import type { Backup } from "../../lib/backup";
import { useFlash } from "../../lib/useFlash";

const MAX_BACKUP_BYTES = 100 * 1024 * 1024;

export function BackupControls() {
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Backup | null>(null);
  const [busy, setBusy] = useState<"export" | "import" | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  // Each button says it worked on itself, then goes back
  const [exported, flashExported] = useFlash();
  const [restored, flashRestored] = useFlash();
  // The note and the error keep their text while they animate out
  const lastMessage = useRef("");
  if (message) lastMessage.current = message;
  const lastError = useRef("");
  if (error) lastError.current = error;
  const run = async (which: "export" | "import", action: () => Promise<void>) => {
    setBusy(which); setError(""); setMessage("");
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : "ดำเนินการไม่สำเร็จ กรุณาลองอีกครั้ง"); }
    finally { setBusy(null); }
  };
  return <div className="min-w-0">
    <div className="flex flex-wrap items-center justify-center gap-1 sm:justify-end">
      <Button type="button" size="sm" className="pointer-coarse:min-h-12" variant="ghost" disabled={!!busy}
        loading={busy === "export"} status={exported ? "success" : undefined} successText="สำรองแล้ว"
        onClick={() => void run("export", async () => {
        const { createBackup } = await import("../../lib/backup");
        const blob = new Blob([JSON.stringify(await createBackup())], { type: "application/json" });
        if (blob.size > MAX_BACKUP_BYTES) throw new Error("ไฟล์สำรองเกิน 100 MB กรุณาลดจำนวนรายการก่อนสำรอง");
        const url = URL.createObjectURL(blob); const link = document.createElement("a");
        link.href = url; link.download = `GenJSA-backup-${new Date().toISOString().slice(0, 10)}.json`;
        link.click(); setTimeout(() => URL.revokeObjectURL(url), 30_000);
        flashExported();
        setMessage("เก็บไฟล์ .json ไว้ในที่ปลอดภัย");
      })}>{exported || busy === "export" ? null : <Download className="size-4" aria-hidden="true" />}สำรองข้อมูล</Button>
      <Button type="button" size="sm" className="pointer-coarse:min-h-12" variant="ghost" disabled={!!busy}
        loading={busy === "import"} status={restored ? "success" : undefined} successText="นำเข้าแล้ว"
        onClick={() => input.current?.click()}>{restored || busy === "import" ? null : <Upload className="size-4" aria-hidden="true" />}นำเข้าข้อมูล</Button>
    </div>
    <input ref={input} type="file" accept=".json,application/json" className="hidden" aria-label="เลือกไฟล์สำรอง GenJSA"
      onChange={(event) => {
        const file = event.target.files?.[0]; event.target.value = "";
        if (!file) return;
        void run("import", async () => {
          if (file.size > MAX_BACKUP_BYTES) throw new Error("รองรับไฟล์สำรองขนาดไม่เกิน 100 MB");
          const { parseBackup } = await import("../../lib/backup");
          try { setPending(parseBackup(await file.text())); }
          catch (e) { throw new Error(e instanceof SyntaxError ? "ไฟล์ JSON ไม่สมบูรณ์ กรุณาเลือกไฟล์สำรองจาก GenJSA" : e instanceof Error ? e.message : "ไฟล์สำรองไม่ถูกต้อง"); }
        });
      }} />
    <Reveal show={!!message}><p role="status" className="mt-2 text-center text-sm text-muted sm:text-end">{message || lastMessage.current}</p></Reveal>
    <Reveal show={!!error}><div className="mt-2"><Alert>{error || lastError.current}</Alert></div></Reveal>
    <ConfirmDialog open={!!pending} title="นำเข้าข้อมูลเป็นสำเนา?"
      description={pending ? `${pending.entries.length} งาน · ${pending.projects.length} โครงการ · ${pending.assets.length} รูป/โลโก้ ข้อมูลเดิมจะยังอยู่ครบ` : ""}
      confirmLabel="นำเข้า" onCancel={() => setPending(null)}
      onConfirm={() => { const data = pending; setPending(null); if (data) void run("import", async () => {
        const { restoreBackup } = await import("../../lib/backup"); await restoreBackup(data); flashRestored();
      }); }} />
  </div>;
}
