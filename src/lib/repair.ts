// src/lib/repair.ts
// JSON repair logic using the jsonrepair package — 100% client-side

import { jsonrepair } from "jsonrepair";

export type RepairResult =
  | { success: true; output: string; alreadyValid: boolean; changes: string[] }
  | { success: false; error: string };

/**
 * Attempt to auto-repair broken JSON.
 * Returns what was fixed (heuristic detection) for user feedback.
 */
export function repairJSON(input: string): RepairResult {
  const trimmed = input.trim();
  if (!trimmed) return { success: true, output: "", alreadyValid: true, changes: [] };

  // Check if already valid
  try {
    const parsed = JSON.parse(trimmed);
    return {
      success: true,
      output: JSON.stringify(parsed, null, 2),
      alreadyValid: true,
      changes: [],
    };
  } catch {
    // Not valid — attempt repair
  }

  try {
    const repaired = jsonrepair(trimmed);
    const changes = detectChanges(trimmed, repaired);
    return { success: true, output: repaired, alreadyValid: false, changes };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Unknown repair error",
    };
  }
}

/**
 * Heuristic: compare original vs repaired to detect what was fixed.
 * Returns a human-readable list of fix descriptions.
 */
function detectChanges(original: string, repaired: string): string[] {
  const changes: string[] = [];

  // Single quotes → double quotes
  if (/'/.test(original) && !/'/.test(repaired)) {
    changes.push("single quotes converted");
  }

  // Trailing commas before } or ]
  if (/,\s*[}\]]/.test(original)) {
    changes.push("trailing commas removed");
  }

  // Comments (// or /* */)
  if (/\/\/|\/\*/.test(original)) {
    changes.push("comments removed");
  }

  // Unquoted keys: pattern like `{ key: value }`
  if (/[{,]\s*[a-zA-Z_$][a-zA-Z0-9_$]*\s*:/.test(original)) {
    changes.push("unquoted keys quoted");
  }

  // Python-style booleans/null
  if (/\bTrue\b|\bFalse\b|\bNone\b/.test(original)) {
    changes.push("Python-style values fixed (True/False/None)");
  }

  // Missing quotes around string values — hard to detect simply
  // Fallback: if no specific change detected but strings differ
  if (changes.length === 0 && original !== repaired) {
    changes.push("auto-repaired");
  }

  return changes;
}
