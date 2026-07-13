// components/LeadTable.tsx — widok tabeli DEALÓW (Faza 10, było: ContactTable).
// Deal to samodzielny rekord: kolumny tożsamości (nazwa, firma, e-mail,
// telefon) i pipeline'u (etap, wartość, źródło, otwarcie) żyją razem. Kolumny
// właściwości (systemowe: kategoria/cel + własne) dokładane są dynamicznie, a
// zaznaczanie wierszy pozwala na zbiorczą edycję dowolnej właściwości.
"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Reorder } from "framer-motion";
import { ChevronUp, ChevronDown, Settings2, GripVertical, X, CheckSquare, Square } from "lucide-react";
import { tokens, formatPLN, formatDateTime, ghostButton } from "@/lib/ui";
import { Deal } from "@/lib/types";
import { useStages } from "@/lib/stages";
import { createClient } from "@/lib/supabase/client";
import { asArray, readPropValue, type PropertyView } from "@/lib/properties";
import { PropertyValueDisplay } from "@/components/PropertyFields";
import BulkEditBar from "@/components/BulkEditBar";

export type SortConfig = {
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
  /** Kontrolowane sortowanie (Zapisane Widoki) — jeśli pominięte, komponent trzyma stan sam. */
  sort?: SortConfig;
  onSortChange?: (sort: SortConfig) => void;
  /** Właściwości (systemowe + własne) — kolumny dynamiczne + opcje akcji zbiorczej. */
  properties?: PropertyView[];
  /** Zbiorcza edycja właściwości dla zaznaczonych wierszy. */
  onBulkEdit?: (ids: string[], view: PropertyView, value: unknown, mode: "replace" | "add") => void | Promise<void>;
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

export default function LeadTable({ leads, onRowClick, sort: sortProp, onSortChange, properties = [], onBulkEdit }: LeadTableProps) {
  const supabase = useMemo(() => createClient(), []);
  const { stageMeta } = useStages();
  const [internalSort, setInternalSort] = useState<SortConfig>({ key: "opened_at", direction: "desc" });
  const sort = sortProp ?? internalSort;
  const [config, setConfig] = useState<TableColumn[]>([]);
  const [showConfig, setShowConfig] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const pageSize = 25;
  const colBtnRef = useRef<HTMLButtonElement>(null);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mapa klucz → właściwość, do renderu komórek i sortowania.
  const viewByKey = useMemo(() => new Map(properties.map((v) => [v.key, v])), [properties]);

  useEffect(() => {
    async function loadConfig() {
      const { data } = await supabase.from("table_view_config").select("*").single();
      const savedCols = data?.columns as TableColumn[] | undefined;

      const allPossible: TableColumn[] = [
        ...BUILT_IN_COLUMNS.map((c, i) => ({ ...c, visible: true, position: i })),
        // Kolumny właściwości: systemowe (kategoria/cel) domyślnie widoczne,
        // własne domyślnie ukryte (użytkownik włącza w „Kolumny").
        ...properties.map((v, i) => ({
          key: v.key,
          label: v.label,
          width: 160,
          visible: v.system,
          position: BUILT_IN_COLUMNS.length + i,
        })),
      ];

      if (savedCols && Array.isArray(savedCols)) {
        const merged = allPossible.map((col) => {
          const saved = savedCols.find((s) => s.key === col.key);
          // Zachowaj widoczność/szerokość zapisaną przez użytkownika, ale świeże
          // etykiety bierz z definicji (nazwa właściwości mogła się zmienić).
          return saved ? { ...col, visible: saved.visible, width: saved.width, position: saved.position } : col;
        });
        setConfig(merged.sort((a, b) => a.position - b.position));
      } else {
        setConfig(allPossible);
      }
      setLoadingConfig(false);
    }
    loadConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, properties]);

  // Odznacz wiersze, które zniknęły z listy (filtry/paginacja danych).
  useEffect(() => {
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => leads.some((l) => l.id === id)));
      return next.size === prev.size ? prev : next;
    });
  }, [leads]);

  const sortedLeads = useMemo(() => {
    return [...leads].sort((a, b) => {
      const aVal = getVal(a, sort.key, viewByKey);
      const bVal = getVal(b, sort.key, viewByKey);
      if (aVal === bVal) return 0;
      const res = aVal > bVal ? 1 : -1;
      return sort.direction === "asc" ? res : -res;
    });
  }, [leads, sort, viewByKey]);

  useEffect(() => setPage(1), [leads, sort]);

  const handleSort = (key: string) => {
    const next: SortConfig = {
      key,
      direction: sort.key === key && sort.direction === "asc" ? "desc" : "asc",
    };
    if (onSortChange) onSortChange(next);
    else setInternalSort(next);
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
  const safePage = Math.min(page, Math.max(1, totalPages));
  const paginated = sortedLeads.slice((safePage - 1) * pageSize, safePage * pageSize);

  const allSelected = leads.length > 0 && selected.size === leads.length;
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(leads.map((l) => l.id)));
  }
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  async function runBulk(view: PropertyView, value: unknown, mode: "replace" | "add") {
    if (!onBulkEdit) return;
    await onBulkEdit([...selected], view, value, mode);
    setSelected(new Set());
  }

  if (loadingConfig) {
    return <div style={{ padding: 40, textAlign: "center", color: tokens.muted }}>Wczytywanie konfiguracji...</div>;
  }

  const showSelection = !!onBulkEdit;

  return (
    <div style={{ position: "relative" }}>
      <div style={{ padding: "10px 16px", borderBottom: `1px solid ${tokens.border}`, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        {showSelection && (
          <>
            <button
              onClick={toggleAll}
              disabled={leads.length === 0}
              style={{ background: "none", border: "none", cursor: leads.length === 0 ? "default" : "pointer", display: "flex", alignItems: "center", gap: 6, color: tokens.text, fontSize: 13, fontWeight: 600, opacity: leads.length === 0 ? 0.5 : 1 }}
            >
              {allSelected ? <CheckSquare size={17} color={tokens.accent} /> : <Square size={17} color={tokens.muted} />}
              Zaznacz wszystkie
            </button>
            <BulkEditBar properties={properties} count={selected.size} onApply={runBulk} />
          </>
        )}
        <div style={{ flex: 1, minWidth: 8 }} />
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
              {showSelection && <th style={{ padding: "12px 16px", width: 44 }} />}
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
            {paginated.map((l) => {
              const isSelected = selected.has(l.id);
              return (
                <tr
                  key={l.id}
                  onClick={() => onRowClick(l.id)}
                  style={{ borderBottom: `1px solid ${tokens.border}`, cursor: "pointer", transition: "background 0.15s ease", background: isSelected ? tokens.accentSoft : "transparent" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = isSelected ? tokens.accentSoft : tokens.bg)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = isSelected ? tokens.accentSoft : "transparent")}
                >
                  {showSelection && (
                    <td style={{ ...tdStyle, width: 44, textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => toggleOne(l.id)}
                        aria-label={isSelected ? "Odznacz" : "Zaznacz"}
                        style={{ background: "none", border: "none", cursor: "pointer", display: "grid", placeItems: "center", padding: 0 }}
                      >
                        {isSelected ? <CheckSquare size={17} color={tokens.accent} /> : <Square size={17} color={tokens.muted} />}
                      </button>
                    </td>
                  )}
                  {visibleColumns.map((col) => (
                    <td key={col.key} style={{ ...tdStyle, width: col.width, maxWidth: col.width }}>
                      {renderCell(l, col.key, stageMeta, viewByKey)}
                    </td>
                  ))}
                </tr>
              );
            })}
            {paginated.length === 0 && (
              <tr>
                <td colSpan={visibleColumns.length + (showSelection ? 1 : 0)} style={{ padding: 40, textAlign: "center", color: tokens.muted }}>
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
            Pokazano {(safePage - 1) * pageSize + 1} – {Math.min(safePage * pageSize, sortedLeads.length)} z {sortedLeads.length}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              disabled={safePage === 1}
              onClick={() => setPage(safePage - 1)}
              style={{ ...ghostButton, padding: "4px 10px", fontSize: 12, opacity: safePage === 1 ? 0.5 : 1 }}
            >
              Poprzednia
            </button>
            <button
              disabled={safePage === totalPages}
              onClick={() => setPage(safePage + 1)}
              style={{ ...ghostButton, padding: "4px 10px", fontSize: 12, opacity: safePage === totalPages ? 0.5 : 1 }}
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

function getVal(d: Deal, key: string, viewByKey: Map<string, PropertyView>): string | number {
  if (key === "value") return Number(d.value || 0);
  if (key === "opened_at") return new Date(d.opened_at).getTime();
  const view = viewByKey.get(key);
  if (view) {
    const v = readPropValue(d as unknown as Record<string, unknown>, view);
    if (view.type === "multi_select") return asArray(v).join(",");
    return v == null ? "" : String(v);
  }
  if (key in d) return ((d as unknown as Record<string, unknown>)[key] as string | number) || "";
  const pv = d.props?.[key];
  return pv == null ? "" : String(pv);
}

function renderCell(
  d: Deal,
  key: string,
  stageMeta: (k: string) => { color: string; label: string },
  viewByKey: Map<string, PropertyView>
) {
  const view = viewByKey.get(key);
  if (view) return <PropertyValueDisplay view={view} value={readPropValue(d as unknown as Record<string, unknown>, view)} />;
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
  if (key in d) {
    const v = (d as unknown as Record<string, unknown>)[key];
    return v == null || v === "" ? "—" : String(v);
  }
  const pv = d.props?.[key];
  return pv == null || pv === "" ? "—" : String(pv);
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
