// app/admin/scraper/page.tsx — zakładka "Scraper": headless Google Maps
// scraper sterowany z CRM. Tworzy scrape_jobs (keyword × location), woła
// webhook Cloud Run (przez /api/scraper/start), i pokazuje postęp oraz
// wyniki na żywo przez Supabase Realtime.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Rocket, RefreshCw, CheckSquare, Square, ArrowRightCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { tokens, inputStyle, primaryButton, ghostButton, formatDateTime } from "@/lib/ui";
import { useToast } from "@/components/Toast";
import type { ScrapeJob, ScrapedLead, Prospect } from "@/lib/types";

type Tab = "leads" | "duplicates";

const JOB_STATUS_LABEL: Record<ScrapeJob["status"], string> = {
  pending: "Oczekuje",
  running: "W trakcie",
  done: "Gotowe",
  error: "Błąd",
};
const JOB_STATUS_COLOR: Record<ScrapeJob["status"], string> = {
  pending: tokens.muted,
  running: tokens.accent,
  done: tokens.success,
  error: tokens.danger,
};

export default function ScraperPage() {
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();

  const [keywordsText, setKeywordsText] = useState("");
  const [locationsText, setLocationsText] = useState("");
  const [starting, setStarting] = useState(false);

  const [jobs, setJobs] = useState<ScrapeJob[]>([]);
  const [leads, setLeads] = useState<ScrapedLead[]>([]);
  const [tab, setTab] = useState<Tab>("leads");

  const loadJobs = useCallback(async () => {
    const { data } = await supabase
      .from("scrape_jobs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    setJobs((data as ScrapeJob[]) ?? []);
  }, [supabase]);

  const loadLeads = useCallback(async () => {
    const { data } = await supabase
      .from("scraped_leads")
      .select("*")
      .in("status", ["new", "duplicate"])
      .order("score", { ascending: false });
    setLeads((data as ScrapedLead[]) ?? []);
  }, [supabase]);

  useEffect(() => {
    loadJobs();
    loadLeads();

    // Realtime: statusy zadań i nowe/zmienione leady na żywo, bez pollingu.
    const channel = supabase
      .channel("scraper_tab")
      .on("postgres_changes", { event: "*", schema: "public", table: "scrape_jobs" }, () => loadJobs())
      .on("postgres_changes", { event: "*", schema: "public", table: "scraped_leads" }, () => loadLeads())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, loadJobs, loadLeads]);

  async function startScraping() {
    const keywords = keywordsText.split("\n").map((k) => k.trim()).filter(Boolean);
    const locations = locationsText.split("\n").map((l) => l.trim()).filter(Boolean);
    if (keywords.length === 0 || locations.length === 0) {
      toast.error("Podaj co najmniej jedno słowo kluczowe i jedną lokalizację.");
      return;
    }
    setStarting(true);
    try {
      const resp = await fetch("/api/scraper/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords, locations }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        toast.error(data.error ?? "Nie udało się uruchomić scrapowania.");
        return;
      }
      toast.success(`Utworzono ${keywords.length * locations.length} zadań.`);
      if (data.warning) toast.error(data.warning);
      loadJobs();
    } catch {
      toast.error("Błąd połączenia z serwerem.");
    } finally {
      setStarting(false);
    }
  }

  const newLeads = leads.filter((l) => l.status === "new");
  const duplicateLeads = leads.filter((l) => l.status === "duplicate");

  const recentBatchIds = useMemo(() => {
    const seen: string[] = [];
    for (const j of jobs) {
      if (!seen.includes(j.batch_id)) seen.push(j.batch_id);
      if (seen.length >= 3) break;
    }
    return seen;
  }, [jobs]);

  return (
    <div style={{ maxWidth: 980 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 20px" }}>Scraper</h1>

      <section
        style={{
          background: tokens.card,
          border: `1px solid ${tokens.border}`,
          borderRadius: tokens.radius,
          padding: 20,
          marginBottom: 20,
        }}
      >
        <p style={{ fontSize: 14, color: tokens.muted, margin: "0 0 14px" }}>
          Podaj słowa kluczowe i lokalizacje (po jednej w linii). Scraper wygeneruje zadanie
          dla każdej kombinacji słowo kluczowe × lokalizacja.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Słowa kluczowe</span>
            <textarea
              value={keywordsText}
              onChange={(e) => setKeywordsText(e.target.value)}
              placeholder={"psycholog\npsychoterapeuta"}
              rows={5}
              style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
            />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Lokalizacje</span>
            <textarea
              value={locationsText}
              onChange={(e) => setLocationsText(e.target.value)}
              placeholder={"Wrocław Krzyki\nWrocław Fabryczna"}
              rows={5}
              style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
            />
          </label>
        </div>
        <button
          onClick={startScraping}
          disabled={starting}
          style={{ ...primaryButton, marginTop: 14, display: "flex", alignItems: "center", gap: 8 }}
        >
          <Rocket size={16} />
          {starting ? "Uruchamianie…" : "Rozpocznij scrapowanie"}
        </button>
      </section>

      {recentBatchIds.length > 0 && (
        <section
          style={{
            background: tokens.card,
            border: `1px solid ${tokens.border}`,
            borderRadius: tokens.radius,
            padding: 20,
            marginBottom: 20,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Zadania</h2>
            <button onClick={loadJobs} style={{ ...ghostButton, display: "flex", alignItems: "center", gap: 6, padding: "6px 12px" }}>
              <RefreshCw size={14} /> Odśwież
            </button>
          </div>
          <div style={{ display: "grid", gap: 16 }}>
            {recentBatchIds.map((batchId) => (
              <JobsBatch key={batchId} jobs={jobs.filter((j) => j.batch_id === batchId)} />
            ))}
          </div>
        </section>
      )}

      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        <button
          onClick={() => setTab("leads")}
          style={{
            padding: "8px 16px",
            borderRadius: 10,
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
            border: `1px solid ${tab === "leads" ? tokens.accent : tokens.border}`,
            background: tab === "leads" ? tokens.accentSoft : "#fff",
            color: tab === "leads" ? tokens.accent : tokens.muted,
          }}
        >
          Leady ({newLeads.length})
        </button>
        <button
          onClick={() => setTab("duplicates")}
          style={{
            padding: "8px 16px",
            borderRadius: 10,
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
            border: `1px solid ${tab === "duplicates" ? tokens.accent : tokens.border}`,
            background: tab === "duplicates" ? tokens.accentSoft : "#fff",
            color: tab === "duplicates" ? tokens.accent : tokens.muted,
          }}
        >
          Duplikaty ({duplicateLeads.length})
        </button>
      </div>

      {tab === "leads" ? (
        <LeadsTab leads={newLeads} onMoved={loadLeads} />
      ) : (
        <DuplicatesTab leads={duplicateLeads} supabase={supabase} />
      )}
    </div>
  );
}

function JobsBatch({ jobs }: { jobs: ScrapeJob[] }) {
  const done = jobs.filter((j) => j.status === "done").length;
  const errored = jobs.filter((j) => j.status === "error").length;
  return (
    <div style={{ border: `1px solid ${tokens.border}`, borderRadius: 12, padding: 12 }}>
      <div style={{ fontSize: 13, color: tokens.muted, marginBottom: 8 }}>
        {done + errored}/{jobs.length} zakończonych
        {errored > 0 ? ` · ${errored} błędów` : ""} · utworzono {formatDateTime(jobs[0]?.created_at)}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {jobs.map((j) => (
          <div
            key={j.id}
            title={j.error_message ?? undefined}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 10px",
              borderRadius: 999,
              fontSize: 12.5,
              fontWeight: 600,
              border: `1px solid ${tokens.border}`,
              color: JOB_STATUS_COLOR[j.status],
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: JOB_STATUS_COLOR[j.status],
                flexShrink: 0,
              }}
            />
            {j.keyword} · {j.location}
            {j.status === "done" ? ` — ${j.results_count}` : ` — ${JOB_STATUS_LABEL[j.status]}`}
          </div>
        ))}
      </div>
    </div>
  );
}

function ScorePill({ score }: { score: number | null }) {
  const s = score ?? 0;
  const color = s >= 70 ? tokens.success : s >= 35 ? tokens.warning : tokens.muted;
  const bg = s >= 70 ? "rgba(24,169,87,0.10)" : s >= 35 ? "rgba(242,153,74,0.12)" : tokens.bg;
  return (
    <span style={{ padding: "2px 10px", borderRadius: 999, fontSize: 12.5, fontWeight: 700, color, background: bg }}>
      {s}
    </span>
  );
}

function LeadsTab({ leads, onMoved }: { leads: ScrapedLead[]; onMoved: () => void }) {
  const toast = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    // Odznacz leady, które zniknęły z listy (już przeniesione/oznaczone duplikatem gdzie indziej).
    setSelected((prev) => new Set([...prev].filter((id) => leads.some((l) => l.id === id))));
  }, [leads]);

  const allSelected = leads.length > 0 && selected.size === leads.length;

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(leads.map((l) => l.id)));
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function moveSelected() {
    if (selected.size === 0) return;
    setMoving(true);
    try {
      const resp = await fetch("/api/scraper/move-to-prospecting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scraped_lead_ids: [...selected] }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        toast.error(data.error ?? "Nie udało się przenieść leadów.");
        return;
      }
      toast.success(
        `Przeniesiono ${data.moved} do Prospectingu` +
          (data.duplicates > 0 ? `, ${data.duplicates} oznaczono jako duplikaty` : "") +
          "."
      );
      setSelected(new Set());
      onMoved();
    } catch {
      toast.error("Błąd połączenia z serwerem.");
    } finally {
      setMoving(false);
    }
  }

  if (leads.length === 0) {
    return (
      <section style={{ background: tokens.card, border: `1px solid ${tokens.border}`, borderRadius: tokens.radius, padding: 30, textAlign: "center", color: tokens.muted }}>
        Brak leadów — uruchom scrapowanie powyżej.
      </section>
    );
  }

  return (
    <section style={{ background: tokens.card, border: `1px solid ${tokens.border}`, borderRadius: tokens.radius, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: `1px solid ${tokens.border}` }}>
        <button onClick={toggleAll} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, color: tokens.text, fontSize: 13, fontWeight: 600 }}>
          {allSelected ? <CheckSquare size={17} color={tokens.accent} /> : <Square size={17} color={tokens.muted} />}
          Zaznacz wszystkie
        </button>
        <div style={{ flex: 1 }} />
        <button
          onClick={moveSelected}
          disabled={selected.size === 0 || moving}
          style={{ ...primaryButton, display: "flex", alignItems: "center", gap: 6, opacity: selected.size === 0 ? 0.5 : 1 }}
        >
          <ArrowRightCircle size={16} />
          {moving ? "Przenoszenie…" : `Przenieś do Prospectingu (${selected.size})`}
        </button>
      </div>
      <div style={{ maxHeight: 560, overflowY: "auto" }}>
        {leads.map((l) => (
          <div
            key={l.id}
            style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderBottom: `1px solid ${tokens.border}` }}
          >
            <button onClick={() => toggleOne(l.id)} style={{ background: "none", border: "none", cursor: "pointer", flexShrink: 0 }}>
              {selected.has(l.id) ? <CheckSquare size={17} color={tokens.accent} /> : <Square size={17} color={tokens.muted} />}
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.business_name}</div>
              <div style={{ fontSize: 12.5, color: tokens.muted }}>
                {l.source_keyword} · {l.source_location} · {l.address ?? "brak adresu"}
              </div>
            </div>
            <div style={{ fontSize: 13, color: tokens.muted, width: 130, flexShrink: 0 }}>{l.phone ?? "—"}</div>
            <div style={{ fontSize: 13, color: tokens.muted, width: 110, flexShrink: 0 }}>
              ⭐ {l.rating ?? "—"} ({l.review_count ?? 0})
            </div>
            <div style={{ width: 90, flexShrink: 0 }}>
              {l.website ? (
                <span style={{ fontSize: 12.5, color: tokens.muted }}>{l.website.replace(/^https?:\/\//, "").split("/")[0]}</span>
              ) : (
                <span style={{ fontSize: 12.5, color: tokens.success }}>Brak strony</span>
              )}
            </div>
            <div style={{ width: 50, flexShrink: 0, textAlign: "right" }}>
              <ScorePill score={l.score} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function DuplicatesTab({ leads, supabase }: { leads: ScrapedLead[]; supabase: ReturnType<typeof createClient> }) {
  const [prospectsById, setProspectsById] = useState<Record<string, Prospect>>({});

  useEffect(() => {
    const placeIds = [...new Set(leads.map((l) => l.place_id))];
    if (placeIds.length === 0) {
      setProspectsById({});
      return;
    }
    (async () => {
      const { data } = await supabase.from("prospects").select("*").in("place_id", placeIds);
      const map: Record<string, Prospect> = {};
      for (const p of (data as Prospect[]) ?? []) map[p.place_id] = p;
      setProspectsById(map);
    })();
  }, [leads, supabase]);

  if (leads.length === 0) {
    return (
      <section style={{ background: tokens.card, border: `1px solid ${tokens.border}`, borderRadius: tokens.radius, padding: 30, textAlign: "center", color: tokens.muted }}>
        Brak duplikatów do przeglądu.
      </section>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <p style={{ fontSize: 13, color: tokens.muted, margin: 0 }}>
        Te firmy już istnieją w Prospectingu (ten sam place_id) — nie zostały nadpisane
        automatycznie. Porównaj dane i zaktualizuj prospekt ręcznie, jeśli chcesz.
      </p>
      {leads.map((l) => {
        const p = prospectsById[l.place_id];
        return (
          <section key={l.id} style={{ background: tokens.card, border: `1px solid ${tokens.border}`, borderRadius: tokens.radius, padding: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>{l.business_name}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: tokens.muted, marginBottom: 6, textTransform: "uppercase" }}>
                  Istniejący prospekt
                </div>
                {p ? (
                  <CompareFields
                    rating={p.rating}
                    reviewCount={p.review_count}
                    score={p.lead_score}
                    website={p.website}
                    phone={p.phone}
                    when={p.created_at}
                  />
                ) : (
                  <span style={{ fontSize: 13, color: tokens.muted }}>Nie znaleziono (usunięty?)</span>
                )}
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: tokens.muted, marginBottom: 6, textTransform: "uppercase" }}>
                  Nowe dane ze scrapowania
                </div>
                <CompareFields
                  rating={l.rating}
                  reviewCount={l.review_count}
                  score={l.score}
                  website={l.website}
                  phone={l.phone}
                  when={l.scraped_at}
                />
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function CompareFields({
  rating,
  reviewCount,
  score,
  website,
  phone,
  when,
}: {
  rating: number | null;
  reviewCount: number | null;
  score: number | null;
  website: string | null;
  phone: string | null;
  when: string;
}) {
  return (
    <div style={{ fontSize: 13, display: "grid", gap: 4 }}>
      <div>⭐ {rating ?? "—"} ({reviewCount ?? 0} opinii)</div>
      <div>Score: <b>{score ?? "—"}</b></div>
      <div>Strona: {website ?? "brak"}</div>
      <div>Telefon: {phone ?? "—"}</div>
      <div style={{ color: tokens.muted }}>{formatDateTime(when)}</div>
    </div>
  );
}
