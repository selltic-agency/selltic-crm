// app/admin/pipeline/page.tsx — lejek sprzedaży (kanban / tabela) na DEALACH.
// Redesign Attio-style: zakładki = zapisane widoki (filtry + sortowanie +
// tryb + kolumny tabeli + konfiguracja kanbana per widok, autosave na
// aktywnym widoku), smukły toolbar zamiast paska chipów filtrów.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { tokens, inputStyle, primaryButton, ghostButton, formatPLN, pageTitle, menuPanel } from "@/lib/ui";
import { type Deal, type Stage } from "@/lib/types";
import { useStages } from "@/lib/stages";
import MIcon from "@/components/MaterialIcon";
import LeadTable, { DEAL_COLUMNS, type SortConfig } from "@/components/LeadTable";
import OwnerAvatar from "@/components/OwnerAvatar";
import type { FieldDef } from "@/components/FilterBar";
import ViewTabs from "@/components/ViewTabs";
import FilterButton from "@/components/views/FilterButton";
import SortButton from "@/components/views/SortButton";
import ViewSettingsButton, { KANBAN_CARD_FIELDS } from "@/components/views/ViewSettingsButton";
import EmptyState from "@/components/EmptyState";
import { Filter, Sort, buildFilterQuery } from "@/lib/filters";
import { useSavedViews, type ColumnPref, type ViewConfig, type ViewMode } from "@/lib/savedViews";
import { loadViewPrefs, saveViewPrefs, planHydration, type ViewMode as PrefViewMode } from "@/lib/viewPrefs";
import { useEntityProperties, makeColumnResolver, toFieldDef, applyBulkProperty, appendPurposeHistory, type PropertyView } from "@/lib/properties";
import { useToast } from "@/components/Toast";
import { useScrollLock } from "@/lib/useScrollLock";

const DEAL_BUILT_IN_FIELDS: FieldDef[] = [
  { key: "stage", label: "Etap", type: "stage" },
  { key: "value", label: "Wartość", type: "value" },
  { key: "source", label: "Źródło", type: "source" },
  { key: "opened_at", label: "Data utworzenia", type: "date" },
  { key: "name", label: "Nazwa", type: "text" },
  { key: "email", label: "E-mail", type: "text" },
  { key: "phone", label: "Telefon", type: "text" },
  { key: "company", label: "Firma", type: "text" },
  {
    key: "assignee",
    label: "Deal Owner",
    type: "select",
    options: [
      { key: "dominik", label: "Dominik" },
      { key: "kuba", label: "Kuba" },
    ],
  },
];

const DEFAULT_TABLE_SORT: SortConfig = { key: "opened_at", direction: "desc" };

// Deal + metadane aktywności dociągane razem z listą.
type DealRow = Deal & {
  activities?: { created_at: string }[] | null;
  tasks?: { due_at: string | null }[] | null;
};

