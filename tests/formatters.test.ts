import { describe, it, expect } from "vitest";
import {
  validateJSON,
  formatJSON,
  minifyJSON,
  getStats,
  formatBytes,
  findDuplicateKeys,
  findUnsafeIntegers,
  findWindowsPathEscapes,
  detectPythonLiteral,
  isKeyPosition,
  formatJsonErrorMessage,
} from "../src/lib/formatters";

describe("formatters.ts - Validation and Formatting Utilities", () => {
  describe("validateJSON", () => {
    it("returns valid: true for valid JSON objects", () => {
      const input = '{"title": "QuietJSON", "count": 42, "tags": ["a", "b"]}';
      expect(validateJSON(input)).toEqual({ valid: true });
    });

    it("returns valid: true for valid JSON arrays and primitive values", () => {
      expect(validateJSON('[1, "two", true, null]')).toEqual({ valid: true });
      expect(validateJSON('"standalone string"')).toEqual({ valid: true });
      expect(validateJSON("12345")).toEqual({ valid: true });
      expect(validateJSON("true")).toEqual({ valid: true });
      expect(validateJSON("null")).toEqual({ valid: true });
    });

    it("reports precise line, column, and offset for missing commas", () => {
      // Line 2 has missing comma between "a": 1 and "b": 2
      const input = '{\n  "a": 1\n  "b": 2\n}';
      const result = validateJSON(input);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.line).toBe(3);
        expect(result.column).toBe(3);
        expect(typeof result.offset).toBe("number");
        expect(result.message).toBeDefined();
      }
    });

    it("rejects trailing commas under strict JSON rules", () => {
      const input = '{"name": "test",}';
      const result = validateJSON(input);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.message).toBeDefined();
      }
    });

    it("rejects JavaScript/C-style comments under strict rules", () => {
      const input = '{\n  // comment\n  "key": "value"\n}';
      const result = validateJSON(input);

      expect(result.valid).toBe(false);
    });

    it("rejects unclosed brackets and braces with location", () => {
      const input = '{"items": [1, 2, 3';
      const result = validateJSON(input);

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.line).toBeGreaterThan(0);
        expect(result.column).toBeGreaterThan(0);
      }
    });

    describe("HTML response detection", () => {
      it("detects <!DOCTYPE html> and provides an actionable message", () => {
        const input = "<!DOCTYPE html>\n<html><head><title>Error</title></head><body><h1>404 Not Found</h1></body></html>";
        const result = validateJSON(input);

        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.message).toMatch(/HTML/i);
          expect(result.message).toMatch(/error|API|URL/i);
          expect(result.line).toBe(1);
          expect(result.column).toBe(1);
        }
      });

      it("detects <html> tag without doctype and handles leading whitespace", () => {
        const input = "  \n  <html lang=\"en\">\n<head><title>403 Forbidden</title></head>\n<body>Forbidden</body>\n</html>";
        const result = validateJSON(input);

        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.message).toMatch(/HTML/i);
          expect(result.line).toBe(2);
          expect(result.column).toBe(3);
        }
      });

      it("detects HTML server error pages with <head> or <body> roots", () => {
        const input = "<head><title>500 Internal Server Error</title></head><body>Server Error</body>";
        const result = validateJSON(input);

        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.message).toMatch(/HTML/i);
        }
      });

      it("does not falsely classify valid JSON containing HTML strings as HTML", () => {
        const input = JSON.stringify({
          title: "Blog Post",
          content: "<!DOCTYPE html><html><body><h1>Safe</h1></body></html>",
          tags: ["<div>", "</div>"],
        });
        const result = validateJSON(input);

        expect(result.valid).toBe(true);
      });

      it("does not falsely classify valid scalar HTML string as HTML", () => {
        const input = '"<p>This is a JSON string scalar</p>"';
        const result = validateJSON(input);

        expect(result.valid).toBe(true);
      });

      it("does not classify ordinary non-HTML malformed JSON as HTML", () => {
        const input = "{ bad: json, notHtml: true }";
        const result = validateJSON(input);

        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.message).not.toMatch(/HTML/i);
        }
      });
    });

    describe("Duplicate JSON Keys Detection (GAP-1)", () => {
      it("detects duplicate keys at top level and returns warnings while preserving valid: true", () => {
        const input = '{\n  "id": 101,\n  "name": "QuietJSON",\n  "id": 202\n}';
        const result = validateJSON(input);

        // Syntax remains valid per ECMA-404 / RFC 8259
        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.warnings).toBeDefined();
          expect(result.warnings!.length).toBe(1);
          const w = result.warnings![0]!;
          expect(w.key).toBe("id");
          expect(w.line).toBe(4);
          expect(w.column).toBe(3);
          expect(w.message).toMatch(/duplicate key "id"/i);
          expect(w.firstOccurrence).toBeDefined();
          expect(w.firstOccurrence?.line).toBe(2);
        }
      });

      it("detects duplicate keys inside nested objects", () => {
        const input = '{\n  "config": {\n    "port": 8080,\n    "port": 9090\n  }\n}';
        const result = validateJSON(input);

        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.warnings).toBeDefined();
          expect(result.warnings!.length).toBe(1);
          expect(result.warnings![0]!.key).toBe("port");
          expect(result.warnings![0]!.line).toBe(4);
        }
      });

      it("does not report the same key appearing in separate, independent objects", () => {
        const input = '{\n  "user": { "name": "Alice" },\n  "admin": { "name": "Bob" }\n}';
        const result = validateJSON(input);

        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.warnings ?? []).toEqual([]);
        }
      });

      it("does not report the same key appearing across multiple objects in an array", () => {
        const input = '[\n  { "id": 1, "status": "active" },\n  { "id": 2, "status": "pending" }\n]';
        const result = validateJSON(input);

        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.warnings ?? []).toEqual([]);
        }
      });

      it("detects duplicate keys when one is escaped with Unicode (e.g. \\u0069d and id)", () => {
        const input = '{\n  "id": 1,\n  "\\u0069d": 2\n}';
        const result = validateJSON(input);

        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.warnings).toBeDefined();
          expect(result.warnings!.length).toBe(1);
          expect(result.warnings![0]!.key).toBe("id");
          expect(result.warnings![0]!.line).toBe(3);
        }
      });

      it("does not report duplicate key warnings on malformed JSON", () => {
        const input = '{\n  "id": 1,\n  "id": ';
        const result = validateJSON(input);

        // When JSON is syntactically invalid, valid is false, syntax error is returned
        expect(result.valid).toBe(false);
      });

      it("findDuplicateKeys utility function returns detailed warning objects directly", () => {
        const input = '{\n  "dup": "first",\n  "dup": "second"\n}';
        const warnings = findDuplicateKeys(input);

        expect(warnings.length).toBe(1);
        expect(warnings[0]!.key).toBe("dup");
        expect(warnings[0]!.line).toBe(3);
        expect(warnings[0]!.firstOccurrence?.line).toBe(2);
        expect(warnings[0]!.message).toMatch(/duplicate key "dup"/i);
      });
    });

    describe("Large Integer Precision Protection (GAP-4)", () => {
      it("detects 9007199254740992 and 9007199254740993 as unsafe while preserving valid: true", () => {
        const input = '{\n  "accountId": 9007199254740993\n}';
        const result = validateJSON(input);

        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.warnings).toBeDefined();
          expect(result.warnings!.length).toBe(1);
          const w = result.warnings![0]!;
          expect(w.value).toBe("9007199254740993");
          expect(w.warningType).toBe("unsafe-integer");
          expect(w.line).toBe(2);
          expect(w.column).toBe(16);
          expect(w.message).toMatch(/precision/i);
          expect(w.message).toMatch(/9007199254740993/);
        }
      });

      it("detects negative unsafe integers like -9007199254740992 and -9007199254740993", () => {
        const input = '{\n  "negId": -9007199254740992\n}';
        const result = validateJSON(input);

        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.warnings).toBeDefined();
          expect(result.warnings!.length).toBe(1);
          expect(result.warnings![0]!.value).toBe("-9007199254740992");
        }
      });

      it("does not warn for 9007199254740991 (MAX_SAFE_INTEGER) or -9007199254740991 (MIN_SAFE_INTEGER)", () => {
        const input = '{\n  "max": 9007199254740991,\n  "min": -9007199254740991\n}';
        const result = validateJSON(input);

        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.warnings ?? []).toEqual([]);
        }
      });

      it("does not warn for 16-digit safe integer 1234567890123456 (avoids naive digit-count check)", () => {
        const input = '{\n  "safe16": 1234567890123456\n}';
        const result = validateJSON(input);

        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.warnings ?? []).toEqual([]);
        }
      });

      it("detects unsafe integer literals inside nested objects and arrays", () => {
        const input = '{\n  "data": [\n    100,\n    { "subId": 99999999999999999 }\n  ]\n}';
        const result = validateJSON(input);

        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.warnings).toBeDefined();
          expect(result.warnings!.length).toBe(1);
          expect(result.warnings![0]!.value).toBe("99999999999999999");
          expect(result.warnings![0]!.line).toBe(4);
        }
      });

      it("does not flag digits appearing only inside JSON strings or property names", () => {
        const input = '{\n  "9007199254740993": "9007199254740993",\n  "safeNum": 42\n}';
        const result = validateJSON(input);

        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.warnings ?? []).toEqual([]);
        }
      });

      it("does not generate precision warnings on malformed JSON", () => {
        const input = '{\n  "id": 9007199254740993,\n  bad\n}';
        const result = validateJSON(input);

        expect(result.valid).toBe(false);
      });

      it("findUnsafeIntegers utility returns structured warnings directly", () => {
        const input = '{\n  "big": 9007199254740993\n}';
        const warnings = findUnsafeIntegers(input);

        expect(warnings.length).toBe(1);
        expect(warnings[0]!.value).toBe("9007199254740993");
        expect(warnings[0]!.line).toBe(2);
        expect(warnings[0]!.column).toBe(10);
      });
    });

    describe("GAP-3: Windows path escape detection", () => {
      it("detects Windows path with single backslash before \\t as escape-path warning while preserving valid: true", () => {
        // In JS: 'C:\\temp' represents raw characters 'C', ':', '\', 't', 'e', 'm', 'p'
        const input = '{\n  "path": "C:\\temp"\n}';
        const result = validateJSON(input);

        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.warnings).toBeDefined();
          expect(result.warnings!.length).toBe(1);
          const w = result.warnings![0]!;
          expect(w.warningType).toBe("escape-path");
          expect(w.message).toMatch(/Windows path/i);
          expect(w.message).toMatch(/C:\\\\temp/);
          expect(w.line).toBe(2);
        }
      });

      it("detects Windows paths whose single backslashes form valid control escapes (\\n, \\r, \\b, \\f)", () => {
        const input = '{\n  "file": "D:\\new\\reports\\backup\\files"\n}';
        const result = validateJSON(input);

        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.warnings).toBeDefined();
          expect(result.warnings!.some((w) => w.warningType === "escape-path")).toBe(true);
        }
      });

      it("detects Windows path-like strings nested inside objects and arrays", () => {
        const input = '{\n  "config": {\n    "paths": [\n      "C:\\temp",\n      "E:\\notes"\n    ]\n  }\n}';
        const result = validateJSON(input);

        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.warnings).toBeDefined();
          expect(result.warnings!.length).toBe(2);
          expect(result.warnings![0]!.line).toBe(4);
          expect(result.warnings![1]!.line).toBe(5);
        }
      });

      it("does not warn for correctly escaped Windows paths", () => {
        // In JS: 'C:\\\\temp' represents raw characters 'C', ':', '\', '\', 't', 'e', 'm', 'p'
        const input = '{\n  "path": "C:\\\\temp"\n}';
        const result = validateJSON(input);

        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.warnings ?? []).toEqual([]);
        }
      });

      it("does not warn for ordinary text containing intentional JSON escapes", () => {
        const input = '{\n  "greeting": "hello\\tworld",\n  "message": "line1\\nline2"\n}';
        const result = validateJSON(input);

        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.warnings ?? []).toEqual([]);
        }
      });

      it("does not warn for Unix or URL paths using forward slashes", () => {
        const input = '{\n  "path": "C:/temp/file.txt",\n  "url": "https://example.com/test"\n}';
        const result = validateJSON(input);

        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.warnings ?? []).toEqual([]);
        }
      });

      it("preserves invalid escape syntax errors on malformed JSON without masking them as warnings", () => {
        // \u not followed by 4 hex digits is invalid JSON
        const input = '{\n  "path": "C:\\users"\n}';
        const result = validateJSON(input);

        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.line).toBe(2);
        }
      });

      it("findWindowsPathEscapes utility returns structured warnings directly", () => {
        const input = '{\n  "path": "C:\\temp"\n}';
        const warnings = findWindowsPathEscapes(input);

        expect(warnings.length).toBe(1);
        expect(warnings[0]!.warningType).toBe("escape-path");
        expect(warnings[0]!.line).toBe(2);
        expect(warnings[0]!.value).toBe('"C:\\temp"');
      });
    });

    describe("GAP-2: Python-style literal diagnostics", () => {
      it("detects Python True literal in object value and suggests lowercase true with repair hint", () => {
        const input = '{\n  "active": True\n}';
        const result = validateJSON(input);

        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.message).toMatch(/Python/i);
          expect(result.message).toContain("'True'");
          expect(result.message).toContain("'true'");
          expect(result.message).toMatch(/repair/i);
          expect(result.line).toBe(2);
        }
      });

      it("detects Python False literal in object value and suggests lowercase false", () => {
        const input = '{\n  "deleted": False\n}';
        const result = validateJSON(input);

        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.message).toMatch(/Python/i);
          expect(result.message).toContain("'False'");
          expect(result.message).toContain("'false'");
          expect(result.line).toBe(2);
        }
      });

      it("detects Python None literal in object value and suggests lowercase null", () => {
        const input = '{\n  "metadata": None\n}';
        const result = validateJSON(input);

        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.message).toMatch(/Python/i);
          expect(result.message).toContain("'None'");
          expect(result.message).toContain("'null'");
          expect(result.line).toBe(2);
        }
      });

      it("detects Python literals at root level", () => {
        const resTrue = validateJSON("True");
        expect(resTrue.valid).toBe(false);
        if (!resTrue.valid) {
          expect(resTrue.message).toMatch(/Python.*True.*true/i);
        }

        const resFalse = validateJSON("False");
        expect(resFalse.valid).toBe(false);
        if (!resFalse.valid) {
          expect(resFalse.message).toMatch(/Python.*False.*false/i);
        }

        const resNone = validateJSON("None");
        expect(resNone.valid).toBe(false);
        if (!resNone.valid) {
          expect(resNone.message).toMatch(/Python.*None.*null/i);
        }
      });

      it("detects Python literals inside arrays", () => {
        const input = "[\n  True,\n  False,\n  None\n]";
        const result = validateJSON(input);

        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.message).toMatch(/Python.*True.*true/i);
          expect(result.line).toBe(2);
        }
      });

      it("detects Python literals inside deeply nested structures", () => {
        const input = '{\n  "user": {\n    "flags": [\n      { "verified": False }\n    ]\n  }\n}';
        const result = validateJSON(input);

        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.message).toMatch(/Python.*False.*false/i);
          expect(result.line).toBe(4);
        }
      });

      it("detects Python True literal used as unquoted object key and explains keys must be double-quoted strings", () => {
        const input = "{\n  True: 1\n}";
        const result = validateJSON(input);

        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.message).toMatch(/Python.*True/i);
          expect(result.message).toMatch(/object key.*double-quoted string/i);
          // Must NOT suggest replacement that leaves the object syntactically invalid (e.g. lowercase 'true' without quotes)
          expect(result.message).not.toMatch(/booleans must be lowercase 'true'/i);
          expect(result.message).toMatch(/repair/i);
        }
      });

      it("detects Python False and None in unquoted key positions and explains keys must be double-quoted", () => {
        const resFalse = validateJSON('{"a": 1, False: 2}');
        expect(resFalse.valid).toBe(false);
        if (!resFalse.valid) {
          expect(resFalse.message).toMatch(/Python.*False/i);
          expect(resFalse.message).toMatch(/object key.*double-quoted string/i);
          expect(resFalse.message).not.toMatch(/booleans must be lowercase 'false'/i);
        }

        const resNone = validateJSON("{None: 3}");
        expect(resNone.valid).toBe(false);
        if (!resNone.valid) {
          expect(resNone.message).toMatch(/Python.*None/i);
          expect(resNone.message).toMatch(/object key.*double-quoted string/i);
          expect(resNone.message).not.toMatch(/null values must be lowercase 'null'/i);
        }
      });

      it("does not flag valid string literals containing 'True', 'False', or 'None'", () => {
        const input = '{\n  "isTrue": "True",\n  "isFalse": "False",\n  "isNull": "None"\n}';
        const result = validateJSON(input);

        expect(result.valid).toBe(true);
      });

      it("does not flag valid string property names 'True', 'False', or 'None'", () => {
        const input = '{\n  "True": true,\n  "False": false,\n  "None": null\n}';
        const result = validateJSON(input);

        expect(result.valid).toBe(true);
      });

      it("does not misclassify non-Python identifiers like TrueVar or NoneType", () => {
        const input = '{\n  "status": TrueVar\n}';
        const result = validateJSON(input);

        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.message).not.toMatch(/Python-style literal/i);
        }
      });

      it("detectPythonLiteral accurately identifies True, False, and None with word boundaries and key context", () => {
        expect(detectPythonLiteral("True", 0)).toEqual({
          literal: "True",
          replacement: "true",
          expectedType: "booleans must be lowercase 'true'",
          isKey: false,
        });
        expect(detectPythonLiteral("False", 0)).toEqual({
          literal: "False",
          replacement: "false",
          expectedType: "booleans must be lowercase 'false'",
          isKey: false,
        });
        expect(detectPythonLiteral("None", 0)).toEqual({
          literal: "None",
          replacement: "null",
          expectedType: "null values must be lowercase 'null'",
          isKey: false,
        });
        expect(detectPythonLiteral("{True: 1}", 1)).toEqual({
          literal: "True",
          replacement: "true",
          expectedType: "booleans must be lowercase 'true'",
          isKey: true,
        });
        expect(detectPythonLiteral("TrueVar", 0)).toBeNull();
        expect(detectPythonLiteral("aTrue", 1)).toBeNull();
      });

      it("isKeyPosition accurately differentiates object key position from value position", () => {
        expect(isKeyPosition("{True: 1}", 1, 4)).toBe(true);
        expect(isKeyPosition('{"a": 1, False: 2}', 9, 5)).toBe(true);
        expect(isKeyPosition('{"active": True}', 11, 4)).toBe(false);
        expect(isKeyPosition("[True]", 1, 4)).toBe(false);
        expect(isKeyPosition("[1, True]", 4, 4)).toBe(false);
      });

      it("formatJsonErrorMessage falls back to printParseErrorCode for non-python errors", () => {
        const input = '{"key": }';
        const msg = formatJsonErrorMessage(input, { error: 4, offset: 8, length: 1 });
        expect(msg).toBe("ValueExpected");
      });
    });
  });

  describe("formatJSON", () => {
    it("formats valid JSON with default 2 spaces indentation", () => {
      const input = '{"a":1,"b":[2,3]}';
      const result = formatJSON(input);

      expect(result).toEqual({
        success: true,
        output: '{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}',
      });
    });

    it("formats valid JSON with 4 spaces indentation", () => {
      const input = '{"a":1}';
      const result = formatJSON(input, 4);

      expect(result).toEqual({
        success: true,
        output: '{\n    "a": 1\n}',
      });
    });

    it("formats valid JSON with tab indentation", () => {
      const input = '{"a":1}';
      const result = formatJSON(input, "tab");

      expect(result).toEqual({
        success: true,
        output: '{\n\t"a": 1\n}',
      });
    });

    it("returns empty output for empty or whitespace-only input", () => {
      expect(formatJSON("")).toEqual({ success: true, output: "" });
      expect(formatJSON("   \n\t  ")).toEqual({ success: true, output: "" });
    });

    it("returns success: false with line/col error location for malformed JSON", () => {
      const input = '{\n  "unclosed": "string\n}';
      const result = formatJSON(input);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(typeof result.error).toBe("string");
        expect(result.line).toBeGreaterThanOrEqual(1);
        expect(result.column).toBeGreaterThanOrEqual(1);
        expect(typeof result.offset).toBe("number");
      }
    });

    it("refuses to format JSON containing unsafe integers to prevent silent precision loss", () => {
      const input = '{\n  "id": 9007199254740993\n}';
      const result = formatJSON(input);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toMatch(/precision/i);
        expect(result.error).toMatch(/9007199254740993/);
        expect(result.line).toBe(2);
        expect(result.column).toBe(9);
      }
    });

    it("preserves exact formatting behavior for numbers within safe integer range", () => {
      const input = '{"safeId": 9007199254740991, "count": 1234567890123456}';
      const result = formatJSON(input, 2);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.output).toContain("9007199254740991");
        expect(result.output).toContain("1234567890123456");
      }
    });
  });

  describe("minifyJSON", () => {
    it("strips all whitespace and newlines from valid JSON", () => {
      const input = `
        {
          "title": "QuietJSON",
          "list": [
            1,
            2,
            3
          ]
        }
      `;
      const result = minifyJSON(input);

      expect(result).toEqual({
        success: true,
        output: '{"title":"QuietJSON","list":[1,2,3]}',
      });
    });

    it("refuses to minify JSON containing unsafe integers to prevent silent precision loss", () => {
      const input = '{"bigId": 9007199254740993}';
      const result = minifyJSON(input);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toMatch(/precision/i);
        expect(result.error).toMatch(/9007199254740993/);
      }
    });

    it("returns empty string for empty input", () => {
      expect(minifyJSON("")).toEqual({ success: true, output: "" });
      expect(minifyJSON("   ")).toEqual({ success: true, output: "" });
    });

    it("returns success: false for invalid JSON", () => {
      const result = minifyJSON("{ invalid json }");
      expect(result.success).toBe(false);
    });
  });

  describe("getStats", () => {
    it("computes stats for a valid JSON object", () => {
      const input = '{\n  "a": 1,\n  "b": 2,\n  "c": 3\n}';
      const stats = getStats(input);

      expect(stats.lines).toBe(5);
      expect(stats.chars).toBe(input.length);
      expect(stats.bytes).toBe(new TextEncoder().encode(input).length);
      expect(stats.keys).toBe(3);
      expect(stats.isArray).toBe(false);
    });

    it("computes stats for a valid JSON array", () => {
      const input = '["alpha", "beta", "gamma", "delta"]';
      const stats = getStats(input);

      expect(stats.keys).toBe(4); // array length
      expect(stats.isArray).toBe(true);
    });

    it("returns keys: null for invalid JSON while still computing chars and bytes", () => {
      const input = "invalid { json";
      const stats = getStats(input);

      expect(stats.lines).toBe(1);
      expect(stats.chars).toBe(input.length);
      expect(stats.keys).toBeNull();
      expect(stats.isArray).toBe(false);
    });

    it("handles empty input correctly", () => {
      const stats = getStats("");
      expect(stats.lines).toBe(0);
      expect(stats.chars).toBe(0);
      expect(stats.bytes).toBe(0);
      expect(stats.keys).toBeNull();
      expect(stats.isArray).toBe(false);
    });
  });

  describe("formatBytes", () => {
    it("formats bytes accurately across units", () => {
      expect(formatBytes(500)).toBe("500 B");
      expect(formatBytes(1024)).toBe("1.0 KB");
      expect(formatBytes(2560)).toBe("2.5 KB");
      expect(formatBytes(1048576)).toBe("1.0 MB");
      expect(formatBytes(5242880)).toBe("5.0 MB");
    });
  });
});
