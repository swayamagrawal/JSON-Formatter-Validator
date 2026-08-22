// src/lib/formatters.ts
// JSON formatting, validation, minify logic — 100% client-side

import { parse, printParseErrorCode } from "jsonc-parser";
import type { ParseError } from "jsonc-parser";

export type ValidationResult =
  | { valid: true }
  | { valid: false; message: string; line: number; column: number; offset: number };

export type FormatResult =
  | { success: true; output: string }
  | { success: false; error: string; line: number; column: number; offset: number };

/**
 * Validate JSON string. Returns precise error location.
 */
export function validateJSON(input: string): ValidationResult {
  const errors: ParseError[] = [];
  parse(input, errors, { allowTrailingComma: false, disallowComments: true });

  if (errors.length === 0) return { valid: true };

  const err = errors[0]!;
  const { line, column } = offsetToLineCol(input, err.offset);

  return {
    valid: false,
    message: printParseErrorCode(err.error),
    line,
    column,
    offset: err.offset,
  };
}

/**
 * Format/Beautify JSON with given indent (2, 4, or "tab")
 */
export function formatJSON(input: string, indent: number | "tab" = 2): FormatResult {
  const trimmed = input.trim();
  if (!trimmed) return { success: true, output: "" };

  try {
    const parsed = JSON.parse(trimmed);
    const indentStr = indent === "tab" ? "\t" : indent;
    return { success: true, output: JSON.stringify(parsed, null, indentStr) };
  } catch (e) {
    // Try to get error location from the native error message
    const { line, column, offset } = extractErrorLocation(e, trimmed);
    return {
      success: false,
      error: e instanceof Error ? e.message : "Invalid JSON",
      line,
      column,
      offset,
    };
  }
}

/**
 * Minify JSON — remove all whitespace
 */
export function minifyJSON(input: string): FormatResult {
  const trimmed = input.trim();
  if (!trimmed) return { success: true, output: "" };

  try {
    const parsed = JSON.parse(trimmed);
    return { success: true, output: JSON.stringify(parsed) };
  } catch (e) {
    const { line, column, offset } = extractErrorLocation(e, trimmed);
    return {
      success: false,
      error: e instanceof Error ? e.message : "Invalid JSON",
      line,
      column,
      offset,
    };
  }
}

/**
 * Count lines, characters, and top-level keys in JSON
 */
export function getStats(input: string): { lines: number; chars: number; keys: number | null; bytes: number; isArray: boolean } {
  const lines = input ? input.split("\n").length : 0;
  const chars = input.length;
  const bytes = new TextEncoder().encode(input).length;

  let keys: number | null = null;
  let isArray = false;
  try {
    const parsed = JSON.parse(input);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      keys = Object.keys(parsed).length;
    } else if (Array.isArray(parsed)) {
      keys = parsed.length; // array length instead
      isArray = true;
    }
  } catch {
    // not valid JSON — no key count
  }

  return { lines, chars, keys, bytes, isArray };
}

/** Format bytes to human-readable */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function offsetToLineCol(text: string, offset: number): { line: number; column: number } {
  const lines = text.slice(0, offset).split("\n");
  return {
    line: lines.length,
    column: (lines[lines.length - 1] ?? "").length + 1,
  };
}

function extractErrorLocation(e: unknown, input: string): { line: number; column: number; offset: number } {
  // Native JSON.parse error messages often contain "position N"
  if (e instanceof SyntaxError) {
    const match = e.message.match(/position (\d+)/);
    if (match) {
      const offset = parseInt(match[1]!, 10);
      const { line, column } = offsetToLineCol(input, offset);
      return { line, column, offset };
    }
  }
  return { line: 1, column: 1, offset: 0 };
}
