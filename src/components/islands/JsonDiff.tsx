// src/components/islands/JsonDiff.tsx
// Phase 5 — JSON Diff / Compare tool island (100% client-side, Preact)

import { useState } from "preact/hooks";
import { jsonDiff, type DiffEntry } from "../../lib/converters";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatValue(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "string") return `"${v}"`;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

const DIFF_COLORS = {
  added: { bg: "rgba(34,197,94,0.12)", border: "rgba(34,197,94,0.3)", label: "rgba(34,197,94,0.8)", text: "#16a34a", badge: "ADDED" },
  removed: { bg: "rgba(238,68,68,0.1)", border: "rgba(238,68,68,0.25)", label: "rgba(238,68,68,0.7)", text: "#dc2626", badge: "REMOVED" },
  changed: { bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.3)", label: "rgba(245,158,11,0.7)", text: "#b45309", badge: "CHANGED" },
  "type-changed": { bg: "rgba(139,92,246,0.1)", border: "rgba(139,92,246,0.3)", label: "rgba(139,92,246,0.7)", text: "#7c3aed", badge: "TYPE" },
};

function DiffRow({ entry }: { entry: DiffEntry }) {
  const c = DIFF_COLORS[entry.type];
  return (
    <div style={{
      background: c.bg,
      border: `1px solid ${c.border}`,
      borderRadius: "var(--radius-sm)",
      padding: "8px 12px",
      fontFamily: "var(--font-mono)",
      fontSize: "12.5px",
      lineHeight: "1.5",
      display: "flex",
      flexDirection: "column",
      gap: "3px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        {/* Badge */}
        <span style={{
          fontSize: "10px", fontWeight: 700, padding: "1px 6px",
          borderRadius: "4px", border: `1px solid ${c.border}`,
          color: c.text, background: c.bg, flexShrink: 0,
          letterSpacing: "0.5px",
        }}>
          {c.badge}
        </span>
        {/* Path */}
        <span style={{ color: "var(--color-link)", wordBreak: "break-all" }}>{entry.path}</span>
      </div>

      {/* Values */}
      {entry.type === "added" && (
        <span style={{ color: c.text }}>+ {formatValue(entry.newValue)}</span>
      )}
      {entry.type === "removed" && (
        <span style={{ color: c.text }}>− {formatValue(entry.oldValue)}</span>
      )}
      {(entry.type === "changed" || entry.type === "type-changed") && (
        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          <span style={{ color: "#dc2626", textDecoration: "line-through", opacity: 0.8 }}>
            − {formatValue(entry.oldValue)}
          </span>
          <span style={{ color: "#16a34a" }}>
            + {formatValue(entry.newValue)}
          </span>
        </div>
      )}
    </div>
  );
}

function ToolbarButton({
  onClick, children, primary, disabled,
}: { onClick: () => void; children: preact.ComponentChildren; primary?: boolean; disabled?: boolean }) {
  const base = { padding: "5px 14px", fontSize: "13px", fontWeight: 500, border: "1px solid", borderRadius: "var(--radius-sm)", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.45 : 1, transition: "opacity 0.1s" };
  const style = primary
    ? { ...base, background: "var(--color-ink)", color: "var(--color-canvas)", borderColor: "transparent" }
    : { ...base, background: "var(--color-canvas-soft-2)", color: "var(--color-body)", borderColor: "var(--color-hairline)" };
  return (
    <button onClick={disabled ? undefined : onClick} style={style}
      onMouseEnter={(e) => { if (!disabled) (e.currentTarget as HTMLElement).style.opacity = "0.75"; }}
      onMouseLeave={(e) => { if (!disabled) (e.currentTarget as HTMLElement).style.opacity = "1"; }}
    >{children}</button>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function JsonDiff() {
  const [jsonA, setJsonA] = useState("");
  const [jsonB, setJsonB] = useState("");
  const [entries, setEntries] = useState<DiffEntry[] | null>(null);
  const [totalChanges, setTotalChanges] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canCompare = jsonA.trim().length > 0 && jsonB.trim().length > 0;

  function handleCompare() {
    if (!canCompare) return;
    const result = jsonDiff(jsonA, jsonB);
    if (result.success) {
      setEntries(result.entries);
      setTotalChanges(result.totalChanges);
      setError(null);
    } else {
      setEntries(null);
      setTotalChanges(null);
      setError(result.error);
    }
  }

  function handleClear() {
    setJsonA(""); setJsonB(""); setEntries(null); setTotalChanges(null); setError(null);
  }

  function makeFileHandler(setter: (v: string) => void) {
    return (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => { setter(ev.target?.result as string); setEntries(null); setError(null); };
      reader.readAsText(file);
    };
  }

  const panelStyle = {
    display: "flex", flexDirection: "column" as const,
    border: "1px solid var(--color-hairline)", borderRadius: "var(--radius-md)",
    overflow: "hidden", background: "var(--color-canvas)", boxShadow: "var(--shadow-1)",
  };

  const headerStyle = {
    display: "flex", alignItems: "center", padding: "6px 12px",
    borderBottom: "1px solid var(--color-hairline)", background: "var(--color-canvas-soft)",
    gap: "8px", minHeight: "36px", flexShrink: 0 as const,
  };

  const textareaStyle = {
    flex: 1, resize: "none" as const, border: "none", outline: "none",
    padding: "10px 14px", fontSize: "13px",
    fontFamily: "var(--font-mono, monospace)", background: "var(--color-editor-bg)",
    color: "var(--color-ink)", lineHeight: "1.6",
  };

  const addedCount = entries?.filter(e => e.type === "added").length ?? 0;
  const removedCount = entries?.filter(e => e.type === "removed").length ?? 0;
  const changedCount = entries?.filter(e => e.type === "changed" || e.type === "type-changed").length ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>

      {/* Toolbar */}
      <div style={{
        display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px",
        padding: "9px 15px", background: "var(--color-canvas)",
        border: "1px solid var(--color-hairline)", borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-1)",
      }}>
        <ToolbarButton onClick={handleCompare} primary disabled={!canCompare}>
          Compare JSON
        </ToolbarButton>
        <ToolbarButton onClick={handleClear}>Clear All</ToolbarButton>

        {totalChanges !== null && (
          <div style={{ display: "flex", gap: "6px", marginLeft: "8px" }}>
            {addedCount > 0 && (
              <span style={{ fontSize: "11.5px", padding: "2px 8px", borderRadius: "var(--radius-sm)", background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.3)", color: "#16a34a", fontFamily: "var(--font-mono)" }}>
                +{addedCount} added
              </span>
            )}
            {removedCount > 0 && (
              <span style={{ fontSize: "11.5px", padding: "2px 8px", borderRadius: "var(--radius-sm)", background: "rgba(238,68,68,0.1)", border: "1px solid rgba(238,68,68,0.25)", color: "#dc2626", fontFamily: "var(--font-mono)" }}>
                −{removedCount} removed
              </span>
            )}
            {changedCount > 0 && (
              <span style={{ fontSize: "11.5px", padding: "2px 8px", borderRadius: "var(--radius-sm)", background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", color: "#b45309", fontFamily: "var(--font-mono)" }}>
                ~{changedCount} changed
              </span>
            )}
            {totalChanges === 0 && (
              <span style={{ fontSize: "11.5px", padding: "2px 8px", borderRadius: "var(--radius-sm)", background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.3)", color: "#16a34a", fontFamily: "var(--font-mono)" }}>
                ✓ Identical
              </span>
            )}
          </div>
        )}
      </div>

      {/* Two input panels side by side */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", minHeight: "280px" }} class="diff-input-grid">
        {/* JSON A */}
        <div style={panelStyle}>
          <div style={headerStyle}>
            <span style={{ fontSize: "12px", fontWeight: 500, color: "var(--color-body)", fontFamily: "var(--font-mono)" }}>JSON A</span>
            <label style={{ marginLeft: "auto", padding: "2px 8px", fontSize: "11px", border: "1px solid var(--color-hairline)", borderRadius: "4px", background: "var(--color-canvas-soft-2)", color: "var(--color-mute)", cursor: "pointer", fontFamily: "var(--font-mono)" }}>
              Upload
              <input type="file" accept=".json,text/plain" onChange={makeFileHandler(setJsonA)} style={{ display: "none" }} />
            </label>
          </div>
          <textarea
            value={jsonA}
            onInput={(e) => { setJsonA((e.target as HTMLTextAreaElement).value); setEntries(null); setError(null); }}
            placeholder={`{\n  "name": "Alice",\n  "age": 25,\n  "role": "user"\n}`}
            spellcheck={false}
            style={textareaStyle}
          />
        </div>

        {/* JSON B */}
        <div style={panelStyle}>
          <div style={headerStyle}>
            <span style={{ fontSize: "12px", fontWeight: 500, color: "var(--color-body)", fontFamily: "var(--font-mono)" }}>JSON B</span>
            <label style={{ marginLeft: "auto", padding: "2px 8px", fontSize: "11px", border: "1px solid var(--color-hairline)", borderRadius: "4px", background: "var(--color-canvas-soft-2)", color: "var(--color-mute)", cursor: "pointer", fontFamily: "var(--font-mono)" }}>
              Upload
              <input type="file" accept=".json,text/plain" onChange={makeFileHandler(setJsonB)} style={{ display: "none" }} />
            </label>
          </div>
          <textarea
            value={jsonB}
            onInput={(e) => { setJsonB((e.target as HTMLTextAreaElement).value); setEntries(null); setError(null); }}
            placeholder={`{\n  "name": "Alice",\n  "age": 26,\n  "role": "admin"\n}`}
            spellcheck={false}
            style={textareaStyle}
          />
        </div>
      </div>

      {/* Result panel */}
      <div style={{
        border: `1px solid ${error ? "rgba(238,68,68,0.3)" : "var(--color-hairline)"}`,
        borderRadius: "var(--radius-md)", overflow: "hidden",
        background: "var(--color-canvas)", boxShadow: "var(--shadow-1)",
        minHeight: "180px",
      }}>
        <div style={headerStyle}>
          <span style={{ fontSize: "12px", fontWeight: 500, color: "var(--color-body)", fontFamily: "var(--font-mono)" }}>
            Diff Result
          </span>
          {totalChanges !== null && (
            <span style={{ fontSize: "11px", color: "var(--color-mute)" }}>
              {totalChanges} difference{totalChanges !== 1 ? "s" : ""} found
            </span>
          )}
        </div>

        <div style={{ padding: "12px", background: "var(--color-editor-bg)" }}>
          {/* Error */}
          {error && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px", textAlign: "center", gap: "12px" }}>
              <div style={{ width: "42px", height: "42px", borderRadius: "50%", background: "rgba(238,0,0,0.1)", border: "1px solid rgba(238,0,0,0.2)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-error, #ee0000)" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              </div>
              <div>
                <h3 style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-ink)", margin: "0 0 6px 0" }}>Parse Error</h3>
                <p style={{ fontSize: "12.5px", color: "var(--color-mute)", margin: 0, fontFamily: "var(--font-mono)", maxWidth: "340px", lineHeight: "1.5" }}>{error}</p>
              </div>
            </div>
          )}

          {/* Empty / waiting */}
          {!error && entries === null && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "40px", color: "var(--color-mute)", fontSize: "12.5px", fontFamily: "var(--font-mono)" }}>
              Paste both JSON A and JSON B, then click "Compare JSON"
            </div>
          )}

          {/* Identical */}
          {!error && entries !== null && entries.length === 0 && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px", gap: "10px" }}>
              <span style={{ fontSize: "32px" }}>✅</span>
              <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-ink)", margin: 0 }}>The two JSON objects are identical</p>
              <p style={{ fontSize: "12.5px", color: "var(--color-mute)", margin: 0 }}>No differences found</p>
            </div>
          )}

          {/* Diff entries */}
          {!error && entries !== null && entries.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {entries.map((entry, i) => <DiffRow key={i} entry={entry} />)}
            </div>
          )}
        </div>
      </div>

      {/* Status bar */}
      <div style={{
        padding: "7px 14px", background: "var(--color-canvas)", border: "1px solid var(--color-hairline)",
        borderRadius: "var(--radius-sm)", fontSize: "12px", fontFamily: "var(--font-mono)", color: "var(--color-mute)",
      }}>
        {!canCompare && <span>○ Paste JSON in both panels to compare</span>}
        {canCompare && entries === null && !error && <span>Ready — click "Compare JSON"</span>}
        {error && <span style={{ color: "var(--color-error, #ee0000)" }}>✗ {error}</span>}
        {entries !== null && entries.length > 0 && (
          <span>
            {addedCount > 0 && `+${addedCount} added  `}
            {removedCount > 0 && `−${removedCount} removed  `}
            {changedCount > 0 && `~${changedCount} changed`}
          </span>
        )}
        {entries !== null && entries.length === 0 && <span style={{ color: "var(--color-success, #16a34a)" }}>✓ Identical</span>}
      </div>

      <style>{`
        @media (max-width: 768px) {
          .diff-input-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
