// app/admin/forms/page.tsx — §5. Lista formularzy jako sortowalna TABELA
// (spójna gęstość/sortowanie z listą Leadów). Metryki pobierane jednym
// złączonym zapytaniem z widoku form_metrics (bez N+1). Zakładki Active/Archive,
// akcje Archiwizuj/Przywróć, menu ⋯ (bez „Usuń formularza”).
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { tokens, primaryButton, formatRelative, pageTitle, menuPanel } from "@/lib/ui";
import { blankForm, randomSlug } from "@/lib/forms";
import ShareModal from "./share-modal";
import { useToast } from "@/components/Toast";
import MIcon from "@/components/MaterialIcon";
import EmptyState from "@/components/EmptyState";
import AllSubmissions from "@/components/forms/AllSubmissions";

// Poniżej tej szerokości dostępnego obszaru tabela (min-width 900) nie mieści
// się i zwija do przewijanego w bok pudełka — wtedy przełączamy na listę kart.
// Liczy się realna szerokość kontenera, nie okna: na desktopie po odjęciu
// sidebara (230px) obszar treści bywa węższy niż okno, więc sam useIsMobile
// (mierzący viewport) nie wystarczał.
const TABLE_MIN_WIDTH = 900;

type MetricsRow = {
  id: string;
  title: string;
  slug: string | null;
  status: string;
  archived_at: string | null;
  created_at: string;
  views: number;
  unique_users: number;
  completions: number;
  abandoned: number;
  last_submission: string | null;
  conversion_rate: number | null;
};

type SortKey = "title" | "status" | "views" | "unique_users" | "completions" | "abandoned" | "conversion_rate" | "last_submission";
type Sort = { key: SortKey; dir: "asc" | "desc" };

