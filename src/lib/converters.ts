// src/lib/converters.ts
// Phase 5 conversion utilities — JSON↔CSV, JSON↔YAML, JSON Diff
// All 100% client-side, zero server calls.

import {
  dump as yamlDump,
  load as yamlLoad,
  CORE_SCHEMA,
  intCoreTag,
  defineScalarTag,
  NOT_RESOLVED,
} from "js-yaml";
import { findUnsafeIntegers } from "./formatters";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConversionResult {
  success: true;
  output: string;
}

export interface ConversionError {
  success: false;
  error: string;
}

export type ConversionOutcome = ConversionResult | ConversionError;

export type DiffType = "added" | "removed" | "changed" | "type-changed";

export interface DiffEntry {
  path: string;
  type: DiffType;
  oldValue?: unknown;
  newValue?: unknown;
}

export interface DiffResult {
  success: true;
  entries: DiffEntry[];
  totalChanges: number;
}

export interface DiffError {
  success: false;
  error: string;
}

export type DiffOutcome = DiffResult | DiffError;

// ─── Helpers ──────────────────────────────────────────────────────────────────

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonArray;
type JsonObject = { [key: string]: JsonValue };
type JsonArray = JsonValue[];

/** Safely parse JSON, return parsed value or throw with clear message */
function safeParse(jsonString: string, label = "JSON"): JsonValue {
  const trimmed = jsonString.trim();
  if (!trimmed) throw new Error(`${label} input is empty`);

  const unsafeInts = findUnsafeIntegers(trimmed);
  if (unsafeInts.length > 0) {
    const u = unsafeInts[0]!;
    throw new Error(
      `Cannot safely process ${label}: integer ${u.value} exceeds JavaScript's safe integer limit (${Number.MAX_SAFE_INTEGER}) and will lose precision. Store large IDs as strings to preserve precision.`
    );
  }

  try {
    return JSON.parse(trimmed);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Invalid ${label}: ${msg}`);
  }
}

/** Flatten a nested object with dot-notation keys */
function flattenObject(
  obj: JsonObject,
  prefix = "",
  result: Record<string, string> = {}
): Record<string, string> {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      flattenObject(value as JsonObject, fullKey, result);
    } else if (Array.isArray(value)) {
      // Stringify arrays inline
      result[fullKey] = JSON.stringify(value);
    } else {
      result[fullKey] = value === null ? "" : String(value);
    }
  }
  return result;
}

/** Escape a CSV cell value (quote if needed) */
function escapeCsvCell(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// ─── JSON → CSV ───────────────────────────────────────────────────────────────

/**
 * Convert a JSON array-of-objects to a CSV string.
 * Nested objects are flattened with dot notation (e.g. "address.city").
 * Arrays inside objects are serialised as JSON strings in the cell.
 */
export function jsonToCsv(jsonString: string): ConversionOutcome {
  const trimmed = jsonString.trim();
  const unsafeInts = findUnsafeIntegers(trimmed);
  if (unsafeInts.length > 0) {
    const u = unsafeInts[0]!;
    return {
      success: false,
      error: `Cannot safely convert to CSV: integer ${u.value} exceeds JavaScript's safe integer limit (${Number.MAX_SAFE_INTEGER}) and will lose precision. Store large IDs as strings to preserve precision.`,
    };
  }

  try {
    const parsed = safeParse(jsonString);

    if (parsed === null || typeof parsed !== "object") {
      return {
        success: false,
        error:
          "CSV conversion requires a JSON object or an array of objects. Primitive values cannot be converted to CSV table rows.",
      };
    }

    if (!Array.isArray(parsed)) {
      if (Object.keys(parsed).length === 0) {
        return { success: true, output: "" };
      }
      const row = flattenObject(parsed as JsonObject);
      const allKeys = Object.keys(row);
      const headerRow = allKeys.map(escapeCsvCell).join(",");
      const dataRow = allKeys.map((key) => escapeCsvCell(row[key] ?? "")).join(",");
      return { success: true, output: `${headerRow}\n${dataRow}` };
    }

    if (parsed.length === 0) {
      return { success: true, output: "" };
    }

    // Validate all items are objects
    const nonObjects = parsed.filter(
      (item) =>
        item === null || typeof item !== "object" || Array.isArray(item)
    );
    if (nonObjects.length > 0) {
      return {
        success: false,
        error:
          "CSV conversion needs a JSON array of objects. Some items in your array are primitives or nested arrays, not objects.",
      };
    }

    // Flatten each row and collect all headers
    const rows = (parsed as JsonObject[]).map((obj) => flattenObject(obj));
    const allKeys = Array.from(
      new Set(rows.flatMap((row) => Object.keys(row)))
    );

    // Build CSV
    const headerRow = allKeys.map(escapeCsvCell).join(",");
    const dataRows = rows.map((row) =>
      allKeys.map((key) => escapeCsvCell(row[key] ?? "")).join(",")
    );

    return { success: true, output: [headerRow, ...dataRows].join("\n") };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Conversion failed",
    };
  }
}

