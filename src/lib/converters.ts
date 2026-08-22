// src/lib/converters.ts
// Phase 5 conversion utilities — JSON↔CSV, JSON↔YAML, JSON Diff
// All 100% client-side, zero server calls.

import { dump as yamlDump, load as yamlLoad } from "js-yaml";

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
  try {
    const parsed = safeParse(jsonString);

    if (!Array.isArray(parsed)) {
      return {
        success: false,
        error:
          "CSV conversion needs a JSON array of objects. Your input is not an array — wrap it in [ ] or check the format.",
      };
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

// ─── JSON → YAML ──────────────────────────────────────────────────────────────

/**
 * Convert a JSON string to YAML using js-yaml.
 * Returns a clean, human-readable YAML string.
 */
export function jsonToYaml(jsonString: string): ConversionOutcome {
  try {
    const parsed = safeParse(jsonString);
    const output = yamlDump(parsed, {
      indent: 2,
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

/**
 * Convert a YAML string back to JSON (reverse direction).
 */
export function yamlToJson(yamlString: string): ConversionOutcome {
  try {
    const trimmed = yamlString.trim();
    if (!trimmed) throw new Error("YAML input is empty");
    const parsed = yamlLoad(trimmed);
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
