import { describe, it, expect } from "vitest";
import { validateJSON, formatJSON } from "../src/lib/formatters";

/**
 * These tests characterize and record CURRENT production behavior
 * on known edge-cases and diagnostic capability gaps identified during
 * the competitor and architecture audits.
 *
 * They verify actual baseline behavior WITHOUT masking known gaps.
 */
describe("Known Capability Gaps - Current Baseline Characterization", () => {
  it("GAP-1 (RESOLVED in Phase 2B): Duplicate keys emit actionable warning while preserving validity", () => {
    // Resolved in Phase 2B: duplicate keys remain valid JSON per RFC 8259,
    // but emit a clear ValidationWarning with line/column coordinates.
    const input = '{"id": 1, "id": 2}';
    const result = validateJSON(input);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.length).toBe(1);
      expect(result.warnings![0]!.key).toBe("id");
      expect(result.warnings![0]!.message).toMatch(/duplicate key/i);
    }
  });

  it("GAP-2 (RESOLVED in Phase 2E): Python True/False/None emit helpful Python-style literal diagnostic and repair hint", () => {
    // Resolved in Phase 2E: validateJSON detects Python literals (True, False, None)
    // and returns an actionable diagnostic identifying the Python literal, the standard JSON equivalent,
    // and a prompt to use "Try Repair".
    const input = '{"active": True}';
    const result = validateJSON(input);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.message).toMatch(/Python/i);
      expect(result.message).toContain("'True'");
      expect(result.message).toContain("'true'");
    }
  });

  it("GAP-3 (RESOLVED in Phase 2D): Windows file paths with single backslashes emit escape-path warning while preserving validity", () => {
    // Resolved in Phase 2D: In "C:\temp", \t is detected as an unescaped Windows path,
    // emitting a ValidationWarning while keeping valid: true.
    const input = '{"path": "C:\\temp"}';
    const result = validateJSON(input);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.some((w) => w.warningType === "escape-path")).toBe(true);
    }
  });

  it("GAP-4 (RESOLVED in Phase 2C): Integers exceeding 2^53 - 1 emit precision warnings and formatJSON refuses silent loss", () => {
    // Resolved in Phase 2C: validateJSON emits an unsafe-integer warning while preserving valid: true,
    // and formatJSON refuses to format to prevent silent rounding.
    const input = '{"id": 9007199254740993}';
    const valResult = validateJSON(input);

    expect(valResult.valid).toBe(true);
    if (valResult.valid) {
      expect(valResult.warnings).toBeDefined();
      expect(valResult.warnings!.some((w) => w.warningType === "unsafe-integer")).toBe(true);
    }

    const fmtResult = formatJSON(input);
    expect(fmtResult.success).toBe(false);
    if (!fmtResult.success) {
      expect(fmtResult.error).toMatch(/precision/i);
    }
  });

  it("GAP-5 (RESOLVED in Phase 2A): HTML error responses provide actionable HTML guidance", () => {
    // Resolved in Phase 2A: detects HTML doctype/tags and emits actionable diagnostic
    const input = "<!DOCTYPE html><html><body>Error</body></html>";
    const result = validateJSON(input);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.line).toBe(1);
      expect(result.column).toBe(1);
      expect(result.message).toContain("HTML");
      expect(result.message).toMatch(/API|URL|error/i);
    }
  });

  it("GAP-A1 (RESOLVED in Master Sprint): formatJSON preserves Python literal diagnostic instead of raw V8 error", () => {
    const input = '{"active": True}';
    const fmtResult = formatJSON(input);

    expect(fmtResult.success).toBe(false);
    if (!fmtResult.success) {
      expect(fmtResult.error).toContain("Invalid Python-style literal 'True'");
      expect(fmtResult.error).toContain("booleans must be lowercase 'true'");
      expect(fmtResult.error).not.toMatch(/Unexpected token 'T'/);
    }
  });
});
