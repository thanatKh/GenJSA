/* Cloudflare Web Analytics — visit counts for the deployed site.
 *
 * The token comes from config/app.yaml (analytics.cloudflare_token) through
 * /api/config/public, so it can be changed or switched off (blank) without a
 * code change. The beacon records the page, time, country and browser — no
 * cookies, and nothing users type: documents live in React state and browser
 * storage, never in the URL, so there is nothing of theirs for it to see.
 *
 * Not loaded on localhost, so working on the app doesn't count as visits. */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", ""]);

export function loadCloudflareAnalytics(token: string | undefined, host = location.hostname): boolean {
  const clean = token?.trim();
  if (!clean || LOCAL_HOSTS.has(host)) return false;
  if (document.querySelector("script[data-cf-beacon]")) return false;
  const script = document.createElement("script");
  script.defer = true;
  script.src = "https://static.cloudflareinsights.com/beacon.min.js";
  script.dataset.cfBeacon = JSON.stringify({ token: clean });
  document.head.appendChild(script);
  return true;
}
