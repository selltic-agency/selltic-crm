// app/admin/pipeline/page.tsx — lejek sprzedaży (kanban / tabela) na DEALACH.
// Faza 10: karty/wiersze to deale, samodzielne rekordy (tożsamość + szansa
// sprzedaży razem). Klik prowadzi na stronę deala (/admin/leads/[id]).
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useRouter } from "next/navigation";
import {
  Plus,
  X,
  KanbanSquare,
  Table,
  Phone,
  Mail,
  Clock,
  CalendarClock,
  type LucideIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  tokens,
  inputStyle,
  primaryButton,
  ghostButton,
  formatPLN,
} from "@/lib/ui";
import { type Deal, type Stage } from "@/lib/types";
import { useStages } from "@/lib/stages";
import LeadTable, { type SortConfig } from "@/components/LeadTable";
import OwnerAvatar from "@/components/OwnerAvatar";
import FilterBar, { type FieldDef, type FilterBarHandle } from "@/components/FilterBar";
import ViewTabs from "@/components/ViewTabs";
import { Filter, Sort, buildFilterQuery } from "@/lib/filters";
import { useSavedViews, type SeedView } from "@/lib/savedViews";
import { loadViewPrefs, saveViewPrefs, planHydration, type ViewMode } from "@/lib/viewPrefs";
import { useEntityProperties, makeColumnResolver, toFieldDef, applyBulkProperty, appendPurposeHistory, type PropertyView } from "@/lib/properties";
import { useToast } from "@/components/Toast";

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

