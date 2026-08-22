// src/components/islands/JsonToCsv.tsx
// Phase 5 — JSON to CSV converter island (100% client-side, Preact)

import { useState } from "preact/hooks";
import { jsonToCsv } from "../../lib/converters";

// ─── Shared mini-components ───────────────────────────────────────────────────

function PanelHeader({ label, hint }: { label: string; hint?: string }) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      padding: "6px 12px",
      borderBottom: "1px solid var(--color-hairline)",
      background: "var(--color-canvas-soft)",
      gap: "8px",
      minHeight: "36px",
      flexShrink: 0,
    }}>
      <span style={{ fontSize: "12px", fontWeight: 500, color: "var(--color-body)", fontFamily: "var(--font-mono)" }}>
        {label}
      </span>
      {hint && (
        <span style={{ fontSize: "11px", color: "var(--color-mute)" }}>{hint}</span>
      )}
    </div>
  );
}

function ToolbarButton({
  onClick,
  children,
  primary,
  disabled,
  title,
}: {
  onClick: () => void;
  children: preact.ComponentChildren;
  primary?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  const base = {
    padding: "5px 14px",
    fontSize: "13px",
    fontWeight: 500,
    border: "1px solid",
    borderRadius: "var(--radius-sm)",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.45 : 1,
    transition: "opacity 0.1s",
  };
  const style = primary
    ? { ...base, background: "var(--color-ink)", color: "var(--color-canvas)", borderColor: "transparent" }
    : { ...base, background: "var(--color-canvas-soft-2)", color: "var(--color-body)", borderColor: "var(--color-hairline)" };

  return (
    <button onClick={disabled ? undefined : onClick} title={title} style={style}
      onMouseEnter={(e) => { if (!disabled) (e.currentTarget as HTMLElement).style.opacity = "0.75"; }}
      onMouseLeave={(e) => { if (!disabled) (e.currentTarget as HTMLElement).style.opacity = "1"; }}
    >
      {children}
    </button>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function JsonToCsv() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [rowCount, setRowCount] = useState<number | null>(null);

  function handleConvert() {
    if (!input.trim()) return;
    const result = jsonToCsv(input);
    if (result.success) {
      setOutput(result.output);
      setError(null);
      // Count data rows (minus header)
      const lines = result.output.split("\n").filter(Boolean);
      setRowCount(Math.max(0, lines.length - 1));
    } else {
      setOutput("");
      setError(result.error);
      setRowCount(null);
    }
  }

  function handleClear() {
    setInput("");
    setOutput("");
    setError(null);
    setRowCount(null);
  }

  async function handleCopy() {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  function handleDownload() {
    if (!output) return;
    const blob = new Blob([output], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "converted.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleFileUpload(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setInput(text);
      setOutput("");
      setError(null);
      setRowCount(null);
    };
    reader.readAsText(file);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>

      {/* ── Toolbar ── */}
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
        <ToolbarButton onClick={handleConvert} primary disabled={!input.trim()} title="Convert JSON to CSV">
          Convert to CSV
        </ToolbarButton>
        <ToolbarButton onClick={handleClear}>Clear</ToolbarButton>

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
          }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Upload JSON
            <input type="file" accept=".json,application/json,text/plain" onChange={handleFileUpload} style={{ display: "none" }} />
          </label>
        </div>
      </div>

      {/* ── Editor grid ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", minHeight: "410px" }} class="converter-grid">

        {/* Input panel */}
        <div style={{
          display: "flex",
          flexDirection: "column",
          border: "1px solid var(--color-hairline)",
          borderRadius: "var(--radius-md)",
          overflow: "hidden",
          background: "var(--color-canvas)",
          boxShadow: "var(--shadow-1)",
        }}>
          <PanelHeader label="Input" hint="Paste JSON array of objects" />
          <textarea
            value={input}
            onInput={(e) => {
              setInput((e.target as HTMLTextAreaElement).value);
              setError(null);
              setOutput("");
              setRowCount(null);
            }}
            placeholder={`[\n  { "name": "Alice", "age": 30, "city": "Mumbai" },\n  { "name": "Bob",   "age": 25, "city": "Delhi"  }\n]`}
            spellcheck={false}
            style={{
              flex: 1,
              resize: "none",
              border: "none",
              outline: "none",
              padding: "10px 14px",
              fontSize: "13px",
              fontFamily: "var(--font-mono, monospace)",
              background: "var(--color-editor-bg)",
              color: "var(--color-ink)",
              lineHeight: "1.6",
            }}
          />
        </div>

        {/* Output panel */}
        <div style={{
          display: "flex",
          flexDirection: "column",
          border: `1px solid ${error ? "rgba(238,0,0,0.3)" : "var(--color-hairline)"}`,
          borderRadius: "var(--radius-md)",
          overflow: "hidden",
          background: "var(--color-canvas)",
          boxShadow: "var(--shadow-1)",
        }}>
          <div style={{
            display: "flex",
            alignItems: "center",
            padding: "6px 12px",
            borderBottom: "1px solid var(--color-hairline)",
            background: "var(--color-canvas-soft)",
            gap: "8px",
            minHeight: "36px",
            flexShrink: 0,
          }}>
            <span style={{ fontSize: "12px", fontWeight: 500, color: "var(--color-body)", fontFamily: "var(--font-mono)" }}>
              Output (CSV)
            </span>
            {rowCount !== null && (
              <span style={{ fontSize: "11px", color: "var(--color-mute)" }}>
                {rowCount} row{rowCount !== 1 ? "s" : ""}
              </span>
            )}
            {output && (
              <div style={{ display: "flex", gap: "4px", marginLeft: "auto" }}>
                <button
                  onClick={handleCopy}
                  title="Copy CSV"
                  style={{
                    padding: "3px 10px",
                    fontSize: "11.5px",
                    border: "1px solid var(--color-hairline)",
                    borderRadius: "var(--radius-xs, 4px)",
                    background: copied ? "rgba(34,197,94,0.12)" : "var(--color-canvas-soft-2)",
                    color: copied ? "#16a34a" : "var(--color-body)",
                    cursor: "pointer",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {copied ? "✓ Copied" : "Copy"}
                </button>
                <button
                  onClick={handleDownload}
                  title="Download .csv"
                  style={{
                    padding: "3px 10px",
                    fontSize: "11.5px",
                    border: "1px solid var(--color-hairline)",
                    borderRadius: "var(--radius-xs, 4px)",
                    background: "var(--color-canvas-soft-2)",
                    color: "var(--color-body)",
                    cursor: "pointer",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  ↓ Download
                </button>
              </div>
            )}
          </div>

          {/* Error state */}
          {error && (
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
                width: "42px", height: "42px", borderRadius: "50%",
                background: "rgba(238,0,0,0.1)", border: "1px solid rgba(238,0,0,0.2)",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "var(--color-error, #ee0000)",
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              </div>
              <div>
                <h3 style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-ink)", margin: "0 0 6px 0" }}>
                  Cannot Convert
                </h3>
                <p style={{ fontSize: "12.5px", color: "var(--color-mute)", margin: 0, maxWidth: "300px", lineHeight: "1.5", fontFamily: "var(--font-mono)" }}>
                  {error}
                </p>
              </div>
            </div>
          )}

          {/* Empty state */}
          {!error && !output && (
            <div style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
              background: "var(--color-editor-bg)",
            }}>
              <span style={{ fontSize: "12.5px", color: "var(--color-mute)", fontFamily: "var(--font-mono)" }}>
                Click "Convert to CSV" to see output
              </span>
            </div>
          )}

          {/* CSV output */}
          {!error && output && (
            <textarea
              readOnly
              value={output}
              style={{
                flex: 1,
                resize: "none",
                border: "none",
                outline: "none",
                padding: "10px 14px",
                fontSize: "12.5px",
                fontFamily: "var(--font-mono, monospace)",
                background: "var(--color-editor-bg)",
                color: "var(--color-ink)",
                lineHeight: "1.6",
                wordBreak: "break-all",
              }}
            />
          )}
        </div>
      </div>

      {/* Status bar */}
      <div style={{
        padding: "7px 14px",
        background: "var(--color-canvas)",
        border: "1px solid var(--color-hairline)",
        borderRadius: "var(--radius-sm)",
        fontSize: "12px",
        fontFamily: "var(--font-mono)",
        color: "var(--color-mute)",
        display: "flex",
        gap: "16px",
      }}>
        {!input.trim() && <span>○ Paste a JSON array of objects to begin</span>}
        {input.trim() && error && <span style={{ color: "var(--color-error, #ee0000)" }}>✗ {error}</span>}
        {input.trim() && output && (
          <>
            <span style={{ color: "var(--color-success, #16a34a)" }}>✓ Converted</span>
            <span>{rowCount} rows</span>
            <span>{(output.split("\n")[0]?.match(/,/g)?.length ?? 0) + 1} columns</span>
          </>
        )}
      </div>

      <style>{`
        @media (max-width: 768px) {
          .converter-grid { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 640px) {
          .toolbar-upload { margin-left: 0 !important; width: 100%; display: flex; justify-content: flex-end; }
        }
      `}</style>
    </div>
  );
}
