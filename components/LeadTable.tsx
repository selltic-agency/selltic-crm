// components/LeadTable.tsx — widok tabeli DEALÓW (Faza 10, było: ContactTable).
// Deal to samodzielny rekord: kolumny tożsamości (nazwa, firma, e-mail,
// telefon) i pipeline'u (etap, wartość, źródło, otwarcie) żyją razem.
"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Reorder } from "framer-motion";
import { ChevronUp, ChevronDown, Settings2, GripVertical, X } from "lucide-react";
import { tokens, formatPLN, formatDateTime, ghostButton } from "@/lib/ui";
import { Deal, PropertyDef } from "@/lib/types";
import { useStages } from "@/lib/stages";
import { createClient } from "@/lib/supabase/client";

type SortConfig = {
  key: string;
  direction: "asc" | "desc";
};

type TableColumn = {
  key: string;
  label: string;
  visible: boolean;
  width: number;
  position: number;
};

type LeadTableProps = {
  leads: Deal[];
  onRowClick: (id: string) => void;
};

const BUILT_IN_COLUMNS = [
  { key: "name", label: "Nazwa", width: 180 },
  { key: "company", label: "Firma", width: 150 },
  { key: "email", label: "E-mail", width: 200 },
  { key: "phone", label: "Telefon", width: 130 },
  { key: "stage", label: "Etap", width: 130 },
  { key: "value", label: "Wartość", width: 120 },
  { key: "source", label: "Źródło", width: 120 },
  { key: "opened_at", label: "Otwarto", width: 160 },
];

export default function LeadTable({ leads, onRowClick }: LeadTableProps) {
  const supabase = useMemo(() => createClient(), []);
  const { stageMeta } = useStages();
  const [sort, setSort] = useState<SortConfig>({ key: "opened_at", direction: "desc" });
  const [config, setConfig] = useState<TableColumn[]>([]);
  const [showConfig, setShowConfig] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const colBtnRef = useRef<HTMLButtonElement>(null);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    async function loadConfig() {
      const [defsRes, configRes] = await Promise.all([
        supabase.from("property_defs").select("*").order("position"),
        supabase.from("table_view_config").select("*").single(),
      ]);

      const defs = (defsRes.data as PropertyDef[]) || [];
      const savedCols = configRes.data?.columns as TableColumn[] | undefined;

      const allPossible: TableColumn[] = [
        ...BUILT_IN_COLUMNS.map((c, i) => ({ ...c, visible: true, position: i })),
        ...defs.map((d, i) => ({
          key: d.key,
          label: d.key,
          width: 150,
          visible: false,
          position: BUILT_IN_COLUMNS.length + i,
        })),
      ];

      if (savedCols && Array.isArray(savedCols)) {
        const merged = allPossible.map((col) => {
          const saved = savedCols.find((s) => s.key === col.key);
          return saved ? { ...col, ...saved } : col;
        });
        setConfig(merged.sort((a, b) => a.position - b.position));
      } else {
        setConfig(allPossible);
      }
      setLoadingConfig(false);
    }
    loadConfig();
  }, [supabase]);

  const sortedLeads = useMemo(() => {
    setPage(1);
    return [...leads].sort((a, b) => {
      const aVal = getVal(a, sort.key);
      const bVal = getVal(b, sort.key);
      if (aVal === bVal) return 0;
      const res = aVal > bVal ? 1 : -1;
      return sort.direction === "asc" ? res : -res;
    });
  }, [leads, sort]);

  function getVal(d: Deal, key: string): string | number {
    if (key === "value") return Number(d.value || 0);
    if (key === "opened_at") return new Date(d.opened_at).getTime();
    if (key in d) return (d as any)[key] || "";
    return d.props?.[key] || "";
  }

  const handleSort = (key: string) => {
    setSort((prev) => ({
      key,
      direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc",
    }));
  };

  async function persistConfig(newConfig: TableColumn[]) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("table_view_config").upsert({
      owner: user.id,
      columns: newConfig.map(({ key, visible, width }, i) => ({ key, visible, width, position: i })),
    });
  }

  function updateConfig(newConfig: TableColumn[]) {
    setConfig(newConfig);
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => persistConfig(newConfig), 400);
  }

  const visibleColumns = useMemo(() => config.filter((c) => c.visible), [config]);
  const totalPages = Math.ceil(sortedLeads.length / pageSize);
  const paginated = sortedLeads.slice((page - 1) * pageSize, page * pageSize);

  if (loadingConfig) {
    return <div style={{ padding: 40, textAlign: "center", color: tokens.muted }}>Wczytywanie konfiguracji...</div>;
  }

  return (
    <div style={{ position: "relative" }}>
      <div style={{ padding: "10px 16px", borderBottom: `1px solid ${tokens.border}`, display: "flex", justifyContent: "flex-end" }}>
        <button
          ref={colBtnRef}
          onClick={() => setShowConfig((v) => !v)}
          style={{ ...ghostButton, display: "flex", alignItems: "center", gap: 6, fontSize: 13, padding: "6px 12px" }}
        >
          <Settings2 size={16} />
          Kolumny
        </button>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 800 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${tokens.border}`, background: tokens.bg }}>
              {visibleColumns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  style={{
                    textAlign: "left",
                    padding: "12px 16px",
                    fontSize: 12,
                    fontWeight: 700,
                    color: tokens.muted,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    width: col.width,
                    userSelect: "none",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {col.label.toUpperCase()}
                    {sort.key === col.key &&
                      (sort.direction === "asc" ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginated.map((l) => (
              <tr
                key={l.id}
                onClick={() => onRowClick(l.id)}
                style={{ borderBottom: `1px solid ${tokens.border}`, cursor: "pointer", transition: "background 0.15s ease" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = tokens.bg)}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                {visibleColumns.map((col) => (
                  <td key={col.key} style={{ ...tdStyle, width: col.width, maxWidth: col.width }}>
                    {renderCell(l, col.key, stageMeta)}
                  </td>
                ))}
              </tr>
            ))}
            {paginated.length === 0 && (
              <tr>
                <td colSpan={visibleColumns.length} style={{ padding: 40, textAlign: "center", color: tokens.muted }}>
                  Brak leadów spełniających kryteria.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div
          style={{
            padding: "12px 16px",
            borderTop: `1px solid ${tokens.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 13,
            color: tokens.muted,
          }}
        >
          <div>
            Pokazano {(page - 1) * pageSize + 1} – {Math.min(page * pageSize, sortedLeads.length)} z {sortedLeads.length}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
              style={{ ...ghostButton, padding: "4px 10px", fontSize: 12, opacity: page === 1 ? 0.5 : 1 }}
            >
              Poprzednia
            </button>
            <button
              disabled={page === totalPages}
              onClick={() => setPage((p) => p + 1)}
              style={{ ...ghostButton, padding: "4px 10px", fontSize: 12, opacity: page === totalPages ? 0.5 : 1 }}
            >
              Następna
            </button>
          </div>
        </div>
      )}

      {showConfig && (
        <ColumnConfigPanel
          anchorRef={colBtnRef}
          config={config}
          onChange={updateConfig}
          onClose={() => setShowConfig(false)}
        />
      )}
    </div>
  );
}

