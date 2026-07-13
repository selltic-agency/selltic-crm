// components/ProspectTable.tsx — widok TABELI dla Prospectingu. Odwzorowuje
// wzorzec z components/LeadTable.tsx (sortowalne nagłówki, hover wiersza,
// paginacja, poziome przewijanie na wąskich ekranach) oraz wzorzec zaznaczania
// z zakładki Scraper → Leady (checkbox per wiersz + „Zaznacz wszystkie” +
// akcja zbiorcza). Obsługuje archiwizację (miękkie usunięcie) pojedynczo i
// zbiorczo, a w trybie archiwum — przywracanie.
"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronUp, ChevronDown, CheckSquare, Square, Archive, RotateCcw } from "lucide-react";
import { tokens, formatDateTime } from "@/lib/ui";
import type { Prospect } from "@/lib/types";
import { ScoreBadge } from "@/components/ScoreBreakdown";
import { CategoryBadge, PurposeBadges } from "@/components/ClassificationBadges";
import { STATUS_LABEL, STATUS_COLOR, toDisplayStatus } from "@/lib/prospectStatus";
import { asArray, readPropValue, type PropertyView } from "@/lib/properties";
import { PropertyValueDisplay } from "@/components/PropertyFields";
import BulkEditBar from "@/components/BulkEditBar";

const WEBSITE_STATUS_LABEL: Record<string, string> = {
  none: "Brak strony",
  active: "Aktywna",
  broken: "Zepsuta",
  slow: "Wolna",
};

export type SortConfig = { key: string; direction: "asc" | "desc" };

