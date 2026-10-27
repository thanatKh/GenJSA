/* One document's summary + open/save/share actions, as a single Card.
 *
 * Extracted from PdfStep so the same card can appear twice on
 * ProcedurePdfStep — once for the procedure, once for the JSA it was
 * generated from — without the open/save/share markup and its popup-blocking
 * caveats drifting between three copies. Each caller still owns its own
 * usePdfDelivery() call (a fresh blob lifecycle per document); this component
 * only renders what that hook returns.
 */

import { CircleCheck, FileDown, FileText, Save, Share2 } from "lucide-react";

import { Alert, Button, Card, Reveal } from "../../components/ui";
import { FADE_IN_CLASS } from "../../lib/motion";
import { cn } from "../../lib/utils";

export function PdfDeliveryCard({
  kicker,
  title,
  summary,
  delivery,
  secondary = false,
  word,
  className,
}: {
  /** Small label above the title naming which document this is — e.g.
   * "เอกสารขั้นตอนปฏิบัติงาน" / "เอกสาร JSA". Omit when the page's own H1
   * already says so (PdfStep's single-card case); required once two cards
   * for the same job sit on one page (ProcedurePdfStep), where both titles
   * read identically and the metadata rows are the only other differentiator. */
  kicker?: string;
  title: string;
  summary: { label: string; value: string }[];
  /** The relevant slice of a usePdfDelivery() result */
  delivery: {
    url: string | null;
    error: string | null;
    canSavePicker: boolean;
    canShareFile: boolean;
    saving: boolean;
    sharing: boolean;
    /** Transient post-success flash — see usePdfDelivery's own doc comment
     * on the state for why this exists (no confirmation at all otherwise). */
    savedFlash: boolean;
    sharedFlash: boolean;
    handleSave: () => void;
    handleShare: () => void;
  };
  /** Outline "เปิดเอกสาร PDF" instead of solid — for a supporting document
   * on a page that's about another one (the JSA on ProcedurePdfStep), so
   * the page has one solid button, on its own document. */
  secondary?: boolean;
  /** The editable Word twin — a usePdfDelivery({ format: "docx" }) result.
   * One quiet button under the PDF's actions: the PDF stays the document,
   * Word is for the job that has to change it further. */
  word?: {
    url: string | null;
    error: string | null;
    saving: boolean;
    sharing: boolean;
    savedFlash: boolean;
    sharedFlash: boolean;
    handleDeliver: () => void;
  };
  className?: string;
}) {
  const {
    url,
    error,
    canSavePicker,
    canShareFile,
    saving,
    sharing,
    savedFlash,
    sharedFlash,
    handleSave,
    handleShare,
  } = delivery;

  return (
    <Card className={className}>
      <div className="flex items-start gap-3">
        {url ? (
          <CircleCheck className={`size-6 shrink-0 text-navy ${FADE_IN_CLASS}`} aria-hidden="true" />
        ) : (
          <FileText className="size-6 shrink-0 text-muted" aria-hidden="true" />
        )}
        <div className="min-w-0">
          {/* No uppercase transform — kicker text can carry Latin letters now
              (e.g. "(Work Procedure)"), and CSS uppercase would shout an
              English gloss that reads fine in mixed case. It was a no-op on
              pure Thai anyway, which has no letter case to transform. */}
          {kicker ? (
            <span className="mb-0.5 block text-xs font-semibold tracking-wide text-navy">
              {kicker}
            </span>
          ) : null}
          <h2 className="font-display text-base font-semibold text-ink break-words">{title}</h2>
          <dl className="mt-2 grid gap-1 text-sm">
            {summary.map((row) => (
              // The label never wraps — the value does. A long value (a
              // supervisor with rank + title) used to squeeze the label into
              // "ชื่อ / หัวหน้า / งาน:" over three lines on a small phone.
              <div key={row.label} className="flex gap-1.5">
                <dt className="shrink-0 whitespace-nowrap text-muted">{row.label}:</dt>
                <dd className="min-w-0 break-words text-ink">{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      {/* Open/save live inside the same card as the document they act on, not
          as a detached row below it — a divider (not a new Card) marks "info"
          from "actions" while keeping them one visual unit. Open PDF spans
          both columns when there's no save/share button to sit beside it, so
          this stays exactly one row either way. */}
      <div className="mt-4 grid grid-cols-2 gap-2 border-t border-line pt-4">
        {url ? (
          // ⚠️ Never add a `download` attribute here — it forces an immediate
          // download (on mobile Chrome this saves silently to Downloads with
          // no dialog at all), which violates the "no auto-download"
          // requirement. Let target="_blank" open the native viewer instead,
          // and let the user save/print/share from its menu. The save button
          // below is not a loophole in that rule: the file picker always
          // shows a dialog and always lets the user choose the destination,
          // which is exactly what `download` skips.
          // asChild merges Button's classes onto the real <a> below without
          // introducing a <button> or JS-mediated navigation — the anchor
          // must stay a real, directly-clickable link to avoid mobile
          // Safari's popup blocking.
          <Button
            asChild
            variant={secondary ? "outline" : "default"}
            className={cn(FADE_IN_CLASS, !(canSavePicker || canShareFile) && "col-span-2")}
          >
            <a href={url} target="_blank" rel="noopener">
              <FileText className="size-4" aria-hidden="true" />
              เปิดเอกสาร PDF
            </a>
          </Button>
        ) : (
          // status, not a hand-rolled spinner + bare `disabled` — this was
          // the one button on the page still built the pre-status-prop way
          // (a raw <LoaderCircle className="animate-spin">, no whileHover/
          // whileTap at all since disabled also gates those). Routing it
          // through Button's own status="loading"/"error" gives it the same
          // animated icon-swap (AnimatePresence, not a static icon) every
          // other button on this card already has, rather than a plain spin
          // that looks inert next to them.
          <Button
            disabled
            className="col-span-2"
            status={error ? "error" : "loading"}
            errorText="สร้างเอกสารไม่สำเร็จ"
          >
            กำลังสร้างเอกสาร…
          </Button>
        )}

        {/* Exactly one of these two ever renders — see usePdfDelivery's
            header for why the picker is checked first.
            status={savedFlash ? "success" : undefined} rather than always
            passing a status: `loading` alone already covers the in-flight
            state (Button derives status="loading" from it when `status` is
            left undefined — see components/ui/button.tsx), so this only
            needs to layer the post-success flash on top, for the couple of
            seconds it's actually true. */}
        {canSavePicker ? (
          <Button
            variant="outline"
            className={FADE_IN_CLASS}
            onClick={handleSave}
            loading={saving}
            status={savedFlash ? "success" : undefined}
            successText="บันทึกแล้ว"
          >
            <Save className="size-4" aria-hidden="true" />
            บันทึกไฟล์
          </Button>
        ) : canShareFile ? (
          <Button
            variant="outline"
            className={FADE_IN_CLASS}
            onClick={handleShare}
            loading={sharing}
            status={sharedFlash ? "success" : undefined}
            successText="แชร์แล้ว"
          >
            <Share2 className="size-4" aria-hidden="true" />
            แชร์ / บันทึกไฟล์
          </Button>
        ) : null}
      </div>

      {/* Kept inside the card too — right under the action that would have
          produced it */}
      <Reveal show={!!error}>
        <div className="pt-3">
          <Alert>{error}</Alert>
        </div>
      </Reveal>

      {word ? (
        <>
          <Button
            variant="ghost"
            className="mt-2 w-full text-sm text-muted hover:text-navy"
            onClick={word.handleDeliver}
            disabled={!word.url}
            loading={(!word.url && !word.error) || word.saving || word.sharing}
            status={word.savedFlash || word.sharedFlash ? "success" : undefined}
            successText="บันทึกแล้ว"
          >
            <FileDown className="size-4" aria-hidden="true" />
            ไฟล์ Word (.docx) สำหรับแก้ไขต่อ
          </Button>
          <Reveal show={!!word.error}>
            <div className="pt-2">
              <Alert>{word.error}</Alert>
            </div>
          </Reveal>
        </>
      ) : null}
    </Card>
  );
}
