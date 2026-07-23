// app/admin/submissions/page.tsx — GLOBALNA zakładka „Zgłoszenia" w stylu
// zakładki Leady: zapisane widoki (zakładki), filtry, konfigurowalne kolumny,
// sortowalna tabela. Źródło: form_sessions (ukończone + niekompletne) złączone
// z formularzem i — dla ukończonych — z dealem. Wiersz otwiera szufladę ze
// szczegółami; przy ukończonych jest skok do deala.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { tokens, pageTitle, formatRelative } from "@/lib/ui";
import { useStages } from "@/lib/stages";
import type { Stage } from "@/lib/types";
import { dropOffLabel } from "@/lib/formSessions";
import type { Filter } from "@/lib/filters";
import type { FieldDef } from "@/components/FilterBar";
import { useSavedViews, type ColumnPref, type ViewConfig } from "@/lib/savedViews";
import MIcon from "@/components/MaterialIcon";
import EmptyState from "@/components/EmptyState";
import ViewTabs from "@/components/ViewTabs";
import FilterButton from "@/components/views/FilterButton";
import ViewSettingsButton from "@/components/views/ViewSettingsButton";
import SubmissionDrawer, { type SubmissionDetail, attributionSummary } from "@/components/forms/SubmissionDrawer";

const AMBER = "#F2994A";

type SubRow = {
  sessionId: string;
  status: "completed" | "incomplete";
  when: string;
  formId: string | null;
  formTitle: string;
  answers: Record<string, unknown>;
  meta: Record<string, unknown>;
  lastStep: number;
  totalSteps: number;
  dealId: string | null;
  dealName: string | null;
  dealStage: string | null;
};

type SortKey = "when" | "status" | "form" | "contact" | "source";
type Sort = { key: SortKey; dir: "asc" | "desc" };

// Kolumny konfigurowalne (pierwsza „Kiedy" jest przypięta).
const COLUMN_DEFS: { key: string; label: string; sort?: SortKey }[] = [
  { key: "status", label: "Status", sort: "status" },
  { key: "form", label: "Formularz", sort: "form" },
  { key: "contact", label: "Kontakt", sort: "contact" },
  { key: "source", label: "Źródło", sort: "source" },
  { key: "dropoff", label: "Krok porzucenia" },
  { key: "deal", label: "Deal" },
];
const COLUMN_LABELS: Record<string, string> = Object.fromEntries(COLUMN_DEFS.map((c) => [c.key, c.label]));

function defaultColumnPrefs(): ColumnPref[] {
  return COLUMN_DEFS.map((c, i) => ({ key: c.key, visible: true, position: i }));
}

function contactOf(answers: Record<string, unknown>): string {
  const vals = Object.values(answers).flatMap((v) => (Array.isArray(v) ? v.map(String) : [String(v)]));
  const email = vals.find((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v));
  const phone = vals.find((v) => /^\+?\d[\d\s-]{6,}$/.test(v));
  const text = vals.find((v) => v.trim() && v.length <= 60);
  return text || email || phone || "";
}

