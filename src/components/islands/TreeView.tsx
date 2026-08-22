// src/components/islands/TreeView.tsx
// Phase 4: Collapsible JSON tree with JSONPath copy, type tooltips, lazy expand
// Pure Preact component — no new packages, no separate island

import { useState, useMemo, useEffect, useCallback, useRef } from "preact/hooks";
import { memo } from "preact/compat";

// ─── Types ────────────────────────────────────────────────────────────────────

type JsonValue =
  | string | number | boolean | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type TreeViewProps = {
  /** The JSON string to render (output or input) */
  json: string;
  /** Called when user copies a path — parent shows toast */
  onPathCopied: (path: string) => void;
  /** Optional handler to trigger auto-repair */
  onRepair?: () => void;
};

// ─── Color tokens (works for light AND dark via CSS vars) ─────────────────────

const C = {
  key:     "var(--color-link)",          // blue
  index:   "var(--color-mute)",          // muted grey
  string:  "#22c55e",                    // green
  number:  "#f97316",                    // orange
  boolean: "#a78bfa",                    // violet
  null:    "var(--color-mute)",          // muted
  brace:   "var(--color-body)",          // neutral
  arrow:   "var(--color-mute)",          // collapse arrow
};

// ─── JSONPath builder ─────────────────────────────────────────────────────────

function buildPath(parent: string, key: string | number): string {
  if (typeof key === "number") return `${parent}[${key}]`;
  if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key)) return `${parent}.${key}`;
  return `${parent}["${key}"]`;
}

// ─── Collect all collapsible paths (for Collapse All) ────────────────────────

function collectCollapsiblePaths(value: JsonValue, path: string, acc: Set<string>) {
  if (value === null || typeof value !== "object") return;
  acc.add(path);
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectCollapsiblePaths(item, `${path}[${i}]`, acc));
  } else {
    for (const [k, v] of Object.entries(value)) {
      collectCollapsiblePaths(v, buildPath(path, k), acc);
    }
  }
}

// ─── Primitive value renderer ────────────────────────────────────────────────

function PrimitiveValue({ value }: { value: string | number | boolean | null }) {
  const [hovered, setHovered] = useState(false);
  let color: string;
  let display: string;

  if (value === null) { color = C.null; display = "null"; }
  else if (typeof value === "string") { color = C.string; display = `"${value}"`; }
  else if (typeof value === "number") { color = C.number; display = String(value); }
  else { color = C.boolean; display = String(value); }

  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <span
        style={{ color, cursor: "default" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {display}
      </span>
      {hovered && (
        <span style={{
          position: "absolute",
          bottom: "calc(100% + 4px)",
          left: 0,
          background: "var(--color-canvas)",
          border: "1px solid var(--color-hairline)",
          borderRadius: "var(--radius-xs)",
          padding: "2px 6px",
          fontSize: "11px",
          color: "var(--color-mute)",
          fontFamily: "var(--font-mono)",
          whiteSpace: "nowrap",
          zIndex: 20,
          pointerEvents: "none",
          boxShadow: "var(--shadow-2)",
        }}>
          {typeof value === "string" ? "string" : typeof value}
        </span>
      )}
    </span>
  );
}

// ─── Key label with copy-path on click ───────────────────────────────────────

function KeyLabel({
  label,
  path,
  isIndex,
  onCopyPath,
}: {
  label: string;
  path: string;
  isIndex: boolean;
  onCopyPath: (p: string) => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <span
        title={`Click to copy path: ${path}`}
        onClick={() => onCopyPath(path)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          color: isIndex ? C.index : C.key,
          cursor: "pointer",
          userSelect: "none",
          borderRadius: "2px",
          padding: "0 1px",
          background: hovered ? "var(--color-link-bg-soft)" : "transparent",
          transition: "background 0.1s",
          fontWeight: isIndex ? 400 : 500,
        }}
      >
        {isIndex ? `[${label}]` : `"${label}"`}
      </span>
      {hovered && (
        <span style={{
          position: "absolute",
          bottom: "calc(100% + 4px)",
          left: 0,
          background: "var(--color-canvas)",
          border: "1px solid var(--color-hairline)",
          borderRadius: "var(--radius-xs)",
          padding: "2px 6px",
          fontSize: "11px",
          color: "var(--color-mute)",
          fontFamily: "var(--font-mono)",
          whiteSpace: "nowrap",
          zIndex: 20,
          pointerEvents: "none",
          boxShadow: "var(--shadow-2)",
        }}>
          Copy path: {path}
        </span>
      )}
    </span>
  );
}

// ─── SHOW MORE button for large collections ───────────────────────────────────

const PAGE_SIZE = 100;

// ─── Tree Node (recursive, memoized) ─────────────────────────────────────────