// ─── CSV → JSON ───────────────────────────────────────────────────────────────

export interface CsvToJsonOptions {
  parseNumbers?: boolean;
  parseBooleans?: boolean;
  trimHeaders?: boolean;
}

/**
 * Parse an RFC 4180 compliant CSV string into a 2D array of string cells.
 * Correctly parses quoted fields with commas, newlines, and escaped quotes ("").
 */
function parseCsvRows(input: string): { rows: string[][]; error?: string } {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let insideQuotes = false;
  let i = 0;
  const len = input.length;

  while (i < len) {
    const char = input[i];

    if (insideQuotes) {
      if (char === '"') {
        if (i + 1 < len && input[i + 1] === '"') {
          currentField += '"';
          i += 2;
          continue;
        } else {
          insideQuotes = false;
          i++;
          continue;
        }
      } else {
        currentField += char;
        i++;
        continue;
      }
    } else {
      if (char === '"') {
        insideQuotes = true;
        i++;
        continue;
      } else if (char === ',') {
        currentRow.push(currentField);
        currentField = "";
        i++;
        continue;
      } else if (char === '\r') {
        if (i + 1 < len && input[i + 1] === '\n') {
          i++;
        }
        currentRow.push(currentField);
        rows.push(currentRow);
        currentRow = [];
        currentField = "";
        i++;
        continue;
      } else if (char === '\n') {
        currentRow.push(currentField);
        rows.push(currentRow);
        currentRow = [];
        currentField = "";
        i++;
        continue;
      } else {
        currentField += char;
        i++;
        continue;
      }
    }
  }

  if (insideQuotes) {
    return { rows: [], error: "CSV syntax error: unclosed quoted string encountered." };
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return { rows };
}

/** Disambiguate duplicate header names to prevent silent overwriting of column data */
function disambiguateHeaders(headers: string[], trim = true): string[] {
  const seenCount = new Map<string, number>();
  return headers.map((h, idx) => {
    let headerName = trim ? h.trim() : h;
    if (!headerName) {
      headerName = `col_${idx + 1}`;
    }
    const count = (seenCount.get(headerName) ?? 0) + 1;
    seenCount.set(headerName, count);
    if (count > 1) {
      return `${headerName}_${count}`;
    }
    return headerName;
  });
}

/** Infer types for CSV cell values: booleans, null, numbers (preserving unsafe integers as strings) */
function inferCsvValue(val: string, options?: CsvToJsonOptions): unknown {
  const parseNumbers = options?.parseNumbers ?? true;
  const parseBooleans = options?.parseBooleans ?? true;

  if (parseBooleans) {
    if (val === "true") return true;
    if (val === "false") return false;
    if (val === "null") return null;
  }

  if (parseNumbers && val.trim() !== "") {
    if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(val)) {
      if (/^-?\d+$/.test(val)) {
        try {
          const big = BigInt(val);
          const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
          const minSafe = BigInt(Number.MIN_SAFE_INTEGER);
          if (big > maxSafe || big < minSafe) {
            return val;
          }
        } catch {
          return val;
        }
      }
      const num = Number(val);
      if (!Number.isNaN(num)) {
        return num;
      }
    }
  }

  return val;
}

/**
 * Convert an RFC 4180 CSV string to a JSON array of objects.
 * Supports auto-typing (booleans, numbers with safe integer protection),
 * multiline fields, CRLF, UTF-8 BOM, and duplicate header safety.
 */
