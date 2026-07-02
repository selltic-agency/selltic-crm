// app/admin/prospecting/page.tsx — Prospecting: zimne leady z Google Maps.
// Widok wyłącznie tabelaryczny (tabela pokrywa wszystko, co dawał widok kart,
// plus więcej kolumn i akcje zbiorcze) + „Tryb dzwonienia” (Tinder-style) do
// szybkiego przechodzenia przez kolejkę telefonów. Baza danych nadal zapisuje
// starą wartość `contact_attempted` (patrz lib/prospectStatus.ts) — to
// wyłącznie kosmetyka UI. Archiwum to miękkie usunięcie (kolumna archived_at).
// Stan widoku (aktywna zakładka, filtry, sortowanie) jest trwały per-user
// (lib/viewPrefs.ts) — przeżywa odświeżenie i nawigację.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Phone } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { tokens } from "@/lib/ui";
import { useToast } from "@/components/Toast";
import type { Prospect } from "@/lib/types";
import ProspectTable, { type SortConfig } from "@/components/ProspectTable";
import {
  DISPLAY_STATUSES,
  STATUS_LABEL,
  STATUS_COLOR,
  toDisplayStatus,
  isCallable,
  dbStatusForWrite,
  notesFromProps,
  type DisplayStatus,
  type WritableDisplayStatus,
} from "@/lib/prospectStatus";
import ProspectDetailDrawer from "@/components/prospecting/ProspectDetailDrawer";
import CallingMode from "@/components/prospecting/CallingMode";
import FilterBar, { type FieldDef, type FilterBarHandle } from "@/components/FilterBar";
import SavedViewTabs from "@/components/SavedViewTabs";
import { Filter, Sort, buildFilterQuery, columnForProspect } from "@/lib/filters";
import { useSavedViews, type SeedView } from "@/lib/savedViews";
import { loadViewPrefs, saveViewPrefs, planHydration } from "@/lib/viewPrefs";

// Zakładka statusu. "" = wszystkie aktywne; "archived" = miękko usunięte.
type StatusTab = DisplayStatus | "" | "archived";

const TABS: { key: StatusTab; label: string }[] = [
  { key: "", label: "Wszystkie" },
  { key: "new", label: "Nowe" },
  { key: "no_answer", label: "Nie odbiera" },
  { key: "converted", label: "Skonwertowane" },
  { key: "not_interested", label: "Niezainteresowane" },
  { key: "archived", label: "Archiwum" },
];

const DEFAULT_SORT: SortConfig = { key: "lead_score", direction: "desc" };

const WEBSITE_STATUS_LABEL: Record<string, string> = {
  none: "Brak strony",
  active: "Aktywna",
  broken: "Zepsuta",
  slow: "Wolna",
};

const PROSPECT_BUILT_IN_FIELDS: FieldDef[] = [
  {
    key: "prospecting_status",
    label: "Status",
    type: "select",
    options: [
      { key: "new", label: STATUS_LABEL.new },
      { key: "contact_attempted", label: STATUS_LABEL.no_answer },
      { key: "not_interested", label: STATUS_LABEL.not_interested },
      { key: "converted", label: STATUS_LABEL.converted },
    ],
  },
  { key: "lead_score", label: "Lead score", type: "number" },
  {
    key: "website_status",
    label: "Status strony",
    type: "select",
    options: Object.entries(WEBSITE_STATUS_LABEL).map(([key, label]) => ({ key, label })),
  },
];

const NO_WEBSITE_QUICK_FILTER: Filter = { field: "website_status", operator: "in", value: ["none"] };

