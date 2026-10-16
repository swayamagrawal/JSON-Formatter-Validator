// src/components/islands/CsvToJson.tsx
// CSV to JSON converter island (100% client-side, Preact)

import { useState } from "preact/hooks";
import { csvToJson } from "../../lib/converters";

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
    <button
      onClick={disabled ? undefined : onClick}
      title={title}
      style={style}
      onMouseEnter={(e) => { if (!disabled) (e.currentTarget as HTMLElement).style.opacity = "0.75"; }}
      onMouseLeave={(e) => { if (!disabled) (e.currentTarget as HTMLElement).style.opacity = "1"; }}
    >
      {children}
    </button>
  );
}

const SAMPLE_CSV = `id,name,role,department,active
1,"Doe, John",Engineering Lead,Platform,true
2,"Smith, Alice",Product Designer,Design,true
3,"Brown, Bob",QA Engineer,Quality,false
4,"Patel, Dev",Staff Architect,Cloud,true`;

export default function CsvToJson() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [recordCount, setRecordCount] = useState<number | null>(null);
  const [parseNumbers, setParseNumbers] = useState(true);
  const [parseBooleans, setParseBooleans] = useState(true);

  function handleConvert(csvText?: string) {
    const text = typeof csvText === "string" ? csvText : input;
    if (!text.trim()) return;
    const result = csvToJson(text, { parseNumbers, parseBooleans });
    if (result.success) {
      setOutput(result.output);
      setError(null);
      try {
        const parsed = JSON.parse(result.output);
        setRecordCount(Array.isArray(parsed) ? parsed.length : 1);
      } catch {
        setRecordCount(null);
      }
    } else {
      setOutput("");
      setError(result.error);
      setRecordCount(null);
    }
  }

  function handleClear() {
    setInput("");
    setOutput("");
    setError(null);
    setRecordCount(null);
  }

  function handleSample() {
    setInput(SAMPLE_CSV);
    handleConvert(SAMPLE_CSV);
  }

  async function handleCopy() {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const ta = document.createElement("textarea");
      ta.value = output;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function handleDownload() {
    if (!output) return;
    const blob = new Blob([output], { type: "application/json;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "data.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function handleFileUpload(e: Event) {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (typeof content === "string") {
        setInput(content);
        handleConvert(content);
      }
    };
    reader.readAsText(file);
    target.value = "";
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {/* Toolbar */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: "8px",
        padding: "9px 15px",
        background: "var(--color-canvas)",
        border: "1px solid var(--color-hairline)",
        borderRadius: "var(--radius-md)",
        boxShadow: "var(--shadow-1)",
      }}>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
          <ToolbarButton onClick={() => handleConvert()} primary>
            Convert to JSON
          </ToolbarButton>
          <ToolbarButton onClick={handleSample}>
            Sample CSV
          </ToolbarButton>
          <ToolbarButton onClick={handleClear}>
            Clear
          </ToolbarButton>

          <label style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "5px 14px",
            fontSize: "13px",
            fontWeight: 500,
            border: "1px solid var(--color-hairline)",
            borderRadius: "var(--radius-sm)",
            background: "var(--color-canvas-soft-2)",
            color: "var(--color-body)",
            cursor: "pointer",
          }}>
            Upload .csv
            <input
              type="file"
              accept=".csv,.txt"
              onChange={handleFileUpload}
              style={{ display: "none" }}
            />
          </label>
        </div>

        {/* Options */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "var(--color-body)", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={parseNumbers}
              onChange={(e) => setParseNumbers((e.target as HTMLInputElement).checked)}
              style={{ cursor: "pointer" }}
            />
            Parse numbers
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "var(--color-body)", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={parseBooleans}
              onChange={(e) => setParseBooleans((e.target as HTMLInputElement).checked)}
              style={{ cursor: "pointer" }}
            />
            Parse booleans
          </label>

          <span style={{ fontSize: "11px", color: "var(--color-mute)", fontFamily: "var(--font-mono)" }}>
            Zero server calls — 100% client-side
          </span>
        </div>
      </div>

      {/* Error alert */}
      {error && (
        <div
          role="alert"
          style={{
            padding: "10px 14px",
            background: "var(--color-error-soft)",
            border: "1px solid var(--color-error-hairline)",
            borderRadius: "var(--radius-md)",
            fontSize: "13px",
            color: "var(--color-error-deep)",
            display: "flex",
            alignItems: "flex-start",
            gap: "8px",
          }}
        >
          <span style={{ flexShrink: 0, fontWeight: 700 }}>✕</span>
          <span>{error}</span>
        </div>
      )}

      {/* Editor Grid */}
      <div class="editor-grid" style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "10px",
        minHeight: "480px",
      }}>
        {/* Left: CSV Input */}
        <div style={{
          display: "flex",
          flexDirection: "column",
          border: "1px solid var(--color-hairline)",
          borderRadius: "var(--radius-md)",
          overflow: "hidden",
          background: "var(--color-canvas)",
        }}>
          <PanelHeader
            label="CSV Input"
            hint="Paste RFC 4180 CSV with headers"
          />
          <textarea
            value={input}
            onInput={(e) => setInput((e.target as HTMLTextAreaElement).value)}
            placeholder={`id,name,role\n1,Alice,Engineer\n2,Bob,Designer`}
            spellcheck={false}
            style={{
              flex: 1,
              width: "100%",
              minHeight: "420px",
              padding: "12px",
              border: "none",
              outline: "none",
              resize: "none",
              background: "transparent",
              color: "var(--color-ink)",
              fontFamily: "var(--font-mono)",
              fontSize: "13px",
              lineHeight: "1.6",
              boxSizing: "border-box",
            }}
          />
        </div>

        {/* Right: JSON Output */}
        <div style={{
          display: "flex",
          flexDirection: "column",
          border: "1px solid var(--color-hairline)",
          borderRadius: "var(--radius-md)",
          overflow: "hidden",
          background: "var(--color-canvas)",
        }}>
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "6px 12px",
            borderBottom: "1px solid var(--color-hairline)",
            background: "var(--color-canvas-soft)",
            minHeight: "36px",
            flexShrink: 0,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "12px", fontWeight: 500, color: "var(--color-body)", fontFamily: "var(--font-mono)" }}>
                JSON Output
              </span>
              {recordCount !== null && (
                <span style={{
                  fontSize: "11px",
                  background: "var(--color-canvas-soft-2)",
                  color: "var(--color-mute)",
                  padding: "1px 6px",
                  borderRadius: "10px",
                  fontFamily: "var(--font-mono)",
                }}>
                  {recordCount} {recordCount === 1 ? "record" : "records"}
                </span>
              )}
            </div>

            <div style={{ display: "flex", gap: "6px" }}>
              <ToolbarButton onClick={handleCopy} disabled={!output} title="Copy JSON">
                {copied ? "Copied!" : "Copy"}
              </ToolbarButton>
              <ToolbarButton onClick={handleDownload} disabled={!output} title="Download data.json">
                ↓ Download
              </ToolbarButton>
            </div>
          </div>

          <textarea
            value={output}
            readOnly
            placeholder="JSON array will appear here after conversion..."
            spellcheck={false}
            style={{
              flex: 1,
              width: "100%",
              minHeight: "420px",
              padding: "12px",
              border: "none",
              outline: "none",
              resize: "none",
              background: "var(--color-canvas-soft)",
              color: "var(--color-ink)",
              fontFamily: "var(--font-mono)",
              fontSize: "13px",
              lineHeight: "1.6",
              boxSizing: "border-box",
            }}
          />
        </div>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .editor-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
