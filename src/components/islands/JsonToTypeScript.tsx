// src/components/islands/JsonToTypeScript.tsx
// JSON to TypeScript converter island (100% client-side, Preact)

import { useState } from "preact/hooks";
import { jsonToTypeScript } from "../../lib/converters";

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

const SAMPLE_JSON = `{
  "id": "usr_99824",
  "name": "Jane Developer",
  "email": "jane@example.com",
  "active": true,
  "role": "lead",
  "settings": {
    "theme": "dark",
    "notifications": true,
    "maxRetries": 3
  },
  "tags": ["frontend", "typescript", "performance"],
  "projects": [
    {
      "id": 1,
      "name": "QuietJSON",
      "url": "https://quietjson.com"
    },
    {
      "id": 2,
      "name": "Internal SDK",
      "archived": false
    }
  ]
}`;

export default function JsonToTypeScript() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [rootName, setRootName] = useState("RootObject");
  const [useExport, setUseExport] = useState(true);

  function handleConvert(jsonText?: string) {
    const text = typeof jsonText === "string" ? jsonText : input;
    if (!text.trim()) return;
    const result = jsonToTypeScript(text, { rootName, useExport });
    if (result.success) {
      setOutput(result.output);
      setError(null);
    } else {
      setOutput("");
      setError(result.error);
    }
  }

  function handleClear() {
    setInput("");
    setOutput("");
    setError(null);
  }

  function handleSample() {
    setInput(SAMPLE_JSON);
    handleConvert(SAMPLE_JSON);
  }

  async function handleCopy() {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
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
    const blob = new Blob([output], { type: "text/typescript;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${rootName.toLowerCase() || "types"}.ts`;
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
            Generate TypeScript
          </ToolbarButton>
          <ToolbarButton onClick={handleSample}>
            Sample JSON
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
            Upload .json
            <input
              type="file"
              accept=".json,.txt"
              onChange={handleFileUpload}
              style={{ display: "none" }}
            />
          </label>
        </div>

        {/* Options */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontSize: "12px", color: "var(--color-mute)", fontFamily: "var(--font-mono)" }}>
              Root:
            </span>
            <input
              type="text"
              value={rootName}
              onInput={(e) => setRootName((e.target as HTMLInputElement).value)}
              placeholder="RootObject"
              style={{
                padding: "3px 8px",
                fontSize: "12px",
                fontFamily: "var(--font-mono)",
                border: "1px solid var(--color-hairline)",
                borderRadius: "var(--radius-sm)",
                background: "var(--color-canvas-soft)",
                color: "var(--color-ink)",
                width: "110px",
                outline: "none",
              }}
            />
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "var(--color-body)", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={useExport}
              onChange={(e) => setUseExport((e.target as HTMLInputElement).checked)}
              style={{ cursor: "pointer" }}
            />
            export
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
        {/* Left: JSON Input */}
        <div style={{
          display: "flex",
          flexDirection: "column",
          border: "1px solid var(--color-hairline)",
          borderRadius: "var(--radius-md)",
          overflow: "hidden",
          background: "var(--color-canvas)",
        }}>
          <PanelHeader
            label="JSON Input"
            hint="Paste raw JSON object or array"
          />
          <textarea
            value={input}
            onInput={(e) => setInput((e.target as HTMLTextAreaElement).value)}
            placeholder={`{\n  "userId": 1,\n  "title": "Example",\n  "completed": false\n}`}
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

        {/* Right: TypeScript Output */}
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
                TypeScript Output
              </span>
            </div>

            <div style={{ display: "flex", gap: "6px" }}>
              <ToolbarButton onClick={handleCopy} disabled={!output} title="Copy TypeScript">
                {copied ? "Copied!" : "Copy"}
              </ToolbarButton>
              <ToolbarButton onClick={handleDownload} disabled={!output} title="Download .ts file">
                ↓ Download .ts
              </ToolbarButton>
            </div>
          </div>

          <textarea
            value={output}
            readOnly
            placeholder="TypeScript interface will appear here after generation..."
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