export function csvToJson(csvString: string, options?: CsvToJsonOptions): ConversionOutcome {
  let cleanInput = csvString;
  if (cleanInput.charCodeAt(0) === 0xFEFF) {
    cleanInput = cleanInput.slice(1);
  }

  if (!cleanInput.trim()) {
    return { success: true, output: "[]" };
  }

  const { rows, error } = parseCsvRows(cleanInput);
  if (error) {
    return { success: false, error };
  }

  if (rows.length === 0) {
    return { success: true, output: "[]" };
  }

  const rawHeaders = rows[0]!;
  const headers = disambiguateHeaders(rawHeaders, options?.trimHeaders ?? true);
  const dataRows = rows.slice(1);

  const validDataRows = dataRows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ""));
  if (validDataRows.length === 0) {
    return { success: true, output: "[]" };
  }

  const records = validDataRows.map((row) => {
    const obj: Record<string, unknown> = {};
    headers.forEach((header, idx) => {
      const cellVal = idx < row.length ? row[idx]! : "";
      obj[header] = inferCsvValue(cellVal, options);
    });
    return obj;
  });

  return { success: true, output: JSON.stringify(records, null, 2) };
}

// ─── JSON → YAML ──────────────────────────────────────────────────────────────

/**
 * Convert a JSON string to YAML using js-yaml.
 * Returns a clean, human-readable YAML string.
 */
export function jsonToYaml(jsonString: string, indent: 2 | 4 = 2): ConversionOutcome {
  const trimmed = jsonString.trim();
  const unsafeInts = findUnsafeIntegers(trimmed);
  if (unsafeInts.length > 0) {
    const u = unsafeInts[0]!;
    return {
      success: false,
      error: `Cannot safely convert to YAML: integer ${u.value} exceeds JavaScript's safe integer limit (${Number.MAX_SAFE_INTEGER}) and will lose precision. Store large IDs as strings to preserve precision.`,
    };
  }

  try {
    const parsed = safeParse(jsonString);
    const output = yamlDump(parsed, {
      indent,
      lineWidth: 120,
      noRefs: true,
      quotingType: '"',
    });
    return { success: true, output };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "YAML conversion failed",
    };
  }
}

const MAX_SAFE_INT = BigInt(Number.MAX_SAFE_INTEGER); // 9007199254740991n
const MIN_SAFE_INT = BigInt(Number.MIN_SAFE_INTEGER); // -9007199254740991n

/**
 * Custom scalar tag that wraps the default YAML 1.2 int tag.
 * Detects integer literals (decimal, hex, octal, binary) that exceed
 * JavaScript's safe integer range (±9,007,199,254,740,991) before js-yaml
 * can round them into IEEE 754 float64 numbers.
 */
const safeIntTag = defineScalarTag("tag:yaml.org,2002:int", {
  implicit: true,
  implicitFirstChars: ["-", "+", ..."0123456789"],
  resolve: (source, isExplicit, tagName) => {
    const orig = intCoreTag.resolve(source, isExplicit, tagName);
    if (orig === NOT_RESOLVED) return NOT_RESOLVED;

    try {
      let val = source;
      let sign = 1n;
      if (val[0] === "-" || val[0] === "+") {
        if (val[0] === "-") sign = -1n;
        val = val.slice(1);
      }

      let big: bigint | undefined;
      if (val.startsWith("0b") || val.startsWith("0B")) {
        big = sign * BigInt("0b" + val.slice(2));
      } else if (val.startsWith("0o") || val.startsWith("0O")) {
        big = sign * BigInt("0o" + val.slice(2));
      } else if (val.startsWith("0x") || val.startsWith("0X")) {
        big = sign * BigInt("0x" + val.slice(2));
      } else if (/^\d+$/.test(val)) {
        big = sign * BigInt(val);
      }

      if (big !== undefined && (big > MAX_SAFE_INT || big < MIN_SAFE_INT)) {
        throw new Error(
          `Cannot safely convert to JSON: integer ${source} exceeds JavaScript's safe integer limit (${Number.MAX_SAFE_INTEGER}) and will lose precision. Store large IDs as quoted strings in YAML to preserve precision.`
        );
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("Cannot safely convert")) {
        throw e;
      }
    }

    return orig;
  },
  identify: intCoreTag.identify,
  represent: intCoreTag.represent,
});

const safeYamlSchema = CORE_SCHEMA.withTags(safeIntTag);

/**
 * Convert a YAML string back to JSON (reverse direction).
 */
export function yamlToJson(yamlString: string): ConversionOutcome {
  try {
    const trimmed = yamlString.trim();
    if (!trimmed) throw new Error("YAML input is empty");
    const parsed = yamlLoad(trimmed, { schema: safeYamlSchema });
    return { success: true, output: JSON.stringify(parsed, null, 2) };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "JSON conversion failed",
    };
  }
}

// ─── JSON Diff ────────────────────────────────────────────────────────────────

