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
  STATUS_LABEL,
  isCallable,
  dbStatusForWrite,
  notesFromProps,
  type WritableDisplayStatus,
} from "@/lib/prospectStatus";
import ProspectDetailDrawer from "@/components/prospecting/ProspectDetailDrawer";
import CallingMode from "@/components/prospecting/CallingMode";
import FilterBar, { type FieldDef, type FilterBarHandle } from "@/components/FilterBar";
import ViewTabs from "@/components/ViewTabs";
import { Filter, Sort, buildFilterQuery } from "@/lib/filters";
import { useSavedViews, type SeedView } from "@/lib/savedViews";
import { loadViewPrefs, saveViewPrefs, planHydration } from "@/lib/viewPrefs";
import { useEntityProperties, makeColumnResolver, toFieldDef, applyBulkProperty, type PropertyView } from "@/lib/properties";

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
  const { views: properties } = useEntityProperties("prospects");

  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [archivedProspects, setArchivedProspects] = useState<Prospect[]>([]);
  const [loading, setLoading] = useState(true);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const [archivedCount, setArchivedCount] = useState(0);
  const [industries, setIndustries] = useState<string[]>([]);
  const [cities, setCities] = useState<string[]>([]);

  // Widok Archiwum (miękko usunięte prospekty) — zakładka obok „Wszystkie".
  const [showingArchive, setShowingArchive] = useState(false);
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
  // Prospekt otwarty z globalnej wyszukiwarki (?prospect=), pobrany osobno na
  // wypadek, gdyby nie mieścił się w bieżącym filtrze/zakładce.
  const [focusProspect, setFocusProspect] = useState<Prospect | null>(null);

  // Pola filtrów = wbudowane (status/score/strona) + miasto/branża (dynamiczne)
  // + właściwości (kategoria/cel + własne). Kolumny miasta/branży są dynamiczne
  // (zależą od zaimportowanych danych).
  const builtInFields = useMemo<FieldDef[]>(
    () => [
      ...PROSPECT_BUILT_IN_FIELDS,
      { key: "city", label: "Miasto", type: "select", options: cities },
      { key: "industry", label: "Branża", type: "select", options: industries },
      ...properties.map(toFieldDef),
    ],
    [cities, industries, properties]
  );

  // Resolver: właściwości własne → props jsonb; reszta (kolumny) bezpośrednio.
  const resolveColumn = useMemo(() => makeColumnResolver(properties), [properties]);

  // Brak predefiniowanych (systemowych) zakładek — pozostaje tylko „Wszystkie"
  // (zaszyta w ViewTabs), zakładka „Archiwum" oraz widoki tworzone ręcznie.
  const seedDefaults = useCallback(async (): Promise<SeedView[]> => [], []);

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
    deleteView,
  } = useSavedViews("prospecting", seedDefaults);

  // W zakładkach pokazujemy tylko widoki utworzone ręcznie przez użytkownika.
  // Predefiniowane/systemowe (is_default) są ukryte — „Wszystkie" wystarcza.
  const customViews = useMemo(() => views.filter((v) => !v.is_default), [views]);

  const applyView = useCallback((filters_: Filter[], sort_: Sort | null) => {
    filterBarRef.current?.setFilters(filters_);
    setSort(sort_);
  }, []);

  const handleSelectView = (id: string) => {
    setShowingArchive(false);
    selectView(id);
    const v = views.find((x) => x.id === id);
    if (v) applyView(v.filters, v.sort);
  };

  // „Wszystkie" — stan domyślny: brak aktywnego widoku i brak filtrów.
  const handleSelectAll = useCallback(() => {
    setShowingArchive(false);
    selectView(null);
    filterBarRef.current?.setFilters([]);
    setSort(null);
  }, [selectView]);

  // „Archiwum" — jak „Wszystkie", tylko rekordy zarchiwizowane. Czyścimy
  // aktywny widok i filtry, żeby zachowywała się jak zakładka bazowa.
  const handleSelectArchive = useCallback(() => {
    selectView(null);
    filterBarRef.current?.setFilters([]);
    setSort(null);
    setShowingArchive(true);
  }, [selectView]);

  // ── Hydratacja: stan początkowy to ZAWSZE „Wszystkie" (brak widoku/filtrów).
  // Z prefs przywracamy tylko sortowanie (preferencja prezentacji). Filtry z
  // udostępnionego linku (?f=…) odtwarza sam FilterBar → filtr tymczasowy.
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

  // ── Zapis preferencji prezentacji (tylko sortowanie) ──────────────────
  // Filtry, aktywny widok i zakładka statusu NIE są utrwalane — każde wejście
  // startuje z „Wszystkie".
  useEffect(() => {
    if (!hydrated) return;
    saveViewPrefs("prospecting", userId ?? null, { sort });
  }, [hydrated, userId, sort]);

  const isDirty = useMemo(() => {
    if (!activeView) return false;
    return (
      JSON.stringify(filters) !== JSON.stringify(activeView.filters) ||
      JSON.stringify(sort) !== JSON.stringify(activeView.sort ?? null)
    );
  }, [activeView, filters, sort]);

  // Filtr tymczasowy (ad-hoc): bieżące filtry różnią się od aktywnej zakładki
  // (albo od „Wszystkie", gdy żaden widok nie jest wybrany).
  const adhoc = activeView ? isDirty : filters.length > 0;

  const handleClearAdhoc = useCallback(() => {
    if (activeView) applyView(activeView.filters, activeView.sort);
    else {
      filterBarRef.current?.setFilters([]);
      setSort(null);
    }
  }, [activeView, applyView]);

  // Aktywne prospekty (nie zarchiwizowane) — sterowane filtrami i sortowaniem.
  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase.from("prospects").select("*").is("archived_at", null);
    query = buildFilterQuery(query, filters, resolveColumn);
    // nullsFirst:false → wiersze bez wartości (np. nieocenione leady) zawsze na
    // dole, niezależnie od kierunku sortowania (spójne z sortowaniem tabeli).
    if (sort) query = query.order(sort.column, { ascending: sort.direction === "asc", nullsFirst: false });
    else query = query.order("lead_score", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false });

    const { data } = await query;
    setProspects((data as Prospect[]) ?? []);
    setLoading(false);
  }, [supabase, filters, sort, resolveColumn]);

  useEffect(() => {
    load();
  }, [load]);

  // Zarchiwizowane prospekty — wczytywane leniwie, gdy otwarto zakładkę Archiwum.
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

  // Licznik Archiwum (na zakładce) i opcje filtrów miasta/branży — niezależne
  // od aktywnych filtrów.
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

  // Otwórz szufladę prospektu wskazanego w URL (?prospect=<id>) z globalnej
  // wyszukiwarki. Pobieramy rekord osobno, bo mógł zostać odfiltrowany.
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

  // ── Zbiorcza edycja dowolnej właściwości (Feature 1 + 2 + własne) ──────────
  // Kategoria/własne skalarne: nadpisujemy. Cel kontaktu (multi_select): tryb
  // „dołóż" dokłada bez duplikatów i dopisuje historię (append-only), „zastąp"
  // ustawia zbiór na nowo.
  const handleBulkEdit = useCallback(
    async (ids: string[], view: PropertyView, value: unknown, mode: "replace" | "add") => {
      if (ids.length === 0) return;
      const { error } = await applyBulkProperty(supabase, "prospects", ids, view, value, mode);
      if (error) {
        toast.error("Nie udało się zapisać właściwości.");
        return;
      }
      // Cel kontaktu: historia (append-only), gdy dokładamy.
      if (view.key === "purposes" && mode === "add") {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        const vals = Array.isArray(value) ? (value as string[]) : [];
        if (user && vals.length) {
          const { error: histErr } = await supabase.from("prospect_purposes").insert(
            ids.flatMap((prospect_id) => vals.map((purpose) => ({ owner: user.id, prospect_id, purpose, source: "bulk" })))
          );
          if (histErr) console.error("Nie zapisano historii celu kontaktu (prospect_purposes):", histErr);
        }
      }
      toast.success(ids.length === 1 ? "Zapisano." : `Zaktualizowano ${ids.length} leadów.`);
      load();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [supabase, toast]
  );

  // Zmiana kategorii pojedynczego leada z jego widoku (korekta klasyfikacji).
  const setCategory = useCallback(
    async (p: Prospect, categoryKey: string) => {
      const value = categoryKey || null;
      const { error } = await supabase.from("prospects").update({ category: value }).eq("id", p.id);
      if (error) {
        toast.error("Nie udało się zmienić kategorii.");
        return;
      }
      setProspects((list) => list.map((x) => (x.id === p.id ? { ...x, category: value } : x)));
      setFocusProspect((fp) => (fp && fp.id === p.id ? { ...fp, category: value } : fp));
      toast.success("Kategoria zaktualizowana.");
    },
    [supabase, toast]
  );

  // Dodanie celu kontaktu pojedynczego leada (append-only, przez wspólny endpoint).
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
      setProspects((list) => list.map((x) => (x.id === p.id ? { ...x, purposes: next } : x)));
      setFocusProspect((fp) => (fp && fp.id === p.id ? { ...fp, purposes: next } : fp));
      toast.success("Dodano cel kontaktu.");
    },
    [toast]
  );

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
        onCreate={(name) => createView(name, { filters, sort, view_mode: "table" })}
        onRename={(id, name) => updateView(id, { name })}
        onDelete={deleteView}
        onSaveChanges={() => activeView && updateView(activeView.id, { filters, sort, view_mode: "table" })}
        onClearAdhoc={handleClearAdhoc}
      />

      <FilterBar ref={filterBarRef} fields={builtInFields} onFilterChange={setFilters} />

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
          prospects={prospects}
          onRowClick={(id) => setSelectedId(id)}
          sort={tableSort}
          onSortChange={onTableSortChange}
          onArchive={archiveProspects}
          properties={properties}
          onBulkEdit={handleBulkEdit}
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
          onSetCategory={setCategory}
          onAddPurpose={addPurpose}
          onSaveProps={async (pr, props) => {
            const { error } = await supabase.from("prospects").update({ props }).eq("id", pr.id);
            if (error) {
              toast.error("Nie udało się zapisać właściwości.");
              return;
            }
            setProspects((list) => list.map((x) => (x.id === pr.id ? { ...x, props } : x)));
            setFocusProspect((fp) => (fp && fp.id === pr.id ? { ...fp, props } : fp));
            toast.success("Właściwości zapisane.");
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
