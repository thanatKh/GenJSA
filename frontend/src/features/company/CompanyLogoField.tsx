/* Pick, show, replace or remove a company logo. Used on the first screen
 * and in the JSA editor's header card. Resizing happens in
 * lib/companyLogo.ts before the logo ever reaches state, so what's shown
 * here is exactly what the PDF will embed — but that's an implementation
 * detail, not something the UI tells the user about.
 *
 * Two ways in: drag-and-drop onto the field (with or without a logo
 * already there — dropping replaces it), and the file picker. */

import { useRef, useState } from "react";
import { ImagePlus, LoaderCircle, Trash2 } from "lucide-react";
import { motion } from "motion/react";

import { Button, FieldError } from "../../components/ui";
import { type CompanyLogo, fileToCompanyLogo, LogoError } from "../../lib/companyLogo";
import { popIn } from "../../lib/motion";
import { fileFrom } from "../../lib/photo";

export function CompanyLogoField({
  logo,
  onChange,
}: {
  logo: CompanyLogo | null;
  onChange: (logo: CompanyLogo | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await fileToCompanyLogo(file));
    } catch (caught) {
      setError(caught instanceof LogoError ? caught.message : "เพิ่มโลโก้ไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally {
      setBusy(false);
    }
  };

  const openPicker = () => {
    if (!busy) inputRef.current?.click();
  };

  // Only react to drags that carry files — dragging text over the field
  // shouldn't light it up
  const hasFiles = (event: React.DragEvent) => Array.from(event.dataTransfer.types).includes("Files");
  const dropProps = {
    onDragOver: (event: React.DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setDragging(true);
    },
    onDragLeave: () => setDragging(false),
    onDrop: (event: React.DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setDragging(false);
      void accept(fileFrom(event.dataTransfer));
    },
  };

  const pickIcon = busy ? (
    <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
  ) : (
    <ImagePlus className="size-4" aria-hidden="true" />
  );

  return (
    <div>
      {logo ? (
        <div
          {...dropProps}
          className={`flex flex-wrap items-center gap-2 rounded-xl border p-2 transition-colors ${
            dragging ? "border-navy bg-navy-soft" : "border-transparent"
          }`}
        >
          {/* White ground: shows the logo the way it prints */}
          <motion.img
            key={logo.data}
            {...popIn}
            src={logo.data}
            alt="โลโก้บริษัท"
            className="h-12 w-auto max-w-40 rounded-xl border border-line bg-white object-contain p-1"
          />
          <Button type="button" variant="ghost" size="sm" className="text-sm" disabled={busy} onClick={openPicker}>
            {pickIcon}
            เปลี่ยนโลโก้
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-sm text-muted hover:bg-danger-soft hover:text-danger-text"
            onClick={() => {
              setError(null);
              onChange(null);
            }}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            ลบโลโก้
          </Button>
        </div>
      ) : (
        // A div, not a button: it holds its own button, and a button inside a
        // button is invalid. Clicking anywhere in the box opens the picker; a
        // click on the inner button is skipped here so it doesn't fire twice.
        <div
          {...dropProps}
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("button")) return;
            openPicker();
          }}
          className={`flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-dashed
                      px-3 py-3 text-sm transition-colors ${
                        dragging ? "border-navy bg-navy-soft" : "border-line hover:border-navy/40"
                      }`}
        >
          <Button type="button" variant="outline" size="sm" className="text-sm" disabled={busy} onClick={openPicker}>
            {pickIcon}
            เลือกไฟล์โลโก้
          </Button>
          <span className="text-muted">หรือลากไฟล์มาวางที่นี่ (PNG หรือ JPG)</span>
        </div>
      )}
      <FieldError>{error}</FieldError>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="hidden"
        onChange={(event) => {
          void accept(event.target.files?.[0] ?? null);
          event.target.value = "";
        }}
      />
    </div>
  );
}
