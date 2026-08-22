// src/components/islands/JsonEditor.tsx
// Main JSON tool island — Preact, client:only="preact"
// Phase 3: Inline error highlighting (CodeMirror lint) + JSON Repair Mode
// Phase 4: Tree View with JSONPath copy

import { useState, useRef, useEffect } from "preact/hooks";
import {
  EditorView,
  lineNumbers,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  rectangularSelection,
  crosshairCursor,
  highlightActiveLine,
  keymap,
  placeholder,
} from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { json } from "@codemirror/lang-json";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  HighlightStyle,
  syntaxHighlighting,
  bracketMatching,
  foldGutter,
  indentOnInput,
} from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { linter, lintGutter, type Diagnostic } from "@codemirror/lint";
import { parse, printParseErrorCode } from "jsonc-parser";
import type { ParseError } from "jsonc-parser";

import { formatJSON, minifyJSON, getStats, formatBytes } from "../../lib/formatters";
import { repairJSON } from "../../lib/repair";
import TreeView from "./TreeView";

// ─── Types ────────────────────────────────────────────────────────────────────

type IndentOption = 2 | 4 | "tab";

type StatusState =
  | { type: "idle" }
  | { type: "empty" }
  | { type: "valid" }
  | { type: "error"; message: string; line: number; column: number }
  | { type: "repaired"; changes: string[] };

type Toast =
  | { kind: "success"; message: string }
  | { kind: "warning"; message: string }
  | { kind: "error"; message: string }
  | null;

// ─── JSON Linter for CodeMirror ───────────────────────────────────────────────

/**
 * Build a CodeMirror linter that surfaces all JSON errors as inline diagnostics.
 * Uses jsonc-parser which reports ALL errors, not just the first one.
 * delay: 300ms debounce so it doesn't fire on every keystroke.
 */
function buildJsonLinter() {
  return linter(
    (view): Diagnostic[] => {
      const text = view.state.doc.toString();
      if (!text.trim()) return [];

      const errors: ParseError[] = [];
      parse(text, errors, { allowTrailingComma: false, disallowComments: true });

      return errors.map((err) => ({
        from: err.offset,
        to: err.offset + Math.max(err.length, 1),
        severity: "error" as const,
        message: printParseErrorCode(err.error),
      }));
    },
    { delay: 300 }
  );
}

// ─── CodeMirror extension builders ───────────────────────────────────────────

function isDark(): boolean {
  if (typeof document === "undefined") return true;
  return document.documentElement.classList.contains("dark");
}

// ─── Custom QuietJSON CodeMirror Themes (matching Diff tool palette) ─────────

const darkHighlightStyle = HighlightStyle.define([
  { tag: t.propertyName, color: "#60a5fa" }, // soft sky blue for keys
  { tag: t.string, color: "#4ade80" }, // clean light emerald for strings
  { tag: t.number, color: "#fbbf24" }, // warm gold for numbers
  { tag: t.bool, color: "#f472b6" }, // bright pink for booleans
  { tag: t.null, color: "#9ca3af", fontStyle: "italic" }, // muted for null
  { tag: t.punctuation, color: "#71717a" }, // braces, brackets, commas, colons
  { tag: t.comment, color: "#6b7280", fontStyle: "italic" },
  { tag: t.invalid, color: "#f87171" },
]);

const darkEditorTheme = EditorView.theme({
  "&": {
    color: "#ededed",
    backgroundColor: "var(--color-editor-bg, #0d0d0d)",
  },
  ".cm-content": {
    caretColor: "var(--color-link, #3b9eff)",
    padding: "8px 0",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--color-link, #3b9eff)",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "rgba(59, 130, 246, 0.25) !important",
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "var(--color-mute, #555555)",
    borderRight: "none",
    paddingRight: "6px",
    paddingLeft: "4px",
  },
  ".cm-activeLine": {
    backgroundColor: "transparent",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
    color: "#ededed",
  },
  ".cm-matchingBracket, .cm-nonmatchingBracket": {
    backgroundColor: "rgba(59, 130, 246, 0.2)",
    outline: "1px solid rgba(59, 130, 246, 0.4)",
  },
}, { dark: true });