export default function ProspectingPage() {
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();
  const searchParams = useSearchParams();

  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [archivedProspects, setArchivedProspects] = useState<Prospect[]>([]);
  const [loading, setLoading] = useState(true);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const [counts, setCounts] = useState<Record<DisplayStatus, number>>({
    new: 0,
    no_answer: 0,
    not_interested: 0,
    converted: 0,
  });
  const [archivedCount, setArchivedCount] = useState(0);
  const [industries, setIndustries] = useState<string[]>([]);
  const [cities, setCities] = useState<string[]>([]);

  const [statusFilter, setStatusFilter] = useState<StatusTab>("");
  const [filters, setFilters] = useState<Filter[]>([]);
  const [sort, setSort] = useState<Sort | null>(null);
  const filterBarRef = useRef<FilterBarHandle>(null);

  // ID zalogowanego użytkownika — do namespace'owania trwałego stanu widoku.
  // `undefined` = jeszcze nie wiadomo, `null` = brak sesji.
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, [supabase]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [callingMode, setCallingMode] = useState(false);

  const showingArchive = statusFilter === "archived";

  // Kolumny miasta/branży są dynamiczne (zależą od zaimportowanych danych).
  const builtInFields = useMemo<FieldDef[]>(
    () => [
      ...PROSPECT_BUILT_IN_FIELDS,
      { key: "city", label: "Miasto", type: "select", options: cities },
      { key: "industry", label: "Branża", type: "select", options: industries },
    ],
    [cities, industries]
  );

  const seedDefaults = useCallback(async (): Promise<SeedView[]> => {
    return [
      { name: "Wszystkie", view_mode: "table", filters: [], sort: null },
      {
        name: "Do zadzwonienia",
        view_mode: "table",
        filters: [{ field: "prospecting_status", operator: "in", value: ["new", "contact_attempted"] }],
        sort: { column: "lead_score", direction: "desc" },
      },
      {
        name: "Wysokie priorytety",
        view_mode: "table",
        // >= 70: brak operatora "gte" w modelu filtrów, 69 daje ten sam próg dla liczb całkowitych.
        filters: [{ field: "lead_score", operator: "gt", value: 69 }],
        sort: null,
      },
    ];
  }, []);

  const {
    views,
    activeId,
    activeView,
    loading: viewsLoading,
    selectView,
    createView,
    updateView,
    deleteView,
  } = useSavedViews("prospecting", seedDefaults);

  const applyView = useCallback((filters_: Filter[], sort_: Sort | null) => {
    filterBarRef.current?.setFilters(filters_);
    setSort(sort_);
  }, []);

  const handleSelectView = (id: string) => {
    selectView(id);
    const v = views.find((x) => x.id === id);
    if (v) applyView(v.filters, v.sort);
  };

  // ── Hydratacja trwałego stanu widoku ──────────────────────────────────
  // Uruchamiana raz, gdy znamy użytkownika i wczytano zapisane widoki.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (hydrated || viewsLoading || userId === undefined) return;
    // Filtry z URL (?f=…) obejmują zarówno zwykłe odświeżenie (FilterBar sam
    // zapisuje je do URL), jak i udostępniony link. Gdy są obecne, FilterBar
    // odtwarza je samodzielnie z URL — nie nadpisujemy ich z prefs. Zakładkę
    // statusu, sortowanie i aktywny widok odtwarzamy ZAWSZE z prefs (nie ma
    // ich w URL), więc odświeżenie przywraca pełny stan.
    const hasUrlFilters = !!searchParams.get("f");
    const prefs = loadViewPrefs("prospecting", userId);
    const plan = planHydration(prefs, hasUrlFilters);
    if (plan.restoreFromPrefs && prefs) {
      if (prefs.statusFilter !== undefined) setStatusFilter(prefs.statusFilter as StatusTab);
      if (prefs.sort !== undefined) setSort(prefs.sort ?? null);
      if (prefs.activeViewId !== undefined) selectView(prefs.activeViewId);
      if (plan.restoreFiltersFromPrefs) filterBarRef.current?.setFilters(prefs.filters ?? []);
    } else if (plan.clearActiveView) {
      selectView(null);
    } else if (plan.applyDefaultView && activeView) {
      applyView(activeView.filters, activeView.sort);
    }
    setHydrated(true);
  }, [hydrated, viewsLoading, userId, activeView, applyView, searchParams, selectView]);

  // ── Zapis trwałego stanu widoku ───────────────────────────────────────
  useEffect(() => {
    if (!hydrated) return;
    saveViewPrefs("prospecting", userId ?? null, { activeViewId: activeId, statusFilter, filters, sort });
  }, [hydrated, userId, activeId, statusFilter, filters, sort]);

  const isDirty = useMemo(() => {
    if (!activeView) return false;
    return (
      JSON.stringify(filters) !== JSON.stringify(activeView.filters) ||
      JSON.stringify(sort) !== JSON.stringify(activeView.sort ?? null)
    );
  }, [activeView, filters, sort]);

  // Aktywne prospekty (nie zarchiwizowane) — sterowane filtrami i sortowaniem.
  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase.from("prospects").select("*").is("archived_at", null);
    query = buildFilterQuery(query, filters, columnForProspect);
    if (sort) query = query.order(sort.column, { ascending: sort.direction === "asc" });
    else query = query.order("lead_score", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false });

    const { data } = await query;
    setProspects((data as Prospect[]) ?? []);
    setLoading(false);
  }, [supabase, filters, sort]);

  useEffect(() => {
    load();
  }, [load]);

  // Zarchiwizowane prospekty — wczytywane leniwie, gdy otwarto zakładkę Archiwum.
  const loadArchived = useCallback(async () => {
    setArchivedLoading(true);
    let query = supabase.from("prospects").select("*").not("archived_at", "is", null);
    query = buildFilterQuery(query, filters, columnForProspect);
    query = query.order("archived_at", { ascending: false });
    const { data } = await query;
    setArchivedProspects((data as Prospect[]) ?? []);
    setArchivedLoading(false);
  }, [supabase, filters]);

  useEffect(() => {
    if (showingArchive) loadArchived();
  }, [showingArchive, loadArchived]);

  // Dashboard liczników i opcje filtrów — niezależne od aktywnych filtrów.
  const refreshCounts = useCallback(async () => {
    const { data } = await supabase.from("prospects").select("prospecting_status, industry, city, archived_at");
    const rows =
      (data as { prospecting_status: string; industry: string | null; city: string | null; archived_at: string | null }[]) ??
      [];
    const c: Record<DisplayStatus, number> = { new: 0, no_answer: 0, not_interested: 0, converted: 0 };
    let archived = 0;
    for (const r of rows) {
      if (r.archived_at) archived++;
      else c[toDisplayStatus(r.prospecting_status)]++;
    }
    setCounts(c);
    setArchivedCount(archived);
    setIndustries([...new Set(rows.map((r) => r.industry).filter(Boolean))] as string[]);
    setCities([...new Set(rows.map((r) => r.city).filter(Boolean))] as string[]);
  }, [supabase]);

  useEffect(() => {
    refreshCounts();
  }, [refreshCounts]);

  const visible = useMemo(() => {
    if (!statusFilter) return prospects;
    return prospects.filter((p) => toDisplayStatus(p.prospecting_status) === statusFilter);
  }, [prospects, statusFilter]);

  const callableQueue = useMemo(() => prospects.filter(isCallable), [prospects]);

  const tableSort: SortConfig = sort ? { key: sort.column, direction: sort.direction } : DEFAULT_SORT;
  const onTableSortChange = useCallback((s: SortConfig) => setSort({ column: s.key, direction: s.direction }), []);

  // Powrót z konwersji w trybie dzwonienia (?calling=1) — automatycznie wznów
  // sesję z pozostałą kolejką prospektów do zadzwonienia.
  const resumedCalling = useRef(false);
  useEffect(() => {
    if (resumedCalling.current) return;
    if (searchParams.get("calling") !== "1") return;
    if (loading || callableQueue.length === 0) return;
    resumedCalling.current = true;
    setCallingMode(true);
    // Usuń parametr, żeby odświeżenie strony nie otwierało trybu ponownie.
    window.history.replaceState(null, "", "/admin/prospecting");
  }, [searchParams, loading, callableQueue.length]);

  const selected = selectedId
    ? prospects.find((p) => p.id === selectedId) ?? archivedProspects.find((p) => p.id === selectedId) ?? null
    : null;

  async function setStatus(p: Prospect, status: WritableDisplayStatus): Promise<boolean> {
    const dbStatus = dbStatusForWrite(status);
    const res = await fetch(`/api/prospecting/${p.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: dbStatus }),
    });
    if (!res.ok) {
      toast.error("Nie udało się zaktualizować prospektu.");
      return false;
    }
    const updated = await res.json();
    setProspects((list) => list.map((x) => (x.id === p.id ? (updated as Prospect) : x)));
    toast.success("Zaktualizowano.");
    return true;
  }

  async function convertToLead(p: Prospect): Promise<string | null> {
    const res = await fetch(`/api/prospecting/${p.id}/convert-to-lead`, { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      toast.error(body?.error ?? "Nie udało się utworzyć deala.");
      return null;
    }
    const { deal_id } = await res.json();
    setProspects((list) =>
      list.map((x) => (x.id === p.id ? { ...x, prospecting_status: "converted", converted_deal_id: deal_id } : x))
    );
    toast.success("Deal utworzony.");
    return deal_id as string;
  }

  async function addNote(p: Prospect, body: string): Promise<boolean> {
    const existing = notesFromProps(p.props);
    const note = { id: crypto.randomUUID(), body, created_at: new Date().toISOString() };
    const props = { ...p.props, notes: [...existing, note] };
    const { error } = await supabase.from("prospects").update({ props }).eq("id", p.id);
    if (error) {
      toast.error("Nie udało się zapisać notatki.");
      return false;
    }
    setProspects((list) => list.map((x) => (x.id === p.id ? { ...x, props } : x)));
    toast.success("Notatka zapisana.");
    return true;
  }

  // Archiwizacja (miękkie usunięcie) — pojedynczy prospekt lub zaznaczona grupa.
  const archiveProspects = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      const res = await fetch("/api/prospecting/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, archived: true }),
      });
      if (!res.ok) {
        toast.error("Nie udało się zarchiwizować prospektów.");
        return;
      }
      setProspects((list) => list.filter((p) => !ids.includes(p.id)));
      if (selectedId && ids.includes(selectedId)) setSelectedId(null);
      toast.success(ids.length === 1 ? "Prospekt przeniesiony do Archiwum." : `Przeniesiono ${ids.length} prospektów do Archiwum.`);
      refreshCounts();
    },
    [toast, refreshCounts, selectedId]
  );

  const restoreProspects = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      const res = await fetch("/api/prospecting/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, archived: false }),
      });
      if (!res.ok) {
        toast.error("Nie udało się przywrócić prospektów.");
        return;
      }
      setArchivedProspects((list) => list.filter((p) => !ids.includes(p.id)));
      toast.success(ids.length === 1 ? "Prospekt przywrócony." : `Przywrócono ${ids.length} prospektów.`);
      load();
      refreshCounts();
    },
    [toast, load, refreshCounts]
  );

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Prospecting</h1>
        <button
          onClick={() => setCallingMode(true)}
          disabled={callableQueue.length === 0}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "11px 18px",
            borderRadius: 12,
            border: "none",
            background: tokens.accent,
            color: "#fff",
            fontSize: 14,
            fontWeight: 700,
            cursor: callableQueue.length === 0 ? "default" : "pointer",
            opacity: callableQueue.length === 0 ? 0.5 : 1,
          }}
        >
          <Phone size={16} /> Tryb dzwonienia {callableQueue.length > 0 ? `(${callableQueue.length})` : ""}
        </button>
      </div>

      {/* Dashboard liczników */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 20 }}>
        {DISPLAY_STATUSES.map((s) => (
          <div key={s} style={{ background: tokens.card, border: `1px solid ${tokens.border}`, borderRadius: tokens.radius, padding: "14px 16px" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: tokens.muted, textTransform: "uppercase" }}>{STATUS_LABEL[s]}</div>
            <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: STATUS_COLOR[s] }}>{counts[s] ?? 0}</div>
          </div>
        ))}
      </div>

      {/* Zakładki statusu */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {TABS.map((tab) => (
          <button
            key={tab.key || "all"}
            onClick={() => setStatusFilter(tab.key)}
            style={{
              padding: "8px 16px",
              borderRadius: 999,
              border: `1px solid ${statusFilter === tab.key ? tokens.accent : tokens.border}`,
              background: statusFilter === tab.key ? `${tokens.accent}1A` : tokens.card,
              color: statusFilter === tab.key ? tokens.accent : tokens.text,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {tab.label}
            {tab.key === "archived" && archivedCount > 0 ? ` (${archivedCount})` : ""}
          </button>
        ))}
      </div>

      {!showingArchive && (
        <>
          <SavedViewTabs
            views={views}
            activeId={activeId}
            loading={viewsLoading}
            isDirty={isDirty}
            onSelect={handleSelectView}
            onCreate={(name) => createView(name, { filters, sort, view_mode: "table" })}
            onRename={(id, name) => updateView(id, { name })}
            onDelete={deleteView}
            onSaveChanges={() => activeView && updateView(activeView.id, { filters, sort, view_mode: "table" })}
          />

          <FilterBar
            ref={filterBarRef}
            builtInFields={builtInFields}
            onFilterChange={setFilters}
            quickFilters={[{ label: "Tylko bez strony", filter: NO_WEBSITE_QUICK_FILTER }]}
          />
        </>
      )}

      {showingArchive ? (
        archivedLoading ? (
          <p style={{ color: tokens.muted }}>Wczytywanie…</p>
        ) : (
          <ProspectTable
            prospects={archivedProspects}
            onRowClick={(id) => setSelectedId(id)}
            sort={tableSort}
            onSortChange={onTableSortChange}
            archiveMode
            onRestore={restoreProspects}
          />
        )
      ) : loading ? (
        <p style={{ color: tokens.muted }}>Wczytywanie…</p>
      ) : (
        <ProspectTable
          prospects={visible}
          onRowClick={(id) => setSelectedId(id)}
          sort={tableSort}
          onSortChange={onTableSortChange}
          onArchive={archiveProspects}
        />
      )}

      {selected && (
        <ProspectDetailDrawer
          prospect={selected}
          onClose={() => setSelectedId(null)}
          onConvert={async (p) => {
            await convertToLead(p);
          }}
          onSetStatus={async (p, status) => {
            await setStatus(p, status);
          }}
          onAddNote={async (p, body) => {
            await addNote(p, body);
          }}
        />
      )}

      {callingMode && (
        <CallingMode
          prospects={callableQueue}
          onClose={() => setCallingMode(false)}
          onConvert={convertToLead}
          onSetStatus={setStatus}
        />
      )}
    </div>
  );
}