const TreeNode = memo(function TreeNode({
  value,
  path,
  keyLabel,
  isIndex,
  depth,
  isLast,
  collapsedPaths,
  onToggle,
  onCopyPath,
}: {
  value: JsonValue;
  path: string;
  keyLabel?: string;
  isIndex?: boolean;
  depth: number;
  isLast: boolean;
  collapsedPaths: Set<string>;
  onToggle: (path: string) => void;
  onCopyPath: (path: string) => void;
}) {
  const [showCount, setShowCount] = useState(PAGE_SIZE);

  const isCollapsed = collapsedPaths.has(path);
  const isObject = value !== null && typeof value === "object" && !Array.isArray(value);
  const isArray = Array.isArray(value);
  const isPrimitive = !isObject && !isArray;

  const indent = depth * 16;

  const comma = isLast ? "" : ",";

  // Primitive values
  if (isPrimitive) {
    return (
      <div style={{ paddingLeft: `${indent}px`, lineHeight: "22px", display: "flex", alignItems: "baseline", gap: "4px" }}>
        {keyLabel !== undefined && (
          <>
            <KeyLabel label={keyLabel} path={path} isIndex={!!isIndex} onCopyPath={onCopyPath} />
            <span style={{ color: C.brace }}>: </span>
          </>
        )}
        <PrimitiveValue value={value as string | number | boolean | null} />
        <span style={{ color: C.brace }}>{comma}</span>
      </div>
    );
  }

  // Object or Array
  const entries = isArray
    ? (value as JsonValue[]).map((v, i) => ({ key: String(i), val: v, isIdx: true }))
    : Object.entries(value as Record<string, JsonValue>).map(([k, v]) => ({ key: k, val: v, isIdx: false }));

  const totalCount = entries.length;
  const visibleEntries = entries.slice(0, showCount);
  const hasMore = showCount < totalCount;
  const openBrace = isArray ? "[" : "{";
  const closeBrace = isArray ? "]" : "}";

  const summaryText = isCollapsed
    ? isArray
      ? `Array(${totalCount})`
      : `{${Math.min(totalCount, 3)} key${totalCount !== 1 ? "s" : ""}${totalCount > 3 ? "…" : ""}}`
    : null;

  return (
    <div>
      {/* Node header row */}
      <div
        style={{ paddingLeft: `${indent}px`, lineHeight: "22px", display: "flex", alignItems: "baseline", gap: "4px" }}
      >
        {/* Collapse arrow */}
        <span
          onClick={() => onToggle(path)}
          title={isCollapsed ? "Expand" : "Collapse"}
          style={{
            display: "inline-block",
            width: "14px",
            fontSize: "9px",
            color: C.arrow,
            cursor: "pointer",
            userSelect: "none",
            transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
            transition: "transform 0.12s",
            flexShrink: 0,
          }}
        >
          ▼
        </span>

        {/* Key label */}
        {keyLabel !== undefined && (
          <>
            <KeyLabel label={keyLabel} path={path} isIndex={!!isIndex} onCopyPath={onCopyPath} />
            <span style={{ color: C.brace }}>: </span>
          </>
        )}

        {/* Opening brace */}
        <span style={{ color: C.brace }}>{openBrace}</span>

        {/* Collapsed summary */}
        {isCollapsed && (
          <>
            <span style={{ color: C.index, fontSize: "11px", cursor: "pointer" }} onClick={() => onToggle(path)}>
              {summaryText}
            </span>
            <span style={{ color: C.brace }}>{closeBrace}{comma}</span>
          </>
        )}
      </div>

      {/* Children */}
      {!isCollapsed && (
        <>
          {visibleEntries.map(({ key, val, isIdx }, i) => {
            const childPath = isIdx ? `${path}[${key}]` : buildPath(path, key);
            const childIsLast = i === visibleEntries.length - 1 && !hasMore;
            return (
              <TreeNode
                key={childPath}
                value={val}
                path={childPath}
                keyLabel={key}
                isIndex={isIdx}
                depth={depth + 1}
                isLast={childIsLast}
                collapsedPaths={collapsedPaths}
                onToggle={onToggle}
                onCopyPath={onCopyPath}
              />
            );
          })}

          {/* Show more button for large collections */}
          {hasMore && (
            <div style={{ paddingLeft: `${indent + 16}px`, lineHeight: "24px" }}>
              <button
                onClick={() => setShowCount((c) => c + PAGE_SIZE)}
                style={{
                  fontSize: "11px",
                  color: "var(--color-link)",
                  background: "var(--color-link-bg-soft)",
                  border: "1px solid var(--color-link)",
                  borderRadius: "var(--radius-xs)",
                  padding: "1px 8px",
                  cursor: "pointer",
                  fontFamily: "var(--font-mono)",
                }}
              >
                Show {Math.min(PAGE_SIZE, totalCount - showCount)} more… ({totalCount - showCount} remaining)
              </button>
            </div>
          )}

          {/* Closing brace */}
          <div style={{ paddingLeft: `${indent}px`, lineHeight: "22px" }}>
            <span style={{ color: C.brace }}>{closeBrace}{isLast ? "" : ","}</span>
          </div>
        </>
      )}
    </div>
  );
});

