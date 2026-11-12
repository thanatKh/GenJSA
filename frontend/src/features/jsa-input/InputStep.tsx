/* Step 1 — Input
 *
 * Three required fields per the requirement: supervisor name / analysis date /
 * work description, plus the optional analyst name printed under the PDF's
 * ผู้วิเคราะห์ sign-off line.
 * No fields for company / location / equipment — if important, the user can write them into the description.
 */

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, RotateCcw, Sparkles } from "lucide-react";

import {
  Alert,
  AutoGrowTextarea,
  Button,
  ConfirmDialog,
  FieldError,
  Input,
  Label,
  Reveal,
} from "../../components/ui";
import {
  type CompanyLogo,
  clearCompanyProfile,
  loadCompanyProfile,
  saveCompanyProfile,
} from "../../lib/companyLogo";
import { CompanySection } from "../company/CompanySection";
import { loadNames, saveNames } from "../../lib/rememberedNames";
import { inputFormSchema, type InputForm, type JsaDocument } from "../../lib/schema";
import { todayIso } from "../../lib/thaidate";
import { FADE_IN_CLASS, screenFade } from "../../lib/motion";
import { advancedDraft, inputDraft } from "../../store";
import { GeneratingPanel } from "./GeneratingPanel";
import { AdvancedDraftScreen } from "./AdvancedDraftScreen";
import { parsePersonalDraft } from "../../lib/personalAi";
import type { JsaPromptRules } from "../../lib/api";

const EMPTY_FORM = (): InputForm => ({
  supervisor: "",
  analyst: "",
  company: "",
  work_description: "",
});
const headerSchema = inputFormSchema.pick({ supervisor: true, analyst: true, company: true });