const lightHighlightStyle = HighlightStyle.define([
  { tag: t.propertyName, color: "#0284c7" },
  { tag: t.string, color: "#16a34a" },
  { tag: t.number, color: "#d97706" },
  { tag: t.bool, color: "#db2777" },
  { tag: t.null, color: "#6b7280", fontStyle: "italic" },
  { tag: t.punctuation, color: "#64748b" },
  { tag: t.comment, color: "#9ca3af", fontStyle: "italic" },
  { tag: t.invalid, color: "#dc2626" },
]);

const lightEditorTheme = EditorView.theme({
  "&": {
    color: "#171717",
    backgroundColor: "var(--color-editor-bg, #f5f5f5)",
  },
  ".cm-content": {
    caretColor: "var(--color-link, #0070f3)",
    padding: "8px 0",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--color-link, #0070f3)",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "rgba(0, 112, 243, 0.15) !important",
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "var(--color-mute, #888888)",
    borderRight: "none",
    paddingRight: "6px",
    paddingLeft: "4px",
  },
  ".cm-activeLine": {
    backgroundColor: "transparent",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
    color: "#171717",
  },
  ".cm-matchingBracket, .cm-nonmatchingBracket": {
    backgroundColor: "rgba(0, 112, 243, 0.12)",
    outline: "1px solid rgba(0, 112, 243, 0.3)",
  },
}, { dark: false });

/**
 * Returns the theme extension (styles + syntax highlighting) for the given dark/light state.
 * Used by the Compartment to hot-swap theme without rebuilding the editor.
 */
function themeExtension(dark: boolean) {
  return dark
    ? [darkEditorTheme, syntaxHighlighting(darkHighlightStyle)]
    : [lightEditorTheme, syntaxHighlighting(lightHighlightStyle)];
}

