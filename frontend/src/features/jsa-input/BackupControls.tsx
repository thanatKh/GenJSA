import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { Alert, Button, ConfirmDialog } from "../../components/ui";
import type { Backup } from "../../lib/backup";

const MAX_BACKUP_BYTES = 100 * 1024 * 1024;

export function BackupControls() {
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Backup | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(""); setMessage("");
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : "ดำเนินการไม่สำเร็จ กรุณาลองอีกครั้ง"); }
    finally { setBusy(false); }
  };
  return <div className="min-w-0">
    <div className="flex flex-wrap items-center justify-center gap-1 sm:justify-end">
      <Button type="button" size="sm" className="pointer-coarse:min-h-12" variant="ghost" disabled={busy} onClick={() => void run(async () => {
        const { createBackup } = await import("../../lib/backup");
        const blob = new Blob([JSON.stringify(await createBackup())], { type: "application/json" });
        if (blob.size > MAX_BACKUP_BYTES) throw new Error("ไฟล์สำรองเกิน 100 MB กรุณาลดจำนวนรายการก่อนสำรอง");
        const url = URL.createObjectURL(blob); const link = document.createElement("a");
        link.href = url; link.download = `GenJSA-backup-${new Date().toISOString().slice(0, 10)}.json`;
        link.click(); setTimeout(() => URL.revokeObjectURL(url), 30_000);
        setMessage("ส่งไฟล์สำรองให้เบราว์เซอร์แล้ว กรุณาเก็บไฟล์ .json ไว้ในที่ปลอดภัย");
      })}><Download className="size-4" aria-hidden="true" />สำรองข้อมูล</Button>
      <Button type="button" size="sm" className="pointer-coarse:min-h-12" variant="ghost" disabled={busy} onClick={() => input.current?.click()}><Upload className="size-4" aria-hidden="true" />นำเข้าข้อมูล</Button>
    </div>
    <input ref={input} type="file" accept=".json,application/json" className="hidden" aria-label="เลือกไฟล์สำรอง GenJSA"
      onChange={(event) => {
        const file = event.target.files?.[0]; event.target.value = "";
        if (!file) return;
        void run(async () => {
          if (file.size > MAX_BACKUP_BYTES) throw new Error("รองรับไฟล์สำรองขนาดไม่เกิน 100 MB");
          const { parseBackup } = await import("../../lib/backup");
          try { setPending(parseBackup(await file.text())); }
          catch (e) { throw new Error(e instanceof SyntaxError ? "ไฟล์ JSON ไม่สมบูรณ์ กรุณาเลือกไฟล์สำรองจาก GenJSA" : e instanceof Error ? e.message : "ไฟล์สำรองไม่ถูกต้อง"); }
        });
      }} />
    {message ? <p role="status" className="mt-2 text-sm text-muted">{message}</p> : null}
    {error ? <div className="mt-2"><Alert>{error}</Alert></div> : null}
    <ConfirmDialog open={!!pending} title="นำเข้าข้อมูลเป็นสำเนา?"
      description={pending ? `${pending.entries.length} งาน · ${pending.projects.length} โครงการ · ${pending.assets.length} รูป/โลโก้ ข้อมูลเดิมจะยังอยู่ครบ` : ""}
      confirmLabel="นำเข้า" onCancel={() => setPending(null)}
      onConfirm={() => { const data = pending; setPending(null); if (data) void run(async () => {
        const { restoreBackup } = await import("../../lib/backup"); await restoreBackup(data); setMessage("นำเข้าข้อมูลสำเร็จแล้ว");
      }); }} />
  </div>;
}
