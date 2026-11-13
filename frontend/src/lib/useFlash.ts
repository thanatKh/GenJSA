import { useCallback, useEffect, useRef, useState } from "react";

/** A value that is true for a moment, then false by itself — the "it worked"
 * beat on a button (Button's status="success"). `flash()` starts it (again,
 * if already on); `clear()` ends it early, e.g. when what it confirmed is
 * no longer true. The timer is cleared when the component goes away. */
export function useFlash(ms = 2000): [boolean, () => void, () => void] {
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setOn(false);
  }, []);
  const flash = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setOn(true);
    timer.current = setTimeout(() => setOn(false), ms);
  }, [ms]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return [on, flash, clear];
}
