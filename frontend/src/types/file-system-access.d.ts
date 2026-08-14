/* Minimal ambient types for the File System Access API.
 *
 * showSaveFilePicker is not in TypeScript's DOM lib (tsconfig.app.json targets
 * es2023), and @types/wicg-file-system-access would pull in the whole spec for
 * the three symbols PdfStep.tsx actually uses. Declared here instead, narrowed
 * to what we call — if a future feature needs directory handles or
 * showOpenFilePicker, add them here rather than reaching for the package.
 *
 * Chromium desktop only. Every caller must feature-detect
 * ("showSaveFilePicker" in window) before using it.
 */

interface FileSystemWritableFileStream {
  write(data: Blob | BufferSource | string): Promise<void>;
  close(): Promise<void>;
}

interface FileSystemFileHandle {
  createWritable(): Promise<FileSystemWritableFileStream>;
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: Array<{
    description?: string;
    accept: Record<string, string[]>;
  }>;
}

interface Window {
  showSaveFilePicker?: (
    options?: SaveFilePickerOptions,
  ) => Promise<FileSystemFileHandle>;
}