// Deal + metadane aktywności dociągane razem z listą (osadzone zasoby
// PostgREST): ostatnia aktywność i najbliższe otwarte zadanie z terminem.
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
  const { views: properties } = useEntityProperties("deals");
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [filters, setFilters] = useState<Filter[]>([]);
  const [viewMode, setViewMode] = useState<"kanban" | "table">("kanban");
  const [tableSort, setTableSort] = useState<SortConfig>(DEFAULT_TABLE_SORT);
  const filterBarRef = useRef<FilterBarHandle>(null);

  // Pola filtrów = wbudowane + właściwości (kategoria/cel + własne). Resolver
  // mapuje właściwości własne na ścieżkę props jsonb dla zapytania.
  const filterFields = useMemo<FieldDef[]>(() => [...DEAL_BUILT_IN_FIELDS, ...properties.map(toFieldDef)], [properties]);
  const resolveColumn = useMemo(() => makeColumnResolver(properties), [properties]);

  // Zbiorcza edycja dowolnej właściwości dla zaznaczonych deali.
  const handleBulkEdit = useCallback(
    async (ids: string[], view: PropertyView, value: unknown, mode: "replace" | "add") => {
      if (ids.length === 0) return;
      const { error } = await applyBulkProperty(supabase, "deals", ids, view, value, mode);
      if (error) {
        toast.error("Nie udało się zapisać właściwości.");
        return;
      }
      // Cel kontaktu: dopisz też historię (append-only), gdy dokładamy wartości.
      if (view.key === "purposes" && mode === "add") {
        await appendPurposeHistory(supabase, "deals", ids, Array.isArray(value) ? (value as string[]) : []);
      }
      toast.success(ids.length === 1 ? "Zapisano." : `Zaktualizowano ${ids.length} leadów.`);
      load(filters);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [supabase, toast, filters]
  );

  // ID zalogowanego użytkownika — do namespace'owania trwałego stanu widoku.
  // `undefined` = jeszcze nie wiadomo, `null` = brak sesji.
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, [supabase]);

  const toggleView = (mode: "kanban" | "table") => {
    setViewMode(mode);
  };

  // Brak predefiniowanych (systemowych) zakładek — pozostaje tylko „Wszystkie"
  // (zaszyta w ViewTabs) oraz widoki tworzone ręcznie przez użytkownika.
  const seedDefaults = useCallback(async (): Promise<SeedView[]> => [], []);

  // Zasiew domyślnych widoków czeka na etapy lejka (klucze wygrane/przegrane).
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
  } = useSavedViews("deals", seedDefaults, !stagesLoading);

  // W zakładkach pokazujemy tylko widoki utworzone ręcznie przez użytkownika.
  // Predefiniowane/systemowe (is_default) są ukryte — „Wszystkie" wystarcza.
  const customViews = useMemo(() => views.filter((v) => !v.is_default), [views]);

  // Zastosuj widok (zakładkę) do filtrów/trybu/sortu.
  const applyView = useCallback((filters_: Filter[], mode: "kanban" | "table", sort: Sort | null) => {
    filterBarRef.current?.setFilters(filters_);
    setViewMode(mode);
    setTableSort(sort ? { key: sort.column, direction: sort.direction } : DEFAULT_TABLE_SORT);
  }, []);

  // ── Hydratacja trwałego stanu widoku (per-user, przeżywa odświeżenie i
  // nawigację). Uruchamiana raz, gdy znamy użytkownika i wczytano widoki. ──
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (hydrated || viewsLoading || userId === undefined) return;
    // Stan początkowy to ZAWSZE „Wszystkie" (brak widoku, brak filtrów). Z prefs
    // przywracamy wyłącznie preferencje prezentacji (tryb widoku + sortowanie);
    // filtry z udostępnionego linku (?f=…) odtwarza sam FilterBar i pojawią się
    // jako filtr tymczasowy, nie jako zapisany widok.
    const prefs = loadViewPrefs("deals", userId);
    const plan = planHydration(prefs);
    if (plan.restoreDisplayFromPrefs && prefs) {
      if (prefs.viewMode) setViewMode(prefs.viewMode);
      if (prefs.sort !== undefined) setTableSort(prefs.sort ? { key: prefs.sort.column, direction: prefs.sort.direction } : DEFAULT_TABLE_SORT);
    }
    setHydrated(true);
  }, [hydrated, viewsLoading, userId]);

  const handleSelectView = (id: string) => {
    selectView(id);
    const v = views.find((x) => x.id === id);
    if (v) applyView(v.filters, v.view_mode, v.sort);
  };

  // „Wszystkie" — stan domyślny: brak aktywnego widoku i brak filtrów.
  const handleSelectAll = useCallback(() => {
    selectView(null);
    filterBarRef.current?.setFilters([]);
    setTableSort(DEFAULT_TABLE_SORT);
  }, [selectView]);

  const currentSort: Sort | null = viewMode === "table" ? { column: tableSort.key, direction: tableSort.direction } : null;

  const isDirty = useMemo(() => {
    if (!activeView) return false;
    return (
      JSON.stringify(filters) !== JSON.stringify(activeView.filters) ||
      viewMode !== activeView.view_mode ||
      JSON.stringify(currentSort) !== JSON.stringify(activeView.sort ?? null)
    );
  }, [activeView, filters, viewMode, currentSort]);

  // Filtr tymczasowy (ad-hoc): bieżące filtry różnią się od aktywnej zakładki
  // (albo od „Wszystkie", gdy żaden widok nie jest wybrany).
  const adhoc = activeView ? isDirty : filters.length > 0;

  // Wyczyść filtr tymczasowy — wróć do bazowej zakładki bez ruszania widoków.
  const handleClearAdhoc = useCallback(() => {
    if (activeView) applyView(activeView.filters, activeView.view_mode, activeView.sort);
    else {
      filterBarRef.current?.setFilters([]);
      setTableSort(DEFAULT_TABLE_SORT);
    }
  }, [activeView, applyView]);

  // ── Zapis preferencji prezentacji (tylko tryb widoku + sortowanie) ─────
  // Filtry i aktywny widok NIE są utrwalane — każde wejście startuje z „Wszystkie".
  useEffect(() => {
    if (!hydrated) return;
    saveViewPrefs("deals", userId ?? null, {
      sort: { column: tableSort.key, direction: tableSort.direction },
      viewMode: viewMode as ViewMode,
    });
  }, [hydrated, userId, tableSort, viewMode]);

  const load = useCallback(async (activeFilters: Filter[]) => {
    setLoading(true);
    // Osadzone zasoby: najnowsza aktywność (oś czasu deala) i najbliższe
    // otwarte zadanie z terminem — po 1 rekordzie na deal, na potrzeby kart.
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
  }, [supabase, resolveColumn]);

  useEffect(() => {
    load(filters);
  }, [load, filters]);

  const openDeal = (id: string) => router.push(`/admin/leads/${id}`);

  const byStage = useMemo(() => {
    const map: Record<Stage, DealRow[]> = {};
    for (const s of stages) map[s.key] = [];
    for (const d of deals) {
      if (!map[d.stage]) map[d.stage] = [];
      map[d.stage].push(d);
    }
    return map;
  }, [deals, stages]);

  return (
    // Kanban wypełnia całą wysokość okna (przewijanie żyje wewnątrz kolumn
    // etapów, nie na stronie); tabela zachowuje zwykły przepływ dokumentu.
    <div className={viewMode === "kanban" ? "selltic-page-fill" : undefined}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Leady</h1>
          <div
            style={{
              display: "flex",
              background: tokens.border,
              padding: 2,
              borderRadius: 10,
              gap: 2,
            }}
          >
            <button
              onClick={() => toggleView("kanban")}
              style={{
                ...viewTabBtn,
                background: viewMode === "kanban" ? tokens.card : "transparent",
                color: viewMode === "kanban" ? tokens.accent : tokens.muted,
                boxShadow: viewMode === "kanban" ? "0 2px 8px rgba(0,0,0,0.08)" : "none",
              }}
              title="Kanban"
            >
              <KanbanSquare size={16} />
            </button>
            <button
              onClick={() => toggleView("table")}
              style={{
                ...viewTabBtn,
                background: viewMode === "table" ? tokens.card : "transparent",
                color: viewMode === "table" ? tokens.accent : tokens.muted,
                boxShadow: viewMode === "table" ? "0 2px 8px rgba(0,0,0,0.08)" : "none",
              }}
              title="Tabela"
            >
              <Table size={16} />
            </button>
          </div>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          style={{ ...primaryButton, display: "flex", alignItems: "center", gap: 6 }}
        >
          <Plus size={16} />
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
        onCreate={(name) => createView(name, { filters, sort: currentSort, view_mode: viewMode })}
        onRename={(id, name) => updateView(id, { name })}
        onDelete={deleteView}
        onSaveChanges={() => activeView && updateView(activeView.id, { filters, sort: currentSort, view_mode: viewMode })}
        onClearAdhoc={handleClearAdhoc}
      />

      <FilterBar ref={filterBarRef} fields={filterFields} onFilterChange={setFilters} />

      {loading ? (
        <p style={{ color: tokens.muted }}>Wczytywanie…</p>
      ) : viewMode === "kanban" ? (
        <div
          className="selltic-scroll-x"
          style={{
            flex: 1,
            minHeight: 0,
            display: "grid",
            gridTemplateColumns: `repeat(${stages.length}, minmax(250px, 1fr))`,
            gap: 12,
            overflowX: "auto",
            paddingBottom: 4,
          }}
        >
          {stages.map((s) => {
            const list = byStage[s.key] ?? [];
            const total = list.reduce((sum, d) => sum + Number(d.value || 0), 0);
            return (
              // Kolumna etapu = wyraźnie wydzielona „komórka": przyciemnione
              // tło, obrys i cień; nagłówek stoi w miejscu, przewija się
              // wyłącznie lista kart poniżej.
              <div
                key={s.key}
                style={{
                  minWidth: 250,
                  minHeight: 0,
                  display: "flex",
                  flexDirection: "column",
                  background: "#EDEFF4",
                  border: "1px solid #E2E5EC",
                  borderRadius: 14,
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.7), 0 1px 3px rgba(15,18,28,0.05)",
                }}
              >
                <div
                  style={{
                    flexShrink: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    padding: "12px 12px 10px",
                    borderBottom: "1px solid #E2E5EC",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                    <span
                      style={{
                        width: 9,
                        height: 9,
                        borderRadius: "50%",
                        background: s.color,
                        flexShrink: 0,
                        marginTop: 5,
                      }}
                    />
                    <span
                      title={s.label}
                      style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.3, wordBreak: "break-word" }}
                    >
                      {s.label}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 17 }}>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: tokens.muted,
                        background: tokens.card,
                        border: `1px solid ${tokens.border}`,
                        borderRadius: 999,
                        padding: "1px 8px",
                        flexShrink: 0,
                      }}
                    >
                      {list.length}
                    </span>
                    <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, color: tokens.muted }}>
                      {formatPLN(total)}
                    </span>
                  </div>
                </div>

                <div
                  className="selltic-scroll-y"
                  style={{
                    flex: 1,
                    minHeight: 60,
                    overflowY: "auto",
                    display: "grid",
                    gap: 8,
                    padding: 8,
                    alignContent: "start",
                  }}
                >
                  {list.length === 0 ? (
                    <p style={{ fontSize: 12.5, color: tokens.muted, padding: "12px 8px", margin: 0 }}>
                      Brak leadów
                    </p>
                  ) : (
                    <AnimatePresence initial={false}>
                      {list.map((d) => (
                        <DealCard key={d.id} deal={d} reduce={!!reduce} onOpen={openDeal} />
                      ))}
                    </AnimatePresence>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ background: tokens.card, border: `1px solid ${tokens.border}`, borderRadius: 16, overflow: "hidden" }}>
          <LeadTable leads={deals} onRowClick={openDeal} sort={tableSort} onSortChange={setTableSort} properties={properties} onBulkEdit={handleBulkEdit} />
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

