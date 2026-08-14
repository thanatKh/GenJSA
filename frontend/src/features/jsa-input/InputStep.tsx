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
import { ArrowLeft, RotateCcw, Sparkles } from "lucide-react";

import {
  Alert,
  AutoGrowTextarea,
  Button,
  ConfirmDialog,
  FieldError,
  Input,
  Label,
} from "../../components/ui";
import { ThaiDatePicker } from "../../components/ThaiDatePicker";
import { inputFormSchema, type InputForm } from "../../lib/schema";
import { todayIso } from "../../lib/thaidate";
import { inputDraft } from "../../store";
import { GeneratingPanel } from "./GeneratingPanel";

const EMPTY_FORM = (): InputForm => ({
  supervisor: "",
  analyst: "",
  analysis_date: todayIso(),
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
  onGenerate: (values: InputForm) => void;
  onSkipToManual: (
    values: Pick<InputForm, "supervisor" | "analysis_date" | "analyst">,
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

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    trigger,
    getValues,
    formState: { errors },
  } = useForm<InputForm>({
    resolver: zodResolver(inputFormSchema),
    // Spread over the empty form, not instead of it — a draft saved before a
    // field existed would otherwise leave that input uncontrolled
    defaultValues: { ...EMPTY_FORM(), ...inputDraft.load() },
  });

  const values = watch();

  // Save the draft on every keystroke — data must survive an API error or refresh
  useEffect(() => {
    inputDraft.save(values);
  }, [values]);

  const isEmpty =
    !values.supervisor?.trim() &&
    !values.analyst?.trim() &&
    !values.work_description?.trim();

  const applyReset = () => {
    reset(EMPTY_FORM());
    inputDraft.clear();
    setConfirmReset(false);
    document.getElementById("supervisor")?.focus();
  };

  // Manual entry skips the AI draft entirely, so only the two header fields
  // (not work_description, which only matters for the AI prompt) need to
  // validate — a separate, narrower check from the full-form submit above.
  const skipToManual = async () => {
    const valid = await trigger(["supervisor", "analysis_date", "analyst"]);
    if (!valid) return;
    const { supervisor, analysis_date, analyst } = getValues();
    onSkipToManual({ supervisor, analysis_date, analyst });
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

      <h1 className="text-[1.75rem] font-semibold text-navy">
        วิเคราะห์ความเสี่ยงเพื่อความปลอดภัยในการทำงาน
      </h1>
      <p className="mt-1.5 text-muted">
        อธิบายว่าจะทำงานอะไร แล้วระบบจะร่าง JSA ให้ตรวจทาน
      </p>

      {busy ? (
        // Replace the form entirely while generating — fields are disabled anyway,
        // and this guarantees the loading state is visible immediately with no
        // scrolling, instead of appearing below a possibly-long textarea
        <GeneratingPanel onCancel={onCancelGenerate} />
      ) : (
        <form
          onSubmit={handleSubmit(onGenerate)}
          className="mt-6 grid gap-5"
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
              placeholder={placeholder}
              aria-invalid={!!errors.work_description}
              aria-describedby="work_description_hint"
              {...register("work_description")}
            />
            <p id="work_description_hint" className="mt-1.5 text-sm text-muted">
              ยิ่งระบุรายละเอียดครบถ้วน ระบบจะสามารถจัดทำ JSA
              ได้ตรงกับลักษณะงานจริงมากยิ่งขึ้น
              โปรดระบุขั้นตอนการปฏิบัติงานที่ทราบแล้วให้ครบถ้วน
            </p>
            <FieldError>{errors.work_description?.message}</FieldError>
          </div>

          <div>
            <Label htmlFor="analysis_date" required>
              วันที่วิเคราะห์
            </Label>
            <ThaiDatePicker
              id="analysis_date"
              value={values.analysis_date ?? ""}
              onChange={(next) =>
                setValue("analysis_date", next, { shouldValidate: true })
              }
            />
            <FieldError>{errors.analysis_date?.message}</FieldError>
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

          {error ? <Alert>{error}</Alert> : null}

          {/* Secondary on the left, primary on the right, both auto-width —
              matches EditorStep's footer (เริ่มใหม่ / สร้าง PDF) so the two
              most consequential actions in the app share one convention
              instead of each page inventing its own button arrangement */}
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
              สร้าง JSA
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
