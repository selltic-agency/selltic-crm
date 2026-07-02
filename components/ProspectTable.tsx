// components/ProspectTable.tsx — widok TABELI dla Prospectingu. Odwzorowuje
// wzorzec z components/LeadTable.tsx (sortowalne nagłówki, hover wiersza,
// paginacja, poziome przewijanie na wąskich ekranach), ale na typie Prospect
// i ze stałym zestawem kolumn właściwych dla zimnych leadów z Google Maps.
"use client";

import { useMemo, useState } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import { tokens, formatDateTime } from "@/lib/ui";
import type { Prospect } from "@/lib/types";
import { ScoreBadge } from "@/components/ScoreBreakdown";
import { STATUS_LABEL, STATUS_COLOR, toDisplayStatus } from "@/lib/prospectStatus";

const WEBSITE_STATUS_LABEL: Record<string, string> = {
  none: "Brak strony",
  active: "Aktywna",
  broken: "Zepsuta",
  slow: "Wolna",
};

type SortConfig = { key: string; direction: "asc" | "desc" };

const COLUMNS: { key: string; label: string; width: number }[] = [
  { key: "name", label: "Nazwa", width: 200 },
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
}: {
  prospects: Prospect[];
  onRowClick: (id: string) => void;
}) {
  const [sort, setSort] = useState<SortConfig>({ key: "lead_score", direction: "desc" });
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const sorted = useMemo(() => {
    const arr = [...prospects].sort((a, b) => {
      const aVal = getVal(a, sort.key);
      const bVal = getVal(b, sort.key);
      if (aVal === bVal) return 0;
      const res = aVal > bVal ? 1 : -1;
      return sort.direction === "asc" ? res : -res;
    });
    return arr;
  }, [prospects, sort]);

  const totalPages = Math.ceil(sorted.length / pageSize);
  // Trzymaj bieżącą stronę w zakresie, gdy zmieni się liczba wyników (filtry).
  const safePage = Math.min(page, Math.max(1, totalPages));
  const paginated = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  function handleSort(key: string) {
    setSort((prev) => ({
      key,
      direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc",
    }));
    setPage(1);
  }

  return (
    <div style={{ background: tokens.card, border: `1px solid ${tokens.border}`, borderRadius: 16, overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${tokens.border}`, background: tokens.bg }}>
              {COLUMNS.map((col) => (
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
            {paginated.map((p) => (
              <tr
                key={p.id}
                onClick={() => onRowClick(p.id)}
                style={{ borderBottom: `1px solid ${tokens.border}`, cursor: "pointer", transition: "background 0.15s ease" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = tokens.bg)}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                {COLUMNS.map((col) => (
                  <td key={col.key} style={{ ...tdStyle, width: col.width, maxWidth: col.width }}>
                    {renderCell(p, col.key)}
                  </td>
                ))}
              </tr>
            ))}
            {paginated.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} style={{ padding: 40, textAlign: "center", color: tokens.muted }}>
                  Brak prospektów spełniających kryteria.
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

function getVal(p: Prospect, key: string): string | number {
  if (key === "lead_score") return p.lead_score ?? -1;
  if (key === "rating") return p.rating ?? -1;
  if (key === "created_at") return new Date(p.created_at).getTime();
  if (key === "prospecting_status") return STATUS_LABEL[toDisplayStatus(p.prospecting_status)];
  if (key === "website_status") return p.website_status ?? "";
  const v = (p as unknown as Record<string, unknown>)[key];
  return typeof v === "number" ? v : (v as string) ?? "";
}

function renderCell(p: Prospect, key: string) {
  if (key === "name") return <span style={{ fontWeight: 600 }}>{p.name || "—"}</span>;
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
