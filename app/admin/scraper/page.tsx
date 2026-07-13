// app/admin/scraper/page.tsx — zakładka "Scraper": headless Google Maps
// scraper sterowany z CRM. Tworzy scrape_jobs (keyword × location) zgrupowane w
// paczki (scrape_batches), woła webhook Cloud Run (przez /api/scraper/start), i
// pokazuje postęp oraz wyniki na żywo przez Supabase Realtime.
//
// Każda paczka to zwijany wiersz: nagłówek (słowa kluczowe, data, postęp, liczba
// leadów, status) + sterowanie (Pauza / Stop / Wznów). Rozwinięcie pokazuje
// pełną listę zadań miasto × słowo kluczowe. Aktywne paczki są u góry; reszta w
// paginowanej sekcji „Historia scrapowania”.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Rocket, RefreshCw, CheckSquare, Square, ArrowRightCircle, Loader2,
  Archive, RotateCcw, Pause, Play, Ban, ChevronRight, ChevronDown,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { tokens, inputStyle, primaryButton, ghostButton, formatDateTime } from "@/lib/ui";
import { useToast } from "@/components/Toast";
import { humanizeScrapeError, ZERO_RESULTS_MESSAGE, formatFound } from "@/lib/scraperMessages";
import { ScoreBadge } from "@/components/ScoreBreakdown";
import type { ScrapeJob, ScrapeBatch, ScrapeBatchStatus, ScrapedLead, Prospect } from "@/lib/types";

type Tab = "leads" | "duplicates" | "archive";

const HISTORY_PAGE_SIZE = 15;

const JOB_STATUS_LABEL: Record<ScrapeJob["status"], string> = {
  pending: "Oczekuje",
  running: "W trakcie",
  done: "Gotowe",
  error: "Błąd",
  canceled: "Anulowane",
};
const JOB_STATUS_COLOR: Record<ScrapeJob["status"], string> = {
  pending: tokens.muted,
  running: tokens.accent,
  done: tokens.success,
  error: tokens.danger,
  canceled: tokens.muted,
};

const BATCH_STATUS_LABEL: Record<ScrapeBatchStatus, string> = {
  running: "W trakcie",
  paused: "Wstrzymane",
  stopped: "Zatrzymane",
  completed: "Zakończone",
};
const BATCH_STATUS_COLOR: Record<ScrapeBatchStatus, string> = {
  running: tokens.accent,
  paused: tokens.warning,
  stopped: tokens.danger,
  completed: tokens.success,
};

// ── Agregaty paczki liczone z jej zadań ──────────────────────────────────
type BatchAgg = {
  done: number;
  errored: number;
  canceled: number;
  running: number;
  pending: number;
  total: number;
  finished: number;
  leads: number;
  newLeads: number;
  existing: number;
};

function computeAgg(batch: ScrapeBatch, jobs: ScrapeJob[]): BatchAgg {
  let done = 0, errored = 0, canceled = 0, running = 0, pending = 0;
  let leads = 0, newLeads = 0, existing = 0;
  for (const j of jobs) {
    if (j.status === "done") done++;
    else if (j.status === "error") errored++;
    else if (j.status === "canceled") canceled++;
    else if (j.status === "running") running++;
    else if (j.status === "pending") pending++;
    leads += j.results_count || 0;
    newLeads += j.new_count || 0;
    existing += j.existing_count || 0;
  }
  const total = batch.total_jobs || jobs.length;
  return { done, errored, canceled, running, pending, total, finished: done + errored + canceled, leads, newLeads, existing };
}

// Status paczki widoczny użytkownikowi. Fallback: paczka wciąż 'running', ale
// wszystkie zadania są terminalne → traktujemy jako 'completed' (backend/watchdog
// domknie ją w bazie, my nie czekamy z UI).
function effectiveStatus(batch: ScrapeBatch, agg: BatchAgg): ScrapeBatchStatus {
  // Uwaga: warunkiem jest finished >= total (wszystkie zadania rozliczone jako
  // terminalne), a NIE „brak pending/running”. Świeża paczka, której zadania nie
  // wczytały się jeszcze do stanu, ma pending=running=0 przy finished=0 — nie
  // wolno jej wtedy uznać za zakończoną.
  if (batch.status === "running" && agg.total > 0 && agg.finished >= agg.total) {
    return "completed";
  }
  return batch.status;
}

