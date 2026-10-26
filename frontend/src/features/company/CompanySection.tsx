/* The "บริษัท (ไม่บังคับ)" section — one component for both the first screen
 * and the JSA editor's header card, so the two can't drift apart again (the
 * editor used to show a bare, always-open name box and logo drop zone while
 * the first screen had this collapsible section).
 *
 * Collapsed unless a name or logo is already there, so PTTOR's own users —
 * most of them, who never need it — see one line instead of an empty form.
 * The name field itself is passed in: the first screen registers it with
 * react-hook-form, the editor binds it to the document.
 */

import { useState, type ReactNode } from "react";
import { Building2, ChevronDown } from "lucide-react";

import { Label, Reveal } from "../../components/ui";
import type { CompanyLogo } from "../../lib/companyLogo";
import { CompanyLogoField } from "./CompanyLogoField";

export function CompanySection({
  name,
  nameField,
  logo,
  onLogoChange,
  footer,
}: {
  /** Current company name — shown after the title while collapsed */
  name: string;
  /** The name input, with id="company" (the label points at it) */
  nameField: ReactNode;
  logo: CompanyLogo | null;
  onLogoChange: (logo: CompanyLogo | null) => void;
  /** Extra controls under the logo (the first screen's "remember" checkbox) */
  footer?: ReactNode;
}) {
  // Decided once, when the section appears — not re-derived as the user
  // types, or clearing the name would snap the section shut mid-edit
  const [open, setOpen] = useState(() => !!(name.trim() || logo));

  return (
    // rounded-field (18px), the same as the text boxes around it, and
    // overflow-hidden so the header's hover background takes the box's own
    // corners: rounded all round when closed, rounded on top and straight
    // along the divider when open. The header has no radius of its own —
    // with one, its bottom corners curved against the straight divider.
    <div className="overflow-hidden rounded-field border border-line">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="company_fields"
        className="flex w-full items-center gap-2 px-3.5 py-3 text-left text-sm
                   font-medium text-ink hover:bg-raised focus-visible:outline-none
                   focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
      >
        <Building2 className="size-4 shrink-0 text-muted" aria-hidden="true" />
        <span className="shrink-0">
          บริษัท <span className="font-normal text-muted">(ไม่บังคับ)</span>
        </span>
        {!open && name.trim() ? (
          <span className="min-w-0 truncate font-normal text-muted">· {name.trim()}</span>
        ) : null}
        <ChevronDown
          className={`ml-auto size-4 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      {/* Height + fade open/close (Reveal), so the form below slides
          instead of jumping */}
      <Reveal show={open}>
        <div id="company_fields" className="grid gap-4 border-t border-line px-3.5 pb-4 pt-3">
          <p className="text-sm text-muted">
            สำหรับเอกสารที่จัดทำในนามบริษัท ชื่อและโลโก้ของบริษัทจะแสดงบนหัวเอกสาร PDF
          </p>
          <div>
            <Label htmlFor="company">ชื่อบริษัท</Label>
            {nameField}
          </div>
          <CompanyLogoField logo={logo} onChange={onLogoChange} />
          {footer}
        </div>
      </Reveal>
    </div>
  );
}