export default function PipelinePage() {
  const supabase = useMemo(() => createClient(), []);
  const reduce = useReducedMotion();
  const router = useRouter();
  const toast = useToast();
  const { stages, loading: stagesLoading } = useStages();
  const { views: properties, customViews: customProps } = useEntityProperties("deals");
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  const [filters, setFilters] = useState<Filter[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("kanban");
  const [tableSort, setTableSort] = useState<SortConfig>(DEFAULT_TABLE_SORT);
  const [columnPrefs, setColumnPrefs] = useState<ColumnPref[] | null>(null);
  const [kanbanCfg, setKanbanCfg] = useState<NonNullable<ViewConfig["kanban"]>>({});

  const filterFields = useMemo<FieldDef[]>(() => [...DEAL_BUILT_IN_FIELDS, ...properties.map(toFieldDef)], [properties]);
  const resolveColumn = useMemo(() => makeColumnResolver(properties), [properties]);

  // ── Słownik kolumn tabeli (wbudowane + właściwości w zakresie Deals) ────
  const columnDict = useMemo(
    () => [...DEAL_COLUMNS, ...properties.map((v) => ({ key: v.key, label: v.label, width: 160 }))],
    [properties]
  );
  const columnLabels = useMemo(() => Object.fromEntries(columnDict.map((c) => [c.key, c.label])), [columnDict]);

  const defaultColumnPrefs = useCallback((): ColumnPref[] => {
    return columnDict.map((c, i) => ({
      key: c.key,
      // Wbudowane + systemowe (kategoria/cel) widoczne; własne domyślnie ukryte.
      visible: DEAL_COLUMNS.some((b) => b.key === c.key) || properties.some((p) => p.system && p.key === c.key),
      position: i,
    }));
  }, [columnDict, properties]);

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

  const handleBulkEdit = useCallback(
    async (ids: string[], view: PropertyView, value: unknown, mode: "replace" | "add") => {
      if (ids.length === 0) return;
      const { error } = await applyBulkProperty(supabase, "deals", ids, view, value, mode);
      if (error) {
        toast.error("Nie udało się zapisać właściwości.");
        return;
      }
      if (view.key === "purposes" && mode === "add") {
        await appendPurposeHistory(supabase, "deals", ids, Array.isArray(value) ? (value as string[]) : []);
      }
      toast.success(ids.length === 1 ? "Zapisano." : `Zaktualizowano ${ids.length} leadów.`);
      load(filters);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [supabase, toast, filters]
  );

  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, [supabase]);

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
  } = useSavedViews("deals");

  const customViews = useMemo(() => views.filter((v) => !v.is_default).sort((a, b) => a.position - b.position), [views]);

  // ── Autosave zmian na aktywnym widoku ───────────────────────────────────
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosave = useCallback(
    (patch: Partial<{ filters: Filter[]; sort: Sort | null; view_mode: ViewMode; config: ViewConfig }>) => {
      if (!activeView) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const id = activeView.id;
      saveTimer.current = setTimeout(() => updateView(id, patch), 450);
    },
    [activeView, updateView]
  );

  const currentSort: Sort | null = viewMode === "table" ? { column: tableSort.key, direction: tableSort.direction } : null;

  const changeFilters = useCallback(
    (next: Filter[]) => {
      setFilters(next);
      autosave({ filters: next });
    },
    [autosave]
  );

  const changeSort = useCallback(
    (next: Sort | null) => {
      setTableSort(next ? { key: next.column, direction: next.direction } : DEFAULT_TABLE_SORT);
      autosave({ sort: next });
    },
    [autosave]
  );

  const changeViewMode = useCallback(
    (mode: ViewMode) => {
      setViewMode(mode);
      autosave({ view_mode: mode });
    },
    [autosave]
  );

  const changeColumns = useCallback(
    (next: ColumnPref[]) => {
      setColumnPrefs(next);
      autosave({ config: { ...(activeView?.config ?? {}), columns: next, kanban: kanbanCfg } });
    },
    [autosave, activeView, kanbanCfg]
  );

  const changeKanban = useCallback(
    (next: NonNullable<ViewConfig["kanban"]>) => {
      setKanbanCfg(next);
      autosave({ config: { ...(activeView?.config ?? {}), columns: columnPrefs ?? undefined, kanban: next } });
    },
    [autosave, activeView, columnPrefs]
  );

  const applyViewState = useCallback(
    (filters_: Filter[], mode: ViewMode, sort: Sort | null, config?: ViewConfig) => {
      setFilters(filters_);
      setViewMode(mode);
      setTableSort(sort ? { key: sort.column, direction: sort.direction } : DEFAULT_TABLE_SORT);
      setColumnPrefs(config?.columns && config.columns.length > 0 ? config.columns : null);
      setKanbanCfg(config?.kanban ?? {});
    },
    []
  );

  // ── Hydratacja: start na „Wszystkie"; z prefs tryb + sortowanie ─────────
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (hydrated || viewsLoading || userId === undefined || stagesLoading) return;
    const prefs = loadViewPrefs("deals", userId);
    const plan = planHydration(prefs);
    if (plan.restoreDisplayFromPrefs && prefs) {
      if (prefs.viewMode) setViewMode(prefs.viewMode);
      if (prefs.sort !== undefined) setTableSort(prefs.sort ? { key: prefs.sort.column, direction: prefs.sort.direction } : DEFAULT_TABLE_SORT);
    }
    setHydrated(true);
  }, [hydrated, viewsLoading, userId, stagesLoading]);

  const handleSelectView = (id: string) => {
    selectView(id);
    const v = views.find((x) => x.id === id);
    if (v) applyViewState(v.filters, v.view_mode, v.sort, v.config);
  };

  const handleSelectAll = useCallback(() => {
    selectView(null);
    applyViewState([], viewMode, null, undefined);
  }, [selectView, applyViewState, viewMode]);

  const adhoc = !activeView && (filters.length > 0 || columnPrefs !== null || (kanbanCfg.hiddenStages?.length ?? 0) > 0);

  // ── Zapis preferencji prezentacji (tylko poza widokiem) ─────────────────
  useEffect(() => {
    if (!hydrated || activeView) return;
    saveViewPrefs("deals", userId ?? null, {
      sort: { column: tableSort.key, direction: tableSort.direction },
      viewMode: viewMode as PrefViewMode,
    });
  }, [hydrated, userId, tableSort, viewMode, activeView]);

  const load = useCallback(
    async (activeFilters: Filter[]) => {
      setLoading(true);
      let query = supabase
        .from("deals")
        .select("*, activities(created_at), tasks(due_at)")
        .eq("tasks.done", false)
        .not("tasks.due_at", "is", null)
        .order("opened_at", { ascending: false })
        .order("created_at", { referencedTable: "activities", ascending: false })
        .limit(1, { referencedTable: "activities" })
        .order("due_at", { referencedTable: "tasks", ascending: true })
        .limit(1, { referencedTable: "tasks" });

      query = buildFilterQuery(query, activeFilters, resolveColumn);

      const { data } = await query;
      setDeals((data as DealRow[]) ?? []);
      setLoading(false);
    },
    [supabase, resolveColumn]
  );

  useEffect(() => {
    load(filters);
  }, [load, filters]);

  const openDeal = (id: string) => router.push(`/admin/leads/${id}`);

  const hiddenStages = kanbanCfg.hiddenStages ?? [];
  const visibleStages = useMemo(() => stages.filter((s) => !hiddenStages.includes(s.key)), [stages, hiddenStages]);
  const cardFields = kanbanCfg.cardFields ?? KANBAN_CARD_FIELDS.map((f) => f.key);

  const byStage = useMemo(() => {
    const map: Record<Stage, DealRow[]> = {};
    for (const s of stages) map[s.key] = [];
    for (const d of deals) {
      if (!map[d.stage]) map[d.stage] = [];
      map[d.stage].push(d);
    }
    return map;
  }, [deals, stages]);

  const sortFields = useMemo(() => columnDict.map((c) => ({ key: c.key, label: c.label })), [columnDict]);

  return (
    <div className={viewMode === "kanban" ? "selltic-page-fill" : undefined}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexShrink: 0, gap: 10, flexWrap: "wrap" }}>
        <h1 style={pageTitle}>Leady</h1>
        <button onClick={() => setShowAdd(true)} style={primaryButton}>
          <MIcon name="add" size={15} />
          Dodaj lead
        </button>
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
        onCreate={(name) =>
          createView(name, {
            filters,
            sort: currentSort,
            view_mode: viewMode,
            config: { columns: fullColumnPrefs, kanban: kanbanCfg },
          })
        }
        onRename={(id, name) => updateView(id, { name })}
        onDuplicate={duplicateView}
        onDelete={deleteView}
        onMove={moveView}
      />

      {/* Smukły toolbar widoku */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12, flexShrink: 0 }}>
        <FilterButton fields={filterFields} filters={filters} onChange={changeFilters} />
        {viewMode === "table" && (
          <SortButton fields={sortFields} sort={currentSort} defaultLabel="Otwarto" onChange={changeSort} />
        )}
        <div style={{ flex: 1 }} />
        <ViewSettingsButton
          viewMode={viewMode}
          columns={fullColumnPrefs}
          columnLabels={columnLabels}
          onColumnsChange={changeColumns}
          stages={stages}
          kanban={kanbanCfg}
          onKanbanChange={changeKanban}
        />
        {/* Przełącznik tabela/kanban — per widok */}
        <div style={{ display: "flex", background: tokens.bg, border: `1px solid ${tokens.border}`, padding: 2, borderRadius: tokens.radiusSm, gap: 2 }}>
          <ModeButton icon="view_kanban" active={viewMode === "kanban"} onClick={() => changeViewMode("kanban")} title="Kanban" />
          <ModeButton icon="table_rows" active={viewMode === "table"} onClick={() => changeViewMode("table")} title="Tabela" />
        </div>
      </div>

      {loading ? (
        <p style={{ color: tokens.muted, fontSize: 13 }}>Wczytywanie…</p>
      ) : deals.length === 0 && filters.length === 0 ? (
        <div style={{ background: tokens.card, border: `1px solid ${tokens.border}`, borderRadius: tokens.radius }}>
          <EmptyState
            title="Brak leadów"
            description="Utwórz rekord, aby zacząć pracę w tym widoku."
            action={{ label: "Dodaj lead", icon: "add", onClick: () => setShowAdd(true) }}
            secondaryAction={{ label: "Importuj z Prospectingu", icon: "call", onClick: () => router.push("/admin/prospecting") }}
          />
        </div>
      ) : viewMode === "kanban" ? (
        <div
          className="selltic-scroll-x"
          style={{
            flex: 1,
            minHeight: 0,
            display: "grid",
            gridTemplateColumns: `repeat(${Math.max(visibleStages.length, 1)}, minmax(240px, 1fr))`,
            gap: 10,
            overflowX: "auto",
            paddingBottom: 4,
          }}
        >
          {visibleStages.map((s) => {
            const list = byStage[s.key] ?? [];
            const total = list.reduce((sum, d) => sum + Number(d.value || 0), 0);
            return (
              <div
                key={s.key}
                style={{
                  minWidth: 240,
                  minHeight: 0,
                  display: "flex",
                  flexDirection: "column",
                  background: "#F1F2F5",
                  border: `1px solid ${tokens.border}`,
                  borderRadius: tokens.radius,
                }}
              >
                <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 7, padding: "9px 10px", borderBottom: `1px solid ${tokens.border}` }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.color, flexShrink: 0 }} />
                  <span title={s.label} style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.label}
                  </span>
                  <span style={{ fontSize: 11.5, fontWeight: 500, color: tokens.muted, background: tokens.card, border: `1px solid ${tokens.border}`, borderRadius: 999, padding: "0 7px", lineHeight: "17px", flexShrink: 0 }}>
                    {list.length}
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 500, color: tokens.muted, whiteSpace: "nowrap" }}>{formatPLN(total)}</span>
                </div>

                <div className="selltic-scroll-y" style={{ flex: 1, minHeight: 60, overflowY: "auto", display: "grid", gap: 7, padding: 7, alignContent: "start" }}>
                  {list.length === 0 ? (
                    <EmptyState compact title="Brak rekordów" description="Przeciągnij tu leady lub utwórz nowy." />
                  ) : (
                    <AnimatePresence initial={false}>
                      {list.map((d) => (
                        <DealCard key={d.id} deal={d} reduce={!!reduce} onOpen={openDeal} fields={cardFields} />
                      ))}
                    </AnimatePresence>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ background: tokens.card, border: `1px solid ${tokens.border}`, borderRadius: tokens.radius, overflow: "hidden" }}>
          <LeadTable
            leads={deals}
            onRowClick={openDeal}
            sort={tableSort}
            onSortChange={(s) => changeSort({ column: s.key, direction: s.direction })}
            properties={properties}
            onBulkEdit={handleBulkEdit}
            columns={visibleColumns}
            emptyState={
              <EmptyState
                title="Brak leadów w tym widoku"
                description="Zmień filtry albo dodaj pierwszego leada."
                action={{ label: "Dodaj lead", icon: "add", onClick: () => setShowAdd(true) }}
              />
            }
          />
        </div>
      )}

      {showAdd && (
        <AddLeadModal
          onClose={() => setShowAdd(false)}
          onCreated={() => {
            setShowAdd(false);
            load(filters);
          }}
        />
      )}
    </div>
  );
}

