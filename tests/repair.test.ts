import { describe, it, expect } from "vitest";
import { repairJSON } from "../src/lib/repair";

describe("repairJSON - Existing Repair Engine", () => {
  describe("Valid JSON handling", () => {
    it("returns alreadyValid: true for clean JSON object", () => {
      const input = '{\n  "name": "QuietJSON",\n  "active": true\n}';
      const result = repairJSON(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.alreadyValid).toBe(true);
        expect(result.changes).toEqual([]);
        expect(JSON.parse(result.output)).toEqual({
          name: "QuietJSON",
          active: true,
        });
      }
    });

    it("returns alreadyValid: true for clean JSON array", () => {
      const input = '[1, 2, "three", null, false]';
      const result = repairJSON(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.alreadyValid).toBe(true);
        expect(result.changes).toEqual([]);
        expect(JSON.parse(result.output)).toEqual([1, 2, "three", null, false]);
      }
    });

    it("handles empty or whitespace-only input", () => {
      expect(repairJSON("")).toEqual({
        success: true,
        output: "",
        alreadyValid: true,
        changes: [],
      });

      expect(repairJSON("   \n\t  ")).toEqual({
        success: true,
        output: "",
        alreadyValid: true,
        changes: [],
      });
    });
  });

  describe("Syntax repairs and change summaries", () => {
    it("repairs trailing commas in objects and arrays", () => {
      const input = '{"a": 1, "b": [2, 3,],}';
      const result = repairJSON(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.alreadyValid).toBe(false);
        expect(result.changes).toContain("trailing commas removed");
        expect(JSON.parse(result.output)).toEqual({ a: 1, b: [2, 3] });
      }
    });

    it("repairs single quotes to double quotes", () => {
      const input = "{'message': 'hello world'}";
      const result = repairJSON(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.alreadyValid).toBe(false);
        expect(result.changes).toContain("single quotes converted");
        expect(JSON.parse(result.output)).toEqual({ message: "hello world" });
      }
    });

    it("repairs unquoted object keys", () => {
      const input = "{ foo: 123, bar: true }";
      const result = repairJSON(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.alreadyValid).toBe(false);
        expect(result.changes).toContain("unquoted keys quoted");
        expect(JSON.parse(result.output)).toEqual({ foo: 123, bar: true });
      }
    });

    it("repairs Python literals True, False, and None", () => {
      const input = '{"isAdmin": True, "isBlocked": False, "profile": None}';
      const result = repairJSON(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.alreadyValid).toBe(false);
        expect(result.changes).toContain(
          "Python-style values fixed (True/False/None)"
        );
        expect(JSON.parse(result.output)).toEqual({
          isAdmin: true,
          isBlocked: false,
          profile: null,
        });
      }
    });

    it("repairs Python literals used in unquoted key positions", () => {
      const input = "{True: 1, False: 2, None: 3}";
      const result = repairJSON(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.alreadyValid).toBe(false);
        expect(JSON.parse(result.output)).toEqual({
          True: 1,
          False: 2,
          None: 3,
        });
      }
    });

    it("removes single-line and multi-line comments", () => {
      const input = `
        {
          // User configuration
          "timeout": 5000,
          /* Default retry count */
          "retries": 3
        }
      `;
      const result = repairJSON(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.alreadyValid).toBe(false);
        expect(result.changes).toContain("comments removed");
        expect(JSON.parse(result.output)).toEqual({
          timeout: 5000,
          retries: 3,
        });
      }
    });

    it("handles multiple repairs simultaneously", () => {
      const input = `
        {
          // Developer settings
          name: 'Jane Doe',
          is_admin: True,
          roles: ['editor', 'reviewer',],
        }
      `;
      const result = repairJSON(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.alreadyValid).toBe(false);
        expect(result.changes).toContain("comments removed");
        expect(result.changes).toContain("single quotes converted");
        expect(result.changes).toContain("unquoted keys quoted");
        expect(result.changes).toContain(
          "Python-style values fixed (True/False/None)"
        );
        expect(result.changes).toContain("trailing commas removed");
        expect(JSON.parse(result.output)).toEqual({
          name: "Jane Doe",
          is_admin: true,
          roles: ["editor", "reviewer"],
        });
      }
    });
  });

  describe("Complex structures, Unicode, and failure cases", () => {
    it("preserves Unicode characters during repair", () => {
      const input = "{ 'greeting': 'नमस्कार 🌍 世界' }";
      const result = repairJSON(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(JSON.parse(result.output)).toEqual({
          greeting: "नमस्कार 🌍 世界",
        });
      }
    });

    it("repairs deeply nested objects and arrays", () => {
      const input = "{ a: { b: { c: [1, 2, 3,], }, }, }";
      const result = repairJSON(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(JSON.parse(result.output)).toEqual({
          a: { b: { c: [1, 2, 3] } },
        });
      }
    });

    it("returns success: false with error message for irreparable inputs", () => {
      // Invalid hex characters in \u unicode escape cannot be repaired
      const input = '{"key": "\\u12"}';
      const result = repairJSON(input);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(typeof result.error).toBe("string");
        expect(result.error).toContain("Invalid unicode");
      }
    });

    it("rejects HTML <!DOCTYPE html> responses without crashing and returns actionable guidance", () => {
      const input = "<!DOCTYPE html><html><body><h1>502 Bad Gateway</h1></body></html>";
      const result = repairJSON(input);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toMatch(/HTML/i);
        expect(result.error).toMatch(/error|API|URL/i);
      }
    });

    it("rejects <html> error responses with leading whitespace and actionable message", () => {
      const input = "   \n<html lang=\"en\">\n<head><title>404 Not Found</title></head>\n<body>Not Found</body>\n</html>";
      const result = repairJSON(input);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toMatch(/HTML/i);
      }
    });

    it("preserves valid JSON objects that contain HTML strings inside repairJSON", () => {
      const input = '{\n  "template": "<!DOCTYPE html><html><body>Hello</body></html>"\n}';
      const result = repairJSON(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.alreadyValid).toBe(true);
      }
    });
  });
});
