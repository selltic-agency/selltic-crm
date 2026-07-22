// app/admin/prospecting/page.tsx — Prospecting: zimne leady z Google Maps.
// Redesign Attio-style: zakładki = zapisane widoki (filtry + sortowanie +
// kolumny per widok, autosave na aktywnym widoku), smukły toolbar (Filtr /
// Sortowanie / Ustawienia widoku) zamiast pełnowymiarowego paska filtrów,
// oraz „Tryb dzwonienia" z trwałą historią kontaktu.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { tokens, primaryButton, pageTitle } from "@/lib/ui";
import { useToast } from "@/components/Toast";
import type { Prospect } from "@/lib/types";
import MIcon from "@/components/MaterialIcon";
import ProspectTable, { PROSPECT_COLUMNS, type SortConfig } from "@/components/ProspectTable";
import { STATUS_LABEL, isCallable } from "@/lib/prospectStatus";
import { appendConvertEvent } from "@/lib/prospectActions";
import ProspectDetailDrawer from "@/components/prospecting/ProspectDetailDrawer";
import CallingMode from "@/components/prospecting/CallingMode";
import type { ConvertOptions } from "@/components/prospecting/ConvertModal";
import type { FieldDef } from "@/components/FilterBar";
import ViewTabs from "@/components/ViewTabs";
import FilterButton from "@/components/views/FilterButton";
import SortButton from "@/components/views/SortButton";
import ViewSettingsButton from "@/components/views/ViewSettingsButton";
import { Filter, Sort, buildFilterQuery } from "@/lib/filters";
import { useSavedViews, type ColumnPref, type ViewConfig } from "@/lib/savedViews";
import { loadViewPrefs, saveViewPrefs, planHydration } from "@/lib/viewPrefs";
import EmptyState from "@/components/EmptyState";
import {
  useEntityProperties,
  makeColumnResolver,
  toFieldDef,
  applyBulkProperty,
  appendPurposeHistory,
  type PropertyView,
} from "@/lib/properties";

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