export default function ScraperPage() {
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();

  const [keywordsText, setKeywordsText] = useState("");
  const [locationsText, setLocationsText] = useState("");
  const [starting, setStarting] = useState(false);

  const [batches, setBatches] = useState<ScrapeBatch[]>([]);
  const [jobs, setJobs] = useState<ScrapeJob[]>([]);
  const [leads, setLeads] = useState<ScrapedLead[]>([]);
  const [tab, setTab] = useState<Tab>("leads");
  const [refreshing, setRefreshing] = useState(false);
  const [historyPage, setHistoryPage] = useState(0);
  const [controlBusy, setControlBusy] = useState<string | null>(null);

  // Puls „nowy lead” na liczniku + zliczanie przychodzących leadów do jednego
  // zbiorczego toasta (unikamy 60 toastów przy dużym scrapowaniu).
  const [leadPulseKey, setLeadPulseKey] = useState(0);
  const newLeadCount = useRef(0);
  const newLeadLastName = useRef("");
  const newLeadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cykl życia zadań/paczek — toasty tylko dla scrapowań uruchomionych w tej sesji.
  const sessionBatchIds = useRef<Set<string>>(new Set());
  const announcedJobTerminal = useRef<Set<string>>(new Set());
  const announcedBatchStart = useRef<Set<string>>(new Set());
  const announcedBatchDone = useRef<Set<string>>(new Set());

  // Bezpiecznik utkniętych zadań: zanim wczytamy listę, poprosimy backend CRM
  // o oznaczenie zadań wiszących zbyt długo jako błąd (i domknięcie paczek).
  const reapStaleJobs = useCallback(async () => {
    try {
      await fetch("/api/scraper/reap-stale", { method: "POST" });
    } catch {
      /* best-effort */
    }
  }, []);

  const loadBatches = useCallback(async () => {
    const { data, error } = await supabase
      .from("scrape_batches")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (!error) setBatches((data as ScrapeBatch[]) ?? []);
    return error;
  }, [supabase]);

  const loadJobs = useCallback(async () => {
    const { data, error } = await supabase
      .from("scrape_jobs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(3000);
    if (!error) setJobs((data as ScrapeJob[]) ?? []);
    return error;
  }, [supabase]);

  const loadLeads = useCallback(async () => {
    const { data, error } = await supabase
      .from("scraped_leads")
      .select("*")
      .in("status", ["new", "duplicate", "rejected"])
      .order("score", { ascending: false });
    if (!error) setLeads((data as ScrapedLead[]) ?? []);
    return error;
  }, [supabase]);

  useEffect(() => {
    reapStaleJobs().finally(() => {
      loadBatches();
      loadJobs();
    });
    loadLeads();

    // Realtime: statusy paczek, statusy/kroki zadań i nowe leady — na żywo.
    const channel = supabase
      .channel("scraper_tab")
      .on("postgres_changes", { event: "*", schema: "public", table: "scrape_batches" }, (payload) => {
        if (payload.eventType === "DELETE") {
          const oldId = (payload.old as { id?: string })?.id;
          if (oldId) setBatches((list) => list.filter((b) => b.id !== oldId));
          return;
        }
        const row = payload.new as ScrapeBatch;
        setBatches((list) => {
          const idx = list.findIndex((b) => b.id === row.id);
          if (idx === -1) return [row, ...list];
          const next = [...list];
          next[idx] = row;
          return next;
        });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "scrape_jobs" }, (payload) => {
        if (payload.eventType === "DELETE") {
          const oldId = (payload.old as { id?: string })?.id;
          if (oldId) setJobs((list) => list.filter((j) => j.id !== oldId));
          return;
        }
        const row = payload.new as ScrapeJob;
        setJobs((list) => {
          const idx = list.findIndex((j) => j.id === row.id);
          if (idx === -1) return [row, ...list];
          const next = [...list];
          next[idx] = row;
          return next;
        });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "scraped_leads" }, (payload) => {
        const lead = payload.new as ScrapedLead;
        if (lead.status === "new" || lead.status === "duplicate") {
          setLeads((list) => (list.some((l) => l.id === lead.id) ? list : [lead, ...list]));
        }
        newLeadCount.current += 1;
        newLeadLastName.current = lead.business_name;
        setLeadPulseKey((k) => k + 1);
        if (newLeadTimer.current) clearTimeout(newLeadTimer.current);
        newLeadTimer.current = setTimeout(() => {
          const n = newLeadCount.current;
          newLeadCount.current = 0;
          if (n <= 0) return;
          toast.success(n === 1 ? `➕ Nowy lead: ${newLeadLastName.current}` : `➕ Znaleziono ${n} nowych leadów`);
        }, 1200);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "scraped_leads" }, () => loadLeads())
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "scraped_leads" }, (payload) => {
        const oldId = (payload.old as { id?: string })?.id;
        if (oldId) setLeads((list) => list.filter((l) => l.id !== oldId));
      })
      .subscribe();

    return () => {
      if (newLeadTimer.current) clearTimeout(newLeadTimer.current);
      supabase.removeChannel(channel);
    };
  }, [supabase, loadBatches, loadJobs, loadLeads, reapStaleJobs, toast]);

  // Widoki paczek: dołącz zadania i policz agregaty raz, użyj do podziału i kart.
  const jobsByBatch = useMemo(() => {
    const map = new Map<string, ScrapeJob[]>();
    for (const j of jobs) {
      const arr = map.get(j.batch_id);
      if (arr) arr.push(j);
      else map.set(j.batch_id, [j]);
    }
    return map;
  }, [jobs]);

  const batchViews = useMemo(
    () =>
      batches.map((batch) => {
        const bj = jobsByBatch.get(batch.id) ?? [];
        const agg = computeAgg(batch, bj);
        return { batch, jobs: bj, agg, eff: effectiveStatus(batch, agg) };
      }),
    [batches, jobsByBatch]
  );

  const activeViews = batchViews.filter((v) => v.eff === "running" || v.eff === "paused");
  const historyViews = batchViews.filter((v) => v.eff === "completed" || v.eff === "stopped");
  const historyPages = Math.max(1, Math.ceil(historyViews.length / HISTORY_PAGE_SIZE));
  const historyPageClamped = Math.min(historyPage, historyPages - 1);
  const historySlice = historyViews.slice(
    historyPageClamped * HISTORY_PAGE_SIZE,
    historyPageClamped * HISTORY_PAGE_SIZE + HISTORY_PAGE_SIZE
  );

  // Toasty cyklu życia — liczone ze stanu zadań, wyłącznie dla paczek z tej sesji.
  useEffect(() => {
    if (jobs.length === 0) return;
    const grouped = new Map<string, ScrapeJob[]>();
    for (const j of jobs) {
      const arr = grouped.get(j.batch_id);
      if (arr) arr.push(j);
      else grouped.set(j.batch_id, [j]);
    }

    for (const [bid, list] of grouped) {
      if (!sessionBatchIds.current.has(bid)) continue;

      if (
        !announcedBatchStart.current.has(bid) &&
        list.some((j) => j.status === "running" || j.status === "done" || j.status === "error")
      ) {
        announcedBatchStart.current.add(bid);
        toast.info("▶️ Scrapowanie rozpoczęte…");
      }

      for (const j of list) {
        if ((j.status === "done" || j.status === "error") && !announcedJobTerminal.current.has(j.id)) {
          announcedJobTerminal.current.add(j.id);
          if (j.status === "error") {
            toast.error(`✗ ${j.keyword} · ${j.location}: ${humanizeScrapeError(j.error_message).text}`);
          } else if (list.length === 1) {
            if (j.results_count > 0)
              toast.success(`✓ ${j.keyword} · ${j.location}: ${formatFound(j.results_count, j.new_count, j.existing_count)}`);
            else toast.info(ZERO_RESULTS_MESSAGE);
          }
        }
      }

      const allTerminal = list.every((j) => j.status === "done" || j.status === "error" || j.status === "canceled");
      if (allTerminal && !announcedBatchDone.current.has(bid)) {
        announcedBatchDone.current.add(bid);
        if (list.length > 1) {
          const done = list.filter((j) => j.status === "done").length;
          const errored = list.filter((j) => j.status === "error").length;
          const total = list.reduce((s, j) => s + (j.results_count || 0), 0);
          const totalNew = list.reduce((s, j) => s + (j.new_count || 0), 0);
          const totalExisting = list.reduce((s, j) => s + (j.existing_count || 0), 0);
          if (errored === 0) {
            if (total > 0) toast.success(`✓ Zakończono: ${formatFound(total, totalNew, totalExisting)} z ${list.length} zadań.`);
            else toast.info(ZERO_RESULTS_MESSAGE);
          } else {
            toast.error(
              `${done} z ${list.length} zadań zakończone, ${errored} ${errored === 1 ? "błąd" : "błędów"}. ` +
                `Znaleziono ${formatFound(total, totalNew, totalExisting)}.`
            );
          }
        }
      }
    }
  }, [jobs, toast]);

  async function refresh() {
    setRefreshing(true);
    await reapStaleJobs();
    const [bErr, jErr, lErr] = await Promise.all([loadBatches(), loadJobs(), loadLeads()]);
    setRefreshing(false);
    if (bErr || jErr || lErr) toast.error("Nie udało się odświeżyć danych. Spróbuj ponownie.");
    else toast.info("Odświeżono.");
  }

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
      if (data.batch_id) sessionBatchIds.current.add(data.batch_id as string);
      toast.success(`Utworzono ${keywords.length * locations.length} zadań. Scrapowanie startuje…`);
      if (data.warning) toast.error(data.warning);
      loadBatches();
      loadJobs();
    } catch {
      toast.error("Błąd połączenia z serwerem.");
    } finally {
      setStarting(false);
    }
  }

  // Sterowanie paczką: pauza / stop / wznów. Backend widzi zmianę statusu i
  // realnie wstrzymuje/wznawia pracę (nie tylko UI).
  async function control(action: "pause" | "stop" | "resume", batchId: string) {
    setControlBusy(`${batchId}:${action}`);
    try {
      const resp = await fetch(`/api/scraper/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batch_id: batchId }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        toast.error(data.error ?? "Nie udało się wykonać operacji.");
        return;
      }
      if (action === "pause") toast.info("⏸️ Scrapowanie wstrzymane. Postęp zachowany.");
      else if (action === "resume") toast.success("▶️ Wznowiono scrapowanie.");
      else toast.info(`⏹️ Scrapowanie zatrzymane. Anulowano ${data.canceled ?? 0} oczekujących zadań.`);
      if (data.warning) toast.error(data.warning);
      loadBatches();
      loadJobs();
    } catch {
      toast.error("Błąd połączenia z serwerem.");
    } finally {
      setControlBusy(null);
    }
  }

  const newLeads = leads.filter((l) => l.status === "new");
  const duplicateLeads = leads.filter((l) => l.status === "duplicate");
  const archivedLeads = leads.filter((l) => l.status === "rejected");

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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
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

      {/* Aktywne scrapowania (w trakcie / wstrzymane) */}
      {activeViews.length > 0 && (
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
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Aktywne scrapowania</h2>
            <button
              onClick={refresh}
              disabled={refreshing}
              style={{ ...ghostButton, display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", opacity: refreshing ? 0.6 : 1 }}
            >
              <RefreshCw size={14} className={refreshing ? "selltic-spin" : undefined} />
              {refreshing ? "Odświeżanie…" : "Odśwież"}
            </button>
          </div>
          <div style={{ display: "grid", gap: 12 }}>
            {activeViews.map((v) => (
              <BatchCard
                key={v.batch.id}
                batch={v.batch}
                jobs={v.jobs}
                agg={v.agg}
                eff={v.eff}
                pulseKey={leadPulseKey}
                controlBusy={controlBusy}
                onControl={control}
                defaultExpanded={false}
              />
            ))}
          </div>
        </section>
      )}

      {/* Historia scrapowania — wszystkie zakończone/zatrzymane paczki, paginowane */}
      <section
        style={{
          background: tokens.card,
          border: `1px solid ${tokens.border}`,
          borderRadius: tokens.radius,
          padding: 20,
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 10, flexWrap: "wrap" }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>
            Historia scrapowania{historyViews.length > 0 ? ` (${historyViews.length})` : ""}
          </h2>
          {activeViews.length === 0 && (
            <button
              onClick={refresh}
              disabled={refreshing}
              style={{ ...ghostButton, display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", opacity: refreshing ? 0.6 : 1 }}
            >
              <RefreshCw size={14} className={refreshing ? "selltic-spin" : undefined} />
              {refreshing ? "Odświeżanie…" : "Odśwież"}
            </button>
          )}
        </div>

        {historyViews.length === 0 ? (
          <div style={{ padding: "20px 4px", textAlign: "center", color: tokens.muted, fontSize: 13 }}>
            Brak zakończonych scrapowań — uruchom nowe powyżej.
          </div>
        ) : (
          <>
            <div style={{ display: "grid", gap: 12 }}>
              {historySlice.map((v) => (
                <BatchCard
                  key={v.batch.id}
                  batch={v.batch}
                  jobs={v.jobs}
                  agg={v.agg}
                  eff={v.eff}
                  pulseKey={leadPulseKey}
                  controlBusy={controlBusy}
                  onControl={control}
                  defaultExpanded={false}
                />
              ))}
            </div>

            {historyPages > 1 && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 16 }}>
                <button
                  onClick={() => setHistoryPage((p) => Math.max(0, p - 1))}
                  disabled={historyPageClamped === 0}
                  style={{ ...ghostButton, padding: "6px 12px", opacity: historyPageClamped === 0 ? 0.5 : 1 }}
                >
                  ← Poprzednia
                </button>
                <span style={{ fontSize: 13, color: tokens.muted }}>
                  Strona {historyPageClamped + 1} z {historyPages}
                </span>
                <button
                  onClick={() => setHistoryPage((p) => Math.min(historyPages - 1, p + 1))}
                  disabled={historyPageClamped >= historyPages - 1}
                  style={{ ...ghostButton, padding: "6px 12px", opacity: historyPageClamped >= historyPages - 1 ? 0.5 : 1 }}
                >
                  Następna →
                </button>
              </div>
            )}
          </>
        )}
      </section>

      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        <TabButton active={tab === "leads"} onClick={() => setTab("leads")}>
          Leady ({newLeads.length})
        </TabButton>
        <TabButton active={tab === "duplicates"} onClick={() => setTab("duplicates")}>
          Duplikaty ({duplicateLeads.length})
        </TabButton>
        <TabButton active={tab === "archive"} onClick={() => setTab("archive")}>
          Archiwum ({archivedLeads.length})
        </TabButton>
      </div>

      {tab === "leads" ? (
        <LeadsTab leads={newLeads} onMoved={loadLeads} />
      ) : tab === "duplicates" ? (
        <DuplicatesTab leads={duplicateLeads} supabase={supabase} onChanged={loadLeads} />
      ) : (
        <ArchiveTab leads={archivedLeads} supabase={supabase} onChanged={loadLeads} />
      )}
    </div>
  );
}

// ── Zwijana karta paczki: nagłówek-podsumowanie + (po rozwinięciu) lista zadań ─
function BatchCard({
  batch,
  jobs,
  agg,
  eff,
  pulseKey,
  controlBusy,
  onControl,
  defaultExpanded,
}: {
  batch: ScrapeBatch;
  jobs: ScrapeJob[];
  agg: BatchAgg;
  eff: ScrapeBatchStatus;
  pulseKey: number;
  controlBusy: string | null;
  onControl: (action: "pause" | "stop" | "resume", batchId: string) => void;
  defaultExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const keywordsLabel = batch.keywords.length > 0 ? batch.keywords.join(", ") : "(bez słów kluczowych)";
  const isActive = eff === "running";
  const statusColor = BATCH_STATUS_COLOR[eff];
  const busyPrefix = `${batch.id}:`;
  const anyBusy = controlBusy != null && controlBusy.startsWith(busyPrefix);

  // Zadania z bazy przychodzą posortowane po created_at; sortujemy stabilnie po
  // keyword/location, żeby lista miasto × słowo kluczowe była czytelna.
  const sortedJobs = useMemo(
    () =>
      [...jobs].sort((a, b) =>
        a.keyword === b.keyword ? a.location.localeCompare(b.location) : a.keyword.localeCompare(b.keyword)
      ),
    [jobs]
  );

  return (
    <div style={{ border: `1px solid ${tokens.border}`, borderRadius: 12, overflow: "hidden" }}>
      {/* Nagłówek — klik rozwija/zwija listę zadań */}
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          width: "100%",
          textAlign: "left",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 14,
          display: "grid",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {expanded ? (
            <ChevronDown size={16} color={tokens.muted} style={{ flexShrink: 0 }} />
          ) : (
            <ChevronRight size={16} color={tokens.muted} style={{ flexShrink: 0 }} />
          )}
          <span
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: tokens.text,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
            }}
            title={keywordsLabel}
          >
            {keywordsLabel}
          </span>

          {/* Status */}
          <span
            style={{
              flexShrink: 0,
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 12,
              fontWeight: 700,
              color: statusColor,
              background: `${statusColor}14`,
              border: `1px solid ${tokens.border}`,
              borderRadius: 999,
              padding: "3px 10px",
            }}
          >
            {eff === "running" && <Loader2 size={12} className="selltic-spin" />}
            {BATCH_STATUS_LABEL[eff]}
          </span>

          {/* Sterowanie (na aktywnych paczkach) — stopPropagation, by nie rozwijać */}
          <span style={{ display: "inline-flex", gap: 6, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
            {eff === "running" && (
              <ControlButton
                label="Pauza"
                icon={<Pause size={13} />}
                busy={controlBusy === `${batch.id}:pause`}
                disabled={anyBusy}
                onClick={() => onControl("pause", batch.id)}
              />
            )}
            {eff === "paused" && (
              <ControlButton
                label="Wznów"
                icon={<Play size={13} />}
                busy={controlBusy === `${batch.id}:resume`}
                disabled={anyBusy}
                onClick={() => onControl("resume", batch.id)}
              />
            )}
            {(eff === "running" || eff === "paused") && (
              <ControlButton
                label="Stop"
                icon={<Ban size={13} />}
                danger
                busy={controlBusy === `${batch.id}:stop`}
                disabled={anyBusy}
                onClick={() => onControl("stop", batch.id)}
              />
            )}
          </span>
        </div>

        {/* Meta: data · postęp · liczba leadów */}
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, paddingLeft: 26 }}>
          <span style={{ fontSize: 12.5, color: tokens.muted }}>{formatDateTime(batch.created_at)}</span>
          <span style={{ fontSize: 12.5, color: tokens.muted }}>
            {agg.finished}/{agg.total} zadań
            {agg.errored > 0 ? ` · ${agg.errored} ${agg.errored === 1 ? "błąd" : "błędów"}` : ""}
            {agg.canceled > 0 ? ` · ${agg.canceled} anul.` : ""}
          </span>
          <span
            key={isActive ? pulseKey : "static"}
            className={isActive ? "selltic-pulse" : undefined}
            style={{
              marginLeft: "auto",
              fontSize: 12,
              fontWeight: 700,
              color: agg.leads > 0 ? tokens.success : tokens.muted,
            }}
          >
            Leady: {formatFound(agg.leads, agg.newLeads, agg.existing)}
          </span>
        </div>

        {/* Pasek postępu */}
        {isActive ? (
          <div className="selltic-indeterminate" style={{ height: 5, marginLeft: 26, borderRadius: 4 }} />
        ) : (
          agg.total > 0 && (
            <div style={{ height: 5, marginLeft: 26, borderRadius: 4, background: tokens.bg, overflow: "hidden" }}>
              <div
                style={{
                  width: `${Math.min(100, Math.round((agg.finished / agg.total) * 100))}%`,
                  height: "100%",
                  background: agg.errored > 0 ? tokens.warning : tokens.success,
                }}
              />
            </div>
          )
        )}
      </button>

      {/* Lista zadań (rozwinięta) */}
      {expanded && (
        <div style={{ padding: "0 14px 14px", display: "grid", gap: 6 }}>
          {sortedJobs.length === 0 ? (
            <div style={{ fontSize: 12.5, color: tokens.muted, padding: "6px 2px" }}>
              Brak szczegółów zadań do wyświetlenia.
            </div>
          ) : (
            sortedJobs.map((j) => <JobRow key={j.id} job={j} />)
          )}
        </div>
      )}
    </div>
  );
}

function ControlButton({
  label,
  icon,
  onClick,
  busy,
  disabled,
  danger,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  busy: boolean;
  disabled: boolean;
  danger?: boolean;
}) {
  const color = danger ? tokens.danger : tokens.text;
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 12,
        fontWeight: 600,
        color,
        background: tokens.card,
        border: `1px solid ${danger ? tokens.danger : tokens.border}`,
        borderRadius: 8,
        padding: "5px 10px",
        cursor: disabled || busy ? "default" : "pointer",
        opacity: disabled && !busy ? 0.5 : 1,
      }}
    >
      {busy ? <Loader2 size={13} className="selltic-spin" /> : icon}
      {label}
    </button>
  );
}

function JobRow({ job: j }: { job: ScrapeJob }) {
  const color = JOB_STATUS_COLOR[j.status];
  const [expanded, setExpanded] = useState(false);
  const isError = j.status === "error";
  const rawError = j.error_message ?? "";
  const statusText = isError ? humanizeScrapeError(j.error_message).text : "";

  return (
    <div
      style={{
        display: "grid",
        gap: 6,
        padding: "7px 10px",
        borderRadius: 10,
        border: `1px solid ${tokens.border}`,
        background: tokens.card,
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, minWidth: 0 }}>
        {j.status === "running" ? (
          <Loader2 size={13} className="selltic-spin" color={color} style={{ flexShrink: 0 }} />
        ) : (
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
        )}

        <span style={{ fontSize: 12.5, fontWeight: 700, color: tokens.text, wordBreak: "break-word", minWidth: 0 }}>
          {j.keyword} · {j.location}
        </span>

        {!isError && (
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 12,
              color: tokens.muted,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {j.status === "running"
              ? j.current_step || "W trakcie…"
              : j.status === "done"
                ? j.results_count > 0
                  ? formatFound(j.results_count, j.new_count, j.existing_count)
                  : "Brak wyników"
                : JOB_STATUS_LABEL[j.status]}
          </span>
        )}

        {isError && rawError && (
          <button
            onClick={() => setExpanded((v) => !v)}
            style={{
              marginLeft: "auto",
              flexShrink: 0,
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 11.5,
              fontWeight: 700,
              color: tokens.accent,
              padding: "2px 4px",
            }}
          >
            {expanded ? "Ukryj" : "Szczegóły"}
          </button>
        )}

        {(j.status === "running" || j.status === "done") && j.results_count > 0 && (
          <span style={{ fontSize: 12, fontWeight: 700, color: tokens.success, flexShrink: 0, marginLeft: "auto" }}>
            {j.results_count}
          </span>
        )}
      </div>

      {isError && (
        <div
          style={{
            fontSize: 12,
            color: tokens.danger,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
            lineHeight: 1.45,
          }}
        >
          {statusText}
        </div>
      )}

      {isError && expanded && rawError && (
        <div
          style={{
            fontSize: 11.5,
            color: tokens.text,
            background: tokens.bg,
            border: `1px solid ${tokens.border}`,
            borderRadius: 8,
            padding: "8px 10px",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          }}
        >
          {rawError}
        </div>
      )}
    </div>
  );
}

function LeadsTab({ leads, onMoved }: { leads: ScrapedLead[]; onMoved: () => void }) {
  const toast = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moving, setMoving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const busy = moving || rejecting || rejectingId !== null;

  useEffect(() => {
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
          (data.restored > 0 ? ` (w tym ${data.restored} przywrócono z Archiwum Prospectingu)` : "") +
          (data.duplicates > 0 ? `, ${data.duplicates} oznaczono jako duplikaty` : "") +
          "."
      );
      if (Array.isArray(data.errors) && data.errors.length > 0) {
        toast.error(
          `Nie udało się przenieść ${data.errors.length} ${data.errors.length === 1 ? "leada" : "leadów"}: ` +
            data.errors[0].error
        );
      }
      setSelected(new Set());
      onMoved();
    } catch {
      toast.error("Błąd połączenia z serwerem.");
    } finally {
      setMoving(false);
    }
  }

  async function reject(ids: string[]) {
    if (ids.length === 0) return;
    const resp = await fetch("/api/scraper/reject", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scraped_lead_ids: ids }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      toast.error(data.error ?? "Nie udało się odrzucić leadów.");
      return;
    }
    toast.success(
      data.rejected === 1
        ? "Lead przeniesiony do Archiwum."
        : `Przeniesiono ${data.rejected} leadów do Archiwum.`
    );
    onMoved();
  }

  async function rejectSelected() {
    if (selected.size === 0) return;
    setRejecting(true);
    try {
      await reject([...selected]);
      setSelected(new Set());
    } catch {
      toast.error("Błąd połączenia z serwerem.");
    } finally {
      setRejecting(false);
    }
  }

  async function rejectOne(id: string) {
    setRejectingId(id);
    try {
      await reject([id]);
    } catch {
      toast.error("Błąd połączenia z serwerem.");
    } finally {
      setRejectingId(null);
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
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, padding: "12px 16px", borderBottom: `1px solid ${tokens.border}` }}>
        <button onClick={toggleAll} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, color: tokens.text, fontSize: 13, fontWeight: 600 }}>
          {allSelected ? <CheckSquare size={17} color={tokens.accent} /> : <Square size={17} color={tokens.muted} />}
          Zaznacz wszystkie
        </button>
        <div style={{ flex: 1, minWidth: 8 }} />
        <button
          onClick={rejectSelected}
          disabled={selected.size === 0 || busy}
          style={{ ...ghostButton, display: "flex", alignItems: "center", gap: 6, opacity: selected.size === 0 ? 0.5 : 1 }}
        >
          <Archive size={15} />
          {rejecting ? "Odrzucanie…" : `Odrzuć zaznaczone (${selected.size})`}
        </button>
        <button
          onClick={moveSelected}
          disabled={selected.size === 0 || busy}
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
              <ScoreBadge score={l.score} breakdown={l.score_breakdown} />
            </div>
            <button
              onClick={() => rejectOne(l.id)}
              disabled={busy}
              title="Odrzuć (przenieś do Archiwum)"
              aria-label="Odrzuć lead"
              style={{
                flexShrink: 0,
                background: "none",
                border: `1px solid ${tokens.border}`,
                borderRadius: 8,
                cursor: busy ? "default" : "pointer",
                color: tokens.muted,
                display: "grid",
                placeItems: "center",
                width: 30,
                height: 30,
                opacity: rejectingId === l.id ? 0.5 : 1,
              }}
            >
              {rejectingId === l.id ? <Loader2 size={15} className="selltic-spin" /> : <Archive size={15} />}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "8px 16px",
        borderRadius: 10,
        fontSize: 14,
        fontWeight: 600,
        cursor: "pointer",
        border: `1px solid ${active ? tokens.accent : tokens.border}`,
        background: active ? tokens.accentSoft : "#fff",
        color: active ? tokens.accent : tokens.muted,
      }}
    >
      {children}
    </button>
  );
}

// Archiwum: leady odrzucone przez użytkownika (status 'rejected').
function ArchiveTab({
  leads,
  supabase,
  onChanged,
}: {
  leads: ScrapedLead[];
  supabase: ReturnType<typeof createClient>;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [restoringId, setRestoringId] = useState<string | null>(null);

  async function restore(id: string) {
    setRestoringId(id);
    const { error } = await supabase
      .from("scraped_leads")
      .update({ status: "new" })
      .eq("id", id)
      .eq("status", "rejected");
    setRestoringId(null);
    if (error) {
      toast.error("Nie udało się przywrócić leada.");
      return;
    }
    toast.success("Lead przywrócony do listy „Leady”.");
    onChanged();
  }

  if (leads.length === 0) {
    return (
      <section style={{ background: tokens.card, border: `1px solid ${tokens.border}`, borderRadius: tokens.radius, padding: 30, textAlign: "center", color: tokens.muted }}>
        Archiwum jest puste — odrzucone leady pojawią się tutaj.
      </section>
    );
  }

  return (
    <section style={{ background: tokens.card, border: `1px solid ${tokens.border}`, borderRadius: tokens.radius, overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${tokens.border}`, fontSize: 13, color: tokens.muted }}>
        Odrzucone leady — zachowane do wglądu, nie trafiają do Prospectingu. Możesz je przywrócić.
      </div>
      <div style={{ maxHeight: 560, overflowY: "auto" }}>
        {leads.map((l) => (
          <div
            key={l.id}
            style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderBottom: `1px solid ${tokens.border}` }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.business_name}</div>
              <div style={{ fontSize: 12.5, color: tokens.muted }}>
                {l.source_keyword} · {l.source_location} · {l.address ?? "brak adresu"}
              </div>
            </div>
            <div style={{ fontSize: 13, color: tokens.muted, width: 130, flexShrink: 0 }}>{l.phone ?? "—"}</div>
            <div style={{ width: 50, flexShrink: 0, textAlign: "right" }}>
              <ScoreBadge score={l.score} breakdown={l.score_breakdown} />
            </div>
            <button
              onClick={() => restore(l.id)}
              disabled={restoringId !== null}
              style={{ ...ghostButton, display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", flexShrink: 0, opacity: restoringId === l.id ? 0.5 : 1 }}
            >
              {restoringId === l.id ? <Loader2 size={14} className="selltic-spin" /> : <RotateCcw size={14} />}
              Przywróć
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function DuplicatesTab({
  leads,
  supabase,
  onChanged,
}: {
  leads: ScrapedLead[];
  supabase: ReturnType<typeof createClient>;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [prospectsById, setProspectsById] = useState<Record<string, Prospect>>({});
  const [restoringId, setRestoringId] = useState<string | null>(null);

  async function restore(id: string) {
    setRestoringId(id);
    const { error } = await supabase
      .from("scraped_leads")
      .update({ status: "new" })
      .eq("id", id)
      .eq("status", "duplicate");
    setRestoringId(null);
    if (error) {
      toast.error("Nie udało się przywrócić leada.");
      return;
    }
    toast.success("Lead wrócił do listy „Leady”.");
    onChanged();
  }

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
        automatycznie. Porównaj dane i zaktualizuj prospekt ręcznie, jeśli chcesz. Jeśli
        istniejący prospekt jest w Archiwum, kliknij „Wróć do Leadów” i przenieś ponownie —
        prospekt zostanie przywrócony i odświeżony nowymi danymi.
      </p>
      {leads.map((l) => {
        const p = prospectsById[l.place_id];
        return (
          <section key={l.id} style={{ background: tokens.card, border: `1px solid ${tokens.border}`, borderRadius: tokens.radius, padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div style={{ fontSize: 14, fontWeight: 700, flex: 1, minWidth: 0 }}>{l.business_name}</div>
              <button
                onClick={() => restore(l.id)}
                disabled={restoringId !== null}
                title="Cofnij flagę duplikatu — lead wróci do listy „Leady”"
                style={{ ...ghostButton, display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", flexShrink: 0, opacity: restoringId === l.id ? 0.5 : 1 }}
              >
                {restoringId === l.id ? <Loader2 size={14} className="selltic-spin" /> : <RotateCcw size={14} />}
                Wróć do Leadów
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: tokens.muted, marginBottom: 6, textTransform: "uppercase" }}>
                  Istniejący prospekt
                  {p?.archived_at ? <span style={{ color: tokens.danger }}> · w Archiwum</span> : null}
                </div>
                {p ? (
                  <CompareFields
                    rating={p.rating}
                    reviewCount={p.review_count}
                    score={p.lead_score}
                    breakdown={p.lead_score_breakdown}
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
                  breakdown={l.score_breakdown}
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
  breakdown,
  website,
  phone,
  when,
}: {
  rating: number | null;
  reviewCount: number | null;
  score: number | null;
  breakdown?: unknown;
  website: string | null;
  phone: string | null;
  when: string;
}) {
  return (
    <div style={{ fontSize: 13, display: "grid", gap: 4 }}>
      <div>⭐ {rating ?? "—"} ({reviewCount ?? 0} opinii)</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        Score: <ScoreBadge score={score} breakdown={breakdown} fontSize={12} />
      </div>
      <div>Strona: {website ?? "brak"}</div>
      <div>Telefon: {phone ?? "—"}</div>
      <div style={{ color: tokens.muted }}>{formatDateTime(when)}</div>
    </div>
  );
}
