// app/admin/pipeline/page.tsx — lejek sprzedaży (kanban / tabela) na DEALACH.
// Faza 10: karty/wiersze to deale, samodzielne rekordy (tożsamość + szansa
// sprzedaży razem). Klik prowadzi na stronę deala (/admin/leads/[id]).
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useRouter } from "next/navigation";
import { Plus, X, KanbanSquare, Table } from "lucide-react";
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
import LeadTable from "@/components/LeadTable";
import FilterBar from "@/components/FilterBar";
import { Filter, buildFilterQuery } from "@/lib/filters";

export default function PipelinePage() {
  const supabase = useMemo(() => createClient(), []);
  const reduce = useReducedMotion();
  const router = useRouter();
  const { stages } = useStages();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [filters, setFilters] = useState<Filter[]>([]);
  const [viewMode, setViewMode] = useState<"kanban" | "table">("kanban");

  useEffect(() => {
    const saved = localStorage.getItem("selltic_pipeline_view");
    if (saved === "kanban" || saved === "table") setViewMode(saved);
  }, []);

  const toggleView = (mode: "kanban" | "table") => {
    setViewMode(mode);
    localStorage.setItem("selltic_pipeline_view", mode);
  };

  const load = useCallback(async (activeFilters: Filter[]) => {
    setLoading(true);
    let query = supabase
      .from("deals")
      .select("*")
      .order("opened_at", { ascending: false });

    query = buildFilterQuery(query, activeFilters);

    const { data } = await query;
    setDeals((data as Deal[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load(filters);
  }, [load, filters]);

  const openDeal = (id: string) => router.push(`/admin/leads/${id}`);

  const byStage = useMemo(() => {
    const map: Record<Stage, Deal[]> = {};
    for (const s of stages) map[s.key] = [];
    for (const d of deals) {
      if (!map[d.stage]) map[d.stage] = [];
      map[d.stage].push(d);
    }
    return map;
  }, [deals, stages]);

  return (
    <div>
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
          Dodaj lead
        </button>
      </div>

      <FilterBar onFilterChange={setFilters} />

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
            const total = list.reduce((sum, d) => sum + Number(d.value || 0), 0);
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
                      Brak leadów
                    </p>
                  ) : (
                    <AnimatePresence initial={false}>
                      {list.map((d) => (
                        <motion.button
                          key={d.id}
                          layout={!reduce}
                          onClick={() => openDeal(d.id)}
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
                            {d.name || "Bez nazwy"}
                          </div>
                          {d.company && (
                            <div style={{ fontSize: 12.5, color: tokens.muted }}>{d.company}</div>
                          )}
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                            <span style={{ fontSize: 11.5, color: tokens.muted }}>
                              {d.source ? `📋 ${d.source}` : "ręcznie"}
                            </span>
                            {Number(d.value) > 0 && (
                              <span style={{ fontSize: 12.5, fontWeight: 700 }}>{formatPLN(d.value)}</span>
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
          <LeadTable leads={deals} onRowClick={openDeal} />
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