// One random example per mount rather than one fixed placeholder — a single
// example nudges every user toward describing "a pump job," which skews the
// AI draft's assumptions. Spanning several disciplines (mechanical,
// electrical, instrument, civil, process safety, lifting) and a few writing
// lengths/styles signals that any level of detail and any kind of work is
// fine to type here.
const PLACEHOLDERS = [
  "เปลี่ยน mechanical seal ของ LPG Pump P-400 ที่คลัง " +
    "ต้อง isolate ปั๊ม ระบายความดันและ drain product ก่อนเริ่มงาน " +
    "จากนั้นถอด seal เดิม ติดตั้ง seal ใหม่ และตรวจสอบการรั่วก่อนคืนระบบ",

  "ตรวจสอบและบำรุงรักษา Circuit Breaker ในตู้ MCC-02 ห้องไฟฟ้า Sub 3 " +
    "ต้อง lock-out tag-out แหล่งจ่ายไฟก่อน ใช้ multimeter วัดแรงดันให้เป็นศูนย์ " +
    "ทำความสะอาดหน้าสัมผัส ขันน็อตให้ได้ค่าทอร์คตามสเปก " +
    "แล้วจึงจ่ายไฟกลับและทดสอบการทำงาน",

  "สอบเทียบ (calibration) Pressure Transmitter PT-204 ที่คุมความดันถังเก็บ LPG " +
    "โดยแยก transmitter ออกจากระบบ process ต่อ HART communicator และ pressure " +
    "calibrator เทียบค่าที่ 0%, 50%, 100% ปรับ span/zero ถ้าค่าคลาดเคลื่อนเกินเกณฑ์ " +
    "แล้วบันทึกผลก่อนคืนระบบ",

  "ติดตั้งนั่งร้าน (scaffolding) สูง 20 เมตร รอบถัง Tank T-80 " +
    "เพื่อให้ทีมตรวจสอบ non-destructive testing ขึ้นไปตรวจผนังถังด้านนอก " +
    "ต้องตรวจสอบพื้นดินรับน้ำหนักก่อน ประกอบโครงเหล็กเป็นชั้น ๆ " +
    "ติดตั้งราวกันตกและตาข่ายกันของตกทุกชั้น " +
    "แล้วให้ผู้ตรวจสอบนั่งร้านเซ็นรับรองก่อนใช้งาน",

  "เข้าไปทำความสะอาดภายในถัง (confined space entry) ถังเก็บน้ำมันดีเซล T-79 " +
    "หลังจากสูบถ่ายน้ำมันออกหมดแล้ว ต้องตรวจวัดบรรยากาศ (Check Gas) " +
    "วัดออกซิเจน แก๊สไวไฟ และแก๊สพิษก่อนเข้า ติดตั้งพัดลมระบายอากาศ " +
    "มีคนเฝ้าหน้าถังตลอดเวลา และสวมชุด SCBA หากจำเป็น",

  "ยกเครื่อง (overhaul) เครื่อง Boil-Off Gas Compressor C-90912A " +
    "ประจำปี ปลดสายพานและถอดฝาครอบ ตรวจสอบ bearing, valve plate และ ring " +
    "วัดค่า clearance เทียบกับ manual เปลี่ยนชิ้นส่วนที่สึกหรอ ประกอบกลับ " +
    "และรันทดสอบโดยไม่มีโหลดก่อน 30 นาที",

  "ทำ hot tap เจาะท่อ 8 นิ้วที่ส่งน้ำมันดิบขณะระบบยังมีการไหลอยู่ " +
    "เพื่อติดตั้งจุดต่อวาล์วใหม่ ทีมงานต้องมีใบอนุญาตทำงานร้อน (hot work permit) " +
    "ตรวจสอบความดันในท่อ เตรียมอุปกรณ์ดับเพลิงประจำจุด " +
    "และมี fire watch ตลอดการเจาะจนกว่าจะปิดวาล์วสำเร็จ",

  "เปลี่ยน actuator ของ control valve FCV-112 ที่ควบคุมอัตราการไหลในไลน์ผลิตภัณฑ์ " +
    "ต้องปิดวาล์วมือก่อน ปลดสาย air supply และสายสัญญาณ 4-20mA ถอด actuator " +
    "เก่าออก ติดตั้งตัวใหม่ ต่อสายและปรับ calibrate 0-100% " +
    "ให้ตรงกับค่าตำแหน่งวาล์วก่อนคืนระบบ",

  "เดินสายไฟและต่อหัวสาย (cable termination) ป้อนไฟให้ปั๊มตัวใหม่ P-90521 " +
    "จากตู้ MDB อาคาร Sub 3 ระยะทางประมาณ 150 เมตร ผ่าน cable tray " +
    "ต้อง lockout แหล่งจ่ายก่อนทำงานใกล้ตู้ไฟ ดึงสายผ่านท่อร้อยสาย " +
    "ต่อหัวสายตามมาตรฐาน แล้ววัดค่าความเป็นฉนวนก่อนจ่ายไฟ",

  "ยกเครื่องแลกเปลี่ยนความร้อน (heat exchanger) E-94004A น้ำหนักประมาณ 8 ตัน " +
    "ลงจากรถเทรลเลอร์และเคลื่อนย้ายเข้าตำแหน่งติดตั้งด้วยเครนขนาด 50 ตัน " +
    "ต้องตรวจสอบ lifting plan และใบรับรองสลิงก่อนยก กั้นพื้นที่ใต้แนวยก " +
    "ห้ามคนเดินผ่าน และมี signal man สื่อสารกับผู้ควบคุมเครนตลอดการยก",

  // The 10 above are all one paragraph — these 5 show the other way people
  // actually write this stuff (numbered steps / dashed bullets), so the
  // placeholder doesn't quietly imply prose is the only accepted format
  "เปลี่ยนแบริ่งของปั๊ม Fresh Water ตัว B\n" +
    "1. ขออนุญาตทำงาน (Work Permit) และตัด LOTO ปั๊ม\n" +
    "2. ถอดฝาครอบและแบริ่งเดิมออก\n" +
    "3. ตรวจสอบเพลาและตำแหน่งแบริ่งใหม่\n" +
    "4. ประกอบแบริ่งใหม่และฝาครอบ\n" +
    "5. ทดสอบเดินเครื่องและตรวจสอบการสั่นสะเทือน",

  "ตรวจสอบ PM ตู้สวิตช์เกียร์ประจำปี\n" +
    "- lock-out tag-out แหล่งจ่ายไฟหลักก่อนเริ่มงาน\n" +
    "- ทำความสะอาดภายในตู้และตรวจสอบฉนวน\n" +
    "- วัดค่าความต้านทานฉนวน (megger test)\n" +
    "- ขันน็อตจุดต่อสายให้ได้ค่าทอร์คตามสเปก\n" +
    "- บันทึกผลตรวจสอบก่อนจ่ายไฟกลับ",

  "สอบเทียบและเปลี่ยน Flow Meter FT-330 แบบ Online\n" +
    "1. แจ้งห้องควบคุมและปิดวาล์ว isolation ทั้งสองด้าน\n" +
    "2. ระบายความดันและถ่ายของเหลวค้างในท่อ\n" +
    "3. ถอด flow meter เดิมออก\n" +
    "4. ติดตั้งตัวใหม่พร้อมปะเก็น\n" +
    "5. เปิดวาล์วทีละน้อยและตรวจสอบการรั่วซึม",

  "ยกและติดตั้ง Heat Exchanger ด้วยเครนขนาด 25 ตัน\n" +
    "- ตรวจสอบ lifting plan และใบรับรองอุปกรณ์ยกทั้งหมด\n" +
    "- กั้นพื้นที่ใต้แนวยกและห้ามคนเดินผ่าน\n" +
    "- ติดตั้ง tag line ควบคุมการแกว่งของโหลด\n" +
    "- มี signal man สื่อสารกับผู้ควบคุมเครนตลอดเวลา\n" +
    "- ตรวจสอบตำแหน่งและยึดฐานให้แน่นหลังวางถัง",

  "ทำความสะอาดภายในถังเก็บน้ำมันดิบ T-67 เพื่อตรวจสอบตามวาระ 15 ปี\n" +
    "1. สูบถ่ายน้ำมันออกและล้างด้วยไอน้ำ\n" +
    "2. ตรวจวัดบรรยากาศ (Check Gas) ก่อนเข้าไปทุกครั้ง\n" +
    "3. ติดตั้งพัดลมระบายอากาศต่อเนื่อง\n" +
    "4. มี standby man เฝ้าหน้าถังตลอดเวลาทำงาน\n" +
    "5. ทำความสะอาดตะกอนและตรวจสอบสภาพผนังถัง",
] as const;