// Karta deala na kanbanie (układ HubSpot-style): tytuł do 2 linii, telefon,
// e-mail, ostatnia/następna aktywność (przeterminowana → czerwona), owner.
function DealCard({
  deal: d,
  reduce,
  onOpen,
}: {
  deal: DealRow;
  reduce: boolean;
  onOpen: (id: string) => void;
}) {
  const lastActivityAt = d.activities?.[0]?.created_at ?? null;
  const nextDueAt = d.tasks?.[0]?.due_at ?? null;
  const isOverdue = !!nextDueAt && new Date(nextDueAt).getTime() < Date.now();

  return (
    <motion.button
      layout={!reduce}
      onClick={() => onOpen(d.id)}
      initial={{ opacity: 0, scale: reduce ? 1 : 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: reduce ? 1 : 0.95 }}
      whileHover={reduce ? undefined : { scale: 1.02, y: -2 }}
      transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 400, damping: 32 }}
      style={{
        textAlign: "left",
        background: tokens.card,
        border: `1px solid ${tokens.border}`,
        borderRadius: 12,
        padding: "12px 13px",
        cursor: "pointer",
        display: "grid",
        gap: 8,
        boxShadow: "0 1px 2px rgba(15,18,28,0.05)",
      }}
    >
      <div
        title={d.name ?? undefined}
        style={{
          fontSize: 14,
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

      <div style={{ display: "grid", gap: 5 }}>
        {d.phone && <CardMetaRow icon={Phone} text={d.phone} />}
        {d.email && <CardMetaRow icon={Mail} text={d.email} />}
        <CardMetaRow
          icon={Clock}
          muted
          text={
            lastActivityAt
              ? `Ostatnia aktywność: ${formatRelativeDate(lastActivityAt)}`
              : "Brak aktywności"
          }
        />
        {nextDueAt ? (
          <CardMetaRow
            icon={CalendarClock}
            danger={isOverdue}
            text={`${isOverdue ? "Po terminie" : "Następna aktywność"}: ${formatRelativeDate(nextDueAt)}`}
          />
        ) : (
          <CardMetaRow icon={CalendarClock} muted text="Brak zaplanowanych działań" />
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <OwnerAvatar assignee={d.assignee} size={22} />
        {Number(d.value) > 0 && (
          <span style={{ fontSize: 12.5, fontWeight: 700 }}>{formatPLN(d.value)}</span>
        )}
      </div>
    </motion.button>
  );
}

// Wiersz metadanych karty: ikona + tekst w jednej, uciętej linii.
function CardMetaRow({
  icon: Icon,
  text,
  muted = false,
  danger = false,
}: {
  icon: LucideIcon;
  text: string;
  muted?: boolean;
  danger?: boolean;
}) {
  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        minWidth: 0,
        fontSize: 12,
        fontWeight: danger ? 700 : 500,
        color: danger ? tokens.danger : muted ? tokens.muted : tokens.text,
        ...(danger
          ? { background: "rgba(229,72,77,0.10)", borderRadius: 6, padding: "3px 6px", margin: "-1px -4px" }
          : {}),
      }}
    >
      <Icon size={13} style={{ flexShrink: 0 }} />
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
function AddLeadModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
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
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(15,18,28,0.40)", zIndex: 40 }}
      />
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(440px, calc(100vw - 32px))",
          background: tokens.card,
          borderRadius: tokens.radius,
          border: `1px solid ${tokens.border}`,
          boxShadow: "0 24px 60px rgba(15,18,28,0.18)",
          zIndex: 41,
          padding: 22,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Nowy lead</h2>
          <button
            onClick={onClose}
            aria-label="Zamknij"
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              border: `1px solid ${tokens.border}`,
              background: "#fff",
              display: "grid",
              placeItems: "center",
              cursor: "pointer",
            }}
          >
            <X size={16} color={tokens.muted} />
          </button>
        </div>

        <form onSubmit={save} style={{ display: "grid", gap: 12 }}>
          <Field label="Nazwa / osoba">
            <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} autoFocus />
          </Field>
          <Field label="Firma">
            <input value={company} onChange={(e) => setCompany(e.target.value)} style={inputStyle} />
          </Field>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Field label="E-mail">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Telefon">
              <input value={phone} onChange={(e) => setPhone(e.target.value)} style={inputStyle} />
            </Field>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
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

          {error && <p style={{ color: tokens.danger, fontSize: 13, margin: 0 }}>{error}</p>}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 4 }}>
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
    <label style={{ display: "grid", gap: 5, flex: "1 1 140px", minWidth: 0 }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
      {children}
    </label>
  );
}

const viewTabBtn: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 8,
  display: "grid",
  placeItems: "center",
  border: "none",
  cursor: "pointer",
  transition: "all 0.2s ease",
};
