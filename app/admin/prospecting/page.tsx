// app/admin/prospecting/page.tsx — Prospecting: zimne leady z Google Maps.
// Karty zamiast tabeli, cztery statusy (new/no_answer/not_interested/converted)
// i „Tryb dzwonienia” (Tinder-style) do szybkiego przechodzenia przez kolejkę
// telefonów. Baza danych nadal zapisuje starą wartość `contact_attempted`
// (patrz lib/prospectStatus.ts) — to wyłącznie kosmetyka UI.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Phone } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { tokens } from "@/lib/ui";
import { useToast } from "@/components/Toast";
import type { Prospect } from "@/lib/types";
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
import ProspectCard from "@/components/prospecting/ProspectCard";
import ProspectDetailDrawer from "@/components/prospecting/ProspectDetailDrawer";
import CallingMode from "@/components/prospecting/CallingMode";
import FilterBar, { type FieldDef, type FilterBarHandle } from "@/components/FilterBar";
import SavedViewTabs from "@/components/SavedViewTabs";
import { Filter, Sort, buildFilterQuery, columnForProspect } from "@/lib/filters";
import { useSavedViews, type SeedView } from "@/lib/savedViews";

const TABS: { key: DisplayStatus | ""; label: string }[] = [
  { key: "", label: "Wszystkie" },
  { key: "new", label: "Nowe" },
  { key: "no_answer", label: "Nie odbiera" },
  { key: "converted", label: "Skonwertowane" },
  { key: "not_interested", label: "Niezainteresowane" },
];

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
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState<Record<DisplayStatus, number>>({
    new: 0,
    no_answer: 0,
    not_interested: 0,
    converted: 0,
  });
  const [industries, setIndustries] = useState<string[]>([]);
  const [cities, setCities] = useState<string[]>([]);

  const [statusFilter, setStatusFilter] = useState<DisplayStatus | "">("");
  const [filters, setFilters] = useState<Filter[]>([]);
  const [sort, setSort] = useState<Sort | null>(null);
  const filterBarRef = useRef<FilterBarHandle>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [callingMode, setCallingMode] = useState(false);

  // Pola miasta/branży są dynamiczne (zależą od zaimportowanych danych).
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
      { name: "Wszystkie", view_mode: "kanban", filters: [], sort: null },
      {
        name: "Do zadzwonienia",
        view_mode: "kanban",
        filters: [{ field: "prospecting_status", operator: "in", value: ["new", "contact_attempted"] }],
        sort: { column: "lead_score", direction: "desc" },
      },
      {
        name: "Wysokie priorytety",
        view_mode: "kanban",
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

  const appliedInitial = useRef(false);
  useEffect(() => {
    if (appliedInitial.current || viewsLoading) return;
    appliedInitial.current = true;
    if (searchParams.get("f")) {
      selectView(null);
      return;
    }
    if (activeView) applyView(activeView.filters, activeView.sort);
  }, [viewsLoading, activeView, applyView, searchParams, selectView]);

  const handleSelectView = (id: string) => {
    selectView(id);
    const v = views.find((x) => x.id === id);
    if (v) applyView(v.filters, v.sort);
  };

  const isDirty = useMemo(() => {
    if (!activeView) return false;
    return (
      JSON.stringify(filters) !== JSON.stringify(activeView.filters) ||
      JSON.stringify(sort) !== JSON.stringify(activeView.sort ?? null)
    );
  }, [activeView, filters, sort]);

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase.from("prospects").select("*");
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

  // Dashboard liczników i opcje filtrów — niezależne od aktywnych filtrów.
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("prospects").select("prospecting_status, industry, city");
      const rows = (data as { prospecting_status: string; industry: string | null; city: string | null }[]) ?? [];
      const c: Record<DisplayStatus, number> = { new: 0, no_answer: 0, not_interested: 0, converted: 0 };
      for (const r of rows) c[toDisplayStatus(r.prospecting_status)]++;
      setCounts(c);
      setIndustries([...new Set(rows.map((r) => r.industry).filter(Boolean))] as string[]);
      setCities([...new Set(rows.map((r) => r.city).filter(Boolean))] as string[]);
    })();
  }, [supabase, prospects.length]);

  const visible = useMemo(
    () => (statusFilter ? prospects.filter((p) => toDisplayStatus(p.prospecting_status) === statusFilter) : prospects),
    [prospects, statusFilter]
  );

  const callableQueue = useMemo(() => prospects.filter(isCallable), [prospects]);

  const selected = selectedId ? prospects.find((p) => p.id === selectedId) ?? null : null;

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

  async function convertToLead(p: Prospect): Promise<boolean> {
    const res = await fetch(`/api/prospecting/${p.id}/convert-to-lead`, { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      toast.error(body?.error ?? "Nie udało się utworzyć deala.");
      return false;
    }
    const { deal_id } = await res.json();
    setProspects((list) =>
      list.map((x) => (x.id === p.id ? { ...x, prospecting_status: "converted", converted_deal_id: deal_id } : x))
    );
    toast.success("Deal utworzony.");
    return true;
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
          </button>
        ))}
      </div>

      <SavedViewTabs
        views={views}
        activeId={activeId}
        loading={viewsLoading}
        isDirty={isDirty}
        onSelect={handleSelectView}
        onCreate={(name) => createView(name, { filters, sort, view_mode: "kanban" })}
        onRename={(id, name) => updateView(id, { name })}
        onDelete={deleteView}
        onSaveChanges={() => activeView && updateView(activeView.id, { filters, sort })}
      />

      <FilterBar
        ref={filterBarRef}
        builtInFields={builtInFields}
        onFilterChange={setFilters}
        quickFilters={[{ label: "Tylko bez strony", filter: NO_WEBSITE_QUICK_FILTER }]}
      />

      {/* Lista kart */}
      {loading ? (
        <p style={{ color: tokens.muted }}>Wczytywanie…</p>
      ) : visible.length === 0 ? (
        <div style={{ background: tokens.card, border: `1px solid ${tokens.border}`, borderRadius: tokens.radius, padding: 40, textAlign: "center", color: tokens.muted }}>
          Brak prospektów spełniających kryteria.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {visible.map((p) => (
            <ProspectCard key={p.id} prospect={p} onOpen={() => setSelectedId(p.id)} onConvert={() => convertToLead(p)} />
          ))}
        </div>
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
