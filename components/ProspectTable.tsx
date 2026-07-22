// components/ProspectTable.tsx — tabela Prospectingu (Attio-style: gęsta,
// subtelne obrysy). Kolumny (widoczność + kolejność) są KONTROLOWANE przez
// stronę — pochodzą z konfiguracji aktywnego zapisanego widoku. Zaznaczanie
// wierszy + akcje zbiorcze zintegrowane w pasku nad tabelą.
"use client";

import { useEffect, useMemo, useState } from "react";
import { tokens, formatDateTime, thStyle, tdStyle, ghostButton } from "@/lib/ui";
import type { Prospect } from "@/lib/types";
import { ScoreBadge } from "@/components/ScoreBreakdown";
import { CategoryBadge, PurposeBadges } from "@/components/ClassificationBadges";
import { STATUS_LABEL, STATUS_COLOR, displayStatusOf } from "@/lib/prospectStatus";
import { attemptsFromProps } from "@/lib/prospectHistory";
import { asArray, readPropValue, type PropertyView } from "@/lib/properties";
import { PropertyValueDisplay } from "@/components/PropertyFields";
import BulkEditBar from "@/components/BulkEditBar";
import EmptyState from "@/components/EmptyState";
import MIcon from "@/components/MaterialIcon";

const WEBSITE_STATUS_LABEL: Record<string, string> = {
  none: "Brak strony",
  active: "Aktywna",
  broken: "Zepsuta",
  slow: "Wolna",
};

export type SortConfig = { key: string; direction: "asc" | "desc" };

// Kolumny wbudowane — słownik dostępnych (strona buduje z niego konfigurację).
export const PROSPECT_COLUMNS: { key: string; label: string; width: number }[] = [
  { key: "name", label: "Nazwa", width: 200 },
  { key: "category", label: "Kategoria", width: 175 },
  { key: "purposes", label: "Cel kontaktu", width: 165 },
  { key: "industry", label: "Branża", width: 150 },
  { key: "phone", label: "Telefon", width: 140 },
  { key: "website_status", label: "Strona", width: 120 },
  { key: "rating", label: "Ocena", width: 110 },
  { key: "lead_score", label: "Score", width: 90 },
  { key: "contact_attempts", label: "Próby kontaktu", width: 120 },
  { key: "prospecting_status", label: "Status", width: 150 },
  { key: "city", label: "Miasto", width: 130 },
  { key: "created_at", label: "Data", width: 160 },
];