/**
 * Recursively deep-compare two JSON values and collect differences.
 * Differences are reported with full JSONPath-style paths.
 */
function deepCompare(
  a: JsonValue,
  b: JsonValue,
  path: string,
  entries: DiffEntry[]
): void {
  // Type changed (e.g. object → array, string → number, etc.)
  const typeA = Array.isArray(a) ? "array" : a === null ? "null" : typeof a;
  const typeB = Array.isArray(b) ? "array" : b === null ? "null" : typeof b;

  if (typeA !== typeB) {
    entries.push({ path, type: "type-changed", oldValue: a, newValue: b });
    return;
  }

  // Both are plain objects
  if (typeA === "object" && typeB === "object") {
    const objA = a as JsonObject;
    const objB = b as JsonObject;
    const keysA = new Set(Object.keys(objA));
    const keysB = new Set(Object.keys(objB));

    // Removed keys
    for (const key of keysA) {
      if (!keysB.has(key)) {
        const childPath = `${path}.${key}`;
        entries.push({ path: childPath, type: "removed", oldValue: objA[key] });
      }
    }
    // Added keys
    for (const key of keysB) {
      if (!keysA.has(key)) {
        const childPath = `${path}.${key}`;
        entries.push({ path: childPath, type: "added", newValue: objB[key] });
      }
    }
    // Shared keys — recurse
    for (const key of keysA) {
      if (keysB.has(key)) {
        deepCompare(objA[key]!, objB[key]!, `${path}.${key}`, entries);
      }
    }
    return;
  }

  // Both are arrays
  if (typeA === "array") {
    const arrA = a as JsonArray;
    const arrB = b as JsonArray;
    const maxLen = Math.max(arrA.length, arrB.length);
    for (let i = 0; i < maxLen; i++) {
      const childPath = `${path}[${i}]`;
      if (i >= arrA.length) {
        entries.push({ path: childPath, type: "added", newValue: arrB[i] });
      } else if (i >= arrB.length) {
        entries.push({ path: childPath, type: "removed", oldValue: arrA[i] });
      } else {
        deepCompare(arrA[i]!, arrB[i]!, childPath, entries);
      }
    }
    return;
  }

  // Primitives — direct comparison
  if (a !== b) {
    entries.push({ path, type: "changed", oldValue: a, newValue: b });
  }
}

/**
 * Compare two JSON strings and return a structured diff result.
 */
export function jsonDiff(jsonStringA: string, jsonStringB: string): DiffOutcome {
  const trimmedA = jsonStringA.trim();
  const trimmedB = jsonStringB.trim();

  const unsafeA = findUnsafeIntegers(trimmedA);
  const unsafeB = findUnsafeIntegers(trimmedB);

  if (unsafeA.length > 0 && unsafeB.length > 0) {
    return {
      success: false,
      error: `Cannot safely diff: JSON A and JSON B contain integers exceeding JavaScript's safe integer limit (${Number.MAX_SAFE_INTEGER}) and will lose precision. Store large IDs as strings to preserve precision.`,
    };
  }
  if (unsafeA.length > 0) {
    const u = unsafeA[0]!;
    return {
      success: false,
      error: `Cannot safely diff: JSON A contains integer ${u.value} which exceeds JavaScript's safe integer limit (${Number.MAX_SAFE_INTEGER}) and will lose precision. Store large IDs as strings to preserve precision.`,
    };
  }
  if (unsafeB.length > 0) {
    const u = unsafeB[0]!;
    return {
      success: false,
      error: `Cannot safely diff: JSON B contains integer ${u.value} which exceeds JavaScript's safe integer limit (${Number.MAX_SAFE_INTEGER}) and will lose precision. Store large IDs as strings to preserve precision.`,
    };
  }

  try {
    const parsedA = safeParse(jsonStringA, "JSON A");
    const parsedB = safeParse(jsonStringB, "JSON B");

    const entries: DiffEntry[] = [];
    deepCompare(parsedA, parsedB, "$", entries);

    return {
      success: true,
      entries,
      totalChanges: entries.length,
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Diff failed",
    };
  }
}

// ─── JSON → TypeScript ────────────────────────────────────────────────────────

export interface TypeScriptOptions {
  rootName?: string;
  useExport?: boolean;
}

const JS_RESERVED_WORDS = new Set([
  "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete",
  "do", "else", "export", "extends", "finally", "for", "function", "if", "import", "in",
  "instanceof", "new", "return", "super", "switch", "this", "throw", "try", "typeof",
  "var", "void", "while", "with", "yield", "let", "static", "enum", "await", "implements",
  "package", "protected", "interface", "private", "public"
]);

