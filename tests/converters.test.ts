import { describe, it, expect } from "vitest";
import {
  jsonToCsv,
  jsonToYaml,
  yamlToJson,
  jsonDiff,
} from "../src/lib/converters";

describe("converters.ts - Conversion and Diff Utilities", () => {
  describe("jsonToCsv", () => {
    it("converts flat array of objects to CSV with headers", () => {
      const input = JSON.stringify([
        { id: 1, name: "Alice", role: "admin" },
        { id: 2, name: "Bob", role: "user" },
      ]);
      const result = jsonToCsv(input);

      expect(result.success).toBe(true);
      if (result.success) {
        const lines = result.output.split("\n");
        expect(lines[0]).toBe("id,name,role");
        expect(lines[1]).toBe("1,Alice,admin");
        expect(lines[2]).toBe("2,Bob,user");
      }
    });

    it("flattens nested objects with dot-notation keys", () => {
      const input = JSON.stringify([
        {
          id: 101,
          user: { name: "Carol", address: { city: "Seattle", zip: "98101" } },
        },
      ]);
      const result = jsonToCsv(input);

      expect(result.success).toBe(true);
      if (result.success) {
        const lines = result.output.split("\n");
        expect(lines[0]).toBe("id,user.name,user.address.city,user.address.zip");
        expect(lines[1]).toBe("101,Carol,Seattle,98101");
      }
    });

    it("escapes CSV special characters: commas, double quotes, and newlines", () => {
      const input = JSON.stringify([
        {
          name: 'John "The Boss" Doe',
          bio: "Engineer, Musician\nLiving in NY",
        },
      ]);
      const result = jsonToCsv(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.output).toContain('"John ""The Boss"" Doe"');
        expect(result.output).toContain('"Engineer, Musician\nLiving in NY"');
      }
    });

    it("serializes nested arrays inline as JSON strings in the cell", () => {
      const input = JSON.stringify([
        { id: 1, tags: ["frontend", "privacy"] },
      ]);
      const result = jsonToCsv(input);

      expect(result.success).toBe(true);
      if (result.success) {
        // In RFC 4180 CSV, inner quotes are doubled ("")
        expect(result.output).toContain('"[""frontend"",""privacy""]"');
      }
    });

    it("returns empty string for empty array input []", () => {
      const result = jsonToCsv("[]");
      expect(result).toEqual({ success: true, output: "" });
    });

    it("converts a single flat object to a one-row CSV with headers", () => {
      const input = JSON.stringify({
        name: "Alice",
        age: 25,
        city: "Delhi",
      });
      const result = jsonToCsv(input);

      expect(result.success).toBe(true);
      if (result.success) {
        const lines = result.output.split("\n");
        expect(lines[0]).toBe("name,age,city");
        expect(lines[1]).toBe("Alice,25,Delhi");
      }
    });

    it("converts a single object with string, number, boolean, and null values", () => {
      const input = JSON.stringify({
        title: "Task 1",
        completed: false,
        priority: 1,
        assignee: null,
      });
      const result = jsonToCsv(input);

      expect(result.success).toBe(true);
      if (result.success) {
        const lines = result.output.split("\n");
        expect(lines[0]).toBe("title,completed,priority,assignee");
        expect(lines[1]).toBe("Task 1,false,1,");
      }
    });

    it("flattens nested fields in a single root object with dot notation", () => {
      const input = JSON.stringify({
        id: 101,
        user: { name: "Carol", address: { city: "Seattle", zip: "98101" } },
      });
      const result = jsonToCsv(input);

      expect(result.success).toBe(true);
      if (result.success) {
        const lines = result.output.split("\n");
        expect(lines[0]).toBe("id,user.name,user.address.city,user.address.zip");
        expect(lines[1]).toBe("101,Carol,Seattle,98101");
      }
    });

    it("escapes special characters (commas, quotes, newlines) in a single root object", () => {
      const input = JSON.stringify({
        name: 'John "The Boss" Doe',
        bio: "Engineer, Musician\nLiving in NY",
      });
      const result = jsonToCsv(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.output).toContain('"John ""The Boss"" Doe"');
        expect(result.output).toContain('"Engineer, Musician\nLiving in NY"');
      }
    });

    it("returns empty string for empty object input {}", () => {
      const result = jsonToCsv("{}");
      expect(result).toEqual({ success: true, output: "" });
    });

    it("returns error when root input is a primitive scalar (string, number, boolean, null)", () => {
      const stringResult = jsonToCsv('"just a string"');
      expect(stringResult.success).toBe(false);
      if (!stringResult.success) {
        expect(stringResult.error).toMatch(/object.*array/i);
      }

      const numResult = jsonToCsv("42");
      expect(numResult.success).toBe(false);
      if (!numResult.success) {
        expect(numResult.error).toMatch(/object.*array/i);
      }

      const boolResult = jsonToCsv("true");
      expect(boolResult.success).toBe(false);
      if (!boolResult.success) {
        expect(boolResult.error).toMatch(/object.*array/i);
      }

      const nullResult = jsonToCsv("null");
      expect(nullResult.success).toBe(false);
      if (!nullResult.success) {
        expect(nullResult.error).toMatch(/object.*array/i);
      }
    });

    it("refuses to convert single root object containing unsafe integer", () => {
      const input = '{"id": 9007199254740993, "name": "Alice"}';
      const result = jsonToCsv(input);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toMatch(/precision/i);
        expect(result.error).toMatch(/9007199254740993/);
      }
    });

    it("returns error when array contains non-object items", () => {
      const result = jsonToCsv('[1, 2, "three"]');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("Some items in your array are primitives");
      }
    });

    it("returns error on invalid or empty JSON input", () => {
      expect(jsonToCsv("").success).toBe(false);
      expect(jsonToCsv("{ bad json }").success).toBe(false);
    });

    it("refuses to convert JSON containing unsafe integer in top-level object to prevent silent precision loss", () => {
      const input = '[{"id": 9007199254740993, "name": "Alice"}]';
      const result = jsonToCsv(input);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toMatch(/precision/i);
        expect(result.error).toMatch(/9007199254740993/);
      }
    });

    it("refuses to convert JSON containing unsafe integer in nested object", () => {
      const input = '[{"id": 1, "meta": {"bigInt": 9007199254740995}}]';
      const result = jsonToCsv(input);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toMatch(/precision/i);
        expect(result.error).toMatch(/9007199254740995/);
      }
    });

    it("refuses to convert JSON containing unsafe integer in array data", () => {
      const input = '[{"id": 1, "scores": [9007199254740999]}]';
      const result = jsonToCsv(input);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toMatch(/precision/i);
        expect(result.error).toMatch(/9007199254740999/);
      }
    });

    it("converts numbers near safe integer boundary without error", () => {
      const input = '[{"maxSafe": 9007199254740991, "minSafe": -9007199254740991}]';
      const result = jsonToCsv(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.output).toContain("9007199254740991");
        expect(result.output).toContain("-9007199254740991");
      }
    });

    it("preserves numeric-looking string IDs as strings without precision error", () => {
      const input = '[{"accountId": "9007199254740993"}]';
      const result = jsonToCsv(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.output).toContain("9007199254740993");
      }
    });
  });

  describe("jsonToYaml & yamlToJson", () => {
    it("converts JSON to YAML with clean structure and custom indent", () => {
      const input = JSON.stringify({
        project: "QuietJSON",
        features: ["zero-telemetry", "client-side"],
        count: 42,
      });

      const result = jsonToYaml(input, 2);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.output).toContain("project: QuietJSON");
        expect(result.output).toContain("count: 42");
        expect(result.output).toContain("- zero-telemetry");
      }
    });

    it("round-trips YAML back to JSON via yamlToJson", () => {
      const yaml = `
name: QuietJSON
version: 1.0.0
tags:
  - fast
  - private
`;
      const result = yamlToJson(yaml);
      expect(result.success).toBe(true);
      if (result.success) {
        const parsed = JSON.parse(result.output);
        expect(parsed.name).toBe("QuietJSON");
        expect(parsed.version).toBe("1.0.0");
        expect(parsed.tags).toEqual(["fast", "private"]);
      }
    });

    it("handles invalid inputs with descriptive errors", () => {
      expect(jsonToYaml("").success).toBe(false);
      expect(jsonToYaml("{ invalid").success).toBe(false);
      expect(yamlToJson("").success).toBe(false);
    });

    it("refuses to convert JSON containing unsafe integer to YAML to prevent silent precision loss", () => {
      const input = '{"id": 9007199254740993}';
      const result = jsonToYaml(input);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toMatch(/precision/i);
        expect(result.error).toMatch(/9007199254740993/);
      }
    });

    it("refuses to convert JSON containing unsafe integers nested inside objects and arrays to YAML", () => {
      const input = '{"nested": {"items": [{"code": 9007199254740994}]}}';
      const result = jsonToYaml(input);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toMatch(/precision/i);
        expect(result.error).toMatch(/9007199254740994/);
      }
    });

    it("converts safe integers near boundary to YAML cleanly", () => {
      const input = '{"maxSafe": 9007199254740991, "minSafe": -9007199254740991}';
      const result = jsonToYaml(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.output).toContain("maxSafe: 9007199254740991");
        expect(result.output).toContain("minSafe: -9007199254740991");
      }
    });

    it("preserves numeric-looking strings in JSON to YAML without error", () => {
      const input = '{"bigId": "9007199254740993"}';
      const result = jsonToYaml(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.output).toContain("9007199254740993");
      }
    });

    it("refuses to convert YAML containing unsafe positive integer to JSON", () => {
      const yaml = "accountId: 9007199254740993";
      const result = yamlToJson(yaml);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toMatch(/precision/i);
        expect(result.error).toMatch(/9007199254740993/);
        expect(result.error).toMatch(/quoted/i);
      }
    });

    it("refuses to convert YAML containing unsafe negative integer to JSON", () => {
      const yaml = "negativeId: -9007199254740992";
      const result = yamlToJson(yaml);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toMatch(/precision/i);
        expect(result.error).toMatch(/-9007199254740992/);
      }
    });

    it("converts YAML with safe boundary integers cleanly without error", () => {
      const yaml = `
maxSafe: 9007199254740991
minSafe: -9007199254740991
`;
      const result = yamlToJson(yaml);

      expect(result.success).toBe(true);
      if (result.success) {
        const parsed = JSON.parse(result.output);
        expect(parsed.maxSafe).toBe(9007199254740991);
        expect(parsed.minSafe).toBe(-9007199254740991);
      }
    });

    it("refuses to convert YAML containing unsafe integers in nested mappings and sequences", () => {
      const yaml = `
server:
  cluster:
    nodeId: 9007199254740995
  connections:
    - 10
    - 9007199254740997
`;
      const result = yamlToJson(yaml);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toMatch(/precision/i);
      }
    });

    it("preserves quoted numeric strings in YAML as strings without error", () => {
      const yaml = `
quotedId: "9007199254740993"
singleQuoted: '9007199254740995'
`;
      const result = yamlToJson(yaml);

      expect(result.success).toBe(true);
      if (result.success) {
        const parsed = JSON.parse(result.output);
        expect(parsed.quotedId).toBe("9007199254740993");
        expect(parsed.singleQuoted).toBe("9007199254740995");
      }
    });

    it("converts ordinary YAML scalars (integers, floats, booleans, nulls) correctly", () => {
      const yaml = `
count: 42
price: 19.99
active: true
disabled: false
emptyVal: null
tildeNull: ~
`;
      const result = yamlToJson(yaml);

      expect(result.success).toBe(true);
      if (result.success) {
        const parsed = JSON.parse(result.output);
        expect(parsed.count).toBe(42);
        expect(parsed.price).toBe(19.99);
        expect(parsed.active).toBe(true);
        expect(parsed.disabled).toBe(false);
        expect(parsed.emptyVal).toBeNull();
        expect(parsed.tildeNull).toBeNull();
      }
    });

    it("returns descriptive error for malformed YAML input", () => {
      const badYaml = "key: [unclosed sequence";
      const result = yamlToJson(badYaml);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(typeof result.error).toBe("string");
        expect(result.error.length).toBeGreaterThan(0);
      }
    });

    it("refuses to convert YAML containing unsafe hex or binary integers", () => {
      const hexYaml = "bigHex: 0x20000000000001";
      const result = yamlToJson(hexYaml);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toMatch(/precision/i);
      }
    });
  });

  describe("jsonDiff", () => {
    it("returns totalChanges: 0 for identical objects", () => {
      const jsonA = '{"a": 1, "b": [2, 3]}';
      const jsonB = '{"a": 1, "b": [2, 3]}';

      const result = jsonDiff(jsonA, jsonB);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.totalChanges).toBe(0);
        expect(result.entries).toEqual([]);
      }
    });

    it("detects added, removed, and changed object properties", () => {
      const jsonA = JSON.stringify({ name: "Alpha", count: 10, deleted: true });
      const jsonB = JSON.stringify({ name: "Beta", count: 10, added: "new" });

      const result = jsonDiff(jsonA, jsonB);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.totalChanges).toBe(3);

        const types = result.entries.map((e) => ({
          path: e.path,
          type: e.type,
          oldValue: e.oldValue,
          newValue: e.newValue,
        }));

        expect(types).toContainEqual({
          path: "$.deleted",
          type: "removed",
          oldValue: true,
          newValue: undefined,
        });

        expect(types).toContainEqual({
          path: "$.added",
          type: "added",
          oldValue: undefined,
          newValue: "new",
        });

        expect(types).toContainEqual({
          path: "$.name",
          type: "changed",
          oldValue: "Alpha",
          newValue: "Beta",
        });
      }
    });

    it("detects type-changed values (e.g. number to string or object to array)", () => {
      const jsonA = JSON.stringify({ port: 8080, payload: { a: 1 } });
      const jsonB = JSON.stringify({ port: "8080", payload: [1, 2] });

      const result = jsonDiff(jsonA, jsonB);
      expect(result.success).toBe(true);
      if (result.success) {
        const typeChanges = result.entries.filter((e) => e.type === "type-changed");
        expect(typeChanges.length).toBe(2);

        expect(typeChanges).toContainEqual({
          path: "$.port",
          type: "type-changed",
          oldValue: 8080,
          newValue: "8080",
        });

        expect(typeChanges).toContainEqual({
          path: "$.payload",
          type: "type-changed",
          oldValue: { a: 1 },
          newValue: [1, 2],
        });
      }
    });

    it("detects array additions, removals, and changes by index path", () => {
      const jsonA = JSON.stringify([10, 20, 30]);
      const jsonB = JSON.stringify([10, 25, 30, 40]);

      const result = jsonDiff(jsonA, jsonB);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.totalChanges).toBe(2);

        expect(result.entries).toContainEqual({
          path: "$[1]",
          type: "changed",
          oldValue: 20,
          newValue: 25,
        });

        expect(result.entries).toContainEqual({
          path: "$[3]",
          type: "added",
          oldValue: undefined,
          newValue: 40,
        });
      }
    });

    it("returns success: false when either input is invalid JSON", () => {
      const result1 = jsonDiff("{ invalid", '{"a": 1}');
      expect(result1.success).toBe(false);

      const result2 = jsonDiff('{"a": 1}', "bad input");
      expect(result2.success).toBe(false);
    });

    it("refuses to diff when first document (JSON A) contains an unsafe integer", () => {
      const jsonA = '{"id": 9007199254740993}';
      const jsonB = '{"id": 100}';
      const result = jsonDiff(jsonA, jsonB);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toMatch(/precision/i);
        expect(result.error).toMatch(/JSON A/i);
        expect(result.error).toMatch(/9007199254740993/);
      }
    });

    it("refuses to diff when second document (JSON B) contains an unsafe integer", () => {
      const jsonA = '{"id": 100}';
      const jsonB = '{"id": 9007199254740993}';
      const result = jsonDiff(jsonA, jsonB);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toMatch(/precision/i);
        expect(result.error).toMatch(/JSON B/i);
        expect(result.error).toMatch(/9007199254740993/);
      }
    });

    it("refuses to diff when nested objects or arrays contain unsafe integers", () => {
      const jsonA = '{"list": [{"val": 9007199254740994}]}';
      const jsonB = '{"list": [{"val": 10}]}';
      const result = jsonDiff(jsonA, jsonB);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toMatch(/precision/i);
        expect(result.error).toMatch(/JSON A/i);
        expect(result.error).toMatch(/9007199254740994/);
      }
    });

    it("correctly diffs safe integer values without error", () => {
      const jsonA = '{"id": 9007199254740991}';
      const jsonB = '{"id": 9007199254740991}';
      const result = jsonDiff(jsonA, jsonB);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.totalChanges).toBe(0);
      }

      const jsonDiffA = '{"id": 9007199254740990}';
      const jsonDiffB = '{"id": 9007199254740991}';
      const resultDiff = jsonDiff(jsonDiffA, jsonDiffB);

      expect(resultDiff.success).toBe(true);
      if (resultDiff.success) {
        expect(resultDiff.totalChanges).toBe(1);
      }
    });

    it("refuses to diff when both documents contain identical unsafe integers", () => {
      const jsonA = '{"id": 9007199254740993}';
      const jsonB = '{"id": 9007199254740993}';
      const result = jsonDiff(jsonA, jsonB);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toMatch(/precision/i);
      }
    });

    it("refuses to diff when documents contain different unsafe integers that would collide if rounded by float64", () => {
      // 9007199254740992 and 9007199254740993 both round to 9007199254740992 in JS number!
      const jsonA = '{"id": 9007199254740992}';
      const jsonB = '{"id": 9007199254740993}';
      const result = jsonDiff(jsonA, jsonB);

      // Must not silently compare them as equal!
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toMatch(/precision/i);
      }
    });
  });
});
