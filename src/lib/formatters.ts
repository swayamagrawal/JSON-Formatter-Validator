// src/lib/formatters.ts
// JSON formatting, validation, minify logic — 100% client-side

import { parse, parseTree, printParseErrorCode, ParseErrorCode } from "jsonc-parser";
import type { ParseError, Node } from "jsonc-parser";

export interface ValidationWarning {
  message: string;
  key?: string;
  value?: string;
  warningType?: "duplicate-key" | "unsafe-integer" | "escape-path";
  line: number;
  column: number;
  offset: number;
  firstOccurrence?: { line: number; column: number; offset: number };
}

export type ValidationResult =
  | { valid: true; warnings?: ValidationWarning[] }
  | { valid: false; message: string; line: number; column: number; offset: number };

export type FormatResult =
  | { success: true; output: string }
  | { success: false; error: string; line: number; column: number; offset: number };

export const HTML_ERROR_MESSAGE =
  "Input appears to be an HTML document or error page, not JSON. Check if your API returned an HTML error (such as a 404 or 500 response) or if the URL was incorrect.";

/**
 * Detect if input looks like an HTML document, fragment, or error page
 * (e.g. 404/500 server response copied into a JSON tool).
 */
export function isHtmlResponse(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed.startsWith("<")) return false;

  // Explicit HTML document start
  if (/^<!DOCTYPE\s+html/i.test(trimmed)) return true;
  if (/^<html[\s>]/i.test(trimmed)) return true;

  // HTML head/body/error wrappers with standard HTML tags
  if (
    /^<(?:head|body|div|p|pre|center|title)\b/i.test(trimmed) &&
    /<\/(?:html|body|head|div|p|pre|center|title)>/i.test(trimmed)
  ) {
    return true;
  }

  // XML/HTML document starting with <tag> and containing typical HTML markers
  if (
    /^<[a-zA-Z][\w-]*[\s>]/i.test(trimmed) &&
    /<(?:html|head|body|title|meta|h[1-6]|table|center|script|iframe)\b/i.test(trimmed)
  ) {
    return true;
  }

  return false;
}

/**
 * Detect duplicate keys in JSON objects using a structured parse tree.
 * Checks property names within the scope of each individual object.
 * Returns actionable warnings pointing to the duplicate occurrence
 * and referencing the line/column of the first occurrence.
 */
export function findDuplicateKeys(input: string): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];
  const errors: ParseError[] = [];
  const root = parseTree(input, errors, { allowTrailingComma: false, disallowComments: true });

  // If there are fundamental syntax errors that prevent building a tree, return empty
  if (!root || errors.length > 0) return [];

  function walk(node: Node) {
    if (node.type === "object" && node.children) {
      const seen = new Map<string, { offset: number; line: number; column: number }>();
      for (const prop of node.children) {
        if (prop.type === "property" && prop.children && prop.children.length >= 1) {
          const keyNode = prop.children[0]!;
          const keyName = String(keyNode.value);
          const { line, column } = offsetToLineCol(input, keyNode.offset);

          const existing = seen.get(keyName);
          if (existing) {
            warnings.push({
              key: keyName,
              warningType: "duplicate-key",
              message: `Duplicate key "${keyName}". This key was already defined at line ${existing.line}, column ${existing.column}. Parsers may inconsistently overwrite or discard duplicate values.`,
              line,
              column,
              offset: keyNode.offset,
              firstOccurrence: existing,
            });
          } else {
            seen.set(keyName, { offset: keyNode.offset, line, column });
          }

          if (prop.children[1]) {
            walk(prop.children[1]);
          }
        }
      }
    } else if (node.type === "array" && node.children) {
      for (const child of node.children) {
        walk(child);
      }
    }
  }

  walk(root);
  return warnings;
}

/**
 * Detect integer literals that exceed JavaScript's safe integer range (±9,007,199,254,740,991).
 * Uses AST node offsets from jsonc-parser to extract raw token text,
 * avoiding any intermediate float64 conversion.
 */
