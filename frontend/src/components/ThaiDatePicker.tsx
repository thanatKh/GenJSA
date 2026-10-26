/* Date picker
 *
 * Uses the browser's native <input type="date"> instead of a hand-built
 * calendar, because:
 *   - On mobile you get iOS/Android's native date picker, easiest to use with a finger
 *   - Keyboard support and screen reader support come for free
 *   - No need for react-day-picker, which would need to be bent into
 *     Buddhist era years (fiddly and fragile)
 *
 * The field shows the date in Thai — "26 ตุลาคม 2569", the PDF's own format
 * — whatever language the phone is set to. The native field would show its
 * own text in the device's language and calendar ("26 Oct 2026" on an
 * English iPhone), so that text is made transparent and a Thai label sits
 * on top of it. The native picker that opens on tap is still the device's
 * own (its month names follow the phone's language — no web page can change
 * that). With a mouse and keyboard, focusing the field reveals the native
 * day/month/year boxes so typed digits are visible (see .thai-date in
 * index.css).
 */

import { CalendarDays } from "lucide-react";
import { formatThaiDate } from "../lib/thaidate";
import { Input } from "./ui";

export function ThaiDatePicker({
  id,
  value,
  onChange,
  onBlur,
  name,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  name?: string;
}) {
  return (
    <div className="thai-date relative">
      <Input
        id={id}
        name={name}
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        // Date-widget font/alignment/padding fixes live centrally in
        // index.css alongside the input[type="date"] rules — see there
        className="pr-11"
      />
      {/* Not a <label>: the field already has its own. aria-hidden, since a
          screen reader announces the native value itself. A solid
          background, inset inside the border: on touch, a focused native
          field still paints a blue selection behind its (transparent) day
          box, and Chrome ignores author styles on that highlight — covering
          it is the only reliable fix. */}
      <span
        className="thai-date-label pointer-events-none absolute inset-y-[2px] left-3 right-11 flex items-center truncate bg-surface pl-0.5 text-base text-ink"
        aria-hidden="true"
      >
        {value ? formatThaiDate(value) : <span className="text-muted">เลือกวันที่</span>}
      </span>
      <CalendarDays
        className="pointer-events-none absolute right-3.5 top-1/2 size-5 -translate-y-1/2 text-muted"
        aria-hidden="true"
      />
    </div>
  );
}
