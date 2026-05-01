// Tests for filename sanitization (T1.1).
// Each documented rule has at least one accept and one reject case — Constitution L1 Testing.

import { describe, it, expect } from "vitest";
import { sanitizeFilename } from "../../src/domain/sanitize";

describe("sanitizeFilename", () => {
  // ── Rule 1: NUL byte rejection ────────────────────────────────────────────
  describe("Rule 1 — NUL byte rejection", () => {
    it("rejects a filename containing a NUL byte", () => {
      expect(sanitizeFilename("note\0.txt")).toEqual({
        ok: false,
        reason: "sanitization-rejected",
      });
    });

    it("accepts a filename without NUL bytes", () => {
      expect(sanitizeFilename("note.txt")).toEqual({
        ok: true,
        name: "note.txt",
      });
    });
  });

  // ── Rule 2: `..` / path-separator stripping ───────────────────────────────
  describe("Rule 2 — path traversal / separator stripping", () => {
    it("rejects a filename with path traversal (`..`)", () => {
      expect(sanitizeFilename("../../.obsidian/plugins/x")).toEqual({
        ok: false,
        reason: "sanitization-rejected",
      });
    });

    it("strips path separators and takes basename only", () => {
      const result = sanitizeFilename("foo/bar/baz.txt");
      expect(result).toEqual({ ok: true, name: "baz.txt" });
    });

    it("strips Windows-style path separators", () => {
      const result = sanitizeFilename("foo\\bar\\baz.txt");
      expect(result).toEqual({ ok: true, name: "baz.txt" });
    });
  });

  // ── Rule 3: OS housekeeping allowlist ─────────────────────────────────────
  describe("Rule 3 — OS housekeeping file rejection", () => {
    const housekeeping = [
      ".DS_Store",
      "Thumbs.db",
      "desktop.ini",
      ".localized",
      ".AppleDouble",
      "$RECYCLE.BIN",
      "System Volume Information",
    ];

    for (const name of housekeeping) {
      it(`rejects housekeeping file: ${name}`, () => {
        expect(sanitizeFilename(name)).toEqual({
          ok: false,
          reason: "housekeeping-file",
        });
      });
    }

    it("accepts a regular filename that is not a housekeeping file", () => {
      expect(sanitizeFilename("voice-memo-2026-04-30.m4a")).toEqual({
        ok: true,
        name: "voice-memo-2026-04-30.m4a",
      });
    });
  });

  // ── Rule 4: Control-char stripping ───────────────────────────────────────
  describe("Rule 4 — control character stripping", () => {
    it("strips control characters and returns the remaining name", () => {
      // \x01 is a control char; remaining text is valid
      expect(sanitizeFilename("note\x01.txt")).toEqual({
        ok: true,
        name: "note.txt",
      });
    });

    it("rejects a filename that becomes empty after stripping control chars", () => {
      // Only control chars → empty after strip → sanitization-empty
      expect(sanitizeFilename("\x01\x02\x03")).toEqual({
        ok: false,
        reason: "sanitization-empty",
      });
    });

    it("strips DEL (0x7F) control character", () => {
      expect(sanitizeFilename("note\x7F.txt")).toEqual({
        ok: true,
        name: "note.txt",
      });
    });
  });

  // ── Rule 5: Obsidian-invalid char replacement ─────────────────────────────
  describe("Rule 5 — Obsidian-invalid char replacement (* \" < > : | ?)", () => {
    it("replaces `*` with `_`", () => {
      expect(sanitizeFilename("draft*.md")).toEqual({ ok: true, name: "draft_.md" });
    });

    it('replaces `"` with `_`', () => {
      expect(sanitizeFilename('say "hello".md')).toEqual({
        ok: true,
        name: "say _hello_.md",
      });
    });

    it("takes basename when input contains `\\` (step 2 consumes backslash as path separator, not step 5)", () => {
      // `\` and `/` are consumed by step 2 (basename extraction via split(/[\\/]/)),
      // so they never reach step 5's OBSIDIAN_INVALID replacement.
      // OBSIDIAN_INVALID no longer contains `\` or `/`.
      expect(sanitizeFilename("a\\b")).toEqual({ ok: true, name: "b" });
    });

    it("takes basename when input contains `/` (step 2 consumes forward-slash as path separator, not step 5)", () => {
      expect(sanitizeFilename("a/b.md")).toEqual({ ok: true, name: "b.md" });
    });

    it("replaces `<` and `>` with `_`", () => {
      expect(sanitizeFilename("report<draft>v2.md")).toEqual({
        ok: true,
        name: "report_draft_v2.md",
      });
    });

    it("replaces `:` with `_`", () => {
      expect(sanitizeFilename("meeting: notes ?.md")).toEqual({
        ok: true,
        name: "meeting_ notes _.md",
      });
    });

    it("replaces `|` with `_`", () => {
      expect(sanitizeFilename("a|b.md")).toEqual({ ok: true, name: "a_b.md" });
    });

    it("replaces `?` with `_`", () => {
      expect(sanitizeFilename("what?.md")).toEqual({ ok: true, name: "what_.md" });
    });

    it("accepts a filename with no Obsidian-invalid chars unchanged", () => {
      expect(sanitizeFilename("clean-name.md")).toEqual({
        ok: true,
        name: "clean-name.md",
      });
    });
  });

  // ── Rule 6: Leading/trailing dot + space trim ─────────────────────────────
  describe("Rule 6 — leading/trailing dot and whitespace trimming", () => {
    it("trims leading dots", () => {
      expect(sanitizeFilename("...hidden.txt")).toEqual({
        ok: true,
        name: "hidden.txt",
      });
    });

    it("trims trailing spaces", () => {
      expect(sanitizeFilename("filename   ")).toEqual({
        ok: true,
        name: "filename",
      });
    });

    it("trims leading spaces", () => {
      expect(sanitizeFilename("   filename")).toEqual({
        ok: true,
        name: "filename",
      });
    });

    it("rejects a filename of only spaces (becomes empty after trim)", () => {
      expect(sanitizeFilename("   ")).toEqual({
        ok: false,
        reason: "sanitization-empty",
      });
    });

    it("trims trailing dots", () => {
      expect(sanitizeFilename("filename...")).toEqual({
        ok: true,
        name: "filename",
      });
    });
  });

  // ── Rule 7: Windows-reserved name suffixing ───────────────────────────────
  describe("Rule 7 — Windows-reserved name suffixing", () => {
    const reserved = [
      "CON", "PRN", "AUX", "NUL",
      "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
      "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];

    for (const name of reserved) {
      it(`suffixes reserved name: ${name}`, () => {
        const result = sanitizeFilename(name);
        expect(result).toEqual({ ok: true, name: `${name}-file` });
      });
    }

    it("suffixes CON.txt (reserved with extension)", () => {
      expect(sanitizeFilename("CON.txt")).toEqual({ ok: true, name: "CON.txt-file" });
    });

    it("suffixes reserved names case-insensitively (con)", () => {
      expect(sanitizeFilename("con")).toEqual({ ok: true, name: "con-file" });
    });

    it("does not suffix a non-reserved name like CONSOLE", () => {
      const result = sanitizeFilename("CONSOLE.txt");
      expect(result).toEqual({ ok: true, name: "CONSOLE.txt" });
    });
  });

  // ── Rule 8: Empty-after-sanitize rejection ────────────────────────────────
  describe("Rule 8 — empty-after-sanitize rejection", () => {
    it("rejects a filename that is empty after all sanitization steps", () => {
      // Only dots → stripped by rule 6 → empty
      expect(sanitizeFilename("...")).toEqual({
        ok: false,
        reason: "sanitization-empty",
      });
    });

    it("rejects an empty string", () => {
      expect(sanitizeFilename("")).toEqual({
        ok: false,
        reason: "sanitization-empty",
      });
    });
  });

  // ── Rule 9: UTF-8 byte-length cap ─────────────────────────────────────────
  describe("Rule 9 — UTF-8 byte-length cap (255 segment / 1024 total)", () => {
    it("rejects a filename that exceeds 255 bytes", () => {
      // 'a' repeated 256 times → 256 bytes
      const long = "a".repeat(256);
      expect(sanitizeFilename(long)).toEqual({
        ok: false,
        reason: "sanitization-rejected",
      });
    });

    it("accepts a filename at exactly 255 bytes", () => {
      const exact = "a".repeat(255);
      const result = sanitizeFilename(exact);
      expect(result).toEqual({ ok: true, name: exact });
    });

    it("rejects a filename exceeding 255 bytes with multi-byte chars", () => {
      // Each '🎙' is 4 bytes; 64 × 4 = 256 bytes → over limit
      const long = "🎙".repeat(64);
      expect(sanitizeFilename(long)).toEqual({
        ok: false,
        reason: "sanitization-rejected",
      });
    });

    it("accepts a filename with emoji that stays within byte cap", () => {
      // '🎙️ recording.m4a' — well within 255 bytes
      expect(sanitizeFilename("🎙️ recording.m4a")).toEqual({
        ok: true,
        name: "🎙️ recording.m4a",
      });
    });

    it("rejects a multi-segment input whose total byte length exceeds 1024, even when basename is short", () => {
      // 200-char segment repeated 6 times = 1200-byte total input → exceeds 1024
      // but the final basename ("short.md") is only 8 bytes — segment cap alone would pass it.
      // The 1024-byte total cap must be applied to the original input before basename extraction.
      const longSegment = "a".repeat(200);
      const input = `${longSegment}/${longSegment}/${longSegment}/${longSegment}/${longSegment}/${longSegment}/short.md`;
      expect(new TextEncoder().encode(input).byteLength).toBeGreaterThan(1024);
      expect(sanitizeFilename(input)).toEqual({
        ok: false,
        reason: "sanitization-rejected",
      });
    });
  });

  // ── Walkthrough examples from spec ───────────────────────────────────────
  describe("spec walkthrough examples", () => {
    it("passes a clean voice-memo filename", () => {
      expect(sanitizeFilename("voice-memo-2026-04-30.m4a")).toEqual({
        ok: true,
        name: "voice-memo-2026-04-30.m4a",
      });
    });

    it("rejects path traversal from spec example", () => {
      expect(sanitizeFilename("../../.obsidian/plugins/x")).toEqual({
        ok: false,
        reason: "sanitization-rejected",
      });
    });

    it("rejects NUL byte from spec example", () => {
      expect(sanitizeFilename("note\0.txt")).toEqual({
        ok: false,
        reason: "sanitization-rejected",
      });
    });

    it("rejects .DS_Store housekeeping file", () => {
      expect(sanitizeFilename(".DS_Store")).toEqual({
        ok: false,
        reason: "housekeeping-file",
      });
    });

    it("sanitizes `meeting: notes ?.md`", () => {
      expect(sanitizeFilename("meeting: notes ?.md")).toEqual({
        ok: true,
        name: "meeting_ notes _.md",
      });
    });

    it("sanitizes `report<draft>v2.md`", () => {
      expect(sanitizeFilename("report<draft>v2.md")).toEqual({
        ok: true,
        name: "report_draft_v2.md",
      });
    });

    it("rejects spaces-only filename", () => {
      expect(sanitizeFilename("   ")).toEqual({
        ok: false,
        reason: "sanitization-empty",
      });
    });

    it("suffixes CON.txt", () => {
      expect(sanitizeFilename("CON.txt")).toEqual({
        ok: true,
        name: "CON.txt-file",
      });
    });

    it("accepts emoji recording filename", () => {
      expect(sanitizeFilename("🎙️ recording.m4a")).toEqual({
        ok: true,
        name: "🎙️ recording.m4a",
      });
    });

    it("rejects a 600-char filename (byte cap)", () => {
      const long = "a".repeat(600);
      expect(sanitizeFilename(long)).toEqual({
        ok: false,
        reason: "sanitization-rejected",
      });
    });
  });
});