/** Static base extensions — clean, borderless, seamless editor experience */
function buildStaticExtensions() {
  return [
    lineNumbers(),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    indentOnInput(),
    bracketMatching(),
    rectangularSelection(),
    crosshairCursor(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    json(),
    EditorView.lineWrapping,
    EditorView.theme({
      "&": {
        fontSize: "13px",
        fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
        height: "100%",
      },
      ".cm-scroller": { overflow: "auto" },
      "&.cm-focused": { outline: "none" },
      // Lint tooltip styling
      ".cm-tooltip.cm-tooltip-lint": {
        fontSize: "12px",
        fontFamily: "var(--font-mono, monospace)",
        maxWidth: "320px",
        borderRadius: "4px",
      },
      // Lint gutter dot
      ".cm-gutter-lint .cm-lint-marker-error": {
        content: "''",
      },
      // Placeholder styling (subtle, vanishes when typed into)
      ".cm-placeholder": {
        color: "var(--color-mute, #71717a)",
        fontFamily: "var(--font-mono, monospace)",
        opacity: "0.55",
      },
    }),
  ];
}

// ─── Main Component ───────────────────────────────────────────────────────────

// ─── Component Props ─────────────────────────────────────────────────────────

interface JsonEditorProps {
  /** Pre-fill the input editor with this string on mount */
  initialInput?: string;
  /** Placeholder text shown when input is empty (vanishes on type) */
  inputPlaceholder?: string;
}

export default function JsonEditor({ initialInput, inputPlaceholder }: JsonEditorProps = {}) {
  const [input, setInput] = useState(initialInput ?? "");
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState<StatusState>({ type: "idle" });
  const [indent, setIndent] = useState<IndentOption>(2);
  const [isDragging, setIsDragging] = useState(false);
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [dark, setDark] = useState(isDark);
  // Phase 4: view mode toggle (code / tree)
  const [viewMode, setViewMode] = useState<"code" | "tree">("code");
  const [pathCopied, setPathCopied] = useState<string | null>(null);
  const pathCopiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track explicit format/minify error for output panel error state
  const [formatError, setFormatError] = useState<{ message: string; line: number; column: number } | null>(null);

  const inputContainerRef = useRef<HTMLDivElement>(null);
  const outputContainerRef = useRef<HTMLDivElement>(null);
  const inputViewRef = useRef<EditorView | null>(null);
  const outputViewRef = useRef<EditorView | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Compartments for live theme hot-swap — one per editor instance
  const inputThemeCompartment  = useRef(new Compartment());
  const outputThemeCompartment = useRef(new Compartment());

  const stats = getStats(input);

  // ── Watch theme changes — live-reconfigure via Compartment ──────────────
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const nowDark = isDark();
      setDark(nowDark);

      // Dispatch live theme update to both editors without destroying them
      const newTheme = themeExtension(nowDark);

      const inputView = inputViewRef.current;
      if (inputView) {
        inputView.dispatch({
          effects: inputThemeCompartment.current.reconfigure(newTheme),
        });
      }

      const outputView = outputViewRef.current;
      if (outputView) {
        outputView.dispatch({
          effects: outputThemeCompartment.current.reconfigure(newTheme),
        });
      }
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  // ── Mount input editor ───────────────────────────────────────────────────
  useEffect(() => {
    if (!inputContainerRef.current) return;

    const initialDark = isDark();
    const view = new EditorView({
      state: EditorState.create({
        doc: initialInput ?? "",
        extensions: [
          // Static extensions (never change)
          ...buildStaticExtensions(),
          lintGutter(),
          buildJsonLinter(),
          // Placeholder (disappears immediately when user types or pastes)
          placeholder(inputPlaceholder ?? `{\n  "name": "example",\n  "value": 123\n}`),
          // Theme in Compartment — hot-swappable
          inputThemeCompartment.current.of(themeExtension(initialDark)),
          // Content change listener
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const val = update.state.doc.toString();
              setInput(val);
              updateStatusFromInput(val);
            }
          }),
        ],
      }),
      parent: inputContainerRef.current,
    });

    inputViewRef.current = view;
    // If initialInput was provided, run initial validation
    if (initialInput?.trim()) updateStatusFromInput(initialInput);
    return () => {
      view.destroy();
      inputViewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Mount output editor ──────────────────────────────────────────────────
  useEffect(() => {
    if (!outputContainerRef.current) return;

    const initialDark = isDark();
    const view = new EditorView({
      state: EditorState.create({
        doc: "",
        extensions: [
          // Static extensions
          ...buildStaticExtensions(),
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          placeholder("Formatted JSON will appear here..."),
          // Theme in Compartment — hot-swappable
          outputThemeCompartment.current.of(themeExtension(initialDark)),
        ],
      }),
      parent: outputContainerRef.current,
    });

    outputViewRef.current = view;
    return () => {
      view.destroy();
      outputViewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Sync output content ──────────────────────────────────────────────────
  useEffect(() => {
    const view = outputViewRef.current;
    if (!view) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: output },
    });
  }, [output]);

  // ── Auto-validate status (for status bar — separate from CM lint) ────────
  function updateStatusFromInput(val: string) {
    if (!val.trim()) {
      setStatus({ type: "empty" });
      setFormatError(null);
      return;
    }
    try {
      JSON.parse(val);
      setStatus({ type: "valid" });
      setFormatError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Invalid JSON";
      const match = msg.match(/position (\d+)/);
      let line = 1, column = 1;
      if (match) {
        const offset = parseInt(match[1]!, 10);
        const before = val.slice(0, offset).split("\n");
        line = before.length;
        column = (before[before.length - 1] ?? "").length + 1;
      }
      setStatus({ type: "error", message: msg, line, column });
    }
  }

  // ── Set input content programmatically ──────────────────────────────────
  function setInputContent(val: string) {
    const view = inputViewRef.current;
    if (!view) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: val },
    });
    setInput(val);
    updateStatusFromInput(val);
  }

  // ── Show toast ───────────────────────────────────────────────────────────
  function showToast(t: NonNullable<Toast>, durationMs = 4000) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(t);
    toastTimerRef.current = setTimeout(() => setToast(null), durationMs);
  }

  // ── Indent change handler (auto re-format if output already exists) ──────
  function handleIndentChange(newIndent: IndentOption) {
    setIndent(newIndent);

    // Auto re-format if output already has content and no format error is active
    if (output.trim() && !formatError) {
      try {
        const parsed = JSON.parse(output);
        const indentStr = newIndent === "tab" ? "\t" : newIndent;
        setOutput(JSON.stringify(parsed, null, indentStr));
      } catch {
        if (input.trim()) {
          const result = formatJSON(input, newIndent);
          if (result.success) {
            setOutput(result.output);
          }
        }
      }
    }
  }

  // ── Format ───────────────────────────────────────────────────────────────
  function handleFormat() {
    if (!input.trim()) return;
    const result = formatJSON(input, indent);
    if (result.success) {
      setOutput(result.output);
      setStatus({ type: "valid" });
      setFormatError(null);
    } else {
      setOutput("");
      setStatus({ type: "error", message: result.error, line: result.line, column: result.column });
      setFormatError({ message: result.error, line: result.line, column: result.column });
    }
  }

  // ── Minify ───────────────────────────────────────────────────────────────
  function handleMinify() {
    if (!input.trim()) return;
    const result = minifyJSON(input);
    if (result.success) {
      setOutput(result.output);
      setStatus({ type: "valid" });
      setFormatError(null);
    } else {
      setOutput("");
      setStatus({ type: "error", message: result.error, line: result.line, column: result.column });
      setFormatError({ message: result.error, line: result.line, column: result.column });
    }
  }

  // ── Repair ───────────────────────────────────────────────────────────────
  function handleRepair() {
    if (!input.trim()) return;

    const result = repairJSON(input);

    if (!result.success) {
      setOutput("");
      showToast({ kind: "error", message: `Could not auto-repair — ${result.error}` });
      return;
    }

    setFormatError(null);
    setViewMode("code");

    if (result.alreadyValid) {
      // Already valid — just format it
      const formatted = formatJSON(input, indent);
      if (formatted.success) setOutput(formatted.output);
      setStatus({ type: "valid" });
      showToast({ kind: "warning", message: "Already valid JSON — formatted only" }, 3000);
      return;
    }

    // Repaired successfully — format the output with current indent setting
    const formatted = formatJSON(result.output, indent);
    setOutput(formatted.success ? formatted.output : result.output);
    setStatus({ type: "repaired", changes: result.changes });
    const changeStr = result.changes.join(", ");
    showToast({ kind: "success", message: `Fixed: ${changeStr}` });

    // Revert status to "valid" after 3.5s
    setTimeout(() => {
      setStatus((prev) => (prev.type === "repaired" ? { type: "valid" } : prev));
    }, 3500);
  }

  // ── Clear ────────────────────────────────────────────────────────────────
  function handleClear() {
    setInputContent("");
    setOutput("");
    setStatus({ type: "idle" });
    setFormatError(null);
    setToast(null);
  }

  // ── Copy output ──────────────────────────────────────────────────────────
  async function handleCopy() {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  // ── Download ─────────────────────────────────────────────────────────────
  function handleDownload() {
    if (!output) return;
    const blob = new Blob([output], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "formatted.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── File upload ──────────────────────────────────────────────────────────
  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setInputContent(content);
    };
    reader.readAsText(file);
  }

  function handleFileInput(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) handleFile(file);
  }

  // ── Drag & Drop ──────────────────────────────────────────────────────────
  function handleDragOver(e: DragEvent) { e.preventDefault(); setIsDragging(true); }
  function handleDragLeave() { setIsDragging(false); }
  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer?.files[0];
    if (file) handleFile(file);
  }

  // ── Keyboard shortcuts ───────────────────────────────────────────────────
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.shiftKey && e.key === "F") { e.preventDefault(); handleFormat(); }
      if (mod && e.key === "m") { e.preventDefault(); handleMinify(); }
      if (mod && e.key === "s") { e.preventDefault(); handleDownload(); }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [input, output, indent]);

  // ── Path copied handler (from TreeView) ──────────────────────────────────
  function handlePathCopied(path: string) {
    if (pathCopiedTimerRef.current) clearTimeout(pathCopiedTimerRef.current);
    setPathCopied(path);
    pathCopiedTimerRef.current = setTimeout(() => setPathCopied(null), 2000);
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px", position: "relative" }}>

      {/* ── Toast notification ────────────────────────────────────────────── */}
      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}

      {/* ── Toolbar ───────────────────────────────────────────────────────── */}
      <div style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "8px",
        padding: "9px 15px",
        background: "var(--color-canvas)",
        border: "1px solid var(--color-hairline)",
        borderRadius: "var(--radius-md)",
        boxShadow: "var(--shadow-1)",
      }}>
        {/* Action buttons */}
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          <ToolbarButton onClick={handleFormat} primary title="Ctrl+Shift+F">
            Format
          </ToolbarButton>
          <ToolbarButton onClick={handleMinify} title="Ctrl+M">
            Minify
          </ToolbarButton>
          {/* Repair button — amber accent to distinguish it as a "fix" action */}
          <ToolbarButton onClick={handleRepair} accent="amber" title="Auto-repair broken JSON">
            🔧 Repair
          </ToolbarButton>
          <ToolbarButton onClick={handleClear}>
            Clear
          </ToolbarButton>
        </div>

        {/* Divider */}
        <div class="toolbar-divider" style={{ width: "1px", height: "24px", background: "var(--color-hairline)", margin: "0 4px" }} />

        {/* Indent selector */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
          <span style={{ fontSize: "12px", color: "var(--color-mute)", fontFamily: "var(--font-mono)" }}>
            Indent:
          </span>
          {([2, 4, "tab"] as IndentOption[]).map((opt) => (
            <button
              key={String(opt)}
              onClick={() => handleIndentChange(opt)}
              style={{
                padding: "3px 10px",
                fontSize: "12px",
                fontFamily: "var(--font-mono)",
                border: "1px solid",
                borderColor: indent === opt ? "var(--color-link)" : "var(--color-hairline)",
                borderRadius: "var(--radius-sm)",
                background: indent === opt ? "var(--color-link-bg-soft)" : "transparent",
                color: indent === opt ? "var(--color-link)" : "var(--color-body)",
                cursor: "pointer",
                transition: "all 0.1s",
              }}
            >
              {opt === "tab" ? "Tab" : `${opt}sp`}
            </button>
          ))}
        </div>

        {/* File upload */}
        <div class="toolbar-upload" style={{ marginLeft: "auto" }}>
          <label style={{
            padding: "5px 12px",
            fontSize: "13px",
            border: "1px solid var(--color-hairline)",
            borderRadius: "var(--radius-sm)",
            background: "var(--color-canvas-soft-2)",
            color: "var(--color-body)",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
          }} title="Upload a .json file">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Upload
            <input type="file" accept=".json,application/json,text/plain" onChange={handleFileInput} style={{ display: "none" }} />
          </label>
        </div>
      </div>

      {/* ── Editor panels ─────────────────────────────────────────────────── */}
      <div
        class="editor-grid"
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", minHeight: "410px" }}
      >
        {/* Input panel */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            border: `1px solid ${isDragging ? "var(--color-link)" : "var(--color-hairline)"}`,
            borderRadius: "var(--radius-md)",
            overflow: "hidden",
            background: "var(--color-canvas)",
            boxShadow: isDragging ? "0 0 0 2px var(--color-link-bg-soft)" : "var(--shadow-1)",
            transition: "border-color 0.15s, box-shadow 0.15s",
            position: "relative",
          }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <PanelHeader label="Input" hint="Paste JSON or drop a file" />
          <div
            ref={inputContainerRef}
            style={{ flex: 1, overflow: "hidden", background: "var(--color-editor-bg)", minHeight: 0 }}
          />
          {isDragging && (
            <div style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(0,112,243,0.05)",
              border: "2px dashed var(--color-link)",
              borderRadius: "var(--radius-md)",
              pointerEvents: "none",
              zIndex: 10,
            }}>
              <span style={{ fontSize: "14px", color: "var(--color-link)", fontFamily: "var(--font-mono)" }}>
                Drop .json file here
              </span>
            </div>
          )}
        </div>

        {/* Output panel */}
        <div style={{
          display: "flex",
          flexDirection: "column",
          border: "1px solid var(--color-hairline)",
          borderRadius: "var(--radius-md)",
          overflow: "hidden",
          background: "var(--color-canvas)",
          boxShadow: "var(--shadow-1)",
        }}>
          {/* Output panel header with Code/Tree segmented toggle */}
          <div style={{
            display: "flex",
            alignItems: "center",
            padding: "6px 12px",
            borderBottom: "1px solid var(--color-hairline)",
            background: "var(--color-canvas-soft)",
            gap: "8px",
            minHeight: "38px",
          }}>
            <span style={{ fontSize: "12px", fontWeight: 500, color: "var(--color-body)", fontFamily: "var(--font-mono)" }}>
              Output
            </span>
            {!output && (
              <span style={{ fontSize: "11px", color: "var(--color-mute)" }}>Click Format, Minify, or Repair</span>
            )}

            {/* Segmented control: Code | Tree */}
            <div style={{
              display: "flex",
              marginLeft: output ? "0" : "auto",
              border: "1px solid var(--color-hairline)",
              borderRadius: "var(--radius-sm)",
              overflow: "hidden",
              background: "var(--color-canvas-soft-2)",
              flexShrink: 0,
            }}>
              {(["code", "tree"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  style={{
                    padding: "3px 12px",
                    fontSize: "11px",
                    fontFamily: "var(--font-mono)",
                    border: "none",
                    borderRight: mode === "code" ? "1px solid var(--color-hairline)" : "none",
                    background: viewMode === mode ? "var(--color-ink)" : "transparent",
                    color: viewMode === mode ? "var(--color-canvas)" : "var(--color-mute)",
                    cursor: "pointer",
                    transition: "all 0.1s",
                    fontWeight: viewMode === mode ? 500 : 400,
                  }}
                >
                  {mode === "code" ? "{ } Code" : "🌳 Tree"}
                </button>
              ))}
            </div>

            {/* Copy/Download — always visible when output exists */}
            {output && (
              <div style={{ display: "flex", gap: "4px", marginLeft: "auto" }}>
                {/* Path copied inline badge */}
                {pathCopied && (
                  <span style={{
                    fontSize: "11px",
                    color: "var(--color-success)",
                    fontFamily: "var(--font-mono)",
                    alignSelf: "center",
                    marginRight: "4px",
                  }}>
                    ✓ Path copied
                  </span>
                )}
                <IconButton onClick={handleCopy} title="Copy JSON to clipboard">
                  {copied ? (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  )}
                </IconButton>
                <IconButton onClick={handleDownload} title="Download as .json (Ctrl+S)">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                </IconButton>
              </div>
            )}
          </div>

          {/* Code view: CodeMirror — stays mounted, hidden when tree active or when showing error state */}
          <div
            ref={outputContainerRef}
            style={{
              flex: viewMode === "code" && (!formatError || output) ? 1 : 0,
              overflow: "hidden",
              background: "var(--color-editor-bg)",
              opacity: output ? 1 : 0.5,
              minHeight: 0,
              display: viewMode === "code" && (!formatError || output) ? "block" : "none",
            }}
          />

          {/* Invalid JSON Error State in Output Panel */}
          {viewMode === "code" && formatError && !output && (
            <div style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "24px",
              textAlign: "center",
              background: "var(--color-editor-bg)",
              gap: "12px",
            }}>
              <div style={{
                width: "42px",
                height: "42px",
                borderRadius: "50%",
                background: "rgba(238, 0, 0, 0.1)",
                border: "1px solid rgba(238, 0, 0, 0.2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--color-error, #ee0000)",
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="15" y1="9" x2="9" y2="15"></line>
                  <line x1="9" y1="9" x2="15" y2="15"></line>
                </svg>
              </div>

              <div>
                <h3 style={{
                  fontSize: "14.5px",
                  fontWeight: 600,
                  color: "var(--color-ink)",
                  margin: "0 0 4px 0",
                  letterSpacing: "-0.3px",
                }}>
                  Invalid JSON
                </h3>
                <p style={{
                  fontSize: "12.5px",
                  color: "var(--color-mute)",
                  margin: 0,
                  maxWidth: "340px",
                  lineHeight: "1.4",
                  fontFamily: "var(--font-mono)",
                }}>
                  {formatError.message} (Line {formatError.line}, Col {formatError.column})
                </p>
              </div>

              <button
                onClick={handleRepair}
                style={{
                  marginTop: "4px",
                  padding: "6px 16px",
                  fontSize: "13px",
                  fontWeight: 500,
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid rgba(245, 166, 35, 0.4)",
                  background: "rgba(245, 166, 35, 0.14)",
                  color: "#b07000",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  transition: "opacity 0.1s",
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.opacity = "0.8")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.opacity = "1")}
              >
                🔧 Try Repair
              </button>
            </div>
          )}

          {/* Tree view */}
          {viewMode === "tree" && (
            <div style={{ flex: 1, overflow: "hidden", minHeight: 0, display: "flex", flexDirection: "column" }}>
              <TreeView
                json={output}
                onPathCopied={handlePathCopied}
                onRepair={handleRepair}
              />
            </div>
          )}
        </div>
      </div>

      {/* ── Status bar ────────────────────────────────────────────────────── */}
      <div style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "12px",
        padding: "8px 14px",
        background: "var(--color-canvas)",
        border: "1px solid var(--color-hairline)",
        borderRadius: "var(--radius-sm)",
        fontSize: "12px",
        fontFamily: "var(--font-mono)",
      }}>
        <StatusBadge status={status} />

        {input.trim() && (
          <>
            <StatDivider />
            <StatItem label="Lines" value={String(stats.lines)} />
            <StatItem label="Chars" value={String(stats.chars)} />
            <StatItem label="Size" value={formatBytes(stats.bytes)} />
            {stats.keys !== null && (
              <StatItem label={stats.isArray ? "Items" : "Keys"} value={String(stats.keys)} />
            )}
          </>
        )}

        <span class="shortcut-hints" style={{ marginLeft: "auto", color: "var(--color-mute)", fontSize: "11px" }}>
          Ctrl+Shift+F Format · Ctrl+M Minify · Ctrl+S Download
        </span>
      </div>

      {/* Responsive CSS */}
      <style>{`
        @media (max-width: 768px) {
          .editor-grid { grid-template-columns: 1fr !important; }
          .shortcut-hints { display: none !important; }
        }
        @media (max-width: 640px) {
          .toolbar-divider { display: none !important; }
          .toolbar-upload { margin-left: 0 !important; width: 100%; display: flex; justify-content: flex-end; }
        }
        /* CodeMirror lint squiggly — works alongside built-in CM lint styles */
        .cm-diagnostic-error { border-bottom: 2px wavy var(--color-error, #ee0000); }
        .cm-lint-marker-error { color: var(--color-error, #ee0000); }
        .cm-tooltip.cm-tooltip-lint {
          background: var(--color-canvas) !important;
          border: 1px solid var(--color-hairline) !important;
          color: var(--color-error) !important;
          font-size: 12px !important;
          border-radius: 4px !important;
          padding: 4px 8px !important;
          max-width: 300px !important;
        }
      `}</style>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ToolbarButton({
  onClick,
  children,
  primary,
  accent,
  title,
}: {
  onClick: () => void;
  children: preact.ComponentChildren;
  primary?: boolean;
  accent?: "amber";
  title?: string;
}) {
  const styles = primary
    ? {
        background: "var(--color-ink)",
        color: "var(--color-canvas)",
        borderColor: "transparent",
      }
    : accent === "amber"
    ? {
        background: "rgba(245, 166, 35, 0.12)",
        color: "#b07000",
        borderColor: "rgba(245, 166, 35, 0.4)",
      }
    : {
        background: "var(--color-canvas-soft-2)",
        color: "var(--color-body)",
        borderColor: "var(--color-hairline)",
      };

  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        padding: "5px 14px",
        fontSize: "13px",
        fontWeight: 500,
        border: "1px solid",
        borderRadius: "var(--radius-sm)",
        cursor: "pointer",
        transition: "opacity 0.1s",
        ...styles,
      }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.opacity = "0.75")}
      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.opacity = "1")}
    >
      {children}
    </button>
  );
}

