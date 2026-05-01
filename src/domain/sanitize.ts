// Filename sanitization for Hakobi import rules.
// Pure function — no side effects, no imports. TextEncoder is a global.
// Implements the 10-step pipeline from ADR-013 / spec 001-v0-1 T1.1.

// NUL (\x00) intentionally excluded — it is handled by step 1's outright rejection.
// eslint-disable-next-line no-control-regex -- intentional: stripping control characters is the purpose of this regex
const CONTROL_CHARS = /[\x01-\x1F\x7F]/g;
const OBSIDIAN_INVALID = /[*"<>:|?]/g;
const RESERVED_WIN = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;
const HOUSEKEEPING = new Set([
  ".DS_Store", "Thumbs.db", "desktop.ini", ".localized",
  ".AppleDouble", "$RECYCLE.BIN", "System Volume Information",
]);

const ENCODER = new TextEncoder();
export const MAX_SEGMENT_BYTES = 255;
export const MAX_TOTAL_BYTES = 1024;

export type SanitizeResult =
  | { ok: true; name: string }
  | { ok: false; reason: "sanitization-rejected" | "sanitization-empty" | "housekeeping-file" };

export function sanitizeFilename(input: string): SanitizeResult {
  // 1. Reject NUL anywhere
  if (input.includes("\0")) return { ok: false, reason: "sanitization-rejected" };

  // 2. Total path length cap — applied to original input before basename extraction
  if (ENCODER.encode(input).byteLength > MAX_TOTAL_BYTES) {
    return { ok: false, reason: "sanitization-rejected" };
  }

  // 3. Take basename only — strip path separators, reject inputs with traversal segments
  const segments = input.split(/[/\\]/);
  if (segments.some((s) => s === "..")) return { ok: false, reason: "sanitization-rejected" };
  const last = segments.pop() ?? "";

  // 4. Skip OS housekeeping files
  if (HOUSEKEEPING.has(last)) return { ok: false, reason: "housekeeping-file" };

  // 5. Strip control chars
  let name = last.replace(CONTROL_CHARS, "");

  // 6. Replace Obsidian-invalid chars with `_` (`\` and `/` already consumed by step 3)
  name = name.replace(OBSIDIAN_INVALID, "_");

  // 7. Trim leading/trailing dots and whitespace
  name = name.replace(/^[.\s]+|[.\s]+$/g, "");

  // 8. Rename Windows-reserved names
  if (RESERVED_WIN.test(name)) name = `${name}-file`;

  // 9. Empty after sanitization → reject
  if (name.length === 0) return { ok: false, reason: "sanitization-empty" };

  // 10. Segment byte-length cap (UTF-8 bytes, not char length)
  if (ENCODER.encode(name).byteLength > MAX_SEGMENT_BYTES) {
    return { ok: false, reason: "sanitization-rejected" };
  }

  return { ok: true, name };
}