export default function FormsPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const toast = useToast();
  // Przełączanie tabela ↔ karty na podstawie ZMIERZONEJ szerokości obszaru
  // listy (ResizeObserver), a nie szerokości okna — dzięki temu zwinięty
  // sidebar, węższe okno na desktopie i telefon są obsłużone tą samą regułą.
  const listRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const el = listRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setCompact(w < TABLE_MIN_WIDTH);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [rows, setRows] = useState<MetricsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  // Zakładka „Zgłoszenia" (§ redesign): globalna lista zgłoszeń wszystkich
  // formularzy — przeniesiona z dawnej strony /admin/inbox.
  const [tab, setTab] = useState<"active" | "archive" | "submissions">(() => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("tab") === "zgloszenia") {
      return "submissions";
    }
    return "active";
  });
  const [sort, setSort] = useState<Sort>({ key: "last_submission", dir: "desc" });
  const [shareForm, setShareForm] = useState<{ slug: string; title: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // Pojedyncze zapytanie do widoku metryk (bez N+1 na wiersz).
    const { data, error } = await supabase
      .from("form_metrics")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      // Widok niedostępny (przed migracją) — fallback do surowej listy formularzy.
      const { data: forms } = await supabase
        .from("forms")
        .select("id, title, slug, status, archived_at, created_at")
        .order("created_at", { ascending: false });
      setRows(((forms as MetricsRow[]) ?? []).map((f) => ({
        ...f, views: 0, unique_users: 0, completions: 0, abandoned: 0, last_submission: null, conversion_rate: null,
      })));
    } else {
      setRows((data as MetricsRow[]) ?? []);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(
    () => rows.filter((r) => (tab === "archive" ? !!r.archived_at : !r.archived_at)),
    [rows, tab]
  );

  const sorted = useMemo(() => {
    const val = (r: MetricsRow): string | number => {
      switch (sort.key) {
        case "title": return (r.title || "").toLowerCase();
        case "status": return statusRank(r);
        case "last_submission": return r.last_submission ? new Date(r.last_submission).getTime() : 0;
        case "conversion_rate": return r.conversion_rate ?? -1;
        default: return r[sort.key] ?? 0;
      }
    };
    return [...filtered].sort((a, b) => {
      const av = val(a), bv = val(b);
      if (av === bv) return 0;
      const res = av > bv ? 1 : -1;
      return sort.dir === "asc" ? res : -res;
    });
  }, [filtered, sort]);

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));
  }

  async function newForm() {
    if (creating) return;
    setCreating(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setCreating(false); return; }
    const schema = blankForm();
    const { data, error } = await supabase
      .from("forms")
      .insert({ owner: user.id, title: schema.title, slug: randomSlug(), schema, status: "draft" })
      .select("id").single();
    setCreating(false);
    if (!error && data) router.push(`/admin/forms/${data.id}`);
  }

  async function duplicate(id: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: src } = await supabase.from("forms").select("title, schema").eq("id", id).single();
    if (!src) return;
    const { error } = await supabase.from("forms").insert({
      owner: user.id, title: `${src.title} (kopia)`, slug: randomSlug(), schema: src.schema, status: "draft",
    });
    if (!error) { toast.success("Zduplikowano formularz"); load(); }
  }

  async function archive(id: string) {
    const { data: { user } } = await supabase.auth.getUser();
    setRows((list) => list.map((r) => (r.id === id ? { ...r, archived_at: new Date().toISOString() } : r)));
    const { error } = await supabase.from("forms").update({ archived_at: new Date().toISOString(), archived_by: user?.id ?? null }).eq("id", id);
    if (error) { toast.error("Nie udało się zarchiwizować"); load(); }
    else toast.success("Formularz zarchiwizowany");
  }

  async function restore(id: string) {
    setRows((list) => list.map((r) => (r.id === id ? { ...r, archived_at: null } : r)));
    const { error } = await supabase.from("forms").update({ archived_at: null, archived_by: null }).eq("id", id);
    if (error) { toast.error("Nie udało się przywrócić"); load(); }
    else toast.success("Formularz przywrócony");
  }

  function copyLink(slug: string | null) {
    if (!slug) return;
    const url = `${window.location.origin}/f/${slug}`;
    navigator.clipboard?.writeText(url).then(() => toast.success("Skopiowano link"));
  }

  return (
    <div ref={listRef}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <h1 style={pageTitle}>Formularze</h1>
        <button onClick={newForm} disabled={creating} style={primaryButton}>
          <MIcon name="add" size={15} />
          {creating ? "Tworzenie…" : "Nowy formularz"}
        </button>
      </div>

      {/* Zakładki: Aktywne / Archiwum / Zgłoszenia (globalne) */}
      <div style={{ display: "flex", gap: 2, marginBottom: 14, borderBottom: `1px solid ${tokens.border}` }}>
        {(
          [
            ["active", "Aktywne"],
            ["archive", "Archiwum"],
            ["submissions", "Zgłoszenia"],
          ] as const
        ).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "7px 12px",
              border: "none",
              borderBottom: `2px solid ${tab === t ? tokens.accent : "transparent"}`,
              marginBottom: -1,
              cursor: "pointer",
              fontSize: 13,
              fontWeight: tab === t ? 600 : 500,
              background: "transparent",
              color: tab === t ? tokens.text : tokens.muted,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {label}
            {t !== "submissions" && (
              <span style={{ fontSize: 11, fontWeight: 500, color: tokens.muted, background: tokens.bg, borderRadius: 999, padding: "0 6px", lineHeight: "16px" }}>
                {rows.filter((r) => (t === "archive" ? r.archived_at : !r.archived_at)).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "submissions" ? (
        <AllSubmissions onOpenForm={(id) => router.push(`/admin/forms/${id}?tab=submissions`)} />
      ) : loading ? (
        <p style={{ color: tokens.muted, fontSize: 13 }}>Wczytywanie…</p>
      ) : sorted.length === 0 ? (
        <FormsEmptyState tab={tab} onNew={newForm} />
      ) : compact ? (
        // Gdy dostępny obszar jest węższy niż tabela (telefon albo węższe okno
        // na desktopie), tabela zwijała się do przewijanego w bok pudełka
        // pokazującego tylko fragment kolumn. Zamiast tego renderujemy listę
        // kart wypełniających całą szerokość.
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {sorted.map((r) => (
            <MobileCard
              key={r.id}
              r={r}
              onOpen={() => router.push(`/admin/forms/${r.id}`)}
              onStats={() => router.push(`/admin/forms/${r.id}?tab=stats`)}
              onShare={() => r.slug && setShareForm({ slug: r.slug, title: r.title })}
              onCopy={() => copyLink(r.slug)}
              onDuplicate={() => duplicate(r.id)}
              onArchive={() => archive(r.id)}
              onRestore={() => restore(r.id)}
              onSubmissions={() => router.push(`/admin/forms/${r.id}?tab=submissions`)}
            />
          ))}
        </div>
      ) : (
        // Bez overflow-x: auto. Ustawienie overflow-x na auto zmusza przeglądarkę
        // do policzenia overflow-y również jako auto (reguła CSS), przez co
        // rozwijane menu wiersza (⋯), wyższe niż krótka tabela, było przycinane,
        // a kontener zyskiwał pionowy pasek i puste białe pudełko. Widok kart
        // (compact) obsługuje węższe obszary, więc na desktopie tabela zawsze się
        // mieści i poziome przewijanie nie jest już potrzebne.
        <div style={{ background: tokens.card, border: `1px solid ${tokens.border}`, borderRadius: 16, overflow: "visible" }}>
          <div style={{ overflow: "visible" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${tokens.border}`, background: tokens.bg }}>
                  <SortHeader label="Nazwa" k="title" sort={sort} onSort={toggleSort} />
                  <SortHeader label="Status" k="status" sort={sort} onSort={toggleSort} />
                  <SortHeader label="Wyświetlenia" k="views" sort={sort} onSort={toggleSort} num />
                  <SortHeader label="Unikalni" k="unique_users" sort={sort} onSort={toggleSort} num />
                  <SortHeader label="Zgłoszenia" k="completions" sort={sort} onSort={toggleSort} num />
                  <SortHeader label="Porzucone" k="abandoned" sort={sort} onSort={toggleSort} num />
                  <SortHeader label="Konwersja" k="conversion_rate" sort={sort} onSort={toggleSort} num />
                  <SortHeader label="Ostatnie" k="last_submission" sort={sort} onSort={toggleSort} />
                  <th style={{ width: 44 }} />
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <Row
                    key={r.id}
                    r={r}
                    onOpen={() => router.push(`/admin/forms/${r.id}`)}
                    onStats={() => router.push(`/admin/forms/${r.id}?tab=stats`)}
                    onShare={() => r.slug && setShareForm({ slug: r.slug, title: r.title })}
                    onCopy={() => copyLink(r.slug)}
                    onDuplicate={() => duplicate(r.id)}
                    onArchive={() => archive(r.id)}
                    onRestore={() => restore(r.id)}
                    onSubmissions={() => router.push(`/admin/forms/${r.id}?tab=submissions`)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {shareForm?.slug && (
        <ShareModal slug={shareForm.slug} title={shareForm.title} onClose={() => setShareForm(null)} />
      )}
    </div>
  );
}

function statusRank(r: MetricsRow): number {
  if (r.archived_at) return 2;
  return r.status === "published" ? 1 : 0;
}

function StatusBadge({ r }: { r: MetricsRow }) {
  const archived = !!r.archived_at;
  const published = r.status === "published";
  const label = archived ? "Archiwum" : published ? "Opublikowany" : "Szkic";
  const bg = archived ? tokens.bg : published ? "#E7F7EE" : tokens.bg;
  const color = archived ? tokens.muted : published ? tokens.success : tokens.muted;
  return (
    <span style={{ fontSize: 12, fontWeight: 600, padding: "3px 10px", borderRadius: 999, background: bg, color }}>
      {label}
    </span>
  );
}

// Komórka liczbowa: 0 wyświetleń → kreski (świeży formularz nie ma czytać się
// jak porażka). Reszta pokazuje liczbę.
function numCell(value: number, hasViews: boolean): React.ReactNode {
  if (!hasViews) return <span style={{ color: tokens.muted }}>—</span>;
  return value.toLocaleString("pl-PL");
}

function Row({
  r, onOpen, onStats, onShare, onCopy, onDuplicate, onArchive, onRestore, onSubmissions,
}: {
  r: MetricsRow;
  onOpen: () => void; onStats: () => void; onShare: () => void; onCopy: () => void;
  onDuplicate: () => void; onArchive: () => void; onRestore: () => void; onSubmissions: () => void;
}) {
  const archived = !!r.archived_at;
  const hasViews = r.views > 0;
  const muted = archived ? { opacity: 0.6 } : {};

  return (
    <tr
      style={{ borderBottom: `1px solid ${tokens.border}`, ...muted }}
      onMouseEnter={(e) => (e.currentTarget.style.background = tokens.bg)}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <td style={{ ...tdStyle, cursor: "pointer" }} onClick={onOpen}>
        <div style={{ fontWeight: 600 }}>{r.title || "Bez tytułu"}</div>
        {r.slug && <div style={{ fontSize: 12, color: tokens.muted, marginTop: 2 }}>/{r.slug}</div>}
      </td>
      <td style={tdStyle}><StatusBadge r={r} /></td>
      <td style={{ ...tdStyle, textAlign: "right" }}>{numCell(r.views, hasViews)}</td>
      <td style={{ ...tdStyle, textAlign: "right" }}>{numCell(r.unique_users, hasViews)}</td>
      <td style={{ ...tdStyle, textAlign: "right" }}>{numCell(r.completions, hasViews)}</td>
      <td style={{ ...tdStyle, textAlign: "right" }}>{numCell(r.abandoned, hasViews)}</td>
      <td style={{ ...tdStyle, textAlign: "right" }}>
        {hasViews && r.conversion_rate != null ? <ConversionBar pct={r.conversion_rate} /> : <span style={{ color: tokens.muted }}>—</span>}
      </td>
      <td style={tdStyle}>
        {r.last_submission ? formatRelative(r.last_submission) : <span style={{ color: tokens.muted }}>—</span>}
      </td>
      <td style={{ ...tdStyle, textAlign: "center", overflow: "visible" }} onClick={(e) => e.stopPropagation()}>
        <RowMenu
          archived={archived}
          hasSlug={!!r.slug}
          slug={r.slug}
          onOpen={onOpen} onStats={onStats} onShare={onShare} onCopy={onCopy}
          onDuplicate={onDuplicate} onArchive={onArchive} onRestore={onRestore} onSubmissions={onSubmissions}
        />
      </td>
    </tr>
  );
}

function MobileCard({
  r, onOpen, onStats, onShare, onCopy, onDuplicate, onArchive, onRestore, onSubmissions,
}: {
  r: MetricsRow;
  onOpen: () => void; onStats: () => void; onShare: () => void; onCopy: () => void;
  onDuplicate: () => void; onArchive: () => void; onRestore: () => void; onSubmissions: () => void;
}) {
  const archived = !!r.archived_at;
  const hasViews = r.views > 0;

  return (
    <div
      style={{
        background: tokens.card,
        border: `1px solid ${tokens.border}`,
        borderRadius: 14,
        padding: 14,
        ...(archived ? { opacity: 0.7 } : {}),
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={onOpen}>
          <div style={{ fontWeight: 600, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {r.title || "Bez tytułu"}
          </div>
          {r.slug && (
            <div style={{ fontSize: 12, color: tokens.muted, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              /{r.slug}
            </div>
          )}
        </div>
        <div onClick={(e) => e.stopPropagation()} style={{ flexShrink: 0 }}>
          <RowMenu
            archived={archived}
            hasSlug={!!r.slug}
            slug={r.slug}
            onOpen={onOpen} onStats={onStats} onShare={onShare} onCopy={onCopy}
            onDuplicate={onDuplicate} onArchive={onArchive} onRestore={onRestore} onSubmissions={onSubmissions}
          />
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        <StatusBadge r={r} />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 10,
          marginTop: 12,
        }}
      >
        <Metric label="Wyświetlenia" value={numCell(r.views, hasViews)} />
        <Metric label="Zgłoszenia" value={numCell(r.completions, hasViews)} />
        <Metric
          label="Konwersja"
          value={hasViews && r.conversion_rate != null ? `${r.conversion_rate.toFixed(1)}%` : <span style={{ color: tokens.muted }}>—</span>}
        />
      </div>

      <div style={{ marginTop: 12, fontSize: 12, color: tokens.muted }}>
        Ostatnie zgłoszenie:{" "}
        {r.last_submission ? formatRelative(r.last_submission) : "—"}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: tokens.muted, textTransform: "uppercase", letterSpacing: 0.3 }}>
        {label}
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
    </div>
  );
}

function ConversionBar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>{pct.toFixed(1)}%</span>
      <span style={{ width: 44, height: 6, borderRadius: 999, background: tokens.border, overflow: "hidden", display: "inline-block" }}>
        <span style={{ display: "block", height: "100%", width: `${clamped}%`, background: tokens.accent }} />
      </span>
    </div>
  );
}

function RowMenu({
  archived, hasSlug, slug, onOpen, onStats, onShare, onCopy, onDuplicate, onArchive, onRestore, onSubmissions,
}: {
  archived: boolean; hasSlug: boolean; slug: string | null;
  onOpen: () => void; onStats: () => void; onShare: () => void; onCopy: () => void;
  onDuplicate: () => void; onArchive: () => void; onRestore: () => void; onSubmissions: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const item = (icon: React.ReactNode, label: string, action: () => void, danger = false) => (
    <button
      onClick={() => { setOpen(false); action(); }}
      style={{
        display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
        padding: "9px 12px", border: "none", background: "transparent", cursor: "pointer",
        fontSize: 13, color: danger ? tokens.danger : tokens.text,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = tokens.bg)}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {icon}{label}
    </button>
  );

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Więcej akcji"
        style={{ width: 28, height: 28, borderRadius: 7, border: `1px solid ${tokens.border}`, background: "#fff", display: "grid", placeItems: "center", cursor: "pointer", color: tokens.muted }}
      >
        <MIcon name="more_horiz" size={16} />
      </button>
      {open && (
        <div style={{ ...menuPanel, position: "absolute", right: 0, top: 32, zIndex: 30, width: 200, padding: 4 }}>
          {archived ? (
            <>
              {item(<MIcon name="inbox" size={15} />, "Zobacz zgłoszenia", onSubmissions)}
              {item(<MIcon name="restore_from_trash" size={15} />, "Przywróć", onRestore)}
            </>
          ) : (
            <>
              {item(<MIcon name="edit" size={15} />, "Edytuj", onOpen)}
              {hasSlug && item(<MIcon name="link" size={15} />, "Kopiuj link", onCopy)}
              {hasSlug && item(<MIcon name="open_in_new" size={15} />, "Podgląd", () => slug && window.open(`/f/${slug}`, "_blank"))}
              {item(<MIcon name="content_copy" size={15} />, "Duplikuj", onDuplicate)}
              {item(<MIcon name="monitoring" size={15} />, "Statystyki", onStats)}
              {item(<MIcon name="archive" size={15} />, "Archiwizuj", onArchive, true)}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function FormsEmptyState({ tab, onNew }: { tab: "active" | "archive"; onNew: () => void }) {
  return (
    <div style={{ background: tokens.card, border: `1px solid ${tokens.border}`, borderRadius: tokens.radius }}>
      <EmptyState
        title={tab === "archive" ? "Brak zarchiwizowanych formularzy" : "Brak formularzy"}
        description={
          tab === "archive"
            ? "Zarchiwizowane formularze pojawią się tutaj."
            : "Utwórz pierwszy formularz, aby zbierać zgłoszenia."
        }
        action={tab === "active" ? { label: "Nowy formularz", icon: "add", onClick: onNew } : undefined}
      />
    </div>
  );
}

function SortHeader({
  label, k, sort, onSort, num,
}: {
  label: string; k: SortKey; sort: Sort; onSort: (k: SortKey) => void; num?: boolean;
}) {
  return (
    <th
      onClick={() => onSort(k)}
      style={{
        textAlign: num ? "right" : "left", padding: "12px 16px", fontSize: 12, fontWeight: 700,
        color: tokens.muted, cursor: "pointer", whiteSpace: "nowrap", userSelect: "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: num ? "flex-end" : "flex-start" }}>
        {label.toUpperCase()}
        {sort.key === k && <MIcon name={sort.dir === "asc" ? "arrow_upward" : "arrow_downward"} size={12} />}
      </div>
    </th>
  );
}

const tdStyle: React.CSSProperties = {
  padding: "14px 16px",
  fontSize: 14,
  color: tokens.text,
  whiteSpace: "nowrap",
};