function ModeButton({ icon, active, onClick, title }: { icon: string; active: boolean; onClick: () => void; title: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{
        width: 26,
        height: 24,
        borderRadius: 5,
        display: "grid",
        placeItems: "center",
        border: "none",
        cursor: "pointer",
        background: active ? tokens.card : "transparent",
        color: active ? tokens.accent : tokens.muted,
        boxShadow: active ? "0 1px 2px rgba(15,18,28,0.08)" : "none",
        transition: "all 0.15s ease",
        padding: 0,
      }}
    >
      <MIcon name={icon} size={15} />
    </button>
  );
}

// Karta deala na kanbanie: tytuł do 2 linii + pola sterowane widokiem.
function DealCard({
  deal: d,
  reduce,
  onOpen,
  fields,
}: {
  deal: DealRow;
  reduce: boolean;
  onOpen: (id: string) => void;
  fields: string[];
}) {
  const lastActivityAt = d.activities?.[0]?.created_at ?? null;
  const nextDueAt = d.tasks?.[0]?.due_at ?? null;
  const isOverdue = !!nextDueAt && new Date(nextDueAt).getTime() < Date.now();
  const show = (k: string) => fields.includes(k);

  return (
    <motion.button
      layout={!reduce}
      onClick={() => onOpen(d.id)}
      initial={{ opacity: 0, scale: reduce ? 1 : 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: reduce ? 1 : 0.97 }}
      whileHover={reduce ? undefined : { y: -1 }}
      transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 400, damping: 32 }}
      style={{
        textAlign: "left",
        background: tokens.card,
        border: `1px solid ${tokens.border}`,
        borderRadius: tokens.radiusSm,
        padding: "10px 11px",
        cursor: "pointer",
        display: "grid",
        gap: 7,
        boxShadow: "0 1px 2px rgba(15,18,28,0.04)",
      }}
    >
      <div
        title={d.name ?? undefined}
        style={{
          fontSize: 13,
          fontWeight: 600,
          lineHeight: 1.35,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
          wordBreak: "break-word",
        }}
      >
        {d.name || "Bez nazwy"}
      </div>

      {(show("phone") || show("email") || show("activity")) && (
        <div style={{ display: "grid", gap: 4 }}>
          {show("phone") && d.phone && <CardMetaRow icon="call" text={d.phone} />}
          {show("email") && d.email && <CardMetaRow icon="mail" text={d.email} />}
          {show("activity") && (
            <>
              <CardMetaRow
                icon="schedule"
                muted
                text={lastActivityAt ? `Ostatnia aktywność: ${formatRelativeDate(lastActivityAt)}` : "Brak aktywności"}
              />
              {nextDueAt ? (
                <CardMetaRow icon="event_upcoming" danger={isOverdue} text={`${isOverdue ? "Po terminie" : "Następna aktywność"}: ${formatRelativeDate(nextDueAt)}`} />
              ) : (
                <CardMetaRow icon="event_upcoming" muted text="Brak zaplanowanych działań" />
              )}
            </>
          )}
        </div>
      )}

      {show("footer") && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <OwnerAvatar assignee={d.assignee} size={20} />
          {Number(d.value) > 0 && <span style={{ fontSize: 12, fontWeight: 600 }}>{formatPLN(d.value)}</span>}
        </div>
      )}
    </motion.button>
  );
}

