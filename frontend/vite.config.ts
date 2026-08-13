import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(dirname, "./src"),
    },
  },
  server: {
    // dev: proxy /api to FastAPI. prod: FastAPI serves static files itself, so it's same-origin
    proxy: {
      "/api": { target: "http://127.0.0.1:8000", changeOrigin: true },
      "/health": { target: "http://127.0.0.1:8000", changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    // Default (500) flags the main chunk even at its normal size (~170KB
    // gzipped — React, form validation, Radix UI, motion). The genuinely
    // heavy PDF-rendering libraries (jsPDF/html2canvas/dompurify) are already
    // isolated into their own lazily-loaded chunk via the dynamic import in
    // PdfStep.tsx, so this is just raising the threshold past the app shell's
    // real size rather than masking an actual code-splitting gap.
    chunkSizeWarningLimit: 600,
  },
});