const COLUMNS: { key: string; label: string; width: number }[] = [
  { key: "name", label: "Nazwa", width: 200 },
  { key: "category", label: "Kategoria", width: 175 },
  { key: "purposes", label: "Cel kontaktu", width: 165 },
  { key: "industry", label: "Branża", width: 150 },
  { key: "phone", label: "Telefon", width: 140 },
  { key: "website_status", label: "Strona", width: 120 },
  { key: "rating", label: "Ocena", width: 110 },
  { key: "lead_score", label: "Score", width: 90 },
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
}) {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const pageSize = 25;

  // Kolumny własnych właściwości dokładamy po stałych; systemowe (kategoria/cel)
  // mają już swoje stałe kolumny z badge'ami.
  const customViews = useMemo(() => properties.filter((p) => !p.system), [properties]);
  const viewByKey = useMemo(() => new Map(customViews.map((v) => [v.key, v])), [customViews]);
  const columns = useMemo(
    () => [...COLUMNS, ...customViews.map((v) => ({ key: v.key, label: v.label, width: 160 }))],
    [customViews]
  );

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
      // Brak wartości (np. lead score dla nieocenionego leada) zawsze na dole,
      // niezależnie od kierunku sortowania — nieocenione nie wypływają na górę.
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
  // Trzymaj bieżącą stronę w zakresie, gdy zmieni się liczba wyników (filtry).
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
    <div style={{ background: tokens.card, border: `1px solid ${tokens.border}`, borderRadius: 16, overflow: "hidden" }}>
      {/* Pasek akcji zbiorczych */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 10,
          padding: "12px 16px",
          borderBottom: `1px solid ${tokens.border}`,
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
            fontSize: 13,
            fontWeight: 600,
            opacity: prospects.length === 0 ? 0.5 : 1,
          }}
        >
          {allSelected ? <CheckSquare size={17} color={tokens.accent} /> : <Square size={17} color={tokens.muted} />}
          Zaznacz wszystkie
        </button>

        {/* Akcja zbiorcza: ustaw dowolną właściwość (poza Archiwum). */}
        {!archiveMode && onBulkEdit && (
          <BulkEditBar properties={properties} count={selected.size} onApply={runBulkEdit} />
        )}

        <div style={{ flex: 1, minWidth: 8 }} />
        <button
          onClick={bulkAction}
          disabled={selected.size === 0}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "7px 14px",
            borderRadius: 10,
            border: `1px solid ${tokens.border}`,
            background: tokens.card,
            color: tokens.text,
            fontSize: 13,
            fontWeight: 600,
            cursor: selected.size === 0 ? "default" : "pointer",
            opacity: selected.size === 0 ? 0.5 : 1,
          }}
        >
          {archiveMode ? <RotateCcw size={15} /> : <Archive size={15} />}
          {archiveMode ? `Przywróć zaznaczone (${selected.size})` : `Archiwizuj zaznaczone (${selected.size})`}
        </button>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1200 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${tokens.border}`, background: tokens.bg }}>
              <th style={{ padding: "12px 16px", width: 44 }} />
              {columns.map((col) => (
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
              <th style={{ padding: "12px 16px", width: 56 }} />
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
                    borderBottom: `1px solid ${tokens.border}`,
                    cursor: "pointer",
                    transition: "background 0.15s ease",
                    background: isSelected ? tokens.accentSoft : "transparent",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = isSelected ? tokens.accentSoft : tokens.bg)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = isSelected ? tokens.accentSoft : "transparent")}
                >
                  <td style={{ ...tdStyle, width: 44, textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => toggleOne(p.id)}
                      aria-label={isSelected ? "Odznacz" : "Zaznacz"}
                      style={{ background: "none", border: "none", cursor: "pointer", display: "grid", placeItems: "center", padding: 0 }}
                    >
                      {isSelected ? <CheckSquare size={17} color={tokens.accent} /> : <Square size={17} color={tokens.muted} />}
                    </button>
                  </td>
                  {columns.map((col) => (
                    <td key={col.key} style={{ ...tdStyle, width: col.width, maxWidth: col.width }}>
                      {renderCell(p, col.key, viewByKey)}
                    </td>
                  ))}
                  <td style={{ ...tdStyle, width: 56, textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => (archiveMode ? onRestore?.([p.id]) : onArchive?.([p.id]))}
                      title={archiveMode ? "Przywróć" : "Archiwizuj"}
                      aria-label={archiveMode ? "Przywróć prospekt" : "Archiwizuj prospekt"}
                      style={{
                        background: "none",
                        border: `1px solid ${tokens.border}`,
                        borderRadius: 8,
                        cursor: "pointer",
                        color: tokens.muted,
                        display: "grid",
                        placeItems: "center",
                        width: 30,
                        height: 30,
                        margin: "0 auto",
                      }}
                    >
                      {archiveMode ? <RotateCcw size={15} /> : <Archive size={15} />}
                    </button>
                  </td>
                </tr>
              );
            })}
            {paginated.length === 0 && (
              <tr>
                <td colSpan={columns.length + 2} style={{ padding: 40, textAlign: "center", color: tokens.muted }}>
                  {archiveMode ? "Archiwum jest puste." : "Brak prospektów spełniających kryteria."}
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
            Pokazano {(safePage - 1) * pageSize + 1} – {Math.min(safePage * pageSize, sorted.length)} z {sorted.length}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              disabled={safePage === 1}
              onClick={() => setPage(safePage - 1)}
              style={{ ...pagerBtn, opacity: safePage === 1 ? 0.5 : 1 }}
            >
              Poprzednia
            </button>
            <button
              disabled={safePage === totalPages}
              onClick={() => setPage(safePage + 1)}
              style={{ ...pagerBtn, opacity: safePage === totalPages ? 0.5 : 1 }}
            >
              Następna
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function getVal(p: Prospect, key: string, viewByKey: Map<string, PropertyView>): string | number | null {
  // null → komparator umieszcza wiersz na dole (nieoceniony lead niezależnie
  // od kierunku sortowania), zamiast wiązać jego pozycję z asc/desc.
  if (key === "lead_score") return p.lead_score ?? null;
  if (key === "rating") return p.rating ?? -1;
  if (key === "created_at") return new Date(p.created_at).getTime();
  if (key === "prospecting_status") return STATUS_LABEL[toDisplayStatus(p.prospecting_status)];
  if (key === "website_status") return p.website_status ?? "";
  if (key === "category") return p.category ?? "";
  if (key === "purposes") return (p.purposes ?? []).join(",");
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
  if (key === "rating") return p.rating != null ? `⭐ ${p.rating} (${p.review_count ?? 0})` : "—";
  if (key === "created_at") return formatDateTime(p.created_at);
  if (key === "website_status") {
    if (!p.website_status) return "—";
    return WEBSITE_STATUS_LABEL[p.website_status] ?? p.website_status;
  }
  if (key === "prospecting_status") {
    const s = toDisplayStatus(p.prospecting_status);
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_COLOR[s], flexShrink: 0 }} />
        {STATUS_LABEL[s]}
      </div>
    );
  }
  const v = (p as unknown as Record<string, unknown>)[key];
  return v != null && v !== "" ? String(v) : "—";
}

const tdStyle: React.CSSProperties = {
  padding: "14px 16px",
  fontSize: 14,
  color: tokens.text,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const pagerBtn: React.CSSProperties = {
  padding: "4px 10px",
  fontSize: 12,
  borderRadius: 10,
  border: `1px solid ${tokens.border}`,
  background: tokens.card,
  cursor: "pointer",
  color: tokens.text,
};
