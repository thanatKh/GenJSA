/* Step 1 — Input
 *
 * Three required fields per the requirement: supervisor name / analysis date /
 * work description, plus the optional analyst name printed under the PDF's
 * ผู้วิเคราะห์ sign-off line.
 * No fields for company / location / equipment — if important, the user can write them into the description.
 */

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Building2, Check, ChevronDown, RotateCcw, Sparkles } from "lucide-react";

import {
  Alert,
  AutoGrowTextarea,
  Button,
  ConfirmDialog,
  FieldError,
  Input,
  Label,
} from "../../components/ui";
import {
  type CompanyLogo,
  clearCompanyProfile,
  loadCompanyProfile,
  saveCompanyProfile,
} from "../../lib/companyLogo";
import { CompanyLogoField } from "../company/CompanyLogoField";
import { loadNames, saveNames } from "../../lib/rememberedNames";
import { inputFormSchema, type InputForm } from "../../lib/schema";
import { inputDraft } from "../../store";
import { COMBINED_STAGES, JSA_STAGES } from "./generatingStages";
import { GeneratingPanel, TYPICAL_MAX_SECONDS, TYPICAL_MIN_SECONDS } from "./GeneratingPanel";
import { ModeSwitch } from "./ModeSwitch";

const EMPTY_FORM = (): InputForm => ({
  supervisor: "",
  analyst: "",
  company: "",
  work_description: "",
});

// One random example per mount rather than one fixed placeholder — a single
// example nudges every user toward describing "a pump job," which skews the
// AI draft's assumptions. Spanning several disciplines (mechanical,
// electrical, instrument, civil, process safety, lifting) and a few writing
// lengths/styles signals that any level of detail and any kind of work is
// fine to type here.
const PLACEHOLDERS = [
  "เช่น เปลี่ยน mechanical seal ของ LPG Pump P-400 ที่ Tank Farm " +
    "ต้อง isolate ปั๊ม ระบายความดันและ drain product ก่อนเริ่มงาน " +
    "จากนั้นถอด seal เดิม ติดตั้ง seal ใหม่ และตรวจสอบการรั่วก่อนคืนระบบ",

  "เช่น ตรวจสอบและบำรุงรักษา Circuit Breaker ในตู้ MCC-02 ห้องไฟฟ้า Sub 3 " +
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
    "หลังจากสูบถ่ายน้ำมันออกหมดแล้ว ต้องตรวจวัดบรรยากาศ (gas test) " +
    "วัดออกซิเจน แก๊สไวไฟ และแก๊สพิษก่อนเข้า ติดตั้งพัดลมระบายอากาศ " +
    "มีคนเฝ้าหน้าถังตลอดเวลา และสวมชุด SCBA หากจำเป็น",

  "ยกเครื่อง (overhaul) เครื่อง Boild Off Gas Compressor C-90912A" +
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
    "1. ขออนุญาตทำงาน (work permit) และตัด LOTO ปั๊ม\n" +
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
    "2. ตรวจวัดบรรยากาศ (gas test) ก่อนเข้าไปทุกครั้ง\n" +
    "3. ติดตั้งพัดลมระบายอากาศต่อเนื่อง\n" +
    "4. มี standby man เฝ้าหน้าถังตลอดเวลาทำงาน\n" +
    "5. ทำความสะอาดตะกอนและตรวจสอบสภาพผนังถัง",
] as const;

