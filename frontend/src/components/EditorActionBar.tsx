import { useEffect, useRef, type ReactNode } from "react";
import { SaveStatus, type SaveState } from "./SaveStatus";
import { Alert } from "./ui";

const KEYBOARD_MIN_HEIGHT = 120;

export function EditorActionBar({ leading, trailing, saveState, error }: {
  leading: ReactNode;
  trailing: ReactNode;
  saveState: SaveState;
  error?: string | null;
}) {
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = bar.current;
    if (!element) return;
    const root = document.documentElement;
    const viewport = window.visualViewport;
    const touch = window.matchMedia("(pointer: coarse)");
    let frame = 0;

    const syncViewport = () => {
      const layoutHeight = root.clientHeight;
      // Browser chrome can also resize the visual viewport. A large height
      // difference at normal zoom on a touch device is the keyboard case.
      const keyboard = viewport && touch.matches && Math.abs(viewport.scale - 1) < 0.02 &&
        layoutHeight - viewport.height >= KEYBOARD_MIN_HEIGHT;
      const inset = keyboard ? Math.max(0, Math.round(layoutHeight - viewport.height - viewport.offsetTop)) : 0;
      element.toggleAttribute("data-keyboard-open", !!keyboard);
      const value = `${inset}px`;
      if (root.style.getPropertyValue("--editor-keyboard-inset") !== value) {
        root.style.setProperty("--editor-keyboard-inset", value);
      }
    };
    const scheduleViewport = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(syncViewport);
    };

    const observer = new ResizeObserver(() => {
      root.style.setProperty("--editor-toolbar-height", `${element.offsetHeight}px`);
    });
    observer.observe(element);
    syncViewport();
    viewport?.addEventListener("resize", scheduleViewport);
    viewport?.addEventListener("scroll", scheduleViewport, { passive: true });
    window.addEventListener("resize", scheduleViewport);
    touch.addEventListener("change", scheduleViewport);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", scheduleViewport);
      viewport?.removeEventListener("scroll", scheduleViewport);
      window.removeEventListener("resize", scheduleViewport);
      touch.removeEventListener("change", scheduleViewport);
      root.style.removeProperty("--editor-keyboard-inset");
      root.style.removeProperty("--editor-toolbar-height");
    };
  }, []);

  return (
    <div ref={bar} className="editor-action-bar fixed inset-x-0 z-10 border-t border-line t-glass bg-surface/95 supports-backdrop-filter:bg-surface/80 supports-backdrop-filter:backdrop-blur-md">
      {error ? (
        <div className="mx-auto mb-2 w-full max-w-[var(--page-max-w)]">
          <Alert>{error}</Alert>
        </div>
      ) : null}
      <div className="mx-auto flex w-full max-w-[var(--page-max-w)] items-center gap-2 sm:justify-between">
        <div className="editor-action">{leading}</div>
        <SaveStatus state={saveState} />
        <div className="editor-action">{trailing}</div>
      </div>
    </div>
  );
}