function renderCell(
  d: Deal,
  key: string,
  stageMeta: (k: string) => { color: string; label: string }
) {
  if (key === "stage") {
    const meta = stageMeta(d.stage);
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: meta.color }} />
        {meta.label}
      </div>
    );
  }
  if (key === "value") return formatPLN(d.value);
  if (key === "opened_at") return formatDateTime(d.opened_at);
  if (key === "source") return d.source || "ręcznie";
  if (key === "name") return <span style={{ fontWeight: 600 }}>{d.name || "—"}</span>;
  if (key in d) return (d as any)[key] || "—";
  return d.props?.[key] || "—";
}

const PANEL_WIDTH = 300;

function ColumnConfigPanel({ anchorRef, config, onChange, onClose }: {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  config: TableColumn[];
  onChange: (config: TableColumn[]) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    function place() {
      const btn = anchorRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const margin = 12;
      let left = r.right - PANEL_WIDTH;
      left = Math.max(margin, Math.min(left, window.innerWidth - PANEL_WIDTH - margin));
      const top = Math.min(r.bottom + 8, window.innerHeight - margin);
      setPos({ top, left });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchorRef]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose, anchorRef]);

  const toggleVisible = (key: string) =>
    onChange(config.map((c) => (c.key === key ? { ...c, visible: !c.visible } : c)));

  const panel = (
    <div
      ref={panelRef}
      style={{
        position: "fixed",
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        width: PANEL_WIDTH,
        maxWidth: "calc(100vw - 24px)",
        maxHeight: "min(440px, calc(100vh - 24px))",
        background: tokens.card,
        border: `1px solid ${tokens.border}`,
        borderRadius: 12,
        boxShadow: "0 10px 30px rgba(0,0,0,0.12)",
        zIndex: 100,
        display: "flex",
        flexDirection: "column",
        visibility: pos ? "visible" : "hidden",
      }}
    >
      <div style={{ padding: "14px 16px", borderBottom: `1px solid ${tokens.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>Konfiguracja kolumn</span>
        <button onClick={onClose} aria-label="Zamknij" style={{ border: "none", background: "none", cursor: "pointer", color: tokens.muted, display: "grid", placeItems: "center" }}>
          <X size={18} />
        </button>
      </div>

      <Reorder.Group
        axis="y"
        values={config}
        onReorder={onChange}
        style={{ flex: 1, overflowY: "auto", padding: 8, listStyle: "none", margin: 0 }}
      >
        {config.map((col) => (
          <Reorder.Item
            key={col.key}
            value={col}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 8px",
              borderRadius: 8,
              fontSize: 13,
              background: tokens.card,
            }}
          >
            <GripVertical size={16} color={tokens.muted} style={{ cursor: "grab", flexShrink: 0 }} />
            <label style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, cursor: "pointer", minWidth: 0 }}>
              <input
                type="checkbox"
                checked={col.visible}
                onChange={() => toggleVisible(col.key)}
                onPointerDown={(e) => e.stopPropagation()}
                style={{ cursor: "pointer", flexShrink: 0 }}
              />
              <span
                style={{
                  fontWeight: 500,
                  color: col.visible ? tokens.text : tokens.muted,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {col.label}
              </span>
            </label>
          </Reorder.Item>
        ))}
      </Reorder.Group>

      <div style={{ padding: 12, borderTop: `1px solid ${tokens.border}`, flexShrink: 0 }}>
        <button onClick={onClose} style={{ ...ghostButton, width: "100%" }}>
          Gotowe
        </button>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(panel, document.body);
}

const tdStyle: React.CSSProperties = {
  padding: "14px 16px",
  fontSize: 14,
  color: tokens.text,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};