export function InputStep({
  onGenerate,
  onSkipToManual,
  onCancel,
  onCancelGenerate,
  busy,
  error,
}: {
  onGenerate: (values: InputForm, withProcedure: boolean, companyLogo: CompanyLogo | null) => void;
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
}) {
  const [confirmReset, setConfirmReset] = useState(false);
  // Picked once per mount (not per render/keystroke) — re-rolling while the
  // user types would make the placeholder text jump around underneath them
  const [placeholder] = useState(
    () => PLACEHOLDERS[Math.floor(Math.random() * PLACEHOLDERS.length)],
  );
  // ModeSwitch's "เฉพาะ JSA / JSA + ขั้นตอนปฏิบัติงาน" — deliberately local
  // state, not part of InputForm/the sessionStorage draft: every fresh JSA
  // starts on "เฉพาะ JSA" so this never silently doubles the wait for
  // someone who didn't ask for it, while the switch at the top of the form
  // shows every first-time visitor that GenJSA can produce both documents. The doubled-wait warning lives in GeneratingPanel once busy
  // starts (typicalMin/MaxSeconds), not repeated here.
  const [withProcedure, setWithProcedure] = useState(false);

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

  const [companyOpen, setCompanyOpen] = useState(
    () => !!(getValues("company")?.trim() || companyLogo),
  );

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
    !values.work_description?.trim();

  const applyReset = () => {
    // Remembered names and company survive ล้างฟอร์ม — they're settings, not a draft
    reset({ ...EMPTY_FORM(), ...loadNames(), company: loadCompanyProfile()?.name ?? "" });
    inputDraft.clear();
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
        {busy
          ? withProcedure
            ? "กำลังสร้าง JSA และขั้นตอนปฏิบัติงาน"
            : "กำลังสร้าง JSA"
          : "วิเคราะห์ความเสี่ยงเพื่อความปลอดภัยในการทำงาน"}
      </h1>
      {busy ? null : (
        <p className="mt-1.5 text-muted">
          ระบุรายละเอียดงานที่จะปฏิบัติ ระบบจะร่าง JSA เพื่อให้ตรวจทาน
        </p>
      )}

      {busy ? (
        // Replace the form entirely while generating — fields are disabled anyway,
        // and this guarantees the loading state is visible immediately with no
        // scrolling, instead of appearing below a possibly-long textarea.
        // withProcedure is read here, not reset once busy starts, so it still
        // reflects exactly what was submitted — safe to read mid-flight since
        // the checkbox itself is gone from the screen while this renders.
        <GeneratingPanel
          onCancel={onCancelGenerate}
          stages={withProcedure ? COMBINED_STAGES : JSA_STAGES}
          typicalMinSeconds={withProcedure ? TYPICAL_MIN_SECONDS * 2 : undefined}
          typicalMaxSeconds={withProcedure ? TYPICAL_MAX_SECONDS * 2 : undefined}
        />
      ) : (
        <form
          onSubmit={handleSubmit((values) => {
            rememberForNextTime(values);
            onGenerate(values, withProcedure, companyLogo);
          })}
          className="mt-6 grid gap-5"
          noValidate
        >
          <ModeSwitch withProcedure={withProcedure} onChange={setWithProcedure} />

          <div>
            <Label htmlFor="work_description" required>
              รายละเอียดงาน
            </Label>
            <AutoGrowTextarea
              id="work_description"
              minRows={6}
              maxRows={16}
              placeholder={placeholder}
              aria-invalid={!!errors.work_description}
              aria-describedby="work_description_hint"
              {...register("work_description")}
            />
            <p id="work_description_hint" className="mt-1.5 text-sm text-muted">
              ระบุขั้นตอนการปฏิบัติงานที่ทราบให้ครบถ้วน เพื่อให้ JSA ตรงกับงานจริงมากที่สุด
            </p>
            <FieldError>{errors.work_description?.message}</FieldError>
          </div>

          <div>
            <Label htmlFor="supervisor" required>
              ชื่อหัวหน้างาน
            </Label>
            <Input
              id="supervisor"
              autoComplete="name"
              aria-invalid={!!errors.supervisor}
              {...register("supervisor")}
            />
            <FieldError>{errors.supervisor?.message}</FieldError>
          </div>

          <div>
            <Label htmlFor="analyst">ผู้วิเคราะห์</Label>
            <Input
              id="analyst"
              autoComplete="name"
              aria-invalid={!!errors.analyst}
              {...register("analyst")}
            />
            <FieldError>{errors.analyst?.message}</FieldError>
          </div>

          {/* Company — collapsed unless something is already filled in.
              rounded-field (18px), the same as the text box above it, and
              overflow-hidden so the header's hover background takes the
              box's own corners: rounded all round when closed, rounded on
              top and straight along the divider when open. The header has
              no radius of its own — with one, its bottom corners curved
              against the straight divider. */}
          <div className="overflow-hidden rounded-field border border-line">
            <button
              type="button"
              onClick={() => setCompanyOpen((open) => !open)}
              aria-expanded={companyOpen}
              aria-controls="company_fields"
              className="flex w-full items-center gap-2 px-3.5 py-3 text-left text-sm
                         font-medium text-ink hover:bg-raised focus-visible:outline-none
                         focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
            >
              <Building2 className="size-4 shrink-0 text-muted" aria-hidden="true" />
              <span>
                บริษัท <span className="font-normal text-muted">(ไม่บังคับ)</span>
              </span>
              {!companyOpen && values.company?.trim() ? (
                <span className="min-w-0 truncate font-normal text-muted">
                  · {values.company.trim()}
                </span>
              ) : null}
              <ChevronDown
                className={`ml-auto size-4 shrink-0 text-muted transition-transform ${companyOpen ? "rotate-180" : ""}`}
                aria-hidden="true"
              />
            </button>
            {companyOpen ? (
              <div id="company_fields" className="grid gap-4 border-t border-line px-3.5 pb-4 pt-3">
                <p className="text-sm text-muted">
                  สำหรับเอกสารที่จัดทำในนามบริษัท ชื่อและโลโก้ของบริษัทจะแสดงบนหัวเอกสาร PDF
                </p>
                <div>
                  <Label htmlFor="company">ชื่อบริษัท</Label>
                  <Input
                    id="company"
                    autoComplete="organization"
                    aria-invalid={!!errors.company}
                    {...register("company")}
                  />
                  <FieldError>{errors.company?.message}</FieldError>
                </div>
                <CompanyLogoField logo={companyLogo} onChange={setCompanyLogo} />
                <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={rememberCompany}
                    onClick={() => setRememberCompany((v) => !v)}
                    className={`flex size-5 shrink-0 items-center justify-center rounded border transition-colors ${
                      rememberCompany ? "border-navy bg-navy text-white" : "border-line bg-surface"
                    }`}
                  >
                    {rememberCompany ? <Check className="size-3.5" aria-hidden="true" /> : null}
                  </button>
                  <span className="text-ink">จำไว้สำหรับครั้งต่อไป</span>
                </label>
              </div>
            ) : null}
          </div>

          {error ? <Alert>{error}</Alert> : null}

          {/* Secondary on the left, primary on the right, both auto-width —
              matches EditorStep's footer (เริ่มใหม่ / สร้าง PDF) so the two
              most consequential actions in the app share one convention
              instead of each page inventing its own button arrangement.
              "สร้างเอกสาร" rather than "สร้าง JSA" — the label the rest of
              the app already uses for this generic case (ProcedureEditorStep's
              own submit button, PdfDeliveryCard's in-flight/error states).
              With "JSA + ขั้นตอนปฏิบัติงาน" chosen it becomes "สร้าง 2 เอกสาร", so
              the choice is visible at the moment of clicking. Deliberately
              short: a prior version swapped in the full "สร้าง JSA และ
              ขั้นตอนปฏิบัติงาน", which forced a full-width, two-line-tall
              button at narrow widths, disproportionate next to ล้างฟอร์ม. */}
          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="lg"
              onClick={() => setConfirmReset(true)}
              disabled={isEmpty}
            >
              <RotateCcw className="size-4" aria-hidden="true" />
              ล้างฟอร์ม
            </Button>
            <Button type="submit" size="lg">
              <Sparkles className="size-5" aria-hidden="true" />
              {withProcedure ? "สร้าง 2 เอกสาร" : "สร้างเอกสาร"}
            </Button>
          </div>

          {/* Explicit opt-in for users who'd rather type every field
              themselves than review an AI draft — not a stepper shortcut,
              since that would imply step 2/3 are always freely reachable.
              Only supervisor/date are required here; work_description isn't
              validated because it's only ever used to prompt the AI. */}
          <button
            type="button"
            onClick={skipToManual}
            className="justify-self-center text-sm text-muted underline decoration-dotted underline-offset-4 hover:text-navy"
          >
            ข้ามขั้นตอนนี้ กรอกแบบฟอร์ม JSA เองทั้งหมด
          </button>
        </form>
      )}

      <ConfirmDialog
        open={confirmReset}
        title="ล้างข้อมูลทั้งหมด?"
        description="ข้อมูลที่กรอกไว้จะถูกลบและกู้คืนไม่ได้"
        confirmLabel="ล้างฟอร์ม"
        onConfirm={applyReset}
        onCancel={() => setConfirmReset(false)}
      />
    </section>
  );
}
