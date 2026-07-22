// components/LeadTable.tsx — tabela DEALÓW (Attio-style). Kolumny (widoczność
// + kolejność) są KONTROLOWANE przez stronę — pochodzą z konfiguracji
// aktywnego zapisanego widoku (saved_views.config), nie z globalnej tabeli
// table_view_config. Zaznaczanie wierszy + zbiorcza edycja właściwości.
"use client";

import { useEffect, useMemo, useState } from "react";
import { tokens, formatPLN, formatDateTime, ghostButton, thStyle, tdStyle } from "@/lib/ui";
import { Deal } from "@/lib/types";
import { useStages } from "@/lib/stages";
import { asArray, readPropValue, type PropertyView } from "@/lib/properties";
import { PropertyValueDisplay } from "@/components/PropertyFields";
import BulkEditBar from "@/components/BulkEditBar";
import EmptyState from "@/components/EmptyState";
import MIcon from "@/components/MaterialIcon";

export type SortConfig = {
  key: string;
  direction: "asc" | "desc";
};

// Kolumny wbudowane deala — słownik dostępnych.
export const DEAL_COLUMNS: { key: string; label: string; width: number }[] = [
  { key: "name", label: "Nazwa", width: 180 },
  { key: "company", label: "Firma", width: 150 },
  { key: "email", label: "E-mail", width: 200 },
  { key: "phone", label: "Telefon", width: 130 },
  { key: "stage", label: "Etap", width: 130 },
  { key: "value", label: "Wartość", width: 120 },
  { key: "source", label: "Źródło", width: 120 },
  { key: "opened_at", label: "Otwarto", width: 160 },
];

type LeadTableProps = {
  leads: Deal[];
  onRowClick: (id: string) => void;
  sort?: SortConfig;
  onSortChange?: (sort: SortConfig) => void;
  properties?: PropertyView[];
  onBulkEdit?: (ids: string[], view: PropertyView, value: unknown, mode: "replace" | "add") => void | Promise<void>;
  /** Widoczne kolumny w kolejności widoku; brak = domyślny zestaw. */
  columns?: { key: string; label: string; width?: number }[];
  emptyState?: React.ReactNode;
};