export function findUnsafeIntegers(input: string): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];
  const errors: ParseError[] = [];
  const root = parseTree(input, errors, { allowTrailingComma: false, disallowComments: true });

  if (!root || errors.length > 0) return [];

  const maxSafe = BigInt(Number.MAX_SAFE_INTEGER); // 9007199254740991n
  const minSafe = BigInt(Number.MIN_SAFE_INTEGER); // -9007199254740991n

  function walk(node: Node) {
    if (node.type === "number") {
      const raw = input.slice(node.offset, node.offset + node.length).trim();
      // Only check integers (without decimal point or exponent notation)
      if (/^-?\d+$/.test(raw)) {
        try {
          const big = BigInt(raw);
          if (big > maxSafe || big < minSafe) {
            const { line, column } = offsetToLineCol(input, node.offset);
            warnings.push({
              value: raw,
              warningType: "unsafe-integer",
              message: `Integer ${raw} exceeds JavaScript's safe integer limit (±${Number.MAX_SAFE_INTEGER}). Parsers and formatters may lose precision. Store large IDs as strings to preserve precision.`,
              line,
              column,
              offset: node.offset,
            });
          }
        } catch {
          // Ignore if BigInt parsing fails on non-standard format
        }
      }
    }

    if (node.children) {
      for (const child of node.children) {
        walk(child);
      }
    }
  }

  walk(root);
  return warnings;
}

/**
 * Detect JSON strings that look like Windows file paths with single backslashes
 * that were interpreted as valid escape sequences (e.g. \t, \n, \r, \b, \f).
 */
export function findWindowsPathEscapes(input: string): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];
  const errors: ParseError[] = [];
  const root = parseTree(input, errors, { allowTrailingComma: false, disallowComments: true });

  if (!root || errors.length > 0) return [];

  function walk(node: Node) {
    if (node.type === "string") {
      const raw = input.slice(node.offset, node.offset + node.length);
      if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
        const content = raw.slice(1, -1);

        // Check if content looks like a Windows path:
        // 1. Drive letter: e.g. "C:\...", "C:\\..." (starts with [a-zA-Z]: followed by \ or \\ or /)
        // 2. UNC path: e.g. "\\server\..." or "\\\\server\\..."
        // 3. Known Windows root folders: e.g. "\Windows\...", "\Program Files\...", "\temp\..."
        // 4. Relative Windows path: e.g. ".\..." or "..\..."
        const isWindowsPathCandidate =
          /^[a-zA-Z]:(?:\\|\/)/.test(content) ||
          /^(?:\\\\|\\\\\\\\)[a-zA-Z0-9_.-]+/.test(content) ||
          /^(?:\\|\\\\)(?:Windows|Program Files|Program Files \(x86\)|Users|AppData|System32|temp|tmp)\b/i.test(content) ||
          /^\.\.?(?:\\|\\\\)/.test(content);

        if (isWindowsPathCandidate) {
          // Scan for single backslashes that precede valid escape sequences
          let hasUnescapedBackslash = false;
          const unescapedEscapes: string[] = [];
          let suggestedContent = "";
          let i = 0;

          while (i < content.length) {
            if (content[i] === "\\") {
              const next = content[i + 1];
              if (next === "\\") {
                // Already escaped backslash `\\`, keep as-is
                suggestedContent += "\\\\";
                i += 2;
                continue;
              }
              // If next character forms a valid escape sequence
              if (next && /^[btnfr"\/]/.test(next)) {
                hasUnescapedBackslash = true;
                unescapedEscapes.push(`\\${next}`);
                suggestedContent += "\\\\" + next;
                i += 2;
                continue;
              }
              if (next === "u" && /^[0-9a-fA-F]{4}/.test(content.slice(i + 2, i + 6))) {
                hasUnescapedBackslash = true;
                unescapedEscapes.push(content.slice(i, i + 6));
                suggestedContent += "\\\\" + content.slice(i + 1, i + 6);
                i += 6;
                continue;
              }
              // Other backslash
              suggestedContent += content[i];
              i++;
            } else {
              suggestedContent += content[i];
              i++;
            }
          }

          if (hasUnescapedBackslash) {
            const { line, column } = offsetToLineCol(input, node.offset);
            const suggested = `"${suggestedContent}"`;
            const uniqueEscapes = Array.from(new Set(unescapedEscapes));
            warnings.push({
              value: raw,
              warningType: "escape-path",
              message: `The string appears to be a Windows path containing unescaped backslashes (${raw}). In JSON, backslashes must be escaped as "\\\\" (e.g. ${suggested}), otherwise escape sequences like ${uniqueEscapes.join(", ")} are interpreted as control characters.`,
              line,
              column,
              offset: node.offset,
            });
          }
        }
      }
    }

    if (node.children) {
      for (const child of node.children) {
        walk(child);
      }
    }
  }

  walk(root);
  return warnings;
}