function PanelHeader({
  label,
  hint,
  actions,
}: {
  label: string;
  hint?: string;
  actions?: preact.ComponentChildren;
}) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      padding: "8px 12px",
      borderBottom: "1px solid var(--color-hairline)",
      background: "var(--color-canvas-soft)",
      gap: "8px",
      minHeight: "38px",
      flexShrink: 0,
    }}>
      <span style={{ fontSize: "12px", fontWeight: 500, color: "var(--color-body)", fontFamily: "var(--font-mono)" }}>
        {label}
      </span>
      {hint && <span style={{ fontSize: "11px", color: "var(--color-mute)" }}>{hint}</span>}
      {actions && <div style={{ marginLeft: "auto" }}>{actions}</div>}
    </div>
  );
}

function IconButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: preact.ComponentChildren;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: "26px",
        height: "26px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: "1px solid var(--color-hairline)",
        borderRadius: "var(--radius-xs)",
        background: "var(--color-canvas)",
        color: "var(--color-body)",
        cursor: "pointer",
      }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.opacity = "0.7")}
      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.opacity = "1")}
    >
      {children}
    </button>
  );
}

function StatusBadge({ status }: { status: StatusState }) {
  if (status.type === "idle" || status.type === "empty") {
    return <span style={{ color: "var(--color-mute)" }}>○ Paste JSON to begin</span>;
  }
  if (status.type === "valid") {
    return <span style={{ color: "var(--color-success)", fontWeight: 500 }}>✓ Valid JSON</span>;
  }
  if (status.type === "repaired") {
    return (
      <span style={{ color: "var(--color-warning)", fontWeight: 500 }}>
        🔧 Repaired — {status.changes.join(", ")}
      </span>
    );
  }
  // error
  return (
    <span style={{ color: "var(--color-error)", fontWeight: 500 }} title={status.message}>
      ✗ Error at line {status.line}, col {status.column}
    </span>
  );
}

