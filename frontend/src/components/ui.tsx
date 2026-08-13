/* UI primitives — thin app-specific wrappers around shadcn/ui components
 * living in src/components/ui/*.tsx (generated via the shadcn CLI, then
 * patched for GenJSA's brand tokens, tap-target sizes, and iOS zoom fix —
 * see the comments in each generated file for what changed and why).
 *
 * Every icon comes from lucide-react (SVG) — never use emoji in the UI.
 */

import {
  forwardRef,
  useEffect,
  useRef,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { TriangleAlert, Undo2 } from "lucide-react";

import { Button } from "./ui/button";
import { Label as ShadcnLabel } from "./ui/label";
import { Textarea as ShadcnTextarea } from "./ui/textarea";
import { Card as ShadcnCard, CardContent } from "./ui/card";
import { Alert as ShadcnAlert, AlertDescription } from "./ui/alert";
import { Skeleton } from "./ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";

export { Button } from "./ui/button";
export { Input } from "./ui/input";

/* ------------------------------------------------------------------- Field */

export function Label({
  htmlFor,
  children,
  required,
}: {
  htmlFor: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <ShadcnLabel htmlFor={htmlFor} className="mb-1.5 block text-ink">
      {children}
      {required ? (
        <span className="text-danger-text ml-0.5" aria-hidden="true">
          *
        </span>
      ) : null}
    </ShadcnLabel>
  );
}

export function FieldError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p className="mt-1.5 text-sm text-danger-text flex items-start gap-1.5">
      <TriangleAlert className="size-4 mt-1 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/* --------------------------------------------------------- AutoGrowTextarea */

type AutoGrowProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  minRows?: number;
  maxRows?: number;
};

/**
 * A textarea that grows with its content — so a long work description doesn't
 * force scrolling inside a tiny box. Uses scrollHeight because field-sizing:
 * content isn't reliably supported on Safari yet (the generated Textarea's
 * own field-sizing-content class is stripped for the same reason).
 */
export const AutoGrowTextarea = forwardRef<HTMLTextAreaElement, AutoGrowProps>(
  ({ minRows = 3, maxRows = 16, className, onChange, value, ...rest }, ref) => {
    const inner = useRef<HTMLTextAreaElement | null>(null);

    const resize = () => {
      const el = inner.current;
      if (!el) return;
      const styles = window.getComputedStyle(el);
      const lineHeight = parseFloat(styles.lineHeight) || 24;
      const padding =
        parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
      el.style.height = "auto";
      const next = Math.min(
        Math.max(el.scrollHeight, minRows * lineHeight + padding),
        maxRows * lineHeight + padding,
      );
      el.style.height = `${next}px`;
      el.style.overflowY = el.scrollHeight > next ? "auto" : "hidden";
    };

    useEffect(resize, [value, minRows, maxRows]);

    return (
      <ShadcnTextarea
        ref={(node) => {
          inner.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        rows={minRows}
        value={value}
        onChange={(event) => {
          onChange?.(event);
          resize();
        }}
        className={`resize-none leading-[1.75] ${className ?? ""}`}
        {...rest}
      />
    );
  },
);
AutoGrowTextarea.displayName = "AutoGrowTextarea";

/* -------------------------------------------------------------------- Card */

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <ShadcnCard className={className}>
      <CardContent>{children}</CardContent>
    </ShadcnCard>
  );
}

/* ------------------------------------------------------------------- Alert */

/**
 * Errors are shown inline right where they matter, never as a toast that
 * disappears on its own. A field worker may look away and come back —
 * the message needs to still be there. Always the danger/error treatment —
 * no current call site needs any other tone.
 */
export function Alert({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <ShadcnAlert
      variant="destructive"
      className="items-start border-danger/40 bg-danger-soft [&>svg]:text-danger"
    >
      <TriangleAlert className="mt-0.5 size-5" aria-hidden="true" />
      <AlertDescription className="text-danger-text">
        {children}
        {action ? <div className="mt-3">{action}</div> : null}
      </AlertDescription>
    </ShadcnAlert>
  );
}

/* ---------------------------------------------------------------- Skeleton */

export function SkeletonCard() {
  return (
    <div className="rounded-[var(--radius)] border border-line p-4 sm:p-5">
      <Skeleton className="h-5 w-2/5" />
      <Skeleton className="mt-3 h-4 w-full" />
      <Skeleton className="mt-2 h-4 w-4/5" />
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- UndoToast */

/**
 * A brief "deleted — undo?" toast, for actions that used to be instant and
 * irreversible (removing a step/hazard in EditorStep). Auto-dismisses after
 * a few seconds; the caller owns the timer and just tells us whether to show.
 */
export function UndoToast({
  open,
  message,
  onUndo,
}: {
  open: boolean;
  message: string;
  onUndo: () => void;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`t-toast fixed inset-x-0 bottom-20 z-20 mx-auto flex w-[min(92vw,26rem)] items-center
                  justify-between gap-3 rounded-[var(--radius)] border border-line bg-ink px-4 py-3
                  text-sm text-white shadow-lg ${open ? "is-open" : "pointer-events-none"}`}
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={onUndo}
        className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 font-semibold text-cyan hover:bg-white/10"
      >
        <Undo2 className="size-4" aria-hidden="true" />
        เลิกทำ
      </button>
    </div>
  );
}

/* --------------------------------------------------------- ConfirmDialog */

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      {/* The generated file's max-width lives under data-[size=default]: and
          data-[size=default]:sm: scopes — an unscoped max-w-none doesn't
          conflict with those in tailwind-merge's eyes (different modifier
          scope), so it silently loses the cascade at sm+ viewports. Override
          at the exact same scopes so it's actually recognized as a conflict. */}
      <AlertDialogContent className="w-[min(92vw,26rem)] max-w-none data-[size=default]:max-w-none data-[size=default]:sm:max-w-none">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-lg text-navy">{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>ยกเลิก</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ------------------------------------------------------------- InfoDialog */

export function InfoDialog({
  open,
  title,
  icon,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      {/* sm:max-w-none needed alongside max-w-none — the generated file's
          sm:max-w-sm lives in a different modifier scope than a plain
          max-w-none override, so tailwind-merge doesn't treat them as
          conflicting and both would otherwise ship, letting sm:max-w-sm win
          the cascade at any viewport >= 640px */}
      <DialogContent
        className="flex max-h-[85vh] w-[min(92vw,36rem)] max-w-none sm:max-w-none flex-col gap-0 overflow-hidden p-0"
        showCloseButton={false}
      >
        <DialogHeader className="flex-row items-center gap-2.5 border-b border-line px-5 py-4">
          {icon ? (
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-navy-soft text-navy">
              {icon}
            </span>
          ) : null}
          <DialogTitle className="text-lg text-navy">{title}</DialogTitle>
        </DialogHeader>
        <div className="divide-y divide-line overflow-y-auto px-5 text-sm leading-relaxed [&>*]:py-4 first:[&>*]:pt-4">
          {children}
        </div>
        <DialogFooter className="mx-0 mb-0 rounded-none border-t border-line bg-transparent px-5 py-4">
          <Button variant="outline" onClick={onClose}>
            ปิด
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