export default function ProspectingPage() {
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();
  const searchParams = useSearchParams();
  const { views: properties, customViews: customProps } = useEntityProperties("prospects");

  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [archivedProspects, setArchivedProspects] = useState<Prospect[]>([]);
  const [loading, setLoading] = useState(true);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const [archivedCount, setArchivedCount] = useState(0);
  const [industries, setIndustries] = useState<string[]>([]);
  const [cities, setCities] = useState<string[]>([]);

  const [showingArchive, setShowingArchive] = useState(false);
  const [filters, setFilters] = useState<Filter[]>([]);
  const [sort, setSort] = useState<Sort | null>(null);
  const [columnPrefs, setColumnPrefs] = useState<ColumnPref[] | null>(null);

  // ID zalogowanego użytkownika — do namespace'owania trwałego stanu widoku.
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, [supabase]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [callingMode, setCallingMode] = useState(false);
  const [focusProspect, setFocusProspect] = useState<Prospect | null>(null);

  // ── Słownik kolumn (wbudowane + własne właściwości w zakresie) ──────────
  const columnDict = useMemo(
    () => [...PROSPECT_COLUMNS, ...customProps.map((v) => ({ key: v.key, label: v.label, width: 160 }))],
    [customProps]
  );
  const columnLabels = useMemo(() => Object.fromEntries(columnDict.map((c) => [c.key, c.label])), [columnDict]);

  const defaultColumnPrefs = useCallback((): ColumnPref[] => {
    return columnDict.map((c, i) => ({
      key: c.key,
      visible: PROSPECT_COLUMNS.some((b) => b.key === c.key),
      position: i,
    }));
  }, [columnDict]);

  // Pełna lista preferencji kolumn (uzupełniona o nowo dodane właściwości).
  const fullColumnPrefs = useMemo<ColumnPref[]>(() => {
    const base = columnPrefs ?? defaultColumnPrefs();
    const known = new Set(base.map((c) => c.key));
    const missing = columnDict.filter((c) => !known.has(c.key)).map((c, i) => ({ key: c.key, visible: false, position: base.length + i }));
    return [...base, ...missing].sort((a, b) => a.position - b.position);
  }, [columnPrefs, defaultColumnPrefs, columnDict]);

  const visibleColumns = useMemo(
    () =>
      fullColumnPrefs
        .filter((c) => c.visible && columnLabels[c.key])
        .map((c) => ({ key: c.key, label: columnLabels[c.key], width: columnDict.find((d) => d.key === c.key)?.width })),
    [fullColumnPrefs, columnLabels, columnDict]
  );

  // Pola filtrów = wbudowane + miasto/branża (dynamiczne) + właściwości.
  const builtInFields = useMemo<FieldDef[]>(
    () => [
      ...PROSPECT_BUILT_IN_FIELDS,
      { key: "city", label: "Miasto", type: "select", options: cities },
      { key: "industry", label: "Branża", type: "select", options: industries },
      ...properties.map(toFieldDef),
    ],
    [cities, industries, properties]
  );

  const resolveColumn = useMemo(() => makeColumnResolver(properties), [properties]);

  const {
    views,
    activeId,
    activeView,
    loading: viewsLoading,
    storage: viewsStorage,
    error: viewsError,
    selectView,
    createView,
    updateView,
    duplicateView,
    deleteView,
    moveView,
  } = useSavedViews("prospecting");

  // W zakładkach pokazujemy widoki użytkownika (dawne zasiane `is_default`
  // pozostają ukryte — jak dotąd; ich dane nie są ruszane).
  const customViews = useMemo(() => views.filter((v) => !v.is_default).sort((a, b) => a.position - b.position), [views]);

  // ── Autosave zmian na aktywnym widoku (Attio-style) ─────────────────────
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosave = useCallback(
    (patch: Partial<{ filters: Filter[]; sort: Sort | null; config: ViewConfig }>) => {
      if (!activeView) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const id = activeView.id;
      saveTimer.current = setTimeout(() => updateView(id, patch), 450);
    },
    [activeView, updateView]
  );

  const changeFilters = useCallback(
    (next: Filter[]) => {
      setFilters(next);
      autosave({ filters: next });
    },
    [autosave]
  );

  const changeSort = useCallback(
    (next: Sort | null) => {
      setSort(next);
      autosave({ sort: next });
    },
    [autosave]
  );

  const changeColumns = useCallback(
    (next: ColumnPref[]) => {
      setColumnPrefs(next);
      autosave({ config: { ...(activeView?.config ?? {}), columns: next } });
    },
    [autosave, activeView]
  );

  const applyViewState = useCallback((filters_: Filter[], sort_: Sort | null, config?: ViewConfig) => {
    setFilters(filters_);
    setSort(sort_);
    setColumnPrefs(config?.columns && config.columns.length > 0 ? config.columns : null);
  }, []);

  const handleSelectView = (id: string) => {
    setShowingArchive(false);
    selectView(id);
    const v = views.find((x) => x.id === id);
    if (v) applyViewState(v.filters, v.sort, v.config);
  };

  // „Wszystkie" — stan domyślny: brak widoku, brak filtrów, domyślne kolumny.
  const handleSelectAll = useCallback(() => {
    setShowingArchive(false);
    selectView(null);
    applyViewState([], null, undefined);
  }, [selectView, applyViewState]);

  const handleSelectArchive = useCallback(() => {
    selectView(null);
    applyViewState([], null, undefined);
    setShowingArchive(true);
  }, [selectView, applyViewState]);

  // ── Hydratacja: start ZAWSZE na „Wszystkie"; z prefs tylko sortowanie ───
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (hydrated || viewsLoading || userId === undefined) return;
    const prefs = loadViewPrefs("prospecting", userId);
    const plan = planHydration(prefs);
    if (plan.restoreDisplayFromPrefs && prefs) {
      if (prefs.sort !== undefined) setSort(prefs.sort ?? null);
    }
    setHydrated(true);
  }, [hydrated, viewsLoading, userId]);

  useEffect(() => {
    if (!hydrated || activeView) return;
    saveViewPrefs("prospecting", userId ?? null, { sort });
  }, [hydrated, userId, sort, activeView]);

  // Stan tymczasowy na „Wszystkie" (do zapisania jako nowy widok przez +).
  // Sortowanie to preferencja prezentacji (przywracana z prefs) — nie liczy się.
  const adhoc = !activeView && (filters.length > 0 || columnPrefs !== null);

  // ── Dane ────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase.from("prospects").select("*").is("archived_at", null);
    query = buildFilterQuery(query, filters, resolveColumn);
    if (sort) query = query.order(sort.column, { ascending: sort.direction === "asc", nullsFirst: false });
    else query = query.order("lead_score", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false });

    const { data } = await query;
    setProspects((data as Prospect[]) ?? []);
    setLoading(false);
  }, [supabase, filters, sort, resolveColumn]);

  useEffect(() => {
    load();
  }, [load]);

  const loadArchived = useCallback(async () => {
    setArchivedLoading(true);
    let query = supabase.from("prospects").select("*").not("archived_at", "is", null);
    query = buildFilterQuery(query, filters, resolveColumn);
    query = query.order("archived_at", { ascending: false });
    const { data } = await query;
    setArchivedProspects((data as Prospect[]) ?? []);
    setArchivedLoading(false);
  }, [supabase, filters, resolveColumn]);

  useEffect(() => {
    if (showingArchive) loadArchived();
  }, [showingArchive, loadArchived]);

  const refreshCounts = useCallback(async () => {
    const { data } = await supabase.from("prospects").select("industry, city, archived_at");
    const rows = (data as { industry: string | null; city: string | null; archived_at: string | null }[]) ?? [];
    setArchivedCount(rows.filter((r) => r.archived_at).length);
    setIndustries([...new Set(rows.map((r) => r.industry).filter(Boolean))] as string[]);
    setCities([...new Set(rows.map((r) => r.city).filter(Boolean))] as string[]);
  }, [supabase]);

  useEffect(() => {
    refreshCounts();
  }, [refreshCounts]);

  const callableQueue = useMemo(() => prospects.filter(isCallable), [prospects]);

  const tableSort: SortConfig = sort ? { key: sort.column, direction: sort.direction } : DEFAULT_SORT;
  const onTableSortChange = useCallback(
    (s: SortConfig) => changeSort({ column: s.key, direction: s.direction }),
    [changeSort]
  );

  // Powrót z konwersji w trybie dzwonienia (?calling=1) — wznów sesję.
  const resumedCalling = useRef(false);
  useEffect(() => {
    if (resumedCalling.current) return;
    if (searchParams.get("calling") !== "1") return;
    if (loading || callableQueue.length === 0) return;
    resumedCalling.current = true;
    setCallingMode(true);
    window.history.replaceState(null, "", "/admin/prospecting");
  }, [searchParams, loading, callableQueue.length]);

  // Prospekt z globalnej wyszukiwarki (?prospect=<id>).
  const focusedOnce = useRef(false);
  useEffect(() => {
    if (focusedOnce.current) return;
    const pid = searchParams.get("prospect");
    if (!pid) return;
    focusedOnce.current = true;
    setSelectedId(pid);
    (async () => {
      const { data } = await supabase.from("prospects").select("*").eq("id", pid).maybeSingle();
      if (data) setFocusProspect(data as Prospect);
    })();
    window.history.replaceState(null, "", "/admin/prospecting");
  }, [searchParams, supabase]);

  const selected = selectedId
    ? prospects.find((p) => p.id === selectedId) ??
      archivedProspects.find((p) => p.id === selectedId) ??
      (focusProspect?.id === selectedId ? focusProspect : null)
    : null;

  // ── Propagacja aktualizacji rekordu (tryb dzwonienia / szuflada) ────────
  const handleUpdated = useCallback(
    (u: Prospect) => {
      setProspects((list) => {
        if (u.archived_at) return list.filter((x) => x.id !== u.id);
        const exists = list.some((x) => x.id === u.id);
        return exists ? list.map((x) => (x.id === u.id ? u : x)) : [u, ...list];
      });
      setArchivedProspects((list) => {
        if (!u.archived_at) return list.filter((x) => x.id !== u.id);
        const exists = list.some((x) => x.id === u.id);
        return exists ? list.map((x) => (x.id === u.id ? u : x)) : [u, ...list];
      });
      setFocusProspect((fp) => (fp && fp.id === u.id ? u : fp));
      refreshCounts();
    },
    [refreshCounts]
  );

  // ── Konwersja (modal wybiera etap / źródło kontaktu) ────────────────────
  const convertToLead = useCallback(
    async (p: Prospect, opts: ConvertOptions): Promise<string | null> => {
      const res = await fetch(`/api/prospecting/${p.id}/convert-to-lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(opts),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toast.error(body?.error ?? "Nie udało się utworzyć deala.");
        return null;
      }
      const { deal_id } = await res.json();
      // Wpis „Skonwertowano" do trwałej historii + odświeżenie rekordu.
      const base: Prospect = { ...p, prospecting_status: "converted", converted_deal_id: deal_id as string };
      const withEvent = await appendConvertEvent(supabase, base);
      handleUpdated(withEvent ?? base);
      return deal_id as string;
    },
    [supabase, toast, handleUpdated]
  );

  // ── Zbiorcza edycja / klasyfikacja / archiwum ───────────────────────────
  const handleBulkEdit = useCallback(
    async (ids: string[], view: PropertyView, value: unknown, mode: "replace" | "add") => {
      if (ids.length === 0) return;
      const { error } = await applyBulkProperty(supabase, "prospects", ids, view, value, mode);
      if (error) {
        toast.error("Nie udało się zapisać właściwości.");
        return;
      }
      if (view.key === "purposes" && mode === "add") {
        await appendPurposeHistory(supabase, "prospects", ids, Array.isArray(value) ? (value as string[]) : []);
      }
      toast.success(ids.length === 1 ? "Zapisano." : `Zaktualizowano ${ids.length} leadów.`);
      load();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [supabase, toast]
  );

  const setCategory = useCallback(
    async (p: Prospect, categoryKey: string) => {
      const value = categoryKey || null;
      const { error } = await supabase.from("prospects").update({ category: value }).eq("id", p.id);
      if (error) {
        toast.error("Nie udało się zmienić kategorii.");
        return;
      }
      handleUpdated({ ...p, category: value });
      toast.success("Kategoria zaktualizowana.");
    },
    [supabase, toast, handleUpdated]
  );

  const addPurpose = useCallback(
    async (p: Prospect, purposeKey: string) => {
      const res = await fetch("/api/prospecting/bulk-classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [p.id], purpose: purposeKey }),
      });
      if (!res.ok) {
        toast.error("Nie udało się dodać celu kontaktu.");
        return;
      }
      const next = [...new Set([...(p.purposes ?? []), purposeKey])];
      handleUpdated({ ...p, purposes: next });
      toast.success("Dodano cel kontaktu.");
    },
    [toast, handleUpdated]
  );

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

  const sortFields = useMemo(() => columnDict.map((c) => ({ key: c.key, label: c.label })), [columnDict]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
        <h1 style={pageTitle}>Prospecting</h1>
        <button
          onClick={() => setCallingMode(true)}
          disabled={callableQueue.length === 0}
          style={{ ...primaryButton, opacity: callableQueue.length === 0 ? 0.5 : 1, cursor: callableQueue.length === 0 ? "default" : "pointer" }}
        >
          <MIcon name="call" size={15} /> Tryb dzwonienia {callableQueue.length > 0 ? `(${callableQueue.length})` : ""}
        </button>
      </div>

      <ViewTabs
        views={customViews}
        activeId={activeId}
        adhoc={adhoc}
        loading={viewsLoading}
        storage={viewsStorage}
        error={viewsError}
        archiveTab={{ active: showingArchive, count: archivedCount, onSelect: handleSelectArchive }}
        onSelectAll={handleSelectAll}
        onSelectView={handleSelectView}
        onCreate={(name) =>
          createView(name, { filters, sort, view_mode: "table", config: { columns: fullColumnPrefs } })
        }
        onRename={(id, name) => updateView(id, { name })}
        onDuplicate={duplicateView}
        onDelete={deleteView}
        onMove={moveView}
      />

      {/* Smukły toolbar widoku */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <FilterButton fields={builtInFields} filters={filters} onChange={changeFilters} />
        <SortButton fields={sortFields} sort={sort} defaultLabel="Score" onChange={changeSort} />
        <div style={{ flex: 1 }} />
        {!showingArchive && (
          <ViewSettingsButton
            viewMode="table"
            columns={fullColumnPrefs}
            columnLabels={columnLabels}
            onColumnsChange={changeColumns}
          />
        )}
      </div>

      {showingArchive ? (
        archivedLoading ? (
          <p style={{ color: tokens.muted, fontSize: 13 }}>Wczytywanie…</p>
        ) : (
          <ProspectTable
            prospects={archivedProspects}
            onRowClick={(id) => setSelectedId(id)}
            sort={tableSort}
            onSortChange={onTableSortChange}
            archiveMode
            onRestore={restoreProspects}
            columns={visibleColumns}
            emptyState={
              <EmptyState
                title="Archiwum jest puste"
                description="Prospekty oznaczone jako „Nie nasz target” i zarchiwizowane ręcznie trafiają tutaj."
              />
            }
          />
        )
      ) : loading ? (
        <p style={{ color: tokens.muted, fontSize: 13 }}>Wczytywanie…</p>
      ) : (
        <ProspectTable
          prospects={prospects}
          onRowClick={(id) => setSelectedId(id)}
          sort={tableSort}
          onSortChange={onTableSortChange}
          onArchive={archiveProspects}
          properties={properties}
          onBulkEdit={handleBulkEdit}
          columns={visibleColumns}
          emptyState={
            <EmptyState
              title="Brak prospektów"
              description={
                filters.length > 0
                  ? "Żaden prospekt nie spełnia bieżących filtrów."
                  : "Zaimportuj firmy ze Scrapera, aby zacząć dzwonić."
              }
              action={
                filters.length > 0
                  ? { label: "Wyczyść filtry", icon: "filter_list_off", onClick: () => changeFilters([]) }
                  : { label: "Przejdź do Scrapera", icon: "travel_explore", onClick: () => (window.location.href = "/admin/scraper") }
              }
            />
          }
        />
      )}

      {selected && (
        <ProspectDetailDrawer
          prospect={selected}
          onClose={() => setSelectedId(null)}
          onConvert={convertToLead}
          onUpdated={handleUpdated}
          onSetCategory={setCategory}
          onAddPurpose={addPurpose}
          onSaveProps={async (pr, props) => {
            const { error } = await supabase.from("prospects").update({ props }).eq("id", pr.id);
            if (error) {
              toast.error("Nie udało się zapisać właściwości.");
              return;
            }
            handleUpdated({ ...pr, props });
            toast.success("Właściwości zapisane.");
          }}
        />
      )}

      {callingMode && (
        <CallingMode
          prospects={callableQueue}
          onClose={() => setCallingMode(false)}
          onConvert={convertToLead}
          onProspectUpdated={handleUpdated}
        />
      )}
    </div>
  );
}
