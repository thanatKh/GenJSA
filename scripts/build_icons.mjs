/* Builds favicon.ico from the same lettermark used by frontend/public/favicon.svg,
   via headless Chrome over CDP — no npm dependency.

   Run it whenever the mark changes:

     chrome --headless --remote-debugging-port=9222 &
     OUT_DIR=frontend/public node scripts/build_icons.mjs

   Keep the geometry below in step with frontend/public/favicon.svg — that
   file is what browsers actually render in the tab; this script only makes
   the .ico fallback (favicon.ico still matters: without a real file there,
   the SPA catch-all in backend/app/main.py answers /favicon.ico with
   index.html instead of a 404 or an icon).

   Slightly less padding / bigger letters than the source SVG — "JSA" needs
   the extra weight to stay legible once it's down at 16px.
*/
import { writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const OUT = process.env.OUT_DIR;
if (!OUT) throw new Error("set OUT_DIR to frontend/public");

const NAVY = "#0047ab";
const FONT = "system-ui, -apple-system, 'Segoe UI', Arial, sans-serif";
const GEOMETRY = { rx: 72, textLength: 440, fontSize: 232, baseline: 340 };

const svg = (v) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${v.rx}" fill="${NAVY}"/>
  <text x="256" y="${v.baseline}" textLength="${v.textLength}" lengthAdjust="spacingAndGlyphs"
        text-anchor="middle" fill="#ffffff" font-family="${FONT}"
        font-size="${v.fontSize}" font-weight="800" letter-spacing="-4">JSA</text>
</svg>`;

const page = (v, size) => `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0;background:transparent}
  svg{display:block;width:${size}px;height:${size}px}
</style>
${svg(v)}`;

// ---- CDP plumbing -------------------------------------------------------
const created = await (
  await fetch("http://127.0.0.1:9222/json/new?about:blank", { method: "PUT" })
).json();
const ws = new WebSocket(created.webSocketDebuggerUrl);
await new Promise((res) => ws.addEventListener("open", res, { once: true }));

let nextId = 1;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  }
});
const send = (method, params = {}) => {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send("Page.enable");
await send("Runtime.enable");
// Transparent page ground so the rounded corners stay see-through
await send("Emulation.setDefaultBackgroundColorOverride", {
  color: { r: 0, g: 0, b: 0, a: 0 },
});

const work = join(tmpdir(), "genjsa-icons");
mkdirSync(work, { recursive: true });

async function render(size) {
  const html = join(work, `favicon-${size}.html`);
  writeFileSync(html, page(GEOMETRY, size), "utf8");
  await send("Emulation.setDeviceMetricsOverride", {
    width: size,
    height: size,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Page.navigate", { url: pathToFileURL(html).href });
  await sleep(220); // let the font resolve and lay out before capturing
  const { data } = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  return Buffer.from(data, "base64");
}

// ---- favicon.ico (PNG-in-ICO, Vista+ and every modern browser) ----------
const icoSizes = [16, 32, 48];
const images = [];
for (const size of icoSizes) {
  images.push({ size, png: await render(size) });
}

const HEADER = 6;
const ENTRY = 16;
let offset = HEADER + ENTRY * images.length;
const dir = Buffer.alloc(HEADER + ENTRY * images.length);
dir.writeUInt16LE(0, 0); // reserved
dir.writeUInt16LE(1, 2); // type 1 = icon
dir.writeUInt16LE(images.length, 4);
images.forEach((img, i) => {
  const at = HEADER + i * ENTRY;
  dir.writeUInt8(img.size === 256 ? 0 : img.size, at + 0);
  dir.writeUInt8(img.size === 256 ? 0 : img.size, at + 1);
  dir.writeUInt8(0, at + 2); // palette size
  dir.writeUInt8(0, at + 3); // reserved
  dir.writeUInt16LE(1, at + 4); // colour planes
  dir.writeUInt16LE(32, at + 6); // bits per pixel
  dir.writeUInt32LE(img.png.length, at + 8);
  dir.writeUInt32LE(offset, at + 12);
  offset += img.png.length;
});
const ico = Buffer.concat([dir, ...images.map((i) => i.png)]);
writeFileSync(join(OUT, "favicon.ico"), ico);
console.log(
  `  favicon.ico              ${icoSizes.join("+")}  ${ico.length} bytes`,
);

await send("Page.close");
ws.close();
console.log("\ndone");
