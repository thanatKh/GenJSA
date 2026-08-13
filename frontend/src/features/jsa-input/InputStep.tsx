/* Step 1 — Input
 *
 * Only 3 fields per the requirement: supervisor name / analysis date / work description.
 * No fields for company / location / equipment — if important, the user can write them into the description.
 */

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { RotateCcw, Sparkles } from "lucide-react";

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

const PLACEHOLDER =
  "เช่น เปลี่ยน mechanical seal ของ LPG Pump P-101 ที่ Tank Farm " +
  "ต้อง isolate ปั๊ม ระบายความดันและ drain product ก่อนเริ่มงาน " +
  "จากนั้นถอด seal เดิม ติดตั้ง seal ใหม่ และตรวจสอบการรั่วก่อนคืนระบบ";

export function InputStep({
  onGenerate,
  onSkipToManual,
  busy,
  error,
}: {
  onGenerate: (values: InputForm) => void;
  onSkipToManual: (values: Pick<InputForm, "supervisor" | "analysis_date">) => void;
  busy: boolean;
  error: string | null;
}) {
  const [confirmReset, setConfirmReset] = useState(false);

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
    defaultValues:
      inputDraft.load() ?? {
        supervisor: "",
        analysis_date: todayIso(),
        work_description: "",
      },
  });

  const values = watch();

  // Save the draft on every keystroke — data must survive an API error or refresh
  useEffect(() => {
    inputDraft.save(values);
  }, [values]);

  const isEmpty =
    !values.supervisor?.trim() && !values.work_description?.trim();

  const applyReset = () => {
    reset({ supervisor: "", analysis_date: todayIso(), work_description: "" });
    inputDraft.clear();
    setConfirmReset(false);
    document.getElementById("supervisor")?.focus();
  };

  // Manual entry skips the AI draft entirely, so only the two header fields
  // (not work_description, which only matters for the AI prompt) need to
  // validate — a separate, narrower check from the full-form submit above.
  const skipToManual = async () => {
    const valid = await trigger(["supervisor", "analysis_date"]);
    if (!valid) return;
    const { supervisor, analysis_date } = getValues();
    onSkipToManual({ supervisor, analysis_date });
  };

  return (
    <section>
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
        <GeneratingPanel />
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
              placeholder={PLACEHOLDER}
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

          {error ? <Alert>{error}</Alert> : null}

          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Button type="submit" size="lg">
              <Sparkles className="size-5" aria-hidden="true" />
              สร้าง JSA
            </Button>
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