// Wiersz metadanych karty: ikona + tekst w jednej, uciętej linii.
function CardMetaRow({
  icon,
  text,
  muted = false,
  danger = false,
}: {
  icon: string;
  text: string;
  muted?: boolean;
  danger?: boolean;
}) {
  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        minWidth: 0,
        fontSize: 11.5,
        fontWeight: danger ? 600 : 400,
        color: danger ? tokens.danger : muted ? tokens.muted : tokens.text,
        ...(danger ? { background: "rgba(229,72,77,0.08)", borderRadius: 5, padding: "2px 5px", margin: "-1px -3px" } : {}),
      }}
    >
      <MIcon name={icon} size={12} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{text}</span>
    </span>
  );
}

// Data względna po polsku: „dzisiaj"/„wczoraj"/„jutro", „za N dni"/„N dni
// temu" do miesiąca, dalej zwykła data.
function formatRelativeDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const dayStart = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((dayStart(d) - dayStart(new Date())) / 86_400_000);
  if (diffDays === 0) return "dzisiaj";
  if (diffDays === -1) return "wczoraj";
  if (diffDays === 1) return "jutro";
  if (diffDays < 0 && diffDays > -30) return `${-diffDays} dni temu`;
  if (diffDays > 1 && diffDays < 30) return `za ${diffDays} dni`;
  return d.toLocaleDateString("pl-PL", { day: "numeric", month: "short", year: "numeric" });
}

