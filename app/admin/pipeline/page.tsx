// app/admin/pipeline/page.tsx — lejek sprzedaży (kanban).
// 5 kolumn etapów; karty kontaktów; klik karty otwiera ContactDrawer.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Plus, X, KanbanSquare, Table } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  tokens,
  inputStyle,
  primaryButton,
  ghostButton,
  formatPLN,
} from "@/lib/ui";
import { type Contact, type Stage, type SortConfig } from "@/lib/types";
import { useStages } from "@/lib/stages";
import ContactDrawer from "@/components/ContactDrawer";
import ContactTable from "@/components/ContactTable";
import FilterBar from "@/components/FilterBar";
import SavedViewTabs from "@/components/SavedViewTabs";
import { Filter, buildFilterQuery } from "@/lib/filters";

const DEFAULT_SORT: SortConfig = { key: "created_at", direction: "desc" };

export default function PipelinePage() {
  const supabase = useMemo(() => createClient(), []);
  const reduce = useReducedMotion();
  const { stages } = useStages();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerContact, setDrawerContact] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [filters, setFiltersState] = useState<Filter[]>([]);
  const [sort, setSort] = useState<SortConfig>(DEFAULT_SORT);
  const [viewMode, setViewMode] = useState<"kanban" | "table">("kanban");
  const [urlParsed, setUrlParsed] = useState(false);
  const urlHadFilters = useRef(false);

  // Load viewMode from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("selltic_pipeline_view");
    if (saved === "kanban" || saved === "table") {
      setViewMode(saved);
    }
  }, []);

  // Filtry współdzielone w URL (8.4) — czytamy raz przy montowaniu.
  useEffect(() => {
    const fParam = searchParams.get("f");
    if (fParam) {
      try {
        const decoded = JSON.parse(decodeURIComponent(atob(fParam)));
        if (Array.isArray(decoded)) {
          urlHadFilters.current = true;
          setFiltersState(decoded);
        }
      } catch (e) {
        console.error("Błąd dekodowania filtrów z URL", e);
      }
    }
    setUrlParsed(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const syncUrl = useCallback(
    (next: Filter[]) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next.length > 0) {
        // btoa() nie radzi sobie z Unicode (polskie znaki) → encodeURIComponent.
        params.set("f", btoa(encodeURIComponent(JSON.stringify(next))));
      } else {
        params.delete("f");
      }
      router.replace(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams]
  );

  // Zmiana filtrów z FilterBar — aktualizuj stan i URL.
  const setFilters = useCallback(
    (next: Filter[]) => {
      setFiltersState(next);
      syncUrl(next);
    },
    [syncUrl]
  );

  const toggleView = (mode: "kanban" | "table") => {
    setViewMode(mode);
    localStorage.setItem("selltic_pipeline_view", mode);
  };

  // Wczytanie zapisanego widoku (8.6) — ustawia filtry, sortowanie i tryb.
  const applyView = useCallback(
    (v: { filters: Filter[]; sort: SortConfig | null; view_mode: "kanban" | "table" }) => {
      setFiltersState(v.filters);
      syncUrl(v.filters);
      setSort(v.sort ?? DEFAULT_SORT);
      setViewMode(v.view_mode);
      localStorage.setItem("selltic_pipeline_view", v.view_mode);
    },
    [syncUrl]
  );

  const load = useCallback(async (activeFilters: Filter[]) => {
    setLoading(true);
    let query = supabase
      .from("contacts")
      .select("*")
      .order("updated_at", { ascending: false });

    query = buildFilterQuery(query, activeFilters);

    const { data } = await query;
    setContacts((data as Contact[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load(filters);
  }, [load, filters]);

  const byStage = useMemo(() => {
    const map: Record<Stage, Contact[]> = {};
    for (const s of stages) map[s.key] = [];
    for (const c of contacts) {
      if (!map[c.stage]) map[c.stage] = [];
      map[c.stage].push(c);
    }
    return map;
  }, [contacts, stages]);

  // Po zamknięciu panelu odśwież (etap mógł się zmienić w drawerze).
  function closeDrawer() {
    setDrawerContact(null);
    load(filters);
  }

  return (
    <div>
      {urlParsed && (
        <SavedViewTabs
          filters={filters}
          sort={sort}
          viewMode={viewMode}
          suppressInitialApply={urlHadFilters.current}
          onApply={applyView}
        />
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Lejek</h1>
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
          Dodaj kontakt
        </button>
      </div>

      <FilterBar filters={filters} onChange={setFilters} />

      {loading ? (
        <p style={{ color: tokens.muted }}>Wczytywanie…</p>
      ) : viewMode === "kanban" ? (
        <div
          className="selltic-scroll-x"
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${stages.length}, minmax(200px, 1fr))`,
            gap: 14,
            overflowX: "auto",
            paddingBottom: 8,
          }}
        >
          {stages.map((s) => {
            const list = byStage[s.key] ?? [];
            const total = list.reduce((sum, c) => sum + Number(c.value || 0), 0);
            return (
              <div key={s.key} style={{ minWidth: 220 }}>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    marginBottom: 10,
                    padding: "0 2px",
                  }}
                >
                  {/* Wiersz 1: kropka + nazwa etapu (zawija się przy długich nazwach z 8.3). */}
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
                      style={{
                        fontSize: 14,
                        fontWeight: 700,
                        lineHeight: 1.3,
                        wordBreak: "break-word",
                      }}
                    >
                      {s.label}
                    </span>
                  </div>
                  {/* Wiersz 2: licznik kontaktów + suma wartości (PLN). */}
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
                  style={{
                    display: "grid",
                    gap: 8,
                    background: tokens.bg,
                    borderRadius: 12,
                    minHeight: 60,
                    padding: 4,
                  }}
                >
                  {list.length === 0 ? (
                    <p style={{ fontSize: 12.5, color: tokens.muted, padding: "12px 8px", margin: 0 }}>
                      Brak kontaktów
                    </p>
                  ) : (
                    <AnimatePresence initial={false}>
                      {list.map((c) => (
                        <motion.button
                          key={c.id}
                          layout={!reduce}
                          onClick={() => setDrawerContact(c.id)}
                          initial={{ opacity: 0, scale: reduce ? 1 : 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: reduce ? 1 : 0.95 }}
                          whileHover={reduce ? undefined : { scale: 1.02, y: -2 }}
                          transition={
                            reduce ? { duration: 0 } : { type: "spring", stiffness: 400, damping: 32 }
                          }
                          style={{
                            textAlign: "left",
                            background: tokens.card,
                            border: `1px solid ${tokens.border}`,
                            borderRadius: 12,
                            padding: "12px 13px",
                            cursor: "pointer",
                            display: "grid",
                            gap: 6,
                          }}
                        >
                          <div style={{ fontSize: 14, fontWeight: 600 }}>
                            {c.name || "Bez nazwy"}
                          </div>
                          {c.company && (
                            <div style={{ fontSize: 12.5, color: tokens.muted }}>{c.company}</div>
                          )}
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                            <span style={{ fontSize: 11.5, color: tokens.muted }}>
                              {c.source ? `📋 ${c.source}` : "ręcznie"}
                            </span>
                            {Number(c.value) > 0 && (
                              <span style={{ fontSize: 12.5, fontWeight: 700 }}>{formatPLN(c.value)}</span>
                            )}
                          </div>
                        </motion.button>
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
          <ContactTable
            contacts={contacts}
            onRowClick={setDrawerContact}
            sort={sort}
            onSortChange={setSort}
          />
        </div>
      )}

      {showAdd && (
        <AddContactModal
          onClose={() => setShowAdd(false)}
          onCreated={(c) => {
            setContacts((list) => [c, ...list]);
            setShowAdd(false);
          }}
        />
      )}

      <AnimatePresence>
        {drawerContact && (
          <ContactDrawer key="drawer" contactId={drawerContact} onClose={closeDrawer} />
        )}
      </AnimatePresence>
    </div>
  );
}

function AddContactModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (c: Contact) => void;
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
      return;
    }
    const { data, error } = await supabase
      .from("contacts")
      .insert({
        owner: user.id,
        name: name.trim(),
        company: company.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        value: value ? Number(value) : 0,
        stage,
        source: "ręcznie",
      })
      .select()
      .single();
    setSaving(false);
    if (error) {
      setError("Nie udało się zapisać (czy e-mail nie jest już użyty?).");
      return;
    }
    if (data) onCreated(data as Contact);
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
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Nowy kontakt</h2>
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
