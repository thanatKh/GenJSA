import { useState, type ReactNode } from "react";
import {
  FileText,
  Info,
  Lightbulb,
  ListChecks,
  Mail,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import logoUrl from "../assets/logo.png";
import { MAX_ENTRIES } from "../history";
import type { DocumentMeta } from "../lib/pdf/layout";
import { Button, InfoDialog } from "./ui";


function AboutSection({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Sparkles;
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-navy">
        <Icon className="size-4" aria-hidden="true" />
        {title}
      </h3>
      <div className="mt-1.5 text-muted">{children}</div>
    </section>
  );
}

export function AppBar({
  appName = "GenJSA",
  documentMeta,
  department,
  developer,
  contactEmail,
  onHome,
}: {
  appName?: string;
  documentMeta?: DocumentMeta;
  department?: string;
  /** From config/app.yaml (via the public config) — not constants here */
  developer?: string;
  contactEmail?: string;
  /** Reset to a fresh JSA — the same "เริ่มใหม่"/"สร้าง JSA ใหม่" action already
   * on EditorStep/PdfStep. No confirm dialog here for the same reason those
   * don't have one: in-progress work is already autosaved to history as the
   * user types, so nothing is actually lost, just navigated away from. Optional
   * so AppBar doesn't require a working reset in contexts that don't have one. */
  onHome?: () => void;
}) {
  const [aboutOpen, setAboutOpen] = useState(false);

  // Logo + name, sized as a pair: on phones the title matches the height of
  // the "OR" letters; from sm up the text is two lines, so the logo grows to
  // match it and a thin divider keeps the two from reading as one blob.
  const brandRow = "flex min-w-0 items-center gap-3 sm:gap-4";
  const brand = (
    <>
      <img src={logoUrl} alt="OR" className="h-7 w-auto shrink-0 sm:h-9" />
      <span className="hidden h-8 w-px shrink-0 bg-line sm:block" aria-hidden="true" />
      <span className="min-w-0 text-left">
        <span className="block font-title text-lg font-semibold leading-tight tracking-tight text-navy">
          {appName}
        </span>
        {/* Hidden below sm: at phone width it only ever showed as a
            cut-off "…ความปล…", and the page's own heading right below
            already says what this is */}
        <span className="hidden truncate text-xs text-muted sm:block">
          เครื่องมือช่วยวิเคราะห์ความเสี่ยงเพื่อความปลอดภัยในการทำงาน
        </span>
      </span>
    </>
  );

  return (
    <header
      // Frosted glass: the page scrolls under this sticky bar, so a little of
      // it shows through. 80% white keeps the bar's text at full contrast;
      // browsers without backdrop-filter get a near-solid 95% instead of a
      // see-through bar with nothing blurred.
      // z-30: above anything that scrolls under it — Stepper nodes and
      // StepCard's focused cell are positioned (z-10), and at an equal z the
      // later element wins — but below dialogs (z-50).
      className="sticky top-0 z-30 border-b border-line bg-surface/95 supports-backdrop-filter:bg-surface/80 supports-backdrop-filter:backdrop-blur-md"
    >
      {/* Explicit height (not just py-2.5) so EditorStep's sticky column
          header — lg only, so always past this sm: breakpoint — has a fixed
          offset to park under instead of guessing. sm: reads --appbar-h
          (tokens.css) directly rather than a plain h-16, so that's the one
          place to change it — no second value to remember to update. */}
      <div className="mx-auto flex h-14 max-w-[var(--page-max-w)] items-center gap-4 px-4 sm:h-[var(--appbar-h)]">
        {onHome ? (
          <button
            type="button"
            onClick={onHome}
            aria-label={`${appName} — กลับไปเริ่มต้นใหม่`}
            className={`${brandRow} rounded-md
                        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50`}
          >
            {brand}
          </button>
        ) : (
          <div className={brandRow}>{brand}</div>
        )}

        <Button
          type="button"
          variant="ghost"
          className="ml-auto shrink-0 px-2.5 text-sm"
          onClick={() => setAboutOpen(true)}
          aria-label="เกี่ยวกับ"
        >
          <Info className="size-4" aria-hidden="true" />
          <span className="hidden sm:inline" aria-hidden="true">เกี่ยวกับ</span>
        </Button>
      </div>

      <InfoDialog
        open={aboutOpen}
        title={`เกี่ยวกับ ${appName}`}
        icon={<Info className="size-4" aria-hidden="true" />}
        onClose={() => setAboutOpen(false)}
      >
        <AboutSection icon={Sparkles} title="สิ่งที่ระบบนี้ทำ">
          <p>
            {appName} ช่วยวิเคราะห์ความเสี่ยงเพื่อความปลอดภัยในการทำงาน (Job
            Safety Analysis) — อธิบายงานที่จะทำเป็นภาษาไทย ระบบจะร่าง
            JSA ให้ตรวจทานและแก้ไข ก่อนเปิดเป็นเอกสาร PDF
            หลังจากนั้นยังสามารถให้ระบบร่าง
            &ldquo;ขั้นตอนปฏิบัติงาน&rdquo; จาก JSA นั้นได้อีกด้วย
            สำหรับใช้เป็นวิธีปฏิบัติงานอย่างละเอียดหน้างานจริง
          </p>
        </AboutSection>

        <AboutSection icon={ListChecks} title="ขั้นตอนการใช้งาน">
          <ol className="list-decimal space-y-1 pl-5">
            <li>กรอกรายละเอียดงานและชื่อหัวหน้างาน</li>
            <li>ระบบร่าง JSA ให้อัตโนมัติ</li>
            <li>ตรวจทานและแก้ไขทุกช่องให้ตรงกับงานจริง</li>
            <li>เปิดเอกสาร PDF เพื่อบันทึกหรือพิมพ์</li>
            <li>
              (ไม่บังคับ) เลือก &ldquo;สร้างขั้นตอนปฏิบัติงานด้วย&rdquo; ในหน้าแรก
              หรือกด &ldquo;สร้างขั้นตอนปฏิบัติงาน&rdquo; ในหน้าเอกสาร JSA
              เพื่อให้ระบบขยายแต่ละขั้นตอนเป็นวิธีทำอย่างละเอียด แนบรูปภาพประกอบได้
              ตรวจทานแล้วเปิดเป็น PDF อีกฉบับ
            </li>
          </ol>
        </AboutSection>

        <AboutSection icon={Lightbulb} title="ข้อแนะนำ">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              อธิบายงานให้ละเอียดที่สุด รวมขั้นตอนที่คิดไว้แล้ว —
              รายละเอียดที่ครบถ้วนช่วยให้ JSA ตรงกับงานจริงมากขึ้น
            </li>
            <li>
              ระบบเป็นผู้ร่างเท่านั้น ต้องตรวจทานทุกช่องก่อนสร้าง PDF
              เพราะหัวหน้างานคือผู้รับผิดชอบ
            </li>
            <li>ข้อสันนิษฐานที่ระบบใช้จะแสดงในหน้าตรวจทาน ควรตรวจสอบว่าตรงกับหน้างานจริง</li>
            <li>
              งานที่วิเคราะห์แล้วจะแสดงในรายการ &ldquo;งานที่เคยวิเคราะห์&rdquo;
              ในหน้าแรก เปิดขึ้นมาแก้ไขและสร้าง PDF ใหม่ได้
              — หากต้องการเก็บถาวร ควรบันทึกเป็นไฟล์ PDF ไว้
            </li>
          </ul>
        </AboutSection>

        <AboutSection icon={ShieldCheck} title="ความเป็นส่วนตัว">
          <div className="space-y-1">
            <p>
              ระบบนี้ไม่เก็บข้อมูล JSA หรือขั้นตอนปฏิบัติงานไว้บนเซิร์ฟเวอร์
              ยกเว้นรายการ &ldquo;งานที่เคยวิเคราะห์&rdquo;
              ที่เก็บไว้ในเบราว์เซอร์ของเครื่องนี้เท่านั้น โดยไม่มีวันหมดอายุ (สูงสุด {MAX_ENTRIES} งานล่าสุด)
              และลบได้ตลอดเวลา หากใช้เครื่องร่วมกับผู้อื่น ควรล้างประวัติหลังใช้งาน
            </p>
          </div>
        </AboutSection>

        <AboutSection icon={FileText} title="เกี่ยวกับระบบนี้">
          <div className="space-y-1">
            {documentMeta ? (
              <p>
                อ้างอิงแบบฟอร์ม {documentMeta.formCode} {documentMeta.footerText}
              </p>
            ) : null}
            {developer || department ? (
              <p>
                พัฒนาโดย {[developer, department].filter(Boolean).join(" · ")}
              </p>
            ) : null}
            {contactEmail ? (
              <p className="flex items-center gap-1.5">
                <Mail className="size-3.5 shrink-0" aria-hidden="true" />
                <a href={`mailto:${contactEmail}`} className="text-navy hover:underline">
                  {contactEmail}
                </a>
              </p>
            ) : null}
            <div className="mt-2 flex items-center gap-2">
              <span
                className="size-2 rounded-full bg-[var(--success)]"
                aria-hidden="true"
              />
              <span className="text-ink">พร้อมใช้งาน</span>
            </div>
          </div>
        </AboutSection>
      </InfoDialog>
    </header>
  );
}
