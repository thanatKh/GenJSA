/* The open document's company logo, kept in memory and synced to
 * lib/photoStore.ts (IndexedDB, key COMPANY_LOGO_KEY) — the same posture as
 * usePhotos.ts: browser-only, survives a refresh, deleted with its history
 * entry, never sent anywhere.
 *
 * The first-screen form picks a logo BEFORE the job has a historyId (one is
 * only allocated once the JSA comes back), so App.tsx hands it over with
 * setLogoFor(newId, logo) at that moment instead of setLogo().
 */

import { useEffect, useState } from "react";

import type { CompanyLogo } from "../../lib/companyLogo";
import * as photoStore from "../../lib/photoStore";

type Held = { forId: string | null; logo: CompanyLogo | null; loaded: boolean };

export function useCompanyLogo(historyId: string | null) {
  const [held, setHeld] = useState<Held>({ forId: null, logo: null, loaded: false });

  // Load the saved logo whenever the open job changes — unless setLogoFor
  // already put this job's logo in memory (it's still being written).
  useEffect(() => {
    if (!historyId || (held.forId === historyId && held.loaded)) return;
    let cancelled = false;
    void photoStore.loadCompanyLogo(historyId).then((logo) => {
      if (cancelled) return;
      setHeld((current) =>
        current.forId === historyId && current.loaded
          ? current
          : { forId: historyId, logo, loaded: true },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [historyId, held.forId, held.loaded]);

  const persist = (id: string, logo: CompanyLogo | null) => {
    if (logo) void photoStore.save(id, photoStore.COMPANY_LOGO_KEY, logo);
    else void photoStore.remove(id, photoStore.COMPANY_LOGO_KEY);
  };

  /** Give a just-created job its logo (or none) */
  const setLogoFor = (id: string, logo: CompanyLogo | null) => {
    setHeld({ forId: id, logo, loaded: true });
    persist(id, logo);
  };

  /** Change the open job's logo (from the review page) */
  const setLogo = (logo: CompanyLogo | null) => {
    if (!historyId) return;
    setLogoFor(historyId, logo);
  };

  // Only ever expose the logo of the job that's actually open
  const logo = held.forId === historyId ? held.logo : null;
  return { logo, setLogo, setLogoFor };
}