function StatDivider() {
  return (
    <span style={{ color: "var(--color-hairline-strong)", userSelect: "none" }}>·</span>
  );
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ color: "var(--color-mute)" }}>
      <span style={{ color: "var(--color-body)" }}>{value}</span> {label}
    </span>
  );
}

function Toast({
  toast,
  onClose,
}: {
  toast: NonNullable<Toast>;
  onClose: () => void;
}) {
  const colors = {
    success: { bg: "#f0fdf4", border: "#bbf7d0", text: "#15803d" },
    warning: { bg: "var(--color-warning-soft)", border: "#fde68a", text: "#92400e" },
    error: { bg: "var(--color-error-soft)", border: "#fecaca", text: "var(--color-error-deep)" },
  };

  const c = colors[toast.kind];

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        bottom: "24px",
        right: "24px",
        zIndex: 100,
        display: "flex",
        alignItems: "flex-start",
        gap: "10px",
        padding: "12px 16px",
        background: c.bg,
        border: `1px solid ${c.border}`,
        borderRadius: "var(--radius-md)",
        boxShadow: "var(--shadow-4)",
        maxWidth: "380px",
        fontSize: "13px",
        color: c.text,
        fontFamily: "var(--font-sans)",
        animation: "slideUp 0.2s ease",
      }}
    >
      <span style={{ flex: 1, lineHeight: "1.4" }}>{toast.message}</span>
      <button
        onClick={onClose}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: c.text,
          opacity: 0.6,
          fontSize: "16px",
          lineHeight: 1,
          padding: "0",
          flexShrink: 0,
        }}
        aria-label="Dismiss"
      >
        ×
      </button>
      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