export default function ProspectTable({
  prospects,
  onRowClick,
  sort,
  onSortChange,
  archiveMode = false,
  onArchive,
  onRestore,
  properties = [],
  onBulkEdit,
  columns,
  emptyState,
}: {
  prospects: Prospect[];
  onRowClick: (id: string) => void;
  sort: SortConfig;
  onSortChange: (sort: SortConfig) => void;
  archiveMode?: boolean;
  onArchive?: (ids: string[]) => void;
  onRestore?: (ids: string[]) => void;
  // Właściwości (systemowe + własne) — kolumny dynamiczne + akcja zbiorcza.
  properties?: PropertyView[];
  onBulkEdit?: (ids: string[], view: PropertyView, value: unknown, mode: "replace" | "add") => void | Promise<void>;
  /** Widoczne kolumny w kolejności widoku; brak = domyślny zestaw. */
  columns?: { key: string; label: string; width?: number }[];
  /** Pusty stan (Attio-style) — nagłówek/opis/akcje dobiera strona. */
  emptyState?: React.ReactNode;
}) {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const pageSize = 25;

  const customViews = useMemo(() => properties.filter((p) => !p.system), [properties]);
  const viewByKey = useMemo(() => new Map(customViews.map((v) => [v.key, v])), [customViews]);

  const effectiveColumns = useMemo(() => {
    if (columns && columns.length > 0) return columns.map((c) => ({ width: 150, ...c }));
    return [...PROSPECT_COLUMNS, ...customViews.map((v) => ({ key: v.key, label: v.label, width: 160 }))];
  }, [columns, customViews]);

  // Odznacz wiersze, które zniknęły z listy (zarchiwizowane / przywrócone gdzie indziej).
  useEffect(() => {
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => prospects.some((p) => p.id === id)));
      return next.size === prev.size ? prev : next;
    });
  }, [prospects]);

  const sorted = useMemo(() => {
    const arr = [...prospects].sort((a, b) => {
      const aVal = getVal(a, sort.key, viewByKey);
      const bVal = getVal(b, sort.key, viewByKey);
      // Brak wartości zawsze na dole, niezależnie od kierunku sortowania.
      const aNull = aVal === null || aVal === undefined;
      const bNull = bVal === null || bVal === undefined;
      if (aNull || bNull) return aNull === bNull ? 0 : aNull ? 1 : -1;
      if (aVal === bVal) return 0;
      const res = aVal > bVal ? 1 : -1;
      return sort.direction === "asc" ? res : -res;
    });
    return arr;
  }, [prospects, sort, viewByKey]);

  const totalPages = Math.ceil(sorted.length / pageSize);
  const safePage = Math.min(page, Math.max(1, totalPages));
  const paginated = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  const allSelected = prospects.length > 0 && selected.size === prospects.length;

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(prospects.map((p) => p.id)));
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function bulkAction() {
    if (selected.size === 0) return;
    const ids = [...selected];
    if (archiveMode) onRestore?.(ids);
    else onArchive?.(ids);
    setSelected(new Set());
  }

  async function runBulkEdit(view: PropertyView, value: unknown, mode: "replace" | "add") {
    if (selected.size === 0) return;
    await onBulkEdit?.([...selected], view, value, mode);
    setSelected(new Set());
  }

  function handleSort(key: string) {
    onSortChange({
      key,
      direction: sort.key === key && sort.direction === "asc" ? "desc" : "asc",
    });
    setPage(1);
  }

  return (
    <div style={{ background: tokens.card, border: `1px solid ${tokens.border}`, borderRadius: tokens.radius, overflow: "hidden" }}>
      {/* Pasek zaznaczania + akcji zbiorczych */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
          padding: "7px 12px",
          borderBottom: `1px solid ${tokens.borderSoft}`,
        }}
      >
        <button
          onClick={toggleAll}
          disabled={prospects.length === 0}
          style={{
            background: "none",
            border: "none",
            cursor: prospects.length === 0 ? "default" : "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
            color: tokens.text,
            fontSize: 12.5,
            fontWeight: 500,
            opacity: prospects.length === 0 ? 0.5 : 1,
            padding: 0,
          }}
        >
          <MIcon name={allSelected ? "check_box" : "check_box_outline_blank"} size={17} color={allSelected ? tokens.accent : tokens.muted} />
          Zaznacz wszystkie
        </button>

        {!archiveMode && onBulkEdit && <BulkEditBar properties={properties} count={selected.size} onApply={runBulkEdit} />}

        <div style={{ flex: 1, minWidth: 8 }} />
        <button
          onClick={bulkAction}
          disabled={selected.size === 0}
          style={{ ...ghostButton, fontSize: 12.5, opacity: selected.size === 0 ? 0.5 : 1, cursor: selected.size === 0 ? "default" : "pointer" }}
        >
          <MIcon name={archiveMode ? "restore_from_trash" : "archive"} size={15} />
          {archiveMode ? `Przywróć zaznaczone (${selected.size})` : `Archiwizuj zaznaczone (${selected.size})`}
        </button>
      </div>

      {prospects.length === 0 && emptyState ? (
        emptyState
      ) : (
        <div style={{ overflowX: "auto" }} className="selltic-scroll-x">
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${tokens.border}`, background: tokens.surface }}>
                <th style={{ ...thStyle, width: 40 }} />
                {effectiveColumns.map((col) => (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    style={{ ...thStyle, cursor: "pointer", width: col.width }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      {col.label}
                      {sort.key === col.key && (
                        <MIcon name={sort.direction === "asc" ? "arrow_upward" : "arrow_downward"} size={12} />
                      )}
                    </div>
                  </th>
                ))}
                <th style={{ ...thStyle, width: 52 }} />
              </tr>
            </thead>
            <tbody>
              {paginated.map((p) => {
                const isSelected = selected.has(p.id);
                return (
                  <tr
                    key={p.id}
                    onClick={() => onRowClick(p.id)}
                    style={{
                      borderBottom: `1px solid ${tokens.borderSoft}`,
                      cursor: "pointer",
                      transition: "background 0.12s ease",
                      background: isSelected ? tokens.accentSoft : "transparent",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = isSelected ? tokens.accentSoft : tokens.surface)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = isSelected ? tokens.accentSoft : "transparent")}
                  >
                    <td style={{ ...tdStyle, width: 40, textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => toggleOne(p.id)}
                        aria-label={isSelected ? "Odznacz" : "Zaznacz"}
                        style={{ background: "none", border: "none", cursor: "pointer", display: "grid", placeItems: "center", padding: 0 }}
                      >
                        <MIcon name={isSelected ? "check_box" : "check_box_outline_blank"} size={17} color={isSelected ? tokens.accent : tokens.muted} />
                      </button>
                    </td>
                    {effectiveColumns.map((col) => (
                      <td key={col.key} style={{ ...tdStyle, width: col.width, maxWidth: col.width }}>
                        {renderCell(p, col.key, viewByKey)}
                      </td>
                    ))}
                    <td style={{ ...tdStyle, width: 52, textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => (archiveMode ? onRestore?.([p.id]) : onArchive?.([p.id]))}
                        title={archiveMode ? "Przywróć" : "Archiwizuj"}
                        aria-label={archiveMode ? "Przywróć prospekt" : "Archiwizuj prospekt"}
                        style={{ background: "none", border: "none", borderRadius: 6, cursor: "pointer", color: tokens.muted, display: "grid", placeItems: "center", width: 26, height: 26, margin: "0 auto", padding: 0 }}
                      >
                        <MIcon name={archiveMode ? "restore_from_trash" : "archive"} size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {paginated.length === 0 && (
                <tr>
                  <td colSpan={effectiveColumns.length + 2} style={{ padding: 0 }}>
                    <EmptyState
                      title={archiveMode ? "Archiwum jest puste" : "Brak prospektów w tym widoku"}
                      description={archiveMode ? "Zarchiwizowane prospekty pojawią się tutaj." : "Zmień filtry lub zaimportuj nowe firmy ze Scrapera."}
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
            Pokazano {(safePage - 1) * pageSize + 1} – {Math.min(safePage * pageSize, sorted.length)} z {sorted.length}
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

function getVal(p: Prospect, key: string, viewByKey: Map<string, PropertyView>): string | number | null {
  if (key === "lead_score") return p.lead_score ?? null;
  if (key === "rating") return p.rating ?? -1;
  if (key === "created_at") return new Date(p.created_at).getTime();
  if (key === "prospecting_status") return STATUS_LABEL[displayStatusOf(p)];
  if (key === "website_status") return p.website_status ?? "";
  if (key === "category") return p.category ?? "";
  if (key === "purposes") return (p.purposes ?? []).join(",");
  if (key === "contact_attempts") return attemptsFromProps(p.props);
  const view = viewByKey.get(key);
  if (view) {
    const cv = readPropValue(p as unknown as Record<string, unknown>, view);
    if (view.type === "multi_select") return asArray(cv).join(",");
    return typeof cv === "number" ? cv : cv == null ? "" : String(cv);
  }
  const v = (p as unknown as Record<string, unknown>)[key];
  return typeof v === "number" ? v : (v as string) ?? "";
}

function renderCell(p: Prospect, key: string, viewByKey: Map<string, PropertyView>) {
  const view = viewByKey.get(key);
  if (view) return <PropertyValueDisplay view={view} value={readPropValue(p as unknown as Record<string, unknown>, view)} />;
  if (key === "name") return <span style={{ fontWeight: 600 }}>{p.name || "—"}</span>;
  if (key === "category") return <CategoryBadge categoryKey={p.category} size="sm" />;
  if (key === "purposes") return <PurposeBadges purposeKeys={p.purposes} size="sm" />;
  if (key === "lead_score")
    return <ScoreBadge score={p.lead_score} breakdown={p.lead_score_breakdown} fallbackReasons={p.props?.score_reasons} />;
  if (key === "contact_attempts") {
    const n = attemptsFromProps(p.props);
    return n > 0 ? <span style={{ fontWeight: 600, color: tokens.warning }}>{n}</span> : <span style={{ color: tokens.muted }}>0</span>;
  }
  if (key === "rating")
    return p.rating != null ? (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <MIcon name="star" size={13} fill color={tokens.warning} /> {p.rating} ({p.review_count ?? 0})
      </span>
    ) : (
      "—"
    );
  if (key === "created_at") return formatDateTime(p.created_at);
  if (key === "website_status") {
    if (!p.website_status) return "—";
    return WEBSITE_STATUS_LABEL[p.website_status] ?? p.website_status;
  }
  if (key === "prospecting_status") {
    const s = displayStatusOf(p);
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: STATUS_COLOR[s], flexShrink: 0 }} />
        {STATUS_LABEL[s]}
      </div>
    );
  }
  const v = (p as unknown as Record<string, unknown>)[key];
  return v != null && v !== "" ? String(v) : "—";
}
