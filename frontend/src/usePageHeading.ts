import { useEffect, type RefObject } from "react";

/** Follow the heading that actually mounted, including delayed screen swaps.
 * Edits/save indicators must never pull focus out of the current field. */
export function usePageHeading(main: RefObject<HTMLElement | null>, appName: string) {
  useEffect(() => {
    const container = main.current;
    if (!container) return;
    let previous = container.querySelector("h1");
    let previousText = previous?.textContent?.trim() ?? "";
    let frame = 0;
    const update = (focus: boolean) => {
      const heading = container.querySelector("h1");
      const text = heading?.textContent?.trim() ?? "";
      if (!heading || !text) return;
      document.title = `${text} · ${appName}`;
      if (focus && (heading !== previous || text !== previousText)) {
        heading.tabIndex = -1;
        heading.focus();
      }
      previous = heading;
      previousText = text;
    };
    update(false);
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => update(true));
    });
    observer.observe(container, { childList: true, subtree: true, characterData: true });
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [main, appName]);
}