/**
 * Determine if a token at offset is situated in an object key position
 * (e.g. `{True: 1}`, `{"a": 1, True: 2}`).
 */
export function isKeyPosition(input: string, offset: number, length: number): boolean {
  // 1. If followed by a colon (skipping whitespace/comments), it is unambiguously a key
  let i = offset + length;
  while (i < input.length) {
    const ch = input[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    if (ch === "/" && input[i + 1] === "/") {
      i += 2;
      while (i < input.length && input[i] !== "\n" && input[i] !== "\r") i++;
      continue;
    }
    if (ch === "/" && input[i + 1] === "*") {
      i += 2;
      while (i < input.length && !(input[i] === "*" && input[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (ch === ":") return true;
    break;
  }

  // 2. Scan backwards to inspect the immediate scope delimiter
  let braceCount = 0;
  let bracketCount = 0;
  let inString = false;
  let j = offset - 1;

  while (j >= 0) {
    const ch = input[j];
    if (ch === '"' && input[j - 1] !== "\\") {
      inString = !inString;
      j--;
      continue;
    }
    if (inString) {
      j--;
      continue;
    }

    if (ch === "}") braceCount++;
    else if (ch === "{") {
      if (braceCount > 0) braceCount--;
      else return true; // Direct child of '{' before any colon -> key position
    } else if (ch === "]") bracketCount++;
    else if (ch === "[") {
      if (bracketCount > 0) bracketCount--;
      else return false; // Direct child of '[' -> array element (value position)
    } else if (braceCount === 0 && bracketCount === 0) {
      if (ch === ":") {
        // Preceded by a colon in the same scope -> value position
        return false;
      }
      if (ch === ",") {
        // Preceded by a comma in the same scope -> check enclosing container of that comma
        let k = j - 1;
        let bCount = 0;
        let brCount = 0;
        let inStr = false;
        while (k >= 0) {
          const c = input[k];
          if (c === '"' && input[k - 1] !== "\\") inStr = !inStr;
          if (!inStr) {
            if (c === "}") bCount++;
            else if (c === "{") {
              if (bCount > 0) bCount--;
              else return true; // Inside object, after comma -> key position
            } else if (c === "]") brCount++;
            else if (c === "[") {
              if (brCount > 0) brCount--;
              else return false; // Inside array, after comma -> value position
            }
          }
          k--;
        }
        return false;
      }
    }

    j--;
  }

  return false;
}

/**
 * Detect if an offset in the input points to a Python-style literal (True, False, None).
 * Ensures proper word boundary checks to avoid false positives on identifiers like TrueVar or NoneType.
 */
export function detectPythonLiteral(
  input: string,
  offset: number
): {
  literal: "True" | "False" | "None";
  replacement: "true" | "false" | "null";
  expectedType: string;
  isKey: boolean;
} | null {
  const prevChar = offset > 0 ? input[offset - 1] : "";
  if (/[a-zA-Z0-9_$]/.test(prevChar)) return null;

  let literal: "True" | "False" | "None" | null = null;
  let replacement: "true" | "false" | "null" = "true";
  let expectedType = "";
  let length = 0;

  if (input.startsWith("True", offset)) {
    const nextChar = input[offset + 4] ?? "";
    if (!/[a-zA-Z0-9_$]/.test(nextChar)) {
      literal = "True";
      replacement = "true";
      expectedType = "booleans must be lowercase 'true'";
      length = 4;
    }
  } else if (input.startsWith("False", offset)) {
    const nextChar = input[offset + 5] ?? "";
    if (!/[a-zA-Z0-9_$]/.test(nextChar)) {
      literal = "False";
      replacement = "false";
      expectedType = "booleans must be lowercase 'false'";
      length = 5;
    }
  } else if (input.startsWith("None", offset)) {
    const nextChar = input[offset + 4] ?? "";
    if (!/[a-zA-Z0-9_$]/.test(nextChar)) {
      literal = "None";
      replacement = "null";
      expectedType = "null values must be lowercase 'null'";
      length = 4;
    }
  }

  if (!literal) return null;

  const isKey = isKeyPosition(input, offset, length);
  return { literal, replacement, expectedType, isKey };
}

/**
 * Format a jsonc-parser ParseError into a clear, actionable diagnostic message.
 * Provides specialized guidance for Python-style literals (True, False, None) with repair hints,
 * distinguishing between object key position and value position.
 */
export function formatJsonErrorMessage(input: string, err: ParseError): string {
  if (err.error === ParseErrorCode.InvalidSymbol) {
    const py = detectPythonLiteral(input, err.offset);
    if (py) {
      if (py.isKey) {
        return `Invalid unquoted Python literal '${py.literal}' used as an object key. In JSON, object keys must be double-quoted strings. Click 'Try Repair' to auto-fix.`;
      }
      return `Invalid Python-style literal '${py.literal}'. In JSON, ${py.expectedType}. Click 'Try Repair' to auto-fix.`;
    }
  }
  return printParseErrorCode(err.error);
}

/**
 * Validate JSON string. Returns precise error location and duplicate/precision warnings.
 */
export function validateJSON(input: string): ValidationResult {
  if (isHtmlResponse(input)) {
    const trimmed = input.trim();
    const leadingOffset = input.indexOf(trimmed);
    const { line, column } = offsetToLineCol(input, leadingOffset);
    return {
      valid: false,
      message: HTML_ERROR_MESSAGE,
      line,
      column,
      offset: leadingOffset,
    };
  }

  const errors: ParseError[] = [];
  parse(input, errors, { allowTrailingComma: false, disallowComments: true });

  if (errors.length === 0) {
    const duplicateWarnings = findDuplicateKeys(input);
    const precisionWarnings = findUnsafeIntegers(input);
    const pathWarnings = findWindowsPathEscapes(input);
    const warnings = [...duplicateWarnings, ...precisionWarnings, ...pathWarnings];
    return warnings.length > 0 ? { valid: true, warnings } : { valid: true };
  }

  const err = errors[0]!;
  const { line, column } = offsetToLineCol(input, err.offset);

  return {
    valid: false,
    message: formatJsonErrorMessage(input, err),
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

  if (isHtmlResponse(trimmed)) {
    const offset = input.indexOf(trimmed);
    const { line, column } = offsetToLineCol(input, offset);
    return {
      success: false,
      error: HTML_ERROR_MESSAGE,
      line,
      column,
      offset,
    };
  }

  const unsafeInts = findUnsafeIntegers(trimmed);
  if (unsafeInts.length > 0) {
    const u = unsafeInts[0]!;
    return {
      success: false,
      error: `Cannot safely format JSON: integer ${u.value} exceeds JavaScript's safe integer limit (${Number.MAX_SAFE_INTEGER}) and will lose precision. Store large IDs as strings to preserve precision.`,
      line: u.line,
      column: u.column,
      offset: u.offset,
    };
  }

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

  if (isHtmlResponse(trimmed)) {
    const offset = input.indexOf(trimmed);
    const { line, column } = offsetToLineCol(input, offset);
    return {
      success: false,
      error: HTML_ERROR_MESSAGE,
      line,
      column,
      offset,
    };
  }

  const unsafeInts = findUnsafeIntegers(trimmed);
  if (unsafeInts.length > 0) {
    const u = unsafeInts[0]!;
    return {
      success: false,
      error: `Cannot safely minify JSON: integer ${u.value} exceeds JavaScript's safe integer limit (${Number.MAX_SAFE_INTEGER}) and will lose precision. Store large IDs as strings to preserve precision.`,
      line: u.line,
      column: u.column,
      offset: u.offset,
    };
  }

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