export default function SubmissionsPage() {
  const supabase = useMemo(() => createClient(), []);
  const { stageMeta } = useStages();

  const [rows, setRows] = useState<SubRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<SubmissionDetail | null>(null);

  const [filters, setFilters] = useState<Filter[]>([]);
  const [sort, setSort] = useState<Sort>({ key: "when", dir: "desc" });
  const [columnPrefs, setColumnPrefs] = useState<ColumnPref[] | null>(null);

  const {
    views, activeId, activeView, loading: viewsLoading, storage: viewsStorage, error: viewsError,
    selectView, createView, updateView, duplicateView, deleteView, moveView,
  } = useSavedViews("submissions");
  const customViews = useMemo(() => views.filter((v) => !v.is_default).sort((a, b) => a.position - b.position), [views]);

  // ── Autosave zmian na aktywnym widoku ───────────────────────────────────
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosave = useCallback(
    (patch: Partial<{ filters: Filter[]; config: ViewConfig }>) => {
      if (!activeView) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const id = activeView.id;
      saveTimer.current = setTimeout(() => updateView(id, patch), 450);
    },
    [activeView, updateView]
  );

  const changeFilters = useCallback((next: Filter[]) => { setFilters(next); autosave({ filters: next }); }, [autosave]);
  const changeColumns = useCallback(
    (next: ColumnPref[]) => { setColumnPrefs(next); autosave({ config: { ...(activeView?.config ?? {}), columns: next } }); },
    [autosave, activeView]
  );

  const applyViewState = useCallback((filters_: Filter[], config?: ViewConfig) => {
    setFilters(filters_);
    setColumnPrefs(config?.columns && config.columns.length > 0 ? config.columns : null);
  }, []);

  const handleSelectView = (id: string) => {
    selectView(id);
    const v = views.find((x) => x.id === id);
    if (v) applyViewState(v.filters, v.config);
  };
  const handleSelectAll = useCallback(() => { selectView(null); applyViewState([], undefined); }, [selectView, applyViewState]);
  const adhoc = !activeView && (filters.length > 0 || columnPrefs !== null);

  // ── Kolumny ─────────────────────────────────────────────────────────────
  const fullColumnPrefs = useMemo<ColumnPref[]>(() => {
    const base = columnPrefs ?? defaultColumnPrefs();
    const known = new Set(base.map((c) => c.key));
    const missing = COLUMN_DEFS.filter((c) => !known.has(c.key)).map((c, i) => ({ key: c.key, visible: false, position: base.length + i }));
    return [...base, ...missing].filter((c) => COLUMN_LABELS[c.key]).sort((a, b) => a.position - b.position);
  }, [columnPrefs]);
  const visibleColumns = useMemo(
    () => fullColumnPrefs.filter((c) => c.visible).map((c) => COLUMN_DEFS.find((d) => d.key === c.key)!),
    [fullColumnPrefs]
  );

  // ── Dane ─────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("form_sessions")
      .select("id, status, started_at, completed_at, last_step, total_steps, answers, meta, form_id, forms(title), submissions(deal_id, deals(id, name, email, stage))")
      .in("status", ["completed", "abandoned", "started"])
      .order("started_at", { ascending: false })
      .limit(1000);
    type Raw = {
      id: string; status: string; started_at: string; completed_at: string | null;
      last_step: number; total_steps: number; answers: Record<string, unknown>; meta: Record<string, unknown>;
      form_id: string | null; forms: { title: string } | null;
      submissions: { deal_id: string | null; deals: { id: string; name: string | null; email: string | null; stage: string } | null } | null;
    };
    const mapped: SubRow[] = ((data as unknown as Raw[]) ?? []).map((r) => {
      const deal = r.submissions?.deals ?? null;
      return {
        sessionId: r.id,
        status: r.status === "completed" ? "completed" : "incomplete",
        when: r.completed_at || r.started_at,
        formId: r.form_id,
        formTitle: r.forms?.title || "Usunięty formularz",
        answers: r.answers || {},
        meta: r.meta || {},
        lastStep: r.last_step ?? 0,
        totalSteps: r.total_steps ?? 0,
        dealId: deal?.id ?? null,
        dealName: deal?.name || deal?.email || null,
        dealStage: deal?.stage ?? null,
      };
    });
    setRows(mapped);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  // Opcje filtra „Formularz" z załadowanych danych.
  const formOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) if (r.formId) m.set(r.formId, r.formTitle);
    return Array.from(m, ([key, label]) => ({ key, label }));
  }, [rows]);

  const filterFields = useMemo<FieldDef[]>(() => [
    { key: "status", label: "Status", type: "select", options: [{ key: "completed", label: "Ukończone" }, { key: "incomplete", label: "Niekompletne" }] },
    { key: "form", label: "Formularz", type: "select", options: formOptions },
    { key: "source", label: "Źródło", type: "text" },
    { key: "when", label: "Data zgłoszenia", type: "date" },
  ], [formOptions]);

  const filtered = useMemo(() => rows.filter((r) => matches(r, filters)), [rows, filters]);

  const sorted = useMemo(() => {
    const val = (r: SubRow): string | number => {
      switch (sort.key) {
        case "when": return new Date(r.when).getTime();
        case "status": return r.status === "completed" ? 1 : 0;
        case "form": return r.formTitle.toLowerCase();
        case "contact": return contactOf(r.answers).toLowerCase();
        case "source": return attributionSummary(r.meta).label.toLowerCase();
        default: return 0;
      }
    };
    return [...filtered].sort((a, b) => {
      const av = val(a), bv = val(b);
      if (av === bv) return 0;
      const res = av > bv ? 1 : -1;
      return sort.dir === "asc" ? res : -res;
    });
  }, [filtered, sort]);

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));
  }

  function openRow(r: SubRow) {
    setOpen({
      sessionId: r.sessionId, formId: r.formId, formTitle: r.formTitle, status: r.status, when: r.when,
      answers: r.answers, meta: r.meta, lastStep: r.lastStep, totalSteps: r.totalSteps,
      dealId: r.dealId, dealName: r.dealName,
    });
  }

  const counts = useMemo(() => ({
    all: rows.length,
    completed: rows.filter((r) => r.status === "completed").length,
    incomplete: rows.filter((r) => r.status !== "completed").length,
  }), [rows]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, gap: 10, flexWrap: "wrap" }}>
        <h1 style={pageTitle}>Zgłoszenia</h1>
        <div style={{ display: "flex", gap: 8, fontSize: 12.5, color: tokens.muted }}>
          <Pill label="Ukończone" value={counts.completed} color={tokens.success} />
          <Pill label="Niekompletne" value={counts.incomplete} color={AMBER} />
        </div>
      </div>

      <ViewTabs
        views={customViews}
        activeId={activeId}
        adhoc={adhoc}
        loading={viewsLoading}
        storage={viewsStorage}
        error={viewsError}
        onSelectAll={handleSelectAll}
        onSelectView={handleSelectView}
        onCreate={(name) => createView(name, { filters, sort: null, view_mode: "table", config: { columns: fullColumnPrefs } })}
        onRename={(id, name) => updateView(id, { name })}
        onDuplicate={duplicateView}
        onDelete={deleteView}
        onMove={moveView}
      />

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <FilterButton fields={filterFields} filters={filters} onChange={changeFilters} />
        <div style={{ flex: 1 }} />
        <ViewSettingsButton viewMode="table" columns={fullColumnPrefs} columnLabels={COLUMN_LABELS} onColumnsChange={changeColumns} />
      </div>

      {loading ? (
        <p style={{ color: tokens.muted, fontSize: 13 }}>Wczytywanie…</p>
      ) : sorted.length === 0 ? (
        <div style={{ background: tokens.card, border: `1px solid ${tokens.border}`, borderRadius: tokens.radius }}>
          <EmptyState
            title={rows.length === 0 ? "Brak zgłoszeń" : "Brak zgłoszeń w tym widoku"}
            description={rows.length === 0 ? "Wypełnienia opublikowanych formularzy (ukończone i porzucone) pojawią się tutaj automatycznie." : "Zmień filtry, aby zobaczyć więcej."}
          />
        </div>
      ) : (
        <div style={{ background: tokens.card, border: `1px solid ${tokens.border}`, borderRadius: tokens.radius, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }} className="selltic-scroll-x">
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${tokens.border}`, background: tokens.bg }}>
                  <SortHeader label="Kiedy" k="when" sort={sort} onSort={toggleSort} />
                  {visibleColumns.map((c) => (
                    <SortHeader key={c.key} label={c.label} k={c.sort} sort={sort} onSort={c.sort ? toggleSort : undefined} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr
                    key={r.sessionId}
                    onClick={() => openRow(r)}
                    style={{ borderBottom: `1px solid ${tokens.border}`, cursor: "pointer" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = tokens.bg)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <td style={td}>{formatRelative(r.when)}</td>
                    {visibleColumns.map((c) => (
                      <td key={c.key} style={td}>{cell(r, c.key, (s) => stageMeta(s as Stage))}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {open && <SubmissionDrawer detail={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

// Klient-side ewaluacja filtrów (dane są łączone z kilku źródeł).
function matches(r: SubRow, filters: Filter[]): boolean {
  return filters.every((f) => {
    switch (f.field) {
      case "status": {
        const v = f.value as string[];
        return !v?.length || v.includes(r.status);
      }
      case "form": {
        const v = f.value as string[];
        return !v?.length || (!!r.formId && v.includes(r.formId));
      }
      case "source": {
        const q = String(f.value || "").toLowerCase().trim();
        if (!q) return true;
        return attributionSummary(r.meta).label.toLowerCase().includes(q);
      }
      case "when": {
        const t = new Date(r.when).getTime();
        if (f.operator === "after") return !f.value || t >= new Date(f.value).getTime();
        if (f.operator === "before") return !f.value || t <= new Date(f.value).getTime();
        if (f.operator === "last_n_days") { const d = parseInt(f.value); return isNaN(d) ? true : t >= Date.now() - d * 86_400_000; }
        if (f.operator === "between" && Array.isArray(f.value)) {
          const [a, b] = f.value;
          return (!a || t >= new Date(a).getTime()) && (!b || t <= new Date(b).getTime());
        }
        return true;
      }
      default:
        return true;
    }
  });
}

function cell(r: SubRow, key: string, stageMeta: (s: string) => { label: string; color: string }): React.ReactNode {
  switch (key) {
    case "status":
      return r.status === "completed" ? (
        <span style={{ fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: "#E7F7EE", color: tokens.success }}>Ukończone</span>
      ) : (
        <span style={{ fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: "#FDF1E3", color: AMBER }}>Niekompletne</span>
      );
    case "form":
      return <span style={{ fontWeight: 500 }}>{r.formTitle}</span>;
    case "contact":
      return contactOf(r.answers) || <span style={{ color: tokens.muted }}>—</span>;
    case "source": {
      const a = attributionSummary(r.meta);
      return (
        <span style={{ maxWidth: 180, display: "inline-block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "bottom", fontWeight: a.fromAd ? 700 : 500, color: a.fromAd ? tokens.accent : tokens.muted }} title={a.label}>
          {a.fromAd ? "📣 " : ""}{a.label}
        </span>
      );
    }
    case "dropoff":
      return r.status !== "completed" ? (
        <span style={{ color: AMBER, fontWeight: 600 }}>{dropOffLabel(r.lastStep, r.totalSteps)}</span>
      ) : (
        <span style={{ color: tokens.muted }}>—</span>
      );
    case "deal":
      return r.dealId ? (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: tokens.accent, fontWeight: 500 }}>
          {r.dealStage && <span style={{ width: 7, height: 7, borderRadius: "50%", background: stageMeta(r.dealStage).color }} />}
          {r.dealName || "Deal"}
          <MIcon name="open_in_new" size={12} />
        </span>
      ) : (
        <span style={{ color: tokens.muted }}>—</span>
      );
    default:
      return null;
  }
}

function Pill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999, background: tokens.bg, border: `1px solid ${tokens.border}` }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: color }} />
      {label} <strong style={{ color: tokens.text }}>{value}</strong>
    </span>
  );
}

function SortHeader({ label, k, sort, onSort }: { label: string; k?: SortKey; sort: Sort; onSort?: (k: SortKey) => void }) {
  const clickable = !!k && !!onSort;
  return (
    <th
      onClick={() => k && onSort?.(k)}
      style={{ textAlign: "left", padding: "12px 16px", fontSize: 12, fontWeight: 700, color: tokens.muted, cursor: clickable ? "pointer" : "default", whiteSpace: "nowrap", userSelect: "none" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {label.toUpperCase()}
        {k && sort.key === k && <MIcon name={sort.dir === "asc" ? "arrow_upward" : "arrow_downward"} size={12} />}
      </div>
    </th>
  );
}

const td: React.CSSProperties = { padding: "13px 16px", fontSize: 14, color: tokens.text, whiteSpace: "nowrap" };
