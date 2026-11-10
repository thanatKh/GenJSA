import { useEffect, useState } from "react";
import { LoaderCircle, X } from "lucide-react";

/** A waiting state, not simulated server telemetry. */
export function GeneratingPanel({ onCancel, typicalMinSeconds = 60, typicalMaxSeconds = 180 }: {
  onCancel?: () => void;
  stages?: readonly string[];
  typicalMinSeconds?: number;
  typicalMaxSeconds?: number;
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  return <section className="mt-4 rounded-card border border-line bg-raised p-5" aria-busy="true">
    <div className="flex items-center gap-3">
      <LoaderCircle className="size-5 shrink-0 animate-spin text-navy" aria-hidden="true" />
      <p role="status" className="font-medium text-ink">รอคำตอบจากระบบ</p>
      {onCancel ? <button type="button" onClick={onCancel} className="ml-auto flex items-center gap-1 rounded-lg p-2 text-sm text-muted hover:text-navy"><X className="size-4" aria-hidden="true" />ยกเลิก</button> : null}
    </div>
    <p className="mt-3 text-sm text-muted">ผ่านไป {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")} นาที · โดยทั่วไปประมาณ {Math.round(typicalMinSeconds / 60)}–{Math.round(typicalMaxSeconds / 60)} นาที</p>
    <p className="mt-2 text-sm text-muted">{elapsed >= typicalMaxSeconds ? "ยังไม่ได้รับคำตอบจากระบบ คุณสามารถรอต่อหรือยกเลิกแล้วลองใหม่ได้" : "เมื่อได้รับคำตอบ ระบบจะเปิดเอกสารให้คุณตรวจทาน ข้อมูลที่กรอกไว้ยังอยู่ครบ"}</p>
  </section>;
}