// Ręczne dodanie deala: jeden samodzielny rekord (tożsamość + szansa sprzedaży).
function AddLeadModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  useScrollLock();
  const supabase = useMemo(() => createClient(), []);
  const { stages } = useStages();
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [value, setValue] = useState("");
  const [stage, setStage] = useState<Stage>(stages[0]?.key ?? "new");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      setError("Sesja wygasła. Zaloguj się ponownie i spróbuj jeszcze raz.");
      return;
    }

    const { error: dErr } = await supabase.from("deals").insert({
      owner: user.id,
      name: name.trim(),
      company: company.trim() || null,
      email: email.trim() || null,
      phone: phone.trim() || null,
      stage,
      value: value ? Number(value) : 0,
      source: "ręcznie",
    });

    setSaving(false);
    if (dErr) {
      setError(`Nie udało się zapisać deala: ${dErr.message}`);
      return;
    }
    onCreated();
  }

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,18,28,0.40)", zIndex: 40 }} />
      <div
        role="dialog"
        aria-modal="true"
        style={{
          ...menuPanel,
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(440px, calc(100vw - 32px))",
          boxShadow: tokens.shadowModal,
          zIndex: 41,
          padding: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>Nowy lead</h2>
          <button
            onClick={onClose}
            aria-label="Zamknij"
            style={{ width: 28, height: 28, borderRadius: tokens.radiusSm, border: `1px solid ${tokens.border}`, background: "#fff", display: "grid", placeItems: "center", cursor: "pointer", color: tokens.muted }}
          >
            <MIcon name="close" size={16} />
          </button>
        </div>

        <form onSubmit={save} style={{ display: "grid", gap: 11 }}>
          <Field label="Nazwa / osoba">
            <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} autoFocus />
          </Field>
          <Field label="Firma">
            <input value={company} onChange={(e) => setCompany(e.target.value)} style={inputStyle} />
          </Field>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Field label="E-mail">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Telefon">
              <input value={phone} onChange={(e) => setPhone(e.target.value)} style={inputStyle} />
            </Field>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Field label="Wartość (zł)">
              <input type="number" value={value} onChange={(e) => setValue(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Etap">
              <select value={stage} onChange={(e) => setStage(e.target.value as Stage)} style={inputStyle}>
                {stages.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {error && <p style={{ color: tokens.danger, fontSize: 12.5, margin: 0 }}>{error}</p>}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 2 }}>
            <button type="button" onClick={onClose} style={ghostButton}>
              Anuluj
            </button>
            <button type="submit" disabled={saving} style={primaryButton}>
              {saving ? "Zapisywanie…" : "Dodaj"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 4, flex: "1 1 140px", minWidth: 0 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: tokens.muted }}>{label}</span>
      {children}
    </label>
  );
}
