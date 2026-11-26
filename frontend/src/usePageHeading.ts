import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";

/** Move focus and restore scroll only on screen changes, before the first paint. */
export function usePageHeading(main: RefObject<HTMLElement | null>, appName: string, screen: string | null) {
  const activeScreen = useRef<string | null>(null);
  const positions = useRef(new Map<string, number>());

  const rememberScroll = useCallback(() => {
    if (activeScreen.current !== null) positions.current.set(activeScreen.current, window.scrollY);
  }, []);
  useEffect(() => {
    window.addEventListener("scroll", rememberScroll, { passive: true });
    return () => window.removeEventListener("scroll", rememberScroll);
  }, [rememberScroll]);

  useLayoutEffect(() => {
    const heading = main.current?.querySelector("h1");
    const text = heading?.textContent?.trim();
    if (!screen || !heading || !text) return;
    document.title = `${text} · ${appName}`;
    if (screen === activeScreen.current) return;

    const previous = activeScreen.current;
    activeScreen.current = screen;
    if (previous === null) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
    window.scrollTo({ top: positions.current.get(screen) ?? 0, behavior: "instant" });
  }, [main, appName, screen]);

  return { rememberScroll, clearScrollPositions: () => positions.current.clear() };
}