// ─── Main TreeView Component ──────────────────────────────────────────────────

export default function TreeView({ json, onPathCopied, onRepair }: TreeViewProps) {
  // Parse memoized — only re-parse when json string changes
  const parsed = useMemo(() => {
    if (!json.trim()) return { data: null, error: "empty" };
    try {
      return { data: JSON.parse(json) as JsonValue, error: null };
    } catch (e) {
      return { data: null, error: (e as Error).message };
    }
  }, [json]);

  // Collapsed paths — Set of path strings that are collapsed
  // Initially: collapse nodes at depth >= 2 (set filled on first parse)
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(() => new Set());
  const initializedRef = useRef(false);

  // On first valid parse, auto-collapse deep nodes (depth >= 2)
  useEffect(() => {
    if (!parsed.data || initializedRef.current) return;
    initializedRef.current = true;
    const autoCollapse = new Set<string>();
    function scanDepth(val: JsonValue, path: string, depth: number) {
      if (val === null || typeof val !== "object") return;
      if (depth >= 2) { autoCollapse.add(path); return; } // collapse from depth 2+
      if (Array.isArray(val)) {
        val.forEach((item, i) => scanDepth(item, `${path}[${i}]`, depth + 1));
      } else {
        for (const [k, v] of Object.entries(val as Record<string, JsonValue>)) {
          scanDepth(v, buildPath(path, k), depth + 1);
        }
      }
    }
    scanDepth(parsed.data, "$", 0);
    setCollapsedPaths(autoCollapse);
  }, [parsed.data]);

  const toggleCollapse = useCallback((path: string) => {
    setCollapsedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setCollapsedPaths(new Set());
  }, []);

  const collapseAll = useCallback(() => {
    if (!parsed.data) return;
    const all = new Set<string>();
    collectCollapsiblePaths(parsed.data, "$", all);
    setCollapsedPaths(all);
  }, [parsed.data]);

  const handleCopyPath = useCallback(async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      onPathCopied(path);
    } catch {
      // Clipboard access denied
    }
  }, [onPathCopied]);

  // ── Disabled states ──

  if (!json.trim()) {
    return (
      <div style={disabledStyle}>
        <span style={{ fontSize: "13px", color: "var(--color-mute)" }}>
          Click Format or Repair to see tree view
        </span>
      </div>
    );
  }

  if (parsed.error && parsed.error !== "empty") {
    return (
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
        minHeight: "220px",
      }}>
        <div style={{
          width: "40px",
          height: "40px",
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
            fontSize: "14px",
            fontWeight: 600,
            color: "var(--color-ink)",
            margin: "0 0 4px 0",
          }}>
            Invalid JSON
          </h3>
          <p style={{
            fontSize: "12.5px",
            color: "var(--color-mute)",
            margin: 0,
            maxWidth: "320px",
            lineHeight: "1.4",
            fontFamily: "var(--font-mono)",
          }}>
            Fix JSON errors to explore the tree view
          </p>
        </div>
        {onRepair && (
          <button
            onClick={onRepair}
            style={{
              marginTop: "4px",
              padding: "5px 14px",
              fontSize: "12.5px",
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
        )}
      </div>
    );
  }

  // ── Render ──

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "100%",
      width: "100%",
      maxWidth: "100%",
      minWidth: 0,
    }}>
      {/* Tree toolbar */}
      <div style={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "6px",
        padding: "6px 12px",
        borderBottom: "1px solid var(--color-hairline)",
        background: "var(--color-canvas-soft)",
        flexShrink: 0,
      }}>
        <button onClick={expandAll} style={treeBtn}>Expand All</button>
        <button onClick={collapseAll} style={treeBtn}>Collapse All</button>
        <span style={{ fontSize: "11px", color: "var(--color-mute)", marginLeft: "auto", fontFamily: "var(--font-mono)" }}>
          Click key to copy path
        </span>
      </div>

      {/* Scrollable tree body */}
      <div style={{
        flex: 1,
        overflow: "auto",
        padding: "10px 12px",
        fontFamily: "var(--font-mono)",
        fontSize: "13px",
        lineHeight: "22px",
        background: "var(--color-editor-bg)",
      }}>
        <TreeNode
          value={parsed.data!}
          path="$"
          depth={0}
          isLast={true}
          collapsedPaths={collapsedPaths}
          onToggle={toggleCollapse}
          onCopyPath={handleCopyPath}
        />
      </div>
    </div>
  );
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const disabledStyle: preact.JSX.CSSProperties = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "var(--color-editor-bg)",
  opacity: 0.6,
  minHeight: "200px",
};

const treeBtn: preact.JSX.CSSProperties = {
  padding: "2px 10px",
  fontSize: "11px",
  fontFamily: "var(--font-mono)",
  border: "1px solid var(--color-hairline)",
  borderRadius: "var(--radius-sm)",
  background: "var(--color-canvas)",
  color: "var(--color-body)",
  cursor: "pointer",
};
