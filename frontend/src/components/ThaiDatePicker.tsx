/* Date picker
 *
 * Uses the browser's native <input type="date"> instead of a hand-built
 * calendar, because:
 *   - On mobile you get iOS/Android's native date picker, easiest to use with a finger
 *   - Keyboard support and screen reader support come for free
 *   - No need for react-day-picker, which would need to be bent into
 *     Buddhist era years (fiddly and fragile)
 *
 * Note: the native field shows the year in whatever calendar the device's
 * locale uses (usually Gregorian), but the document always prints Buddhist
 * era (see lib/thaidate.ts / the PDF builder).
 */

import { CalendarDays } from "lucide-react";
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
    <div className="relative">
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
      <CalendarDays
        className="pointer-events-none absolute right-3.5 top-1/2 size-5 -translate-y-1/2 text-muted"
        aria-hidden="true"
      />
    </div>
  );
}