export function InputStep({
  withProcedure,
  onGenerate,
  onImportDraft,
  advanced,
  onOpenAdvanced,
  onCloseAdvanced,
  onSkipToManual,
  onCancel,
  onCancelGenerate,
  busy,
  error,
  jsaRules,
}: {
  /** ModeChoice's "JSA + Procedure", chosen above this form (App.tsx). Only
   * changes the wording here: this screen drafts the JSA either way, and the
   * procedure is drafted later, from the JSA once it has been reviewed. */
  withProcedure: boolean;
  onGenerate: (values: InputForm, companyLogo: CompanyLogo | null) => void;
  onImportDraft: (doc: JsaDocument, companyLogo: CompanyLogo | null) => void;
  advanced: boolean;
  onOpenAdvanced: () => void;
  onCloseAdvanced: () => void;
  onSkipToManual: (
    values: Pick<InputForm, "supervisor" | "analyst" | "company">,
    companyLogo: CompanyLogo | null,
  ) => void;
  // Only passed when there's an existing document to return to (reached via
  // the stepper's back-navigation, not a fresh session) — submitting or
  // skipping from here still replaces that document, same as always; this
  // only adds a way to leave without doing either.
  onCancel?: () => void;
  // Aborts the in-flight generate request — passed straight through to
  // GeneratingPanel, which is the only place it's ever shown
  onCancelGenerate?: () => void;
  busy: boolean;
  error: string | null;
  /** config/jsa-rules.yaml's lists, for the advanced mode's prompt. */
  jsaRules?: JsaPromptRules;
}) {
  const [confirmReset, setConfirmReset] = useState(false);
  // Picked once per mount (not per render/keystroke) — re-rolling while the
  // user types would make the placeholder text jump around underneath them
  const [placeholder] = useState(
    () => PLACEHOLDERS[Math.floor(Math.random() * PLACEHOLDERS.length)],
  );

  // The company section ("บริษัท (ไม่บังคับ)") — for documents prepared in
  // another company's name, e.g. a vendor submitting to PTTOR. Prefilled
  // from the remembered default (lib/companyLogo.ts), and open from the
  // start when there is one; collapsed otherwise so PTTOR's own users never
  // have to deal with it. The name lives in the form (and its draft); the
  // logo is local state, handed to App with the submit.
  const [profile] = useState(loadCompanyProfile);
  // หัวหน้างาน / ผู้วิเคราะห์ from last time (lib/rememberedNames.ts) — the
  // starting values, still editable; this tab's own draft wins over them
  const [names] = useState(loadNames);
  const [companyLogo, setCompanyLogo] = useState<CompanyLogo | null>(() => profile?.logo ?? null);
  const [rememberCompany, setRememberCompany] = useState(true);

  const {
    register,
    handleSubmit,
    watch,
    reset,
    trigger,
    getValues,
    formState: { errors },
  } = useForm<InputForm>({
    resolver: zodResolver(inputFormSchema),
    // Spread over the empty form, not instead of it — a draft saved before a
    // field existed would otherwise leave that input uncontrolled
    defaultValues: { ...EMPTY_FORM(), ...names, company: profile?.name ?? "", ...inputDraft.load() },
  });

  /** Apply "จำไว้ในเบราว์เซอร์นี้" at the moment a document is created */
  const rememberOrForgetCompany = (name: string) => {
    if (rememberCompany) saveCompanyProfile({ name: name.trim(), logo: companyLogo });
    else clearCompanyProfile();
  };

  /** Everything remembered for next time, applied when a document is created */
  const rememberForNextTime = ({ supervisor, analyst, company }: Pick<InputForm, "supervisor" | "analyst" | "company">) => {
    saveNames({ supervisor, analyst });
    rememberOrForgetCompany(company);
  };

  const values = watch();

  // Save the draft on every keystroke — data must survive an API error or refresh
  useEffect(() => {
    inputDraft.save(values);
  }, [values]);

  // "Empty" = nothing beyond what the form starts with, so ล้างฟอร์ม stays
  // disabled when only the remembered names are filled in
  const isEmpty =
    (values.supervisor ?? "").trim() === names.supervisor &&
    (values.analyst ?? "").trim() === names.analyst &&
    (values.company ?? "").trim() === (profile?.name ?? "").trim() &&
    companyLogo?.data === profile?.logo?.data &&
    !values.work_description?.trim();

  const applyReset = () => {
    // Remembered names and company survive ล้างฟอร์ม — they're settings, not a draft
    const savedCompany = loadCompanyProfile();
    reset({ ...EMPTY_FORM(), ...loadNames(), company: savedCompany?.name ?? "" });
    setCompanyLogo(savedCompany?.logo ?? null);
    setRememberCompany(true);
    inputDraft.clear();
    advancedDraft.clear("jsa");
    setConfirmReset(false);
    document.getElementById("supervisor")?.focus();
  };

  // Manual entry skips the AI draft entirely, so only the two header fields
  // (not work_description, which only matters for the AI prompt) need to
  // validate — a separate, narrower check from the full-form submit above.
  const skipToManual = async () => {
    const valid = await trigger(["supervisor", "analyst", "company"]);
    if (!valid) return;
    const { supervisor, analyst, company } = getValues();
    rememberForNextTime({ supervisor, analyst, company });
    onSkipToManual({ supervisor, analyst, company: company.trim() }, companyLogo);
  };

  if (advanced) {
    return (
      <AdvancedDraftScreen
        kind="jsa"
        jsaRules={jsaRules}
        description={getValues("work_description")}
        backLabel="กลับไปกรอกข้อมูล"
        onBack={onCloseAdvanced}
        parse={(answer) => {
          if (!headerSchema.safeParse(getValues()).success) {
            throw new Error("กรุณากลับไปตรวจข้อมูลหัวเอกสารก่อนนำเข้าร่าง");
          }
          return parsePersonalDraft(answer);
        }}
        onImport={({ work_activity, steps, assumptions }) => {
          const { supervisor, analyst, company } = getValues();
          const header = {
            work_activity,
            supervisor: supervisor.trim(),
            analyst: analyst.trim(),
            company: company.trim(),
            project: "",
            analysis_date: todayIso(),
          };
          rememberForNextTime(header);
          onImportDraft({ header, steps, assumptions }, companyLogo);
        }}
      />
    );
  }

  return (
    <section>
      {/* Only reachable by jumping back from the stepper (see onCancel's
          doc), and hidden while busy — a regenerate already in flight has no
          abort, so leaving this visible could let it silently overwrite the
          document being reviewed with a fresh AI draft once the call resolves */}
      {onCancel && !busy ? (
        <button
          type="button"
          onClick={onCancel}
          className="mb-3 flex items-center gap-1 text-sm text-muted hover:text-navy"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          กลับไปหน้าตรวจทาน
        </button>
      ) : null}

      {/* Swaps to a dedicated "กำลังสร้าง…" heading while busy, matching how
          App.tsx's two procedure-generation call sites already do it
          (กำลังสร้างขั้นตอนปฏิบัติงาน / …ใหม่) — this page used to keep its
          idle title showing through the whole generate, the one place JSA
          and procedure loading didn't read as the same pattern. */}
      <h1 className="text-2xl font-semibold sm:text-[1.75rem] text-navy">
        <span key={busy ? "busy" : "idle"} className={FADE_IN_CLASS}>
        {busy ? "กำลังสร้าง JSA" : "วิเคราะห์ความเสี่ยงเพื่อความปลอดภัยในการทำงาน"}
        </span>
      </h1>
      {busy ? null : (
        <p className="mt-1.5 text-muted">
          {withProcedure
            ? "ระบุรายละเอียดงานที่จะปฏิบัติ ระบบจะร่าง JSA ให้ตรวจทานก่อน แล้วจึงร่างขั้นตอนปฏิบัติงานจาก JSA ที่ตรวจแล้ว"
            : "ระบุรายละเอียดงานที่จะปฏิบัติ ระบบจะร่าง JSA เพื่อให้ตรวจทาน"}
        </p>
      )}

      {/* Form and progress panel trade places with a fade (mode="wait": the
          old one leaves first, so the two are never on screen together) */}
      <AnimatePresence mode="wait" initial={false}>
      {busy ? (
        <motion.div key="busy" variants={screenFade} initial="initial" animate="animate" exit="exit">
        {/* Replace the form entirely while generating — fields are disabled anyway,
            and this guarantees the loading state is visible immediately with no
            scrolling, instead of appearing below a possibly-long textarea. */}
        <GeneratingPanel onCancel={onCancelGenerate} />
              </motion.div>
) : (
        <motion.div key="form" variants={screenFade} initial="initial" animate="animate" exit="exit">
        <form
          onSubmit={handleSubmit((values) => {
            rememberForNextTime(values);
            onGenerate(values, companyLogo);
          })}
          className="mt-4 grid gap-4"
          noValidate
        >
          <div>
            <Label htmlFor="work_description" required>
              รายละเอียดงาน
            </Label>
            <AutoGrowTextarea
              id="work_description"
              minRows={6}
              maxRows={16}
              // "เช่น" added here, once, so every example reads as one
              placeholder={`เช่น ${placeholder}`}
              aria-invalid={!!errors.work_description}
              required
              aria-describedby={`work_description_hint${errors.work_description ? " work_description_error" : ""}`}
              {...register("work_description")}
            />
            <p id="work_description_hint" className="mt-1.5 text-sm text-muted">
              ระบุขั้นตอนการปฏิบัติงานที่ทราบให้ครบถ้วน เพื่อให้ JSA ตรงกับงานจริงมากที่สุด
            </p>
            <FieldError id="work_description_error">{errors.work_description?.message}</FieldError>
          </div>

          <div>
            <Label htmlFor="supervisor" required>
              ชื่อหัวหน้างาน
            </Label>
            <Input
              id="supervisor"
              required
              aria-describedby={errors.supervisor ? "supervisor_error" : undefined}
              autoComplete="name"
              aria-invalid={!!errors.supervisor}
              {...register("supervisor")}
            />
            <FieldError id="supervisor_error">{errors.supervisor?.message}</FieldError>
          </div>

          <div>
            <Label htmlFor="analyst">ผู้วิเคราะห์</Label>
            <Input
              id="analyst"
              aria-describedby={errors.analyst ? "analyst_error" : undefined}
              autoComplete="name"
              aria-invalid={!!errors.analyst}
              {...register("analyst")}
            />
            <FieldError id="analyst_error">{errors.analyst?.message}</FieldError>
          </div>

          <CompanySection
            name={values.company ?? ""}
            nameField={
              <>
                <Input
                  id="company"
                  aria-describedby={errors.company ? "company_error" : undefined}
                  autoComplete="organization"
                  aria-invalid={!!errors.company}
                  {...register("company")}
                />
                <FieldError id="company_error">{errors.company?.message}</FieldError>
              </>
            }
            logo={companyLogo}
            onLogoChange={setCompanyLogo}
            footer={
              // Only here: remembering happens when a document is created
              <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={rememberCompany}
                  onChange={(event) => setRememberCompany(event.target.checked)}
                  className="size-5 shrink-0 accent-navy"
                />
                <span className="text-ink">จำไว้สำหรับครั้งต่อไป</span>
              </label>
            }
          />

          {/* -mt-4 + pt-4: inside the form's gap-4 grid, so the grid gap
              opens with the message instead of appearing all at once */}
          <Reveal show={!!error} className="-mt-4">
            <div className="pt-4">
              <Alert>{error}</Alert>
            </div>
          </Reveal>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="lg"
              onClick={() => setConfirmReset(true)}
              disabled={isEmpty}
              className="max-[359px]:px-3"
            >
              <RotateCcw className="size-4" aria-hidden="true" />
              ล้างฟอร์ม
            </Button>
            <Button type="submit" size="lg" className="max-[359px]:px-3">
              <Sparkles className="size-5" aria-hidden="true" />
              สร้างเอกสาร
            </Button>
          </div>

          <div className="flex min-w-0 items-center justify-center gap-2.5 text-sm">
            <button
              type="button"
              onClick={skipToManual}
              className="min-w-0 text-start text-muted underline decoration-dotted underline-offset-4 hover:text-navy pointer-coarse:min-h-12"
            >
              ข้ามขั้นตอนนี้ กรอกแบบฟอร์ม JSA เองทั้งหมด
            </button>
            <span aria-hidden="true" className="text-muted">·</span>
            <button
              type="button"
              className="shrink-0 px-1 text-navy underline decoration-dotted underline-offset-4 pointer-coarse:min-h-12"
              onClick={async () => {
                if (await trigger(["supervisor", "analyst", "company"], { shouldFocus: true })) onOpenAdvanced();
              }}
            >
              ใช้ AI ภายนอก
            </button>
          </div>
        </form>
        </motion.div>
      )}
      </AnimatePresence>

      <ConfirmDialog
        open={confirmReset}
        title="ล้างฟอร์ม?"
        description="ข้อมูลที่กรอกและร่างใน “ใช้ AI ภายนอก” จะถูกล้าง ชื่อและบริษัทที่จำไว้จะถูกเติมกลับมา"
        confirmLabel="ล้างฟอร์ม"
        onConfirm={applyReset}
        onCancel={() => setConfirmReset(false)}
      />
    </section>
  );
}