export default function LeadTable({ leads, onRowClick, sort: sortProp, onSortChange, properties = [], onBulkEdit, columns, emptyState }: LeadTableProps) {
  const { stageMeta } = useStages();
  const [internalSort, setInternalSort] = useState<SortConfig>({ key: "opened_at", direction: "desc" });
  const sort = sortProp ?? internalSort;
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const pageSize = 25;

  const viewByKey = useMemo(() => new Map(properties.map((v) => [v.key, v])), [properties]);

  const effectiveColumns = useMemo(() => {
    if (columns && columns.length > 0) return columns.map((c) => ({ width: 150, ...c }));
    return [
      ...DEAL_COLUMNS,
      ...properties.filter((v) => v.system).map((v) => ({ key: v.key, label: v.label, width: 160 })),
    ];
  }, [columns, properties]);

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

  const showSelection = !!onBulkEdit;

  return (
    <div style={{ position: "relative" }}>
      {showSelection && (
        <div style={{ padding: "7px 12px", borderBottom: `1px solid ${tokens.borderSoft}`, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <button
            onClick={toggleAll}
            disabled={leads.length === 0}
            style={{ background: "none", border: "none", cursor: leads.length === 0 ? "default" : "pointer", display: "flex", alignItems: "center", gap: 6, color: tokens.text, fontSize: 12.5, fontWeight: 500, opacity: leads.length === 0 ? 0.5 : 1, padding: 0 }}
          >
            <MIcon name={allSelected ? "check_box" : "check_box_outline_blank"} size={17} color={allSelected ? tokens.accent : tokens.muted} />
            Zaznacz wszystkie
          </button>
          <BulkEditBar properties={properties} count={selected.size} onApply={runBulk} />
        </div>
      )}

      {leads.length === 0 && emptyState ? (
        emptyState
      ) : (
        <div style={{ overflowX: "auto" }} className="selltic-scroll-x">
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 800 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${tokens.border}`, background: "#FAFAFB" }}>
                {showSelection && <th style={{ ...thStyle, width: 40 }} />}
                {effectiveColumns.map((col) => (
                  <th key={col.key} onClick={() => handleSort(col.key)} style={{ ...thStyle, cursor: "pointer", width: col.width }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      {col.label}
                      {sort.key === col.key && (
                        <MIcon name={sort.direction === "asc" ? "arrow_upward" : "arrow_downward"} size={12} />
                      )}
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
                    style={{ borderBottom: `1px solid ${tokens.borderSoft}`, cursor: "pointer", transition: "background 0.12s ease", background: isSelected ? tokens.accentSoft : "transparent" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = isSelected ? tokens.accentSoft : "#FAFAFB")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = isSelected ? tokens.accentSoft : "transparent")}
                  >
                    {showSelection && (
                      <td style={{ ...tdStyle, width: 40, textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => toggleOne(l.id)}
                          aria-label={isSelected ? "Odznacz" : "Zaznacz"}
                          style={{ background: "none", border: "none", cursor: "pointer", display: "grid", placeItems: "center", padding: 0 }}
                        >
                          <MIcon name={isSelected ? "check_box" : "check_box_outline_blank"} size={17} color={isSelected ? tokens.accent : tokens.muted} />
                        </button>
                      </td>
                    )}
                    {effectiveColumns.map((col) => (
                      <td key={col.key} style={{ ...tdStyle, width: col.width, maxWidth: col.width }}>
                        {renderCell(l, col.key, stageMeta, viewByKey)}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {paginated.length === 0 && (
                <tr>
                  <td colSpan={effectiveColumns.length + (showSelection ? 1 : 0)} style={{ padding: 0 }}>
                    <EmptyState
                      title="Brak leadów w tym widoku"
                      description="Zmień filtry albo dodaj pierwszego leada."
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div
          style={{
            padding: "8px 12px",
            borderTop: `1px solid ${tokens.borderSoft}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 12.5,
            color: tokens.muted,
          }}
        >
          <div>
            Pokazano {(safePage - 1) * pageSize + 1} – {Math.min(safePage * pageSize, sortedLeads.length)} z {sortedLeads.length}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button disabled={safePage === 1} onClick={() => setPage(safePage - 1)} style={{ ...ghostButton, padding: "3px 9px", fontSize: 12, opacity: safePage === 1 ? 0.5 : 1 }}>
              Poprzednia
            </button>
            <button disabled={safePage === totalPages} onClick={() => setPage(safePage + 1)} style={{ ...ghostButton, padding: "3px 9px", fontSize: 12, opacity: safePage === totalPages ? 0.5 : 1 }}>
              Następna
            </button>
          </div>
        </div>
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
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: meta.color }} />
        {meta.label}
      </div>
    );
  }
  if (key === "value") return formatPLN(d.value);
  if (key === "opened_at") return formatDateTime(d.opened_at);
  if (key === "source") return d.source || "ręcznie";
  if (key === "name")
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontWeight: 600 }}>{d.name || "—"}</span>
        {d.incomplete && (
          <span title="Niekompletny lead (porzucony formularz)" style={{ fontSize: 10, fontWeight: 600, padding: "0 6px", borderRadius: 5, background: "#FDF1E3", color: tokens.warning, lineHeight: "16px" }}>
            NIEKOMPLETNY
          </span>
        )}
      </span>
    );
  if (key in d) {
    const v = (d as unknown as Record<string, unknown>)[key];
    return v == null || v === "" ? "—" : String(v);
  }
  const pv = d.props?.[key];
  return pv == null || pv === "" ? "—" : String(pv);
}