function formatPropertyKey(key: string): string {
  if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) && !JS_RESERVED_WORDS.has(key)) {
    return key;
  }
  return JSON.stringify(key);
}

function inferType(value: unknown, indentLevel = 0): string {
  if (value === null) return "null";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";

  if (Array.isArray(value)) {
    if (value.length === 0) return "unknown[]";
    const isObjArr = value.every((item) => item !== null && typeof item === "object" && !Array.isArray(item));
    if (isObjArr) {
      return `Array<${inferObjectArrayType(value as Record<string, unknown>[], indentLevel)}>`;
    }
    const types = Array.from(new Set(value.map((v) => inferType(v, indentLevel))));
    return types.length === 1 ? `${types[0]}[]` : `(${types.join(" | ")})[]`;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "Record<string, unknown>";
    const indent = "  ".repeat(indentLevel);
    const childIndent = "  ".repeat(indentLevel + 1);
    const lines = entries.map(([k, v]) => {
      const propKey = formatPropertyKey(k);
      const propType = inferType(v, indentLevel + 1);
      return `${childIndent}${propKey}: ${propType};`;
    });
    return `{\n${lines.join("\n")}\n${indent}}`;
  }

  return "unknown";
}

function inferObjectArrayType(
  arr: Record<string, unknown>[],
  indentLevel = 0
): string {
  const allKeys = Array.from(new Set(arr.flatMap((item) => Object.keys(item))));
  if (allKeys.length === 0) return "Record<string, unknown>";

  const indent = "  ".repeat(indentLevel);
  const childIndent = "  ".repeat(indentLevel + 1);

  const lines = allKeys.map((key) => {
    const isOptional = arr.some((item) => !(key in item));
    const values = arr.map((item) => item[key]).filter((v) => v !== undefined);
    const types = Array.from(new Set(values.map((v) => inferType(v, indentLevel + 1))));
    const typeStr = types.length === 0 ? "unknown" : types.length === 1 ? types[0]! : `(${types.join(" | ")})`;
    const propKey = formatPropertyKey(key) + (isOptional ? "?" : "");
    return `${childIndent}${propKey}: ${typeStr};`;
  });

  return `{\n${lines.join("\n")}\n${indent}}`;
}

/**
 * Convert JSON input into idiomatic TypeScript interface/type definitions.
 * Handles nested objects, primitive and mixed arrays, object arrays with optional
 * property detection, identifier sanitization, and customizable root names.
 */
export function jsonToTypeScript(
  jsonString: string,
  options?: TypeScriptOptions
): ConversionOutcome {
  const trimmed = jsonString.trim();
  if (!trimmed) {
    return { success: false, error: "JSON input is empty" };
  }

  let parsed: JsonValue;
  try {
    parsed = safeParse(trimmed, "JSON");
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Invalid JSON" };
  }

  const rootName = options?.rootName?.trim() || "RootObject";
  const prefix = options?.useExport !== false ? "export " : "";

  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      return { success: true, output: `${prefix}type ${rootName} = unknown[];\n` };
    }
    const isObjectArray = parsed.every((item) => item !== null && typeof item === "object" && !Array.isArray(item));
    if (isObjectArray) {
      const inner = inferObjectArrayType(parsed as Record<string, unknown>[], 0);
      return { success: true, output: `${prefix}type ${rootName} = Array<${inner}>;\n` };
    }
    const elemTypes = Array.from(new Set(parsed.map((item) => inferType(item, 0))));
    const elemTypeStr = elemTypes.length === 1 ? `${elemTypes[0]}[]` : `(${elemTypes.join(" | ")})[]`;
    return { success: true, output: `${prefix}type ${rootName} = ${elemTypeStr};\n` };
  }

  if (parsed !== null && typeof parsed === "object") {
    const entries = Object.entries(parsed as Record<string, unknown>);
    if (entries.length === 0) {
      return { success: true, output: `${prefix}interface ${rootName} {}\n` };
    }
    const lines = entries.map(([key, value]) => {
      const propKey = formatPropertyKey(key);
      const propType = inferType(value, 1);
      return `  ${propKey}: ${propType};`;
    });
    return {
      success: true,
      output: `${prefix}interface ${rootName} {\n${lines.join("\n")}\n}\n`,
    };
  }

  return {
    success: true,
    output: `${prefix}type ${rootName} = ${inferType(parsed, 0)};\n`,
  };
}
